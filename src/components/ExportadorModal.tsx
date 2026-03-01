import { useState } from "react";
import { X, Download, FileArchive, FileText, ImageIcon, Settings2, Loader2, CloudIcon } from "lucide-react";
import { useGoogleLogin } from '@react-oauth/google';
import { getOrCreateFolder, uploadFileToDrive } from "../lib/googleDriveService";
import { supabase } from "../lib/supabase";
import jsPDF from "jspdf";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import type { Project } from "../ProyectosView";
import type { Client } from "../ClientesView";
import type { Photo } from "../ProyectoDetalle";

interface ExportadorModalProps {
    project: Project;
    photos: Photo[];
    onClose: () => void;
}

export function ExportadorModal({ project, photos, onClose }: ExportadorModalProps) {
    const [loading, setLoading] = useState(true);
    const [client, setClient] = useState<Client | null>(null);
    const [exporting, setExporting] = useState(false);
    const [progress, setProgress] = useState(0);
    const [statusText, setStatusText] = useState("");

    // Nomenclature configs
    const defaultPrefix = project.nexo_reference || project.rc.slice(0, 6);
    const [prefix, setPrefix] = useState(defaultPrefix);
    const [includePdfDni, setIncludePdfDni] = useState(true);
    const [includeInformePdf, setIncludeInformePdf] = useState(true);
    const [includePhotos, setIncludePhotos] = useState(false); // Por defecto falso para priorizar el informe

    // Nombres Fijos Modificables
    const [nameDniPdf, setNameDniPdf] = useState("DNI propietario inicial");
    const [nameInformePdf, setNameInformePdf] = useState("INFORME FOTOGRAFICO ANTES Y DESPUES");
    const [nameAntes, setNameAntes] = useState("FOTO ANTES");
    const [nameDespues, setNameDespues] = useState("FOTO DESPUES");

    // Google Drive State
    const [googleAccessToken, setGoogleAccessToken] = useState<string | null>(null);
    const [includeGoogleDrive, setIncludeGoogleDrive] = useState(false);

    const login = useGoogleLogin({
        onSuccess: tokenResponse => {
            setGoogleAccessToken(tokenResponse.access_token);
            setIncludeGoogleDrive(true);
        },
        scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive',
    });

    useState(() => {
        if (project.client_id) {
            loadClient();
        } else {
            setLoading(false);
        }
    });

    async function loadClient() {
        const { data } = await supabase.from('clients').select('*').eq('id', project.client_id).single();
        if (data) setClient(data as Client);
        setLoading(false);
    }

    // Helper to get image as base64 or blob
    async function fetchImageBlob(path: string): Promise<Blob | null> {
        try {
            const { data } = await supabase.storage.from('work_photos').download(path);
            return data;
        } catch (e) {
            console.error(e);
            return null;
        }
    }

    // Helper to convert blob to data url for jsPDF
    function blobToDataUrl(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    async function handleExport() {
        setExporting(true);
        setStatusText("Iniciando exportación...");
        setProgress(10);
        const zip = new JSZip();
        const clientName = client ? `${client.last_name_1} ${client.first_name}`.trim().toUpperCase() : '';
        const baseFolder = zip.folder(`Expediente_${prefix}_${clientName}`.trim());

        try {
            // 1. Generate DNI PDF
            if (includePdfDni && client && (client.dni_front_path || client.dni_back_path)) {
                setStatusText("Generando PDF unificado del DNI...");
                setProgress(30);
                const doc = new jsPDF('p', 'mm', 'a4');
                let yPos = 20;

                doc.setFontSize(14);
                doc.text(`Documento de Identidad: ${clientName} (${client.dni || 'S/N'})`, 20, yPos);
                yPos += 15;

                if (client.dni_front_path) {
                    const frontBlob = await fetchImageBlob(client.dni_front_path);
                    if (frontBlob) {
                        const b64 = await blobToDataUrl(frontBlob);
                        // A4 is 210x297. Put image centered, max width 150mm
                        doc.text("Anverso:", 20, yPos);
                        yPos += 5;
                        doc.addImage(b64, 'JPEG', 30, yPos, 150, 95); // Approximate ID card aspect ratio
                        yPos += 105;
                    }
                }

                if (client.dni_back_path) {
                    const backBlob = await fetchImageBlob(client.dni_back_path);
                    if (backBlob) {
                        const b64 = await blobToDataUrl(backBlob);
                        doc.text("Reverso:", 20, yPos);
                        yPos += 5;
                        doc.addImage(b64, 'JPEG', 30, yPos, 150, 95);
                    }
                }

                const pdfBlob = doc.output('blob');
                const pdfName = `${prefix} ${nameDniPdf} ${clientName}`.trim() + '.pdf';
                baseFolder?.file(pdfName, pdfBlob);
            }

            // 2. Download Separate Photos (Optional)
            if (includePhotos && photos.length > 0) {
                setStatusText("Descargando fotografías sueltas...");
                setProgress(50);

                let idxAntes = 1;
                let idxDespues = 1;

                for (let i = 0; i < photos.length; i++) {
                    const photo = photos[i];
                    const pBlob = await fetchImageBlob(photo.storage_path);
                    if (pBlob) {
                        const ext = photo.storage_path.split('.').pop() || 'jpg';
                        let fName = "";
                        if (photo.category === 'antes') {
                            fName = `${prefix} ${nameAntes} ${clientName} ${idxAntes}.${ext}`.trim();
                            idxAntes++;
                        } else {
                            fName = `${prefix} ${nameDespues} ${clientName} ${idxDespues}.${ext}`.trim();
                            idxDespues++;
                        }
                        baseFolder?.file(fName, pBlob);
                    }
                }
            }

            // 3. Generate Informe Fotográfico PDF
            if (includeInformePdf && photos.length > 0) {
                setStatusText("Generando Informe Fotográfico PDF...");
                setProgress(75);
                const docInst = new jsPDF('p', 'mm', 'a4');
                const pageWidth = 210;
                const margin = 20;
                const contentWidth = pageWidth - margin * 2;

                let yPos = 20;
                let imagesOnPage = 0;
                let isFirstPage = true;

                // Group photos
                const antesPhotos = photos.filter(p => p.category === 'antes');
                const despuesPhotos = photos.filter(p => p.category === 'despues');
                const allInformePhotos = [...antesPhotos, ...despuesPhotos];

                for (let i = 0; i < allInformePhotos.length; i++) {
                    const photo = allInformePhotos[i];

                    if (imagesOnPage === 2) {
                        docInst.addPage();
                        yPos = 20;
                        imagesOnPage = 0;
                        isFirstPage = false;
                    }

                    if (isFirstPage && imagesOnPage === 0) {
                        docInst.setFontSize(14);
                        docInst.setFont("helvetica", "bold");
                        docInst.text(`${nameInformePdf} ${clientName}`.trim(), pageWidth / 2, yPos, { align: 'center' });
                        yPos += 15;
                    }

                    docInst.setFontSize(12);
                    docInst.setFont("helvetica", "bold");

                    const isAntes = photo.category === 'antes';
                    const indexInGroup = isAntes ? antesPhotos.indexOf(photo) + 1 : despuesPhotos.indexOf(photo) + 1;
                    const photoTitle = isAntes ? `ESTADO PREVIO (ANTES) - Foto ${indexInGroup}` : `ESTADO POSTERIOR (DESPUES) - Foto ${indexInGroup}`;

                    docInst.text(photoTitle, margin, yPos);
                    yPos += 5;

                    const pBlob = await fetchImageBlob(photo.storage_path);
                    if (pBlob) {
                        const b64 = await blobToDataUrl(pBlob);
                        docInst.addImage(b64, 'JPEG', margin, yPos, contentWidth, 100);
                        yPos += 105;
                    } else {
                        docInst.setFont("helvetica", "normal");
                        docInst.text("[Error al cargar imagen]", margin, yPos + 10);
                        yPos += 20;
                    }

                    imagesOnPage++;
                    yPos += 10;
                }

                const informeBlob = docInst.output('blob');
                const informeName = `${prefix} ${nameInformePdf} ${clientName}.pdf`.trim();
                baseFolder?.file(informeName, informeBlob);
            }

            // 3. Generate ZIP
            setStatusText("Empaquetando archivo ZIP...");
            setProgress(90);
            const zipContent = await zip.generateAsync({ type: "blob" });
            const zipFileName = `EXP_${prefix}_${clientName || project.rc}.zip`.trim();
            saveAs(zipContent, zipFileName);

            // 4. Upload to Google Drive (Optional)
            if (includeGoogleDrive && googleAccessToken) {
                setStatusText("Sincronizando con Google Drive...");
                try {
                    const rootId = await getOrCreateFolder(googleAccessToken, "OmniCatastro_Expedientes");
                    const projName = `${prefix} ${clientName}`.trim();
                    const projId = await getOrCreateFolder(googleAccessToken, projName, rootId);

                    const zipFile = new File([zipContent], zipFileName, { type: 'application/zip' });
                    await uploadFileToDrive(googleAccessToken, zipFile, zipFileName, projId);
                    setStatusText("¡Sincronizado con Google Drive!");
                } catch (err) {
                    console.error("Error Drive:", err);
                    setStatusText("Error en Drive (ZIP guardado local).");
                }
            }

            setProgress(100);
            setStatusText("¡Exportación completada!");
            setTimeout(() => onClose(), 2000);

        } catch (error: any) {
            alert("Error en la exportación: " + error.message);
            setExporting(false);
            setProgress(0);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-[#0f0f23] border border-slate-700 shadow-2xl rounded-2xl w-full max-w-lg overflow-hidden flex flex-col">
                <div className="flex items-center justify-between p-5 border-b border-indigo-500/10 bg-[#0a0a1a]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-500/20 rounded-lg">
                            <FileArchive className="w-5 h-5 text-indigo-400" />
                        </div>
                        <h2 className="text-xl font-bold text-white">Exportar Expediente</h2>
                    </div>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:text-white rounded-full hover:bg-slate-800 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 space-y-6 overflow-y-auto">
                    {loading ? (
                        <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>
                    ) : (
                        <>
                            {/* Context Information */}
                            <div className="bg-[#0a0a1a] p-4 rounded-xl border border-slate-800">
                                <p className="text-sm text-slate-400">Titular del Expediente:</p>
                                <p className="text-lg font-semibold text-white">
                                    {client ? `${client.first_name} ${client.last_name_1}` : "Sin cliente asociado"}
                                    {client?.dni && <span className="ml-2 text-sm text-indigo-400 font-mono">({client.dni})</span>}
                                </p>
                            </div>

                            {/* Nomenclature Setup */}
                            <div className="space-y-4">
                                <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2 border-b border-slate-800 pb-2">
                                    <Settings2 className="w-4 h-4 text-indigo-400" /> Nomenclatura PWA B2B
                                </h3>

                                <div>
                                    <label className="block text-xs text-slate-400 mb-1">Prefijo Base (Ej: Código Nexo)</label>
                                    <input
                                        type="text" value={prefix} onChange={e => setPrefix(e.target.value)}
                                        className="w-full bg-black/20 border border-slate-700 rounded-lg px-3 py-2 text-white outline-none focus:border-indigo-500 font-mono text-sm"
                                        placeholder="E1-3-4"
                                    />
                                    <p className="text-[10px] text-slate-500 mt-1">Todos los archivos iniciarán con este código.</p>
                                </div>

                                <div className="grid grid-cols-1 gap-3">
                                    <div className="flex items-start gap-3 bg-black/20 p-3 rounded-lg border border-slate-800">
                                        <input
                                            type="checkbox" checked={includePdfDni} onChange={e => setIncludePdfDni(e.target.checked)}
                                            className="mt-1 accent-indigo-500" disabled={!client?.dni_front_path}
                                        />
                                        <div className="w-full">
                                            <p className="text-sm font-medium text-slate-200 flex items-center gap-1">
                                                <FileText className="w-4 h-4 text-emerald-400" /> PDF Unificado DNI
                                            </p>
                                            <input
                                                type="text" value={nameDniPdf} onChange={e => setNameDniPdf(e.target.value)} disabled={!includePdfDni}
                                                className="mt-2 w-full bg-transparent border-b border-slate-700 text-xs text-indigo-300 outline-none focus:border-indigo-500"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex items-start gap-3 bg-black/20 p-3 rounded-lg border border-slate-800">
                                        <input
                                            type="checkbox" checked={includeInformePdf} onChange={e => setIncludeInformePdf(e.target.checked)}
                                            className="mt-1 accent-indigo-500" disabled={photos.length === 0}
                                        />
                                        <div className="w-full">
                                            <p className="text-sm font-medium text-slate-200 flex items-center gap-1">
                                                <FileText className="w-4 h-4 text-orange-400" /> Informe Fotográfico PDF (Antes/Después)
                                            </p>
                                            <p className="text-[10px] text-slate-500 mt-1">Acopla las imágenes a tamaño completo (2 por hoja).</p>
                                            <input
                                                type="text" value={nameInformePdf} onChange={e => setNameInformePdf(e.target.value)} disabled={!includeInformePdf}
                                                className="mt-2 w-full bg-transparent border-b border-slate-700 text-xs text-indigo-300 outline-none focus:border-indigo-500"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex items-start gap-3 bg-black/20 p-3 rounded-lg border border-slate-800 opacity-80">
                                        <input
                                            type="checkbox" checked={includePhotos} onChange={e => setIncludePhotos(e.target.checked)}
                                            className="mt-1 accent-indigo-500" disabled={photos.length === 0}
                                        />
                                        <div className="w-full">
                                            <p className="text-sm font-medium text-slate-200 flex items-center gap-1">
                                                <ImageIcon className="w-4 h-4 text-blue-400" /> Adjuntar Fotos Sueltas (Opcional)
                                            </p>
                                            <div className="grid grid-cols-2 gap-2 mt-2">
                                                <input
                                                    type="text" value={nameAntes} onChange={e => setNameAntes(e.target.value)} disabled={!includePhotos}
                                                    className="w-full bg-transparent border-b border-slate-700 text-xs text-indigo-300 outline-none focus:border-indigo-500"
                                                    placeholder="Nomenclatura (Antes)"
                                                />
                                                <input
                                                    type="text" value={nameDespues} onChange={e => setNameDespues(e.target.value)} disabled={!includePhotos}
                                                    className="w-full bg-transparent border-b border-slate-700 text-xs text-indigo-300 outline-none focus:border-indigo-500"
                                                    placeholder="Nomenclatura (Después)"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Google Drive Integration */}
                                    <div className={`p-4 rounded-xl border transition-all ${googleAccessToken ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-blue-500/10 border-blue-500/30'}`}>
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="flex items-center gap-2">
                                                <CloudIcon className={`w-5 h-5 ${googleAccessToken ? 'text-emerald-400' : 'text-blue-400'}`} />
                                                <span className="text-sm font-semibold text-white">Google Drive B2B</span>
                                            </div>
                                            {!googleAccessToken ? (
                                                <button
                                                    onClick={() => login()}
                                                    className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded-md transition-colors"
                                                >
                                                    Conectar
                                                </button>
                                            ) : (
                                                <span className="text-[10px] text-emerald-400 font-medium bg-emerald-400/10 px-2 py-0.5 rounded-full">Vinculado</span>
                                            )}
                                        </div>
                                        <label className="flex items-center gap-3 cursor-pointer">
                                            <input
                                                type="checkbox" checked={includeGoogleDrive}
                                                onChange={e => setIncludeGoogleDrive(e.target.checked)}
                                                disabled={!googleAccessToken}
                                                className="accent-emerald-500"
                                            />
                                            <div className="flex flex-col">
                                                <span className="text-xs text-slate-200">Guardar copia en la nube automáticamente</span>
                                                <span className="text-[10px] text-slate-500">Crea carpeta por expediente en OmniCatastro_Expedientes</span>
                                            </div>
                                        </label>
                                    </div>
                                </div>
                            </div>

                            {/* Preview */}
                            <div className="bg-slate-900/50 p-3 rounded-lg font-mono text-xs text-slate-400 border border-slate-800">
                                <p className="text-slate-500 mb-1">Ejemplos de salida:</p>
                                <p>📄 {prefix} {nameDniPdf} {client?.last_name_1} {client?.first_name}.pdf</p>
                                <p>🖼️ {prefix} {nameAntes} {client?.last_name_1} {client?.first_name} 1.jpg</p>
                            </div>
                        </>
                    )}
                </div>

                {/* Footer Controls */}
                <div className="p-5 border-t border-indigo-500/10 bg-[#0a0a1a]">
                    {exporting ? (
                        <div className="space-y-2">
                            <div className="flex justify-between text-xs font-medium text-indigo-300">
                                <span>{statusText}</span>
                                <span>{progress}%</span>
                            </div>
                            <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                                <div className="bg-indigo-500 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex gap-3">
                            <button onClick={onClose} className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium rounded-lg transition-colors">
                                Cancelar
                            </button>
                            <button
                                onClick={handleExport} disabled={loading || (!includePdfDni && !includePhotos)}
                                className="flex-2 flex items-center justify-center gap-2 py-2.5 px-6 bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white font-medium rounded-lg shadow-lg shadow-indigo-500/20 disabled:opacity-50 transition-all"
                            >
                                <Download className="w-5 h-5" />
                                Descargar Expediente .ZIP
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
