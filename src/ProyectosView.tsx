import { useState, useEffect } from "react";
import { FolderOpen, Plus, MapPin, Calendar, CircleAlert, CircleCheck } from "lucide-react";
import { getCurrentOrganizationId, supabase } from "./lib/supabase";
import { ProyectoDetalle } from "./ProyectoDetalle";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./infra/db/OmniCatastroDB";

export interface Project {
    id: string;
    organization_id: string;
    rc: string;
    address: string;
    visit_date: string;
    status: 'pending' | 'in_progress' | 'completed';
    created_at: string;
    client_id: string | null;
    nexo_reference: string | null;
}

export function ProyectosView() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [showNewModal, setShowNewModal] = useState(false);
    const [selectedProject, setSelectedProject] = useState<Project | null>(null);

    // Form state
    const [formRc, setFormRc] = useState("");
    const [formAddress, setFormAddress] = useState("");
    const [formDate, setFormDate] = useState(() => new Date().toISOString().split('T')[0]);
    const [formClientId, setFormClientId] = useState("");
    const [formNexoRef, setFormNexoRef] = useState("");
    const [formSaving, setFormSaving] = useState(false);
    const [uxError, setUxError] = useState<string | null>(null);
    const [uxInfo, setUxInfo] = useState<string | null>(null);

    // Data list
    const clientsList = useLiveQuery(() => db.clientes.orderBy('updatedAt').reverse().toArray()) || [];

    useEffect(() => {
        if (!selectedProject) {
            loadProjects();
        }
    }, [selectedProject]);

    async function loadProjects() {
        setLoading(true);
        const { data, error } = await supabase
            .from('projects')
            .select('*')
            .order('created_at', { ascending: false });

        if (!error && data) {
            setProjects(data as Project[]);
            setUxError(null);
        } else if (error) {
            setUxError("No se pudo cargar proyectos. Revalida sesion y vuelve a intentar.");
        }
        setLoading(false);
    }

    async function handleCreateProject(e: React.FormEvent) {
        e.preventDefault();
        setFormSaving(true);
        setUxError(null);
        setUxInfo(null);

        try {
            const organizationId = await getCurrentOrganizationId();
            if (!organizationId) {
                throw new Error("No se pudo resolver tu empresa activa. Inicia sesion real (no modo demo) y verifica que tu licencia este activa y vinculada a una organizacion para crear proyectos.");
            }

            const { data: userAuth } = await supabase.auth.getUser();

            const { data: newProject, error } = await supabase.from('projects').insert([{
                organization_id: organizationId,
                rc: formRc,
                address: formAddress,
                visit_date: formDate,
                status: 'pending',
                license_user_id: userAuth.user?.id,
                client_id: formClientId || null,
                nexo_reference: formNexoRef || null
            }]).select().single();

            if (error) throw error;

            setShowNewModal(false);
            setFormRc("");
            setFormAddress("");
            setFormClientId("");
            setFormNexoRef("");
            setFormDate(new Date().toISOString().split('T')[0]);
            await loadProjects();
            setUxInfo("Proyecto creado correctamente.");

            if (newProject) {
                setSelectedProject(newProject as Project);
            }
        } catch (error: any) {
            setUxError("Error al crear proyecto: " + error.message);
        } finally {
            setFormSaving(false);
        }
    }

    if (selectedProject) {
        return <ProyectoDetalle project={selectedProject} onBack={() => setSelectedProject(null)} />;
    }

    return (
        <div className="flex flex-col h-full overflow-hidden bg-[#060612] relative">
            {/* Header Módulo */}
            <div className="p-6 md:p-8 flex items-center justify-between border-b border-indigo-500/10 bg-[#0a0a1a] shrink-0">
                <div className="flex items-center gap-4 text-indigo-400">
                    <div className="p-3 bg-indigo-500/10 rounded-xl ring-1 ring-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.1)]">
                        <FolderOpen className="w-6 h-6" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-200 tracking-tight">Mis Proyectos</h1>
                        <p className="text-sm text-slate-400 mt-1">Gestión de documentación fotográfica B2B</p>
                    </div>
                </div>
                <button
                    onClick={() => setShowNewModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white font-medium rounded-lg shadow-lg shadow-indigo-500/20 transition-all"
                >
                    <Plus className="w-5 h-5" />
                    <span className="hidden sm:inline">Nuevo Proyecto</span>
                </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-6 md:p-8">
                {uxError && (
                    <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200 inline-flex items-center gap-2">
                        <CircleAlert className="w-4 h-4" />
                        <span>{uxError}</span>
                    </div>
                )}
                {uxInfo && (
                    <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 inline-flex items-center gap-2">
                        <CircleCheck className="w-4 h-4" />
                        <span>{uxInfo}</span>
                    </div>
                )}
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
                    </div>
                ) : projects.length === 0 ? (
                    <div className="flex items-center justify-center h-64 border-2 border-dashed border-slate-800 rounded-xl bg-[#0a0a1a]">
                        <div className="text-center space-y-4">
                            <div className="w-16 h-16 bg-slate-800/50 rounded-full flex items-center justify-center mx-auto">
                                <FolderOpen className="w-8 h-8 text-slate-500" />
                            </div>
                            <div>
                                <h3 className="text-lg font-medium text-slate-300">No hay proyectos activos</h3>
                                <p className="text-slate-500 mt-1">Crea un proyecto para subir fotos del antes y después</p>
                            </div>
                            <button
                                onClick={() => setShowNewModal(true)}
                                className="mt-4 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-medium transition-colors"
                            >
                                Crear mi primer proyecto
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {projects.map(proj => (
                            <div
                                key={proj.id}
                                onClick={() => setSelectedProject(proj)}
                                className="bg-[#0a0a1a] border border-slate-800/60 rounded-xl p-5 hover:border-indigo-500/30 hover:bg-[#0c0c1e] cursor-pointer transition-all group"
                            >
                                <div className="flex justify-between items-start mb-3">
                                    <div className={`px-2 py-1 rounded text-xs font-semibold ${proj.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                                        proj.status === 'in_progress' ? 'bg-blue-500/10 text-blue-400' :
                                            'bg-slate-500/10 text-slate-400'
                                        }`}>
                                        {proj.status === 'completed' ? 'Completado' :
                                            proj.status === 'in_progress' ? 'En Progreso' : 'Pendiente'}
                                    </div>
                                    <span className="text-xs text-slate-500 flex items-center gap-1">
                                        <Calendar className="w-3 h-3" />
                                        {proj.visit_date ? new Date(proj.visit_date).toLocaleDateString() : '-'}
                                    </span>
                                </div>
                                <h3 className="text-lg font-semibold text-slate-200 mb-1 line-clamp-1">{proj.address || 'Sin Dirección'}</h3>
                                <div className="flex items-center gap-2 text-sm text-slate-500 mb-4">
                                    <MapPin className="w-4 h-4 shrink-0" />
                                    <span className="truncate">RC: {proj.rc}</span>
                                </div>

                                <div className="mt-4 pt-4 border-t border-slate-800/50 flex justify-between items-center text-sm text-slate-400">
                                    <span>Ver documentación fotográfica</span>
                                    <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center group-hover:bg-indigo-500/20 group-hover:text-indigo-400 transition-colors">
                                        <Plus className="w-4 h-4" />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Modal Nuevo Proyecto */}
            {showNewModal && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-[#0f0f23] border border-slate-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
                        <h2 className="text-xl font-bold text-white mb-4">Nuevo Proyecto</h2>
                        {uxError && (
                            <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200 inline-flex items-center gap-2">
                                <CircleAlert className="w-4 h-4" />
                                <span>{uxError}</span>
                            </div>
                        )}
                        <form onSubmit={handleCreateProject} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">Referencia Catastral</label>
                                <input
                                    type="text"
                                    value={formRc}
                                    onChange={e => setFormRc(e.target.value)}
                                    className="w-full bg-black/20 border border-slate-800 rounded-lg px-4 py-2 text-white focus:border-indigo-500 outline-none"
                                    placeholder="14 a 20 caracteres"
                                    required
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">Titular / Cliente</label>
                                <select
                                    value={formClientId}
                                    onChange={e => setFormClientId(e.target.value)}
                                    className="w-full bg-black/20 border border-slate-800 rounded-lg px-4 py-2 text-white focus:border-indigo-500 outline-none appearance-none"
                                >
                                    <option value="" className="bg-[#0f0f23]">-- Sin Asignar (Proyecto Libre) --</option>
                                    {clientsList.map(c => (
                                        <option key={c.id} value={c.id} className="bg-[#0f0f23]">
                                            {c.nombre} {c.apellidos} ({c.nif || 'S/DNI'})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-400 mb-1">Dirección / Alias</label>
                                    <input
                                        type="text"
                                        value={formAddress}
                                        onChange={e => setFormAddress(e.target.value)}
                                        className="w-full bg-black/20 border border-slate-800 rounded-lg px-4 py-2 text-white focus:border-indigo-500 outline-none"
                                        placeholder="Ej: Calle Principal 123"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-400 mb-1">Lote / Ref Nexo</label>
                                    <input
                                        type="text"
                                        value={formNexoRef}
                                        onChange={e => setFormNexoRef(e.target.value)}
                                        className="w-full bg-black/20 border border-slate-800 rounded-lg px-4 py-2 text-white focus:border-indigo-500 outline-none"
                                        placeholder="Opcional"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">Fecha de Visita</label>
                                <input
                                    type="date"
                                    value={formDate}
                                    onChange={e => setFormDate(e.target.value)}
                                    className="w-full bg-black/20 border border-slate-800 rounded-lg px-4 py-2 text-white focus:border-indigo-500 outline-none [color-scheme:dark]"
                                    required
                                />
                            </div>
                            <div className="pt-4 flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => setShowNewModal(false)}
                                    className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-medium transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={formSaving}
                                    className="flex-1 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
                                >
                                    {formSaving ? 'Creando...' : 'Crear Proyecto'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
