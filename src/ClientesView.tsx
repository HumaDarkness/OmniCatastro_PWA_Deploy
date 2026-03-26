import { useState, useEffect, useRef } from "react";
import { Users, Plus, UploadCloud, Save, ChevronLeft, Image as ImageIcon, Loader2, CircleAlert, CircleCheck } from "lucide-react";
import { getCurrentOrganizationId, supabase } from "./lib/supabase";

export interface Client {
    id: string;
    organization_id: string;
    first_name: string;
    middle_name: string | null;
    last_name_1: string;
    last_name_2: string | null;
    dni: string;
    dni_address: string | null;
    dni_front_path: string | null;
    dni_back_path: string | null;
    created_at: string;

    // Virtual fields
    front_url?: string;
    back_url?: string;
}

export function ClientesView() {
    const ORG_REQUIRED_MSG = "No se pudo resolver tu empresa activa. Inicia sesion real (no modo demo) y verifica que tu licencia este activa y vinculada a una organizacion.";

    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);

    // Editor State
    const [editingClient, setEditingClient] = useState<Partial<Client> | null>(null);
    const [saving, setSaving] = useState(false);

    // Upload state
    const [uploadingFront, setUploadingFront] = useState(false);
    const [uploadingBack, setUploadingBack] = useState(false);

    // Preview URLs for new uploads
    const [localFrontPreview, setLocalFrontPreview] = useState<string | null>(null);
    const [localBackPreview, setLocalBackPreview] = useState<string | null>(null);
    const [uxError, setUxError] = useState<string | null>(null);
    const [uxInfo, setUxInfo] = useState<string | null>(null);

    const frontInputRef = useRef<HTMLInputElement>(null);
    const backInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!editingClient) {
            loadClients();
        }
    }, [editingClient]);

    async function loadClients() {
        setLoading(true);
        const { data, error } = await supabase
            .from('clients')
            .select('*')
            .order('created_at', { ascending: false });

        if (!error && data) {
            setClients(data as Client[]);
            setUxError(null);
        } else if (error) {
            setUxError("No se pudo cargar el listado de clientes. Revalida sesion y vuelve a intentar.");
        }
        setLoading(false);
    }

    async function loadClientUrls(client: Client) {
        let frontUrl = client.front_url;
        let backUrl = client.back_url;

        if (client.dni_front_path && !frontUrl) {
            const { data } = await supabase.storage.from('work_photos').createSignedUrl(client.dni_front_path, 3600);
            frontUrl = data?.signedUrl;
        }
        if (client.dni_back_path && !backUrl) {
            const { data } = await supabase.storage.from('work_photos').createSignedUrl(client.dni_back_path, 3600);
            backUrl = data?.signedUrl;
        }

        return { ...client, front_url: frontUrl, back_url: backUrl };
    }

    async function handleEditClient(client: Client) {
        setLoading(true);
        setUxError(null);
        setUxInfo(null);
        const enriched = await loadClientUrls(client);
        setEditingClient(enriched);
        setLocalFrontPreview(null);
        setLocalBackPreview(null);
        setLoading(false);
    }

    function handleNewClient() {
        setUxError(null);
        setUxInfo(null);
        setEditingClient({
            first_name: "",
            middle_name: "",
            last_name_1: "",
            last_name_2: "",
            dni: "",
            dni_address: ""
        });
        setLocalFrontPreview(null);
        setLocalBackPreview(null);
    }

    async function uploadDniImage(file: File, side: 'front' | 'back') {
        try {
            setUxError(null);
            const organizationId = await getCurrentOrganizationId();
            if (!organizationId) throw new Error(ORG_REQUIRED_MSG);

            const clientId = editingClient?.id || 'temp_' + Date.now();
            const fileExt = file.name.split('.').pop();
            const fileName = `dni_${side}_${Date.now()}.${fileExt}`;
            const filePath = `${organizationId}/clients/${clientId}/${fileName}`;

            const setter = side === 'front' ? setUploadingFront : setUploadingBack;
            setter(true);

            const { error: uploadError } = await supabase.storage
                .from('work_photos')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            const { data: urlData } = await supabase.storage.from('work_photos').createSignedUrl(filePath, 3600);

            if (side === 'front') {
                setEditingClient(prev => ({ ...prev, dni_front_path: filePath }));
                setLocalFrontPreview(urlData?.signedUrl || URL.createObjectURL(file));
            } else {
                setEditingClient(prev => ({ ...prev, dni_back_path: filePath }));
                setLocalBackPreview(urlData?.signedUrl || URL.createObjectURL(file));
            }
        } catch (error: any) {
            setUxError("Error subiendo imagen: " + error.message);
        } finally {
            const setter = side === 'front' ? setUploadingFront : setUploadingBack;
            setter(false);
        }
    }

    async function copyDiagnostic() {
        try {
            const { data: userData } = await supabase.auth.getUser();
            const organizationId = await getCurrentOrganizationId();
            const diagnostic = [
                "[UX-DIAGNOSTICO CLIENTES]",
                `user_email=${userData.user?.email ?? "sin_sesion"}`,
                `organization_id=${organizationId ?? "null"}`,
                `editing_client_id=${editingClient?.id ?? "nuevo"}`,
                `has_front=${editingClient?.dni_front_path ? "1" : "0"}`,
                `has_back=${editingClient?.dni_back_path ? "1" : "0"}`,
                `timestamp=${new Date().toISOString()}`,
            ].join("\n");
            await navigator.clipboard.writeText(diagnostic);
            setUxInfo("Diagnostico copiado al portapapeles.");
        } catch {
            setUxInfo("No se pudo copiar el diagnostico en este navegador.");
        }
    }

    async function saveClient() {
        if (!editingClient?.first_name || !editingClient?.last_name_1 || !editingClient?.dni) {
            setUxError("El primer nombre, primer apellido y DNI son obligatorios.");
            return;
        }

        setSaving(true);
        try {
            setUxError(null);
            const organizationId = await getCurrentOrganizationId();
            if (!organizationId) throw new Error(ORG_REQUIRED_MSG);

            const payload = {
                organization_id: organizationId,
                first_name: editingClient.first_name,
                middle_name: editingClient.middle_name || null,
                last_name_1: editingClient.last_name_1,
                last_name_2: editingClient.last_name_2 || null,
                dni: editingClient.dni,
                dni_address: editingClient.dni_address || null,
                dni_front_path: editingClient.dni_front_path,
                dni_back_path: editingClient.dni_back_path
            };

            if (editingClient.id && !editingClient.id.startsWith('temp_')) {
                // Update
                const { error } = await supabase.from('clients').update(payload).eq('id', editingClient.id);
                if (error) throw error;
            } else {
                // Insert
                const { error } = await supabase.from('clients').insert([payload]);
                if (error) throw error;
            }

            setEditingClient(null);
        } catch (error: any) {
            setUxError("Error guardando cliente: " + error.message);
        } finally {
            setSaving(false);
        }
    }

    if (editingClient) {
        return (
            <div className="flex flex-col h-full overflow-hidden bg-[#060612] text-slate-200">
                {/* Header Split */}
                <div className="p-4 md:p-6 flex items-center justify-between border-b border-indigo-500/10 bg-[#0a0a1a] shrink-0">
                    <button onClick={() => setEditingClient(null)} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
                        <ChevronLeft className="w-5 h-5" /> Volver a Clientes
                    </button>
                    <button
                        onClick={saveClient}
                        disabled={saving}
                        className="flex items-center gap-2 px-6 py-2 bg-indigo-500 hover:bg-indigo-600 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
                    >
                        {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                        Guardar Cliente
                    </button>
                </div>

                {(uxError || uxInfo) && (
                    <div className="px-4 md:px-6 pt-4">
                        {uxError && (
                            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200 flex items-start justify-between gap-3">
                                <div className="inline-flex items-start gap-2">
                                    <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                                    <span>{uxError}</span>
                                </div>
                                <button
                                    onClick={copyDiagnostic}
                                    className="px-2 py-1 rounded border border-amber-500/30 text-[11px] text-amber-200 hover:bg-amber-500/10"
                                >
                                    Copiar diagnostico
                                </button>
                            </div>
                        )}
                        {uxInfo && (
                            <div className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 inline-flex items-center gap-2">
                                <CircleCheck className="w-4 h-4" />
                                <span>{uxInfo}</span>
                            </div>
                        )}
                    </div>
                )}

                {/* Split Screen Layout */}
                <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">

                    {/* LEFT PANEL: DNI Photos Viewer */}
                    <div className="lg:w-1/2 flex flex-col p-4 md:p-6 border-b lg:border-b-0 lg:border-r border-indigo-500/10 overflow-y-auto bg-black/20">
                        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                            <ImageIcon className="w-5 h-5 text-indigo-400" /> Documentos de Identidad
                        </h3>

                        <div className="space-y-6">
                            {/* Anverso */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-400 flex justify-between">
                                    <span>Anverso del DNI</span>
                                    {uploadingFront && <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />}
                                </label>
                                <div
                                    className="relative w-full aspect-[8/5] rounded-xl border-2 border-dashed border-slate-700 bg-slate-900 overflow-hidden flex items-center justify-center group cursor-pointer"
                                    onClick={() => frontInputRef.current?.click()}
                                >
                                    {(localFrontPreview || editingClient.front_url) ? (
                                        <img src={localFrontPreview || editingClient.front_url} alt="DNI Anverso" className="w-full h-full object-contain" />
                                    ) : (
                                        <div className="flex flex-col items-center text-slate-500 group-hover:text-indigo-400 transition-colors">
                                            <UploadCloud className="w-8 h-8 mb-2" />
                                            <span className="text-sm font-medium">Subir Anverso</span>
                                        </div>
                                    )}
                                    <input
                                        type="file" accept="image/*" className="hidden"
                                        ref={frontInputRef}
                                        onChange={e => e.target.files?.[0] && uploadDniImage(e.target.files[0], 'front')}
                                    />
                                </div>
                            </div>

                            {/* Reverso */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-400 flex justify-between">
                                    <span>Reverso del DNI (Dirección)</span>
                                    {uploadingBack && <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />}
                                </label>
                                <div
                                    className="relative w-full aspect-[8/5] rounded-xl border-2 border-dashed border-slate-700 bg-slate-900 overflow-hidden flex items-center justify-center group cursor-pointer"
                                    onClick={() => backInputRef.current?.click()}
                                >
                                    {(localBackPreview || editingClient.back_url) ? (
                                        <img src={localBackPreview || editingClient.back_url} alt="DNI Reverso" className="w-full h-full object-contain" />
                                    ) : (
                                        <div className="flex flex-col items-center text-slate-500 group-hover:text-indigo-400 transition-colors">
                                            <UploadCloud className="w-8 h-8 mb-2" />
                                            <span className="text-sm font-medium">Subir Reverso</span>
                                        </div>
                                    )}
                                    <input
                                        type="file" accept="image/*" className="hidden"
                                        ref={backInputRef}
                                        onChange={e => e.target.files?.[0] && uploadDniImage(e.target.files[0], 'back')}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* RIGHT PANEL: Transcription Form */}
                    <div className="lg:w-1/2 p-4 md:p-8 overflow-y-auto">
                        <div className="max-w-md mx-auto space-y-6">
                            <div>
                                <h2 className="text-2xl font-bold text-white mb-2">Transcripción de Datos</h2>
                                <p className="text-slate-400 text-sm">Transcribe los datos exactos del titular basándote en el documento adjunto.</p>
                            </div>

                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-400 mb-1">Primer Nombre *</label>
                                        <input
                                            type="text"
                                            value={editingClient.first_name || ""}
                                            onChange={e => setEditingClient(prev => ({ ...prev!, first_name: e.target.value }))}
                                            className="w-full bg-black/20 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:border-indigo-500 focus:bg-indigo-950/20 outline-none transition-all"
                                            placeholder="Ej: María"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-400 mb-1">Segundo Nombre</label>
                                        <input
                                            type="text"
                                            value={editingClient.middle_name || ""}
                                            onChange={e => setEditingClient(prev => ({ ...prev!, middle_name: e.target.value }))}
                                            className="w-full bg-black/20 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:border-indigo-500 focus:bg-indigo-950/20 outline-none transition-all"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-400 mb-1">Primer Apellido *</label>
                                        <input
                                            type="text"
                                            value={editingClient.last_name_1 || ""}
                                            onChange={e => setEditingClient(prev => ({ ...prev!, last_name_1: e.target.value }))}
                                            className="w-full bg-black/20 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:border-indigo-500 focus:bg-indigo-950/20 outline-none transition-all"
                                            placeholder="Ej: García"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-400 mb-1">Segundo Apellido</label>
                                        <input
                                            type="text"
                                            value={editingClient.last_name_2 || ""}
                                            onChange={e => setEditingClient(prev => ({ ...prev!, last_name_2: e.target.value }))}
                                            className="w-full bg-black/20 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:border-indigo-500 focus:bg-indigo-950/20 outline-none transition-all"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-400 mb-1">Documento Identidad (DNI/NIE) *</label>
                                    <input
                                        type="text"
                                        value={editingClient.dni || ""}
                                        onChange={e => setEditingClient(prev => ({ ...prev!, dni: e.target.value.toUpperCase() }))}
                                        className="w-full bg-black/20 border border-slate-800 rounded-lg px-4 py-3 text-white focus:border-indigo-500 font-mono text-lg tracking-wider focus:bg-indigo-950/20 outline-none transition-all"
                                        placeholder="12345678Z"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-400 mb-1">Dirección del Documento</label>
                                    <textarea
                                        value={editingClient.dni_address || ""}
                                        onChange={e => setEditingClient(prev => ({ ...prev!, dni_address: e.target.value }))}
                                        className="w-full bg-black/20 border border-slate-800 rounded-lg px-4 py-3 text-white focus:border-indigo-500 focus:bg-indigo-950/20 outline-none transition-all min-h-[100px]"
                                        placeholder="Dirección exacta tal como figura en el reverso del DNI..."
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // LIST VIEW
    return (
        <div className="flex flex-col h-full bg-[#060612]">
            <div className="p-6 md:p-8 flex items-center justify-between border-b border-indigo-500/10 bg-[#0a0a1a]">
                <div className="flex items-center gap-4 text-indigo-400">
                    <div className="p-3 bg-indigo-500/10 rounded-xl ring-1 ring-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.1)]">
                        <Users className="w-6 h-6" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-200 tracking-tight">Gestión de Clientes</h1>
                        <p className="text-sm text-slate-400 mt-1">Directorio de solicitantes y titulares</p>
                    </div>
                </div>
                <button
                    onClick={handleNewClient}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white font-medium rounded-lg shadow-lg shadow-indigo-500/20 transition-all"
                >
                    <Plus className="w-5 h-5" />
                    <span className="hidden sm:inline">Nuevo Cliente</span>
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 md:p-8">
                {uxError && (
                    <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200 inline-flex items-center gap-2">
                        <CircleAlert className="w-4 h-4" />
                        <span>{uxError}</span>
                    </div>
                )}
                {loading ? (
                    <div className="flex justify-center p-12">
                        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                    </div>
                ) : clients.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-slate-800 rounded-xl bg-[#0a0a1a]">
                        <Users className="w-12 h-12 text-slate-600 mb-4" />
                        <h3 className="text-lg font-medium text-slate-300">No hay clientes registrados</h3>
                        <p className="text-slate-500 mt-1 mb-4">Crea un cliente para transcribir su DNI y asociar expedientes.</p>
                        <button onClick={handleNewClient} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg">Añadir Cliente</button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {clients.map(client => (
                            <div
                                key={client.id}
                                onClick={() => handleEditClient(client)}
                                className="bg-[#0a0a1a] border border-slate-800/60 rounded-xl p-5 hover:border-indigo-500/50 hover:bg-[#0c0c1e] cursor-pointer transition-all group"
                            >
                                <h3 className="text-lg font-semibold text-white mb-1">
                                    {client.first_name} {client.last_name_1} {client.last_name_2 || ''}
                                </h3>
                                <p className="text-sm font-mono text-indigo-400/80 mb-3">{client.dni || 'Sin DNI'}</p>

                                <div className="flex items-center gap-3 mt-4 text-xs text-slate-500 border-t border-slate-800/50 pt-3">
                                    <span className="flex items-center gap-1">
                                        <div className={`w-2 h-2 rounded-full ${client.dni_front_path ? 'bg-emerald-500' : 'bg-slate-600'}`}></div>
                                        Anverso
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <div className={`w-2 h-2 rounded-full ${client.dni_back_path ? 'bg-emerald-500' : 'bg-slate-600'}`}></div>
                                        Reverso
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
