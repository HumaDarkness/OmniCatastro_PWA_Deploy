import { useState, useRef, useMemo, useEffect } from "react";
import { Users, Plus, UploadCloud, Save, ChevronLeft, Image as ImageIcon, Search, Trash2 } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type ClienteLocal } from "./infra/db/OmniCatastroDB";

function normalizeClientSearch(value: string): string {
    return value
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "");
}

export function ClientesView() {
    const clients = useLiveQuery(() => db.clientes.orderBy('updatedAt').reverse().toArray()) || [];
    
    const [editingClient, setEditingClient] = useState<Partial<ClienteLocal> | null>(null);
    const [clientSearch, setClientSearch] = useState("");

    const [localFrontPreview, setLocalFrontPreview] = useState<string | null>(null);
    const [localBackPreview, setLocalBackPreview] = useState<string | null>(null);

    const frontInputRef = useRef<HTMLInputElement>(null);
    const backInputRef = useRef<HTMLInputElement>(null);

    const filteredClients = useMemo(() => {
        const query = normalizeClientSearch(clientSearch.trim());
        if (!query) return clients;

        return clients.filter((client) => {
            const searchable = normalizeClientSearch([
                client.nombre,
                client.apellidos,
                client.nif,
                client.email ?? "",
            ].join(" "));
            return searchable.includes(query);
        });
    }, [clients, clientSearch]);

    // Limpiar object URLs al desmontar
    useEffect(() => {
        if (editingClient) {
            if (editingClient.dniBlobFront) {
                const url = URL.createObjectURL(editingClient.dniBlobFront);
                setLocalFrontPreview(url);
            }
            if (editingClient.dniBlobBack) {
                const url = URL.createObjectURL(editingClient.dniBlobBack);
                setLocalBackPreview(url);
            }
        } else {
            if (localFrontPreview) URL.revokeObjectURL(localFrontPreview);
            if (localBackPreview) URL.revokeObjectURL(localBackPreview);
            setLocalFrontPreview(null);
            setLocalBackPreview(null);
        }

        return () => {
            if (localFrontPreview) URL.revokeObjectURL(localFrontPreview);
            if (localBackPreview) URL.revokeObjectURL(localBackPreview);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editingClient?.id, editingClient?.dniBlobFront, editingClient?.dniBlobBack]);

    function handleEditClient(client: ClienteLocal) {
        setEditingClient(client);
    }

    function handleNewClient() {
        setEditingClient({
            nombre: "",
            apellidos: "",
            nif: "",
            email: "",
        });
        setLocalFrontPreview(null);
        setLocalBackPreview(null);
    }

    function handleFileChange(file: File, side: 'front' | 'back') {
        if (side === 'front') {
            setEditingClient(prev => ({ ...prev!, dniBlobFront: file }));
        } else {
            setEditingClient(prev => ({ ...prev!, dniBlobBack: file }));
        }
    }

    async function saveClient() {
        if (!editingClient?.nombre || !editingClient?.nif) {
            alert("El nombre y NIF son obligatorios.");
            return;
        }

        const payload: Omit<ClienteLocal, 'id' | 'createdAt' | 'updatedAt'> = {
            nombre: editingClient.nombre,
            apellidos: editingClient.apellidos || "",
            nif: editingClient.nif.trim().toUpperCase(),
            email: editingClient.email,
            telefono: editingClient.telefono,
            dniBlobFront: editingClient.dniBlobFront,
            dniBlobBack: editingClient.dniBlobBack,
            fuenteOrigen: 'crm',
            syncedAt: undefined
        };

        let savedId = editingClient.id;

        if (editingClient.id) {
            await db.clientes.update(editingClient.id, { ...payload, updatedAt: Date.now() });
        } else {
            savedId = await db.clientes.add({ ...payload, createdAt: Date.now(), updatedAt: Date.now() });
        }

        setEditingClient(null);
    }

    async function handleDeleteClient(id: number) {
        if (confirm("¿Borrar este cliente localmente?")) {
            await db.clientes.delete(id);
            setEditingClient(null);
        }
    }

    if (editingClient) {
        return (
            <div className="flex flex-col h-full overflow-hidden bg-[#060612] text-slate-200">
                <div className="p-4 md:p-6 flex items-center justify-between border-b border-indigo-500/10 bg-[#0a0a1a] shrink-0">
                    <button onClick={() => setEditingClient(null)} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
                        <ChevronLeft className="w-5 h-5" /> Volver
                    </button>
                    <div className="flex items-center gap-3">
                        {editingClient.id && (
                            <button
                                onClick={() => handleDeleteClient(editingClient.id!)}
                                className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                            >
                                <Trash2 className="w-5 h-5" />
                            </button>
                        )}
                        <button
                            onClick={saveClient}
                            className="flex items-center gap-2 px-6 py-2 bg-indigo-500 hover:bg-indigo-600 text-white font-medium rounded-lg transition-colors"
                        >
                            <Save className="w-5 h-5" />
                            Guardar Local
                        </button>
                    </div>
                </div>

                <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
                    {/* DNI Uploads (Local Blobs) */}
                    <div className="lg:w-1/2 flex flex-col p-4 md:p-6 border-b lg:border-b-0 lg:border-r border-indigo-500/10 overflow-y-auto bg-black/20">
                        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                            <ImageIcon className="w-5 h-5 text-indigo-400" /> Documentos de Identidad (Offline)
                        </h3>

                        <div className="space-y-6">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-400">Anverso del DNI</label>
                                <div
                                    className="relative w-full aspect-[8/5] rounded-xl border-2 border-dashed border-slate-700 bg-slate-900 overflow-hidden flex items-center justify-center cursor-pointer hover:border-indigo-500 hover:bg-indigo-900/10"
                                    onClick={() => frontInputRef.current?.click()}
                                >
                                    {localFrontPreview ? (
                                        <img src={localFrontPreview} alt="DNI Anverso" className="w-full h-full object-contain" />
                                    ) : (
                                        <div className="flex flex-col items-center text-slate-500">
                                            <UploadCloud className="w-8 h-8 mb-2" />
                                            <span className="text-sm font-medium">Subir Anverso</span>
                                        </div>
                                    )}
                                    <input 
                                        type="file" accept="image/*" className="hidden" ref={frontInputRef}
                                        onChange={e => e.target.files?.[0] && handleFileChange(e.target.files[0], 'front')}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-400">Reverso del DNI</label>
                                <div
                                    className="relative w-full aspect-[8/5] rounded-xl border-2 border-dashed border-slate-700 bg-slate-900 overflow-hidden flex items-center justify-center cursor-pointer hover:border-indigo-500 hover:bg-indigo-900/10"
                                    onClick={() => backInputRef.current?.click()}
                                >
                                    {localBackPreview ? (
                                        <img src={localBackPreview} alt="DNI Reverso" className="w-full h-full object-contain" />
                                    ) : (
                                        <div className="flex flex-col items-center text-slate-500">
                                            <UploadCloud className="w-8 h-8 mb-2" />
                                            <span className="text-sm font-medium">Subir Reverso</span>
                                        </div>
                                    )}
                                    <input 
                                        type="file" accept="image/*" className="hidden" ref={backInputRef}
                                        onChange={e => e.target.files?.[0] && handleFileChange(e.target.files[0], 'back')}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="lg:w-1/2 p-4 md:p-8 overflow-y-auto">
                        <div className="max-w-md mx-auto space-y-6">
                            <div>
                                <h2 className="text-2xl font-bold text-white mb-2">Editor (Local-First)</h2>
                                <p className="text-slate-400 text-sm">Cambios se guardan en el navegador y sincronizan en background.</p>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-400 mb-1">Nombre *</label>
                                    <input
                                        type="text" value={editingClient.nombre || ""}
                                        onChange={e => setEditingClient(prev => ({ ...prev!, nombre: e.target.value }))}
                                        className="w-full bg-black/20 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:border-indigo-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-400 mb-1">Apellidos</label>
                                    <input
                                        type="text" value={editingClient.apellidos || ""}
                                        onChange={e => setEditingClient(prev => ({ ...prev!, apellidos: e.target.value }))}
                                        className="w-full bg-black/20 border border-slate-800 rounded-lg px-4 py-2.5 text-white focus:border-indigo-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-400 mb-1">DNI/NIE *</label>
                                    <input
                                        type="text" value={editingClient.nif || ""}
                                        onChange={e => setEditingClient(prev => ({ ...prev!, nif: e.target.value }))}
                                        className="w-full bg-black/20 border border-slate-800 rounded-lg px-4 py-3 text-white focus:border-indigo-500 font-mono text-lg"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-[#060612]">
            <div className="p-6 md:p-8 flex items-center justify-between border-b border-indigo-500/10 bg-[#0a0a1a]">
                <div className="flex items-center gap-4 text-indigo-400">
                    <div className="p-3 bg-indigo-500/10 rounded-xl ring-1 ring-indigo-500/20">
                        <Users className="w-6 h-6" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-200">Gestion de Clientes (Local)</h1>
                        <p className="text-sm text-slate-400 mt-1">Directorio offline en IndexedDB</p>
                    </div>
                </div>
                <button
                    onClick={handleNewClient}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white font-medium rounded-lg"
                >
                    <Plus className="w-5 h-5" />
                    <span>Nuevo Cliente</span>
                </button>
            </div>

            <div className="px-6 md:px-8 py-3 border-b border-indigo-500/10 bg-[#0a0a1a]">
                 <div className="relative max-w-xl">
                    <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                        type="text"
                        value={clientSearch}
                        onChange={(e) => setClientSearch(e.target.value)}
                        placeholder="Buscar por DNI o nombre..."
                        className="w-full pl-9 pr-10 py-2 rounded-lg border border-slate-800 bg-black/20 text-slate-200 text-sm focus:border-indigo-500"
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 md:p-8">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredClients.map(client => (
                        <div
                            key={client.id}
                            onClick={() => handleEditClient(client)}
                            className="bg-[#0a0a1a] border border-slate-800/60 rounded-xl p-5 hover:border-indigo-500/50 hover:bg-[#0c0c1e] cursor-pointer transition-all"
                        >
                            <h3 className="text-lg font-semibold text-white mb-1">
                                {client.nombre} {client.apellidos}
                            </h3>
                            <p className="text-sm font-mono text-indigo-400/80 mb-3">{client.nif}</p>
                            
                            <div className="flex items-center gap-3 mt-4 text-xs text-slate-500 border-t border-slate-800/50 pt-3">
                                <span className={`flex items-center gap-1 ${!client.syncedAt ? 'text-amber-500' : 'text-emerald-500'}`}>
                                    <div className={`w-2 h-2 rounded-full ${!client.syncedAt ? 'bg-amber-500' : 'bg-emerald-500'}`}></div>
                                    {!client.syncedAt ? 'Pendiente Sync' : 'Sincronizado'}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
