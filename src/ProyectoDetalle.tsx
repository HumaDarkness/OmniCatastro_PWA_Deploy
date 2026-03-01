import { useState, useEffect, useRef } from "react";
import { ArrowLeft, Camera, Image as ImageIcon, Trash2, Loader2, Maximize2, Download } from "lucide-react";
import { supabase } from "./lib/supabase";
import { ExportadorModal } from "./components/ExportadorModal";
import type { Project } from "./ProyectosView";

export interface Photo {
    id: string;
    project_id: string;
    category: 'antes' | 'despues';
    storage_path: string;
    url?: string; // Signed URL retrieved at runtime
}

interface ProyectoDetalleProps {
    project: Project;
    onBack: () => void;
}

export function ProyectoDetalle({ project, onBack }: ProyectoDetalleProps) {
    const [activeTab, setActiveTab] = useState<'antes' | 'despues'>('antes');
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [showExportModal, setShowExportModal] = useState(false);
    const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        loadPhotos();
    }, [activeTab]);

    async function loadPhotos() {
        setLoading(true);
        const { data: dbPhotos, error } = await supabase
            .from('project_photos')
            .select('*')
            .eq('project_id', project.id)
            .eq('category', activeTab)
            .order('created_at', { ascending: false });

        if (error || !dbPhotos) {
            console.error("Error loading photos:", error);
            setLoading(false);
            return;
        }

        // Fetch signed URLs for the private bucket
        const photosWithUrls = await Promise.all(
            dbPhotos.map(async (p: any) => {
                const { data } = await supabase.storage
                    .from('work_photos')
                    .createSignedUrl(p.storage_path, 3600); // 1 hour valid

                return {
                    ...p,
                    url: data?.signedUrl
                };
            })
        );

        setPhotos(photosWithUrls);
        setLoading(false);
    }

    async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        if (!file) return;

        setUploading(true);
        try {
            const { data: userAuth } = await supabase.auth.getUser();
            const fileExt = file.name.split('.').pop();
            const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
            const filePath = `${project.organization_id}/${project.id}/${fileName}`;

            // 1. Upload to Supabase Storage
            const { error: uploadError } = await supabase.storage
                .from('work_photos')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            // 2. Save metadata in Supabase DB
            const { error: dbError } = await supabase.from('project_photos').insert([{
                project_id: project.id,
                organization_id: project.organization_id,
                category: activeTab,
                storage_path: filePath,
                uploaded_by: userAuth.user?.id
            }]);

            if (dbError) throw dbError;

            // Reload automatically
            await loadPhotos();

        } catch (error: any) {
            alert(`Error subiendo la foto: ${error.message}`);
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    }

    async function handleDelete(photo: Photo) {
        if (!confirm("¿Eliminar esta foto permanentemente?")) return;

        try {
            // Delete from Storage
            await supabase.storage.from('work_photos').remove([photo.storage_path]);
            // Delete from DB
            await supabase.from('project_photos').delete().eq('id', photo.id);

            // Remove from local state
            setPhotos(photos.filter(p => p.id !== photo.id));
        } catch (error) {
            console.error("Error al eliminar", error);
        }
    }

    return (
        <div className="flex flex-col h-full overflow-hidden bg-[#060612]">
            {/* Header */}
            <div className="p-4 md:p-6 flex flex-col gap-4 border-b border-indigo-500/10 bg-[#0a0a1a] shrink-0">
                <button
                    onClick={onBack}
                    className="flex w-fit items-center gap-2 text-slate-400 hover:text-white transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" />
                    <span className="text-sm font-medium">Volver a Proyectos</span>
                </button>

                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-3">
                            <h2 className="text-xl font-bold text-white line-clamp-1">{project.address || "Proyecto sin título"}</h2>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-800 text-slate-400 shrink-0">
                                {project.status}
                            </span>
                        </div>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mt-1">
                            <p className="text-slate-500 text-sm">RC: {project.rc}</p>
                            <div className="flex items-center gap-2 text-sm text-slate-400">
                                <span className="text-xs">Fecha:</span>
                                <input
                                    type="date"
                                    defaultValue={project.visit_date ? new Date(project.visit_date).toISOString().split('T')[0] : ''}
                                    onChange={async (e) => {
                                        const val = e.target.value;
                                        await supabase.from('projects').update({ visit_date: val }).eq('id', project.id);
                                    }}
                                    className="bg-transparent border border-slate-800 hover:border-slate-600 rounded px-1.5 py-0.5 text-xs text-slate-300 outline-none focus:border-indigo-500 transition-colors [color-scheme:dark]"
                                />
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={() => setShowExportModal(true)}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500 hover:text-white rounded-lg transition-colors font-medium border border-indigo-500/30 text-sm w-full md:w-auto"
                    >
                        <Download className="w-4 h-4" />
                        Exportar Expediente
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex gap-2 bg-black/40 p-1 rounded-xl border border-slate-800/60 mt-2">
                    {['antes', 'despues'].map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab as any)}
                            className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium capitalize transition-all ${activeTab === tab
                                ? 'bg-indigo-500 text-white shadow-md'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                                }`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
            </div>

            {/* Gallery Content */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 relative">
                {loading ? (
                    <div className="flex items-center justify-center h-full">
                        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                    </div>
                ) : photos.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-[60vh] opacity-50">
                        <ImageIcon className="w-16 h-16 text-slate-600 mb-4" />
                        <p className="text-slate-400">Aún no hay fotos para esta etapa.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {photos.map(photo => (
                            <div key={photo.id} className="relative group rounded-xl overflow-hidden bg-slate-900 border border-slate-800 aspect-square">
                                {photo.url ? (
                                    <img src={photo.url} alt="Evidencia" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-slate-600">
                                        <Loader2 className="w-6 h-6 animate-spin" />
                                    </div>
                                )}

                                {/* Hover overlay */}
                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-3">
                                    <div className="flex justify-end">
                                        <button
                                            onClick={() => handleDelete(photo)}
                                            className="p-2 bg-red-500/20 hover:bg-red-500/40 text-red-100 rounded-lg backdrop-blur-md transition-colors"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                    <p className="text-[10px] text-white/70 truncate">
                                        {new Date(photo.created_at).toLocaleDateString()}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Floating Action Button for Upload */}
            <div className="absolute bottom-6 right-6 md:bottom-8 md:right-8">
                <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                />
                <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="flex items-center justify-center w-14 h-14 md:w-16 md:h-16 bg-gradient-to-tr from-indigo-600 to-purple-500 hover:from-indigo-500 hover:to-purple-400 text-white rounded-full shadow-[0_0_30px_rgba(99,102,241,0.4)] transition-transform hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
                >
                    {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Camera className="w-6 h-6 md:w-7 md:h-7" />}
                </button>
            </div>

            {uploading && (
                <div className="absolute bottom-24 right-6 bg-indigo-500 text-white text-xs px-3 py-1.5 rounded-full font-medium shadow-lg animate-in slide-in-from-bottom-2">
                    Subiendo foto...
                </div>
            )}
            {showExportModal && (
                <ExportadorModal
                    project={project}
                    photos={photos}
                    onClose={() => setShowExportModal(false)}
                />
            )}
        </div>
    );
}
