import { useState, useRef, useEffect } from "react";
import { 
    FileSignature, Save, Loader2, Upload, Eraser, Search, MapPin, Sparkles, Plus, Check, X, Shield
} from "lucide-react";
import SignatureCanvas from 'react-signature-canvas';
import { generarHojaEncargoPDF } from './lib/pdfHojaEncargoGenerator';
import type { HojaEncargoPayload } from './lib/pdfHojaEncargoGenerator';
import { saveAs } from 'file-saver';
import { supabase } from './lib/supabase';
import { consultarCatastro, extraerDatosInmuebleUnico } from './lib/catastroService';
import { useSignatureProcessing } from './features/hoja-encargo/hooks/useSignatureProcessing';

export function HojaEncargoStandaloneView() {
    // ---- Stores ----
    const [tecnico, setTecnico] = useState(() => {
        const saved = localStorage.getItem('tecnicoProfile');
        return saved ? JSON.parse(saved) : { nombre: "", nif: "", empresa: "", direccion: "", ciudad: "", cp: "" };
    });

    // ---- Refs ----
    const sigCanvasRef = useRef<SignatureCanvas>(null);
    const techSigCanvasRef = useRef<SignatureCanvas>(null);

    // ---- Form States ----
    const [loading, setLoading] = useState(false);
    const { processAndSaveTechnicalSignature, processSignature } = useSignatureProcessing();
    

    const [techFirmaUrl, setTechFirmaUrl] = useState<string | null>(tecnico.firmaBase64 || null);

    // Inmueble / Catastro
    const [rcInput, setRcInput] = useState("");
    const [catastroLoading, setCatastroLoading] = useState(false);
    const [inmueble, setInmueble] = useState({
        tipoVia: "CALLE", nombreVia: "", numero: "", bloque: "", 
        escalera: "", planta: "", puerta: "", municipio: "", provincia: "", cp: "", uso: "RESIDENCIAL",
    });

    // Cliente
    const [clientsList, setClientsList] = useState<any[]>([]);
    const [selectedClient, setSelectedClient] = useState<string | "NEW">("");
    const [representante, setRepresentante] = useState("PROPIETARIO");
    const [lugarFirma, setLugarFirma] = useState("");
    const [fechaFirma, setFechaFirma] = useState<Date>(new Date());

    // Magic Paste / Quick Add Client
    const [showQuickAdd, setShowQuickAdd] = useState(false);
    const [quickClient, setQuickClient] = useState({ nombre: "", apellido1: "", apellido2: "", dni: "", direccion: "" });
    const [magicPasteText, setMagicPasteText] = useState("");

    // Alerts
    const [uxMessage, setUxMessage] = useState<{type: 'error' | 'success', text: string} | null>(null);

    // ---- Effects ----
    useEffect(() => {
        loadClientsList();
    }, []);

    useEffect(() => {
        if (tecnico.nombre) {
             localStorage.setItem('tecnicoProfile', JSON.stringify({ ...tecnico, firmaBase64: techFirmaUrl || undefined }));
        }
    }, [tecnico, techFirmaUrl]);

    // ---- Functions ----
    async function loadClientsList() {
        const { data } = await supabase.from('clients').select('id, first_name, last_name_1, last_name_2, dni, address').order('created_at', { ascending: false });
        if (data) setClientsList(data);
    }

    async function handleCatastroLookup() {
        if (!rcInput || rcInput.length < 14) {
            setUxMessage({ type: 'error', text: 'RC inválida. Debe tener al menos 14 caracteres.' });
            return;
        }
        setCatastroLoading(true);
        setUxMessage(null);
        try {
            const res = await consultarCatastro(rcInput);
            if (res.error || !res.datos) throw new Error(res.error || 'Error conectando con Catastro');
            const data = extraerDatosInmuebleUnico(res.datos);
            setInmueble(prev => ({
                ...prev,
                tipoVia: data.tipoVia || prev.tipoVia,
                nombreVia: data.nombreVia || prev.nombreVia,
                numero: data.numero || prev.numero,
                bloque: data.bloque || prev.bloque,
                planta: data.planta || prev.planta,
                puerta: data.puerta || prev.puerta,
                escalera: data.escalera || prev.escalera,
                municipio: data.municipio || prev.municipio,
                provincia: data.provincia || prev.provincia,
                cp: data.codigoPostal || prev.cp,
                uso: data.uso || prev.uso,
            }));
            if (data.municipio && !lugarFirma) {
                setLugarFirma(data.municipio);
            }
            setUxMessage({ type: 'success', text: 'Datos catastrales sincronizados.' });
        } catch (e: any) {
            setUxMessage({ type: 'error', text: e.message || 'Error consultando catastro.' });
        } finally {
            setCatastroLoading(false);
        }
    }

    function handleMagicPaste() {
        if (!magicPasteText) return;
        const text = magicPasteText;
        const dniMatch = text.match(/[XYZ]\d{7}[A-Z]|\d{8}[A-Z]/i);
        let extDni = quickClient.dni;
        if (dniMatch) extDni = dniMatch[0].toUpperCase();

        let cleanText = text.replace(/[XYZ]\d{7}[A-Z]|\d{8}[A-Z]/i, '').trim();
        cleanText = cleanText.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ');
        const parts = cleanText.split(' ').filter(Boolean);
        
        let extNombre = quickClient.nombre;
        let extAp1 = quickClient.apellido1;
        let extAp2 = quickClient.apellido2;

        if (parts.length >= 3) {
           extAp2 = parts.pop() || '';
           extAp1 = parts.pop() || '';
           extNombre = parts.join(' ');
        } else if (parts.length === 2) {
           extAp1 = parts[1];
           extNombre = parts[0];
        } else if (parts.length === 1) {
           extNombre = parts[0];
        }

        setQuickClient({ ...quickClient, nombre: extNombre, apellido1: extAp1, apellido2: extAp2, dni: extDni });
        setMagicPasteText("");
        setUxMessage({ type: 'success', text: 'Análisis IA Mixta completado.' });
    }

    async function handleSaveQuickClient() {
        setLoading(true);
        setUxMessage(null);
        try {
            const { data, error } = await supabase.from('clients').insert([{
                first_name: quickClient.nombre,
                last_name_1: quickClient.apellido1,
                last_name_2: quickClient.apellido2,
                dni: quickClient.dni,
                address: quickClient.direccion || null,
                client_type: 'individual'
            }]).select().single();
            
            if (error) throw error;
            
            await loadClientsList();
            setSelectedClient(data.id);
            setShowQuickAdd(false);
            setQuickClient({ nombre: "", apellido1: "", apellido2: "", dni: "", direccion: "" });
            setUxMessage({ type: 'success', text: 'Cliente guardado correctamente.' });
        } catch (e: any) {
            setUxMessage({ type: 'error', text: 'Error guardando cliente: ' + e.message });
        } finally {
            setLoading(false);
        }
    }

    const handleUploadTechSignature = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setLoading(true);
            try {
                const blob = await processAndSaveTechnicalSignature(e.target.files[0]);
                if (blob) setTechFirmaUrl(URL.createObjectURL(blob));
            } catch(e) {
               console.error(e);
               setUxMessage({ type: 'error', text: 'Error procesando la firma.' });
            } finally {
                setLoading(false);
            }
        }
    };

    const handleGenerate = async () => {
        setLoading(true);
        setUxMessage(null);
        try {
            // Cliente Resolver
            let propietarioPayload = { nombre: "A DEFINIR", nif: "", direccion: "" };
            if (selectedClient && selectedClient !== "NEW") {
                const c = clientsList.find(c => c.id === selectedClient);
                if (c) {
                    propietarioPayload = {
                        nombre: `${c.first_name} ${c.last_name_1} ${c.last_name_2 || ''}`.trim(),
                        nif: c.dni || "",
                        direccion: (c.address as any) || ""
                    };
                }
            } else if (selectedClient === "NEW" && quickClient.nombre) {
                // Modo Borrador - no quiso guardarlo pero lo rellenó
                propietarioPayload = {
                    nombre: `${quickClient.nombre} ${quickClient.apellido1} ${quickClient.apellido2}`.trim(),
                    nif: quickClient.dni,
                    direccion: quickClient.direccion
                };
            }

            // Firmas
            let tecnicoBlob = undefined;
            if (techSigCanvasRef.current && !techSigCanvasRef.current.isEmpty()) {
                const blob = await fetch(techSigCanvasRef.current.getTrimmedCanvas().toDataURL("image/png")).then(r => r.blob());
                tecnicoBlob = await processAndSaveTechnicalSignature(blob) || undefined;
            } else if (techFirmaUrl) {
                tecnicoBlob = await fetch(techFirmaUrl).then(r => r.blob());
            }

            let propietarioBlob = undefined;
            if (sigCanvasRef.current && !sigCanvasRef.current.isEmpty()) {
                const blob = await fetch(sigCanvasRef.current.getTrimmedCanvas().toDataURL("image/png")).then(r => r.blob());
                propietarioBlob = await processSignature(blob) || undefined;
            }

            const inmueblePayload: HojaEncargoPayload["inmueble"] = {
                tipoVia: inmueble.tipoVia,
                nombreVia: inmueble.nombreVia,
                numero: inmueble.numero,
                bloque: inmueble.bloque,
                escalera: inmueble.escalera,
                planta: inmueble.planta,
                puerta: inmueble.puerta,
                municipio: inmueble.municipio,
                provincia: inmueble.provincia,
                cp: inmueble.cp,
                uso: inmueble.uso,
            };

            const payload: HojaEncargoPayload = {
                tecnico,
                propietario: propietarioPayload,
                inmueble: inmueblePayload,
                lugarFirma: lugarFirma || inmueble.municipio || "MADRID",
                fechaFirma,
                tipoCliente: representante,
                firmaTecnicoBlob: tecnicoBlob,
                firmaPropietarioBlob: propietarioBlob
            };

            const pdfBlob = await generarHojaEncargoPDF(payload);
            if (pdfBlob) {
                saveAs(pdfBlob, `Hoja_Encargo_${propietarioPayload.nombre.replace(/ /g, "_")}_${new Date().getFullYear()}.pdf`);
                setUxMessage({ type: 'success', text: 'Hoja de Encargo generada y descargada localmente.' });
            }
        } catch (error) {
            console.error("Error generation:", error);
            setUxMessage({ type: 'error', text: 'Ocurrió un error al generar la hoja de encargo.' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden bg-[#060612] relative">
            {/* Header Módulo */}
            <div className="p-6 md:p-8 flex items-center justify-between border-b border-indigo-500/10 bg-[#0a0a1a] shrink-0">
                <div className="flex items-center gap-4 text-indigo-400">
                    <div className="p-3 bg-indigo-500/10 rounded-xl ring-1 ring-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.1)]">
                        <FileSignature className="w-6 h-6" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-200 tracking-tight">Hoja de Encargo</h1>
                        <p className="text-sm text-slate-400 mt-1 flex items-center gap-2">
                            Generador Autónomo <span title="Generación local PDF"><Shield className="w-3 h-3 text-emerald-400" /></span>
                        </p>
                    </div>
                </div>
                <button
                    onClick={handleGenerate}
                    disabled={loading}
                    className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-50"
                >
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                    <span className="hidden sm:inline">Descargar PDF</span>
                </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-4 md:p-8">
                
                {uxMessage && (
                    <div className={`mb-6 p-4 rounded-xl border flex items-center gap-3 ${uxMessage.type === 'error' ? 'bg-rose-500/10 border-rose-500/20 text-rose-300' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'} animate-in fade-in slide-in-from-top-2`}>
                        {uxMessage.type === 'error' ? <X className="w-5 h-5 shrink-0" /> : <Check className="w-5 h-5 shrink-0" />}
                        <p className="text-sm font-medium">{uxMessage.text}</p>
                    </div>
                )}

                <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 max-w-7xl mx-auto">
                    
                    {/* Left Column: Forms */}
                    <div className="xl:col-span-7 space-y-6">
                        
                        {/* CATASTRO Y VIVIENDA */}
                        <div className="bg-[#0a0a1a] border border-slate-800/60 rounded-xl p-5 md:p-6 shadow-sm">
                            <h2 className="text-sm font-bold text-slate-200 mb-4 flex items-center gap-2 border-b border-slate-800/50 pb-3">
                                <MapPin className="w-4 h-4 text-indigo-400" /> Identificación del Inmueble (Catastro)
                            </h2>
                            <div className="flex gap-2 mb-4">
                                <input
                                    type="text" value={rcInput} onChange={e => setRcInput(e.target.value.toUpperCase())}
                                    placeholder="Referencia Catastral (14 o 20 dígitos)"
                                    className="flex-1 bg-black/20 border border-slate-700 rounded-lg px-4 py-2.5 text-white outline-none focus:border-indigo-500 font-mono text-sm uppercase transition-colors placeholder:normal-case"
                                />
                                <button
                                    onClick={handleCatastroLookup} disabled={catastroLoading}
                                    className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
                                >
                                    {catastroLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                                    Buscar
                                </button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                                <div className="md:col-span-4">
                                    <label className="block text-xs font-semibold text-slate-500 mb-1">Tipo Vía</label>
                                    <input type="text" value={inmueble.tipoVia} onChange={e => setInmueble({...inmueble, tipoVia: e.target.value})} className="w-full bg-black/20 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:border-indigo-500 outline-none text-sm" />
                                </div>
                                <div className="md:col-span-8">
                                    <label className="block text-xs font-semibold text-slate-500 mb-1">Nombre Vía</label>
                                    <input type="text" value={inmueble.nombreVia} onChange={e => setInmueble({...inmueble, nombreVia: e.target.value})} className="w-full bg-black/20 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:border-indigo-500 outline-none text-sm" />
                                </div>
                                <div className="md:col-span-3">
                                    <label className="block text-xs font-semibold text-slate-500 mb-1">Número</label>
                                    <input type="text" value={inmueble.numero} onChange={e => setInmueble({...inmueble, numero: e.target.value})} className="w-full bg-black/20 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:border-indigo-500 outline-none text-sm" />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-xs font-semibold text-slate-500 mb-1">Bloq</label>
                                    <input type="text" value={inmueble.bloque} onChange={e => setInmueble({...inmueble, bloque: e.target.value})} className="w-full bg-black/20 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:border-indigo-500 outline-none text-sm" />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-xs font-semibold text-slate-500 mb-1">Esc</label>
                                    <input type="text" value={inmueble.escalera} onChange={e => setInmueble({...inmueble, escalera: e.target.value})} className="w-full bg-black/20 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:border-indigo-500 outline-none text-sm" />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-xs font-semibold text-slate-500 mb-1">Plt</label>
                                    <input type="text" value={inmueble.planta} onChange={e => setInmueble({...inmueble, planta: e.target.value})} className="w-full bg-black/20 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:border-indigo-500 outline-none text-sm" />
                                </div>
                                <div className="md:col-span-3">
                                    <label className="block text-xs font-semibold text-slate-500 mb-1">Pta</label>
                                    <input type="text" value={inmueble.puerta} onChange={e => setInmueble({...inmueble, puerta: e.target.value})} className="w-full bg-black/20 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:border-indigo-500 outline-none text-sm" />
                                </div>

                                <div className="md:col-span-3">
                                    <label className="block text-xs font-semibold text-slate-500 mb-1">C.P.</label>
                                    <input type="text" value={inmueble.cp} onChange={e => setInmueble({...inmueble, cp: e.target.value})} className="w-full bg-black/20 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:border-indigo-500 outline-none text-sm" />
                                </div>
                                <div className="md:col-span-5">
                                    <label className="block text-xs font-semibold text-slate-500 mb-1">Municipio</label>
                                    <input type="text" value={inmueble.municipio} onChange={e => setInmueble({...inmueble, municipio: e.target.value})} className="w-full bg-black/20 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:border-indigo-500 outline-none text-sm" />
                                </div>
                                <div className="md:col-span-4">
                                    <label className="block text-xs font-semibold text-slate-500 mb-1">Provincia</label>
                                    <input type="text" value={inmueble.provincia} onChange={e => setInmueble({...inmueble, provincia: e.target.value})} className="w-full bg-black/20 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:border-indigo-500 outline-none text-sm" />
                                </div>
                            </div>
                        </div>

                        {/* CLIENTE & MAGIC PASTE */}
                        <div className="bg-[#0a0a1a] border border-slate-800/60 rounded-xl p-5 md:p-6 shadow-sm ring-1 ring-blue-500/10 relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-[40px] pointer-events-none" />
                            <h2 className="text-sm font-bold text-slate-200 mb-4 flex items-center justify-between border-b border-slate-800/50 pb-3">
                                <span className="flex items-center gap-2"><Search className="w-4 h-4 text-blue-400" /> Cliente / Contratante</span>
                                <div className="flex gap-2">
                                    <button onClick={() => setShowQuickAdd(!showQuickAdd)} className="text-xs flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded transition-colors">
                                        <Plus className="w-3 h-3" /> Quick Add
                                    </button>
                                </div>
                            </h2>

                            {!showQuickAdd ? (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in">
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-500 mb-1">Seleccionar Cliente Existente</label>
                                        <select 
                                            value={selectedClient} 
                                            onChange={e => setSelectedClient(e.target.value)}
                                            className="w-full bg-black/20 border border-slate-700 rounded-lg px-3 py-2.5 text-white outline-none focus:border-indigo-500 text-sm appearance-none"
                                        >
                                            <option value="" className="bg-[#0f0f23]">-- Seleccionar --</option>
                                            {clientsList.map(c => (
                                                <option key={c.id} value={c.id} className="bg-[#0f0f23]">
                                                    {c.first_name} {c.last_name_1} ({c.dni})
                                                </option>
                                            ))}
                                            <option value="NEW" className="bg-[#0f0f23] text-indigo-400 font-bold">+ Borrador Manual (No guardar)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-500 mb-1">Actúa en calidad de</label>
                                        <select 
                                            value={representante} onChange={e => setRepresentante(e.target.value)}
                                            className="w-full bg-black/20 border border-slate-700 rounded-lg px-3 py-2.5 text-white outline-none focus:border-indigo-500 text-sm"
                                        >
                                            <option value="PROPIETARIO">PROPIETARIO/A</option>
                                            <option value="REPRESENTANTE LEGAL">REPRESENTANTE LEGAL</option>
                                            <option value="INQUILINO">INQUILINO/A</option>
                                        </select>
                                    </div>
                                    {selectedClient === "NEW" && (
                                        <div className="col-span-2 p-3 border border-dashed border-slate-700 rounded-lg bg-slate-900/30">
                                            <p className="text-xs text-slate-400 mb-2">Has seleccionado crear un borrador rápido que NO se guardará en la base de datos de Clientes. Si prefieres guardarlo, haz click en "Quick Add" arriba.</p>
                                            <div className="grid grid-cols-2 gap-2">
                                                <input type="text" placeholder="Nombre completo" value={quickClient.nombre} onChange={e => setQuickClient({...quickClient, nombre: e.target.value})} className="bg-black/20 border border-slate-800 rounded px-2 py-1.5 text-sm text-white" />
                                                <input type="text" placeholder="DNI/NIF" value={quickClient.dni} onChange={e => setQuickClient({...quickClient, dni: e.target.value})} className="bg-black/20 border border-slate-800 rounded px-2 py-1.5 text-sm text-white" />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-4 animate-in slide-in-from-top-2">
                                    <div className="p-3 bg-gradient-to-r from-purple-500/10 to-indigo-500/10 border border-purple-500/20 rounded-xl">
                                        <label className="flex items-center gap-1.5 text-xs font-bold text-purple-300 mb-2">
                                            <Sparkles className="w-3.5 h-3.5" /> IA Mixta Assistant (Auto-Parse)
                                        </label>
                                        <div className="flex gap-2">
                                            <input 
                                                value={magicPasteText} onChange={e => setMagicPasteText(e.target.value)}
                                                placeholder="Pega aquí bloque de texto con DNI o Nombres..." 
                                                className="flex-1 bg-black/30 border border-purple-500/30 rounded-lg px-3 py-2 text-sm text-white focus:border-purple-500 outline-none"
                                            />
                                            <button onClick={handleMagicPaste} className="px-3 bg-purple-600/80 hover:bg-purple-500 text-white rounded-lg text-xs font-medium transition-colors">Extraer</button>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-[11px] text-slate-500 mb-1 uppercase">Nombre</label>
                                            <input type="text" value={quickClient.nombre} onChange={e => setQuickClient({...quickClient, nombre: e.target.value})} className="w-full bg-black/20 border border-slate-700 rounded px-3 py-1.5 text-slate-200 text-sm outline-none focus:border-blue-500" />
                                        </div>
                                        <div>
                                            <label className="block text-[11px] text-slate-500 mb-1 uppercase">Primer Apellido</label>
                                            <input type="text" value={quickClient.apellido1} onChange={e => setQuickClient({...quickClient, apellido1: e.target.value})} className="w-full bg-black/20 border border-slate-700 rounded px-3 py-1.5 text-slate-200 text-sm outline-none focus:border-blue-500" />
                                        </div>
                                        <div>
                                            <label className="block text-[11px] text-slate-500 mb-1 uppercase">Segundo Apellido</label>
                                            <input type="text" value={quickClient.apellido2} onChange={e => setQuickClient({...quickClient, apellido2: e.target.value})} className="w-full bg-black/20 border border-slate-700 rounded px-3 py-1.5 text-slate-200 text-sm outline-none focus:border-blue-500" />
                                        </div>
                                        <div>
                                            <label className="block text-[11px] text-slate-500 mb-1 uppercase">DNI/NIE</label>
                                            <input type="text" value={quickClient.dni} onChange={e => setQuickClient({...quickClient, dni: e.target.value})} className="w-full bg-black/20 border border-slate-700 rounded px-3 py-1.5 text-slate-200 text-sm outline-none focus:border-blue-500" />
                                        </div>
                                    </div>
                                    <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                                        <button onClick={() => setShowQuickAdd(false)} className="px-3 py-1.5 text-xs text-slate-400 hover:text-white">Cancelar</button>
                                        <button onClick={handleSaveQuickClient} disabled={loading} className="px-4 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium disabled:opacity-50 flex items-center gap-1">
                                            {loading && <Loader2 className="w-3 h-3 animate-spin"/>} Guardar Cliente
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* TÉCNICO Y FECHA */}
                        <div className="bg-[#0a0a1a] border border-slate-800/60 rounded-xl p-5 md:p-6 shadow-sm">
                            <h2 className="text-sm font-bold text-slate-200 mb-4 border-b border-slate-800/50 pb-3">Técnico Certificador (Autoguardado)</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1">Nombre Completo</label>
                                    <input type="text" value={tecnico.nombre} onChange={e => setTecnico({...tecnico, nombre: e.target.value})} className="w-full bg-black/20 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:border-indigo-500 outline-none text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1">DNI/NIF Técnico</label>
                                    <input type="text" value={tecnico.nif} onChange={e => setTecnico({...tecnico, nif: e.target.value})} className="w-full bg-black/20 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:border-indigo-500 outline-none text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1">Lugar de Firma</label>
                                    <input type="text" value={lugarFirma} onChange={e => setLugarFirma(e.target.value)} placeholder="Ej: Madrid" className="w-full bg-black/20 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:border-indigo-500 outline-none text-sm uppercase" />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1">Fecha de Firma</label>
                                    <input type="date" value={fechaFirma.toISOString().split('T')[0]} onChange={e => setFechaFirma(new Date(e.target.value))} className="w-full bg-black/20 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:border-indigo-500 outline-none text-sm [color-scheme:dark]" />
                                </div>
                            </div>
                        </div>

                    </div>

                    {/* Right Column: Signatures */}
                    <div className="xl:col-span-5 space-y-6">
                        {/* CUSTOMER SIGNATURE */}
                        <div className="bg-[#0a0a1a] border-2 border-indigo-500/20 rounded-xl p-5 shadow-lg relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                                <FileSignature className="w-24 h-24" />
                            </div>
                            <h2 className="text-sm font-bold text-white mb-2 flex justify-between items-center relative z-10">
                                <span>1. Firma Cliente ({representante})</span>
                                <button onClick={() => sigCanvasRef.current?.clear()} className="hover:bg-red-500/10 text-slate-400 hover:text-red-400 p-1.5 rounded transition-colors text-xs flex items-center gap-1">
                                    <Eraser className="w-3 h-3" /> Borrar
                                </button>
                            </h2>
                            <p className="text-[11px] text-slate-400 mb-3 relative z-10">Solicita al cliente que firme dentro del recuadro blanco.</p>
                            
                            <div className="border border-slate-400 rounded-xl bg-white shadow-inner relative z-10 ring-1 ring-black/5">
                                <SignatureCanvas 
                                    ref={sigCanvasRef}
                                    penColor="black"
                                    canvasProps={{className: 'signature-canvas w-full h-56 rounded-xl'}}
                                />
                                <div className="bg-slate-100/80 px-3 py-1.5 border-t border-slate-300 rounded-b-xl">
                                    <p className="text-[10px] text-slate-500 font-medium font-mono truncate">
                                        Fdo: {(selectedClient && selectedClient !== "NEW" ? clientsList.find(c => c.id === selectedClient)?.first_name : quickClient.nombre) || '---'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* TECH SIGNATURE */}
                        <div className="bg-[#0a0a1a] border border-slate-800/60 rounded-xl p-5 shadow-sm">
                            <h2 className="text-sm font-bold text-slate-300 mb-3 flex items-center justify-between">
                                2. Firma Técnico
                                <label className="cursor-pointer bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded text-xs transition-colors flex items-center gap-1">
                                    <Upload className="w-3 h-3" /> Cargar Imagen
                                    <input type="file" accept="image/*" className="hidden" onChange={handleUploadTechSignature} />
                                </label>
                            </h2>
                            
                            {techFirmaUrl ? (
                                <div className="relative border border-dashed border-slate-700 rounded-lg p-2 flex justify-center h-40 bg-black/30">
                                    <img src={techFirmaUrl} alt="Firma Técnico" className="h-full object-contain filter invert mix-blend-screen opacity-90" />
                                    <button 
                                        onClick={() => setTechFirmaUrl(null)}
                                        className="absolute top-2 right-2 bg-red-500/20 text-red-400 p-1 rounded hover:bg-red-500/40"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            ) : (
                                <div className="border border-slate-400 rounded-xl bg-white">
                                    <SignatureCanvas 
                                        ref={techSigCanvasRef}
                                        penColor="blue"
                                        canvasProps={{className: 'signature-canvas w-full h-32 rounded-t-xl'}}
                                    />
                                    <div className="flex justify-between p-2 bg-slate-100 rounded-b-xl border-t border-slate-300">
                                         <p className="text-[10px] text-slate-500 font-medium font-mono pt-1">
                                            Fdo: {tecnico.nombre || 'Técnico'}
                                        </p>
                                        <button 
                                            onClick={() => techSigCanvasRef.current?.clear()}
                                            className="text-xs text-slate-600 hover:text-slate-900 flex items-center gap-1"
                                        >
                                            <Eraser className="w-3 h-3" /> Borrar
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}
