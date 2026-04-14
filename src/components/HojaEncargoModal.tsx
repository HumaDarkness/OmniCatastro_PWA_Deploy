import { useState, useRef, useEffect } from "react";
import { X, FileSignature, Save, Loader2, Upload, Eraser } from "lucide-react";
import SignatureCanvas from 'react-signature-canvas';
import { generarHojaEncargoPDF } from '../lib/pdfHojaEncargoGenerator';
import type { HojaEncargoPayload } from '../lib/pdfHojaEncargoGenerator';
import { saveAs } from 'file-saver';

interface HojaEncargoModalProps {
    prefillData: Partial<HojaEncargoPayload>;
    onClose: () => void;
}

export function HojaEncargoModal({ prefillData, onClose }: HojaEncargoModalProps) {
    const [loading, setLoading] = useState(false);
    const [step, setStep] = useState<1 | 2>(1); // 1: Datos, 2: Firmas
    const sigCanvasRef = useRef<SignatureCanvas>(null);
    const techSigCanvasRef = useRef<SignatureCanvas>(null);

    const [tecnico, setTecnico] = useState(() => {
        const saved = localStorage.getItem('tecnicoProfile');
        return saved ? JSON.parse(saved) : {
            nombre: "",
            nif: "",
            empresa: "",
            direccion: "",
            ciudad: "",
            cp: ""
        };
    });


    const [techFirmaUrl, setTechFirmaUrl] = useState<string | null>(tecnico.firmaBase64 || null);

    const [representante, setRepresentante] = useState("PROPIETARIO");
    const [lugarFirma, setLugarFirma] = useState(prefillData.lugarFirma || "");
    const [fechaFirma, setFechaFirma] = useState<Date>(prefillData.fechaFirma || new Date());

    useEffect(() => {
        if (tecnico.nombre) {
             localStorage.setItem('tecnicoProfile', JSON.stringify({ ...tecnico, firmaBase64: techFirmaUrl || undefined }));
        }
    }, [tecnico, techFirmaUrl]);

    const handleGenerate = async () => {
        setLoading(true);
        try {
            // Extraer Firma del Técnico si la dibujó
            let finalTechFirma = techFirmaUrl;
            if (techSigCanvasRef.current && !techSigCanvasRef.current.isEmpty()) {
                finalTechFirma = techSigCanvasRef.current.getTrimmedCanvas().toDataURL("image/png");
                setTechFirmaUrl(finalTechFirma);
            }

            // Extraer Firma del Propietario (Siempre se debe firmar en sitio)
            let finalPropFirma = undefined;
            if (sigCanvasRef.current && !sigCanvasRef.current.isEmpty()) {
                finalPropFirma = sigCanvasRef.current.getTrimmedCanvas().toDataURL("image/png");
            }

            const payload: HojaEncargoPayload = {
                tecnico,
                propietario: {
                    nombre: prefillData.propietario?.nombre || "",
                    nif: prefillData.propietario?.nif || "",
                    direccion: prefillData.propietario?.direccion || ""
                },
                inmueble: {
                    tipoVia: prefillData.inmueble?.tipoVia || "CALLE",
                    nombreVia: prefillData.inmueble?.nombreVia || "",
                    numero: prefillData.inmueble?.numero || "",
                    bloque: prefillData.inmueble?.bloque || "",
                    escalera: prefillData.inmueble?.escalera || "",
                    planta: prefillData.inmueble?.planta || "",
                    puerta: prefillData.inmueble?.puerta || "",
                    municipio: prefillData.inmueble?.municipio || "",
                    provincia: prefillData.inmueble?.provincia || "",
                    cp: prefillData.inmueble?.cp || "",
                    uso: prefillData.inmueble?.uso || "RESIDENCIAL"
                },
                lugarFirma: lugarFirma || prefillData.inmueble?.municipio || "",
                fechaFirma,
                tipoCliente: representante,
                firmaTecnicoDataUrl: finalTechFirma || undefined,
                firmaPropietarioDataUrl: finalPropFirma
            };

            const pdfBlob = await generarHojaEncargoPDF(payload);
            
            if (pdfBlob) {
                saveAs(pdfBlob, `Hoja_Encargo_${payload.propietario.nombre.replace(/ /g, "_")}.pdf`);
                onClose();
            } else {
                alert("Error generando el PDF. Revisa la consola.");
            }
        } catch (error) {
            console.error("Error generation:", error);
            alert("Ocurrió un error al generar la hoja de encargo.");
        } finally {
            setLoading(false);
        }
    };

    const handleUploadTechSignature = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const b64 = ev.target?.result as string;
                setTechFirmaUrl(b64);
            };
            reader.readAsDataURL(e.target.files[0]);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-[#0f0f23] border border-slate-700 shadow-2xl rounded-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="flex items-center justify-between p-5 border-b border-indigo-500/10 bg-[#0a0a1a]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-500/20 rounded-lg">
                            <FileSignature className="w-5 h-5 text-indigo-400" />
                        </div>
                        <h2 className="text-xl font-bold text-white">Hoja de Encargo</h2>
                    </div>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:text-white rounded-full hover:bg-slate-800 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {step === 1 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                            <div className="bg-[#0a0a1a] p-4 rounded-xl border border-slate-800">
                                <h3 className="text-sm font-semibold text-slate-300 mb-4 border-b border-slate-800 pb-2">Datos del Técnico (Autoguardado)</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">Nombre Completo</label>
                                        <input
                                            type="text" value={tecnico.nombre} onChange={e => setTecnico({ ...tecnico, nombre: e.target.value })}
                                            className="w-full bg-black/20 border border-slate-700 rounded-lg px-3 py-2 text-white outline-none focus:border-indigo-500 font-mono text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">DNI/NIF</label>
                                        <input
                                            type="text" value={tecnico.nif} onChange={e => setTecnico({ ...tecnico, nif: e.target.value })}
                                            className="w-full bg-black/20 border border-slate-700 rounded-lg px-3 py-2 text-white outline-none focus:border-indigo-500 font-mono text-sm"
                                            placeholder="50197286Q"
                                        />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-xs text-slate-400 mb-1">Razón Social Corp / Empresa (Opcional)</label>
                                        <input
                                            type="text" value={tecnico.empresa} onChange={e => setTecnico({ ...tecnico, empresa: e.target.value })}
                                            className="w-full bg-black/20 border border-slate-700 rounded-lg px-3 py-2 text-white outline-none focus:border-indigo-500 font-mono text-sm"
                                            placeholder="JASNET GLOBAL MARKETING S.L"
                                        />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-xs text-slate-400 mb-1">Dirección Fiscal</label>
                                        <input
                                            type="text" value={tecnico.direccion} onChange={e => setTecnico({ ...tecnico, direccion: e.target.value })}
                                            className="w-full bg-black/20 border border-slate-700 rounded-lg px-3 py-2 text-white outline-none focus:border-indigo-500 font-mono text-sm"
                                            placeholder="AVENIDA MANOTERAS 8"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="bg-[#0a0a1a] p-4 rounded-xl border border-slate-800">
                                <h3 className="text-sm font-semibold text-slate-300 mb-4 border-b border-slate-800 pb-2">Variables de Firma</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">Lugar de Firma</label>
                                        <input
                                            type="text" value={lugarFirma || prefillData.inmueble?.municipio || ""} onChange={e => setLugarFirma(e.target.value)}
                                            className="w-full bg-black/20 border border-slate-700 rounded-lg px-3 py-2 text-white outline-none focus:border-indigo-500 font-mono text-sm uppercase"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">Fecha de Firma</label>
                                        <input
                                            type="date"
                                            value={fechaFirma.toISOString().split('T')[0]}
                                            onChange={e => setFechaFirma(new Date(e.target.value))}
                                            className="w-full bg-black/20 border border-slate-700 rounded-lg px-3 py-2 text-white outline-none focus:border-indigo-500 font-mono text-sm"
                                        />
                                    </div>
                                    <div className="col-span-2">
                                        <label className="block text-xs text-slate-400 mb-1">Calidad del Cliente</label>
                                        <select 
                                            value={representante}
                                            onChange={e => setRepresentante(e.target.value)}
                                            className="w-full bg-black/20 border border-slate-700 rounded-lg px-3 py-2 text-white outline-none focus:border-indigo-500 font-mono text-sm"
                                        >
                                            <option value="PROPIETARIO">PROPIETARIO/A</option>
                                            <option value="REPRESENTANTE LEGAL">REPRESENTANTE LEGAL</option>
                                            <option value="INQUILINO">INQUILINO/A</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-end pt-4">
                                <button
                                    onClick={() => setStep(2)}
                                    className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors"
                                >
                                    Siguiente: Captura de Firmas
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                            
                            {/* Firma Técnico */}
                            <div className="bg-[#0a0a1a] p-4 rounded-xl border border-slate-800">
                                <h3 className="text-sm font-semibold text-slate-300 mb-2 border-b border-slate-800 pb-2 flex justify-between items-center">
                                    1. Firma del Técnico
                                    <label className="inline-flex items-center gap-1 text-[10px] bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded cursor-pointer transition-colors text-slate-300">
                                        <Upload className="w-3 h-3" /> Cargar Imagen
                                        <input type="file" accept="image/png, image/jpeg" className="hidden" onChange={handleUploadTechSignature} />
                                    </label>
                                </h3>
                                
                                {techFirmaUrl ? (
                                    <div className="relative border border-dashed border-slate-700 rounded-lg bg-black/30 p-2 flex justify-center h-32">
                                        <img src={techFirmaUrl} alt="Firma Técnico" className="h-full object-contain filter invert mix-blend-screen" />
                                        <button 
                                            onClick={() => setTechFirmaUrl(null)}
                                            className="absolute top-2 right-2 bg-red-500/20 text-red-400 p-1 rounded hover:bg-red-500/40"
                                            title="Limpiar Firma"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="border border-dashed border-slate-700 rounded-lg bg-white">
                                        <SignatureCanvas 
                                            ref={techSigCanvasRef}
                                            penColor="blue"
                                            canvasProps={{className: 'signature-canvas w-full h-32 rounded-lg'}}
                                        />
                                        <div className="flex justify-end p-2 bg-slate-100 rounded-b-lg border-t border-slate-200">
                                            <button 
                                                onClick={() => techSigCanvasRef.current?.clear()}
                                                className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1"
                                            >
                                                <Eraser className="w-3 h-3" /> Borrar
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Firma Propietario (Siempre Canvas en Sitio) */}
                            <div className="bg-[#0a0a1a] p-4 rounded-xl border border-slate-800 ring-2 ring-indigo-500/30">
                                <h3 className="text-sm font-semibold text-white mb-2 border-b border-slate-800 pb-2">
                                    2. Firma del Cliente ({representante})
                                </h3>
                                <p className="text-[11px] text-slate-400 mb-2">Solicite al cliente que firme en el recuadro blanco utilizando el dedo o un stylus.</p>
                                
                                <div className="border-2 border-slate-400 rounded-lg bg-white overflow-hidden shadow-inner">
                                    <SignatureCanvas 
                                        ref={sigCanvasRef}
                                        penColor="black"
                                        canvasProps={{className: 'signature-canvas w-full h-48'}}
                                    />
                                    <div className="flex justify-between items-center p-2 bg-slate-100 border-t border-slate-300">
                                        <span className="text-xs font-medium text-slate-500 ml-2">Fdo: {prefillData.propietario?.nombre || "El Cliente"}</span>
                                        <button 
                                            onClick={() => sigCanvasRef.current?.clear()}
                                            className="text-xs text-slate-600 hover:text-red-600 flex items-center gap-1 px-3 py-1 rounded bg-slate-200 hover:bg-red-100 transition-colors"
                                        >
                                            <Eraser className="w-4 h-4" /> Borrar Firma
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-between pt-4">
                                <button
                                    onClick={() => setStep(1)}
                                    className="px-4 py-2 hover:bg-slate-800 text-slate-300 rounded-lg transition-colors"
                                    disabled={loading}
                                >
                                    Volver
                                </button>
                                <button
                                    onClick={handleGenerate}
                                    disabled={loading}
                                    className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 select-none text-white rounded-lg font-medium shadow-lg shadow-indigo-500/20 transition-all active:scale-95 flex items-center gap-2 disabled:opacity-50"
                                >
                                    {loading ? (
                                        <><Loader2 className="w-4 h-4 animate-spin" /> Generando...</>
                                    ) : (
                                        <><Save className="w-4 h-4" /> Generar & Descargar Hoja Aplanada</>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
