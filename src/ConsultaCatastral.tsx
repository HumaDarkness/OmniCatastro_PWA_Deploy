import { useState, useEffect } from "react";
import { Search, FileText, Download, Database, ShieldCheck, Loader2, Info } from "lucide-react";
import { supabase } from "./lib/supabase";
import { Card, CardContent } from "./components/ui/card";
import { Input } from "./components/ui/input";

interface Material {
    id: string;
    nombre: string;
    marca: string;
    lambda_w_mk: number;
    url_acermi: string | null;
    url_ficha: string | null;
    created_at: string;
}

export function CentralDocumental() {
    const [searchTerm, setSearchTerm] = useState("");
    const [materiales, setMateriales] = useState<Material[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadMateriales();
    }, []);

    async function loadMateriales() {
        setLoading(true);
        if (!supabase) return;
        const { data, error } = await supabase
            .from("materiales_referencia")
            .select("*")
            .eq("activo", true)
            .order("nombre");
        if (!error && data) {
            setMateriales(data);
        }
        setLoading(false);
    }

    const filtered = materiales.filter(
        (m) =>
            m.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
            m.marca.toLowerCase().includes(searchTerm.toLowerCase())
    );

    function getStorageUrl(path: string | null) {
        if (!path) return null;
        if (path.startsWith("http")) return path;
        // Construct public URL for R2 / Supabase Storage (Assumes public or signed via middleware elsewhere)
        // For OCPWA, we usually link directly to the R2 public endpoint or use Supabase CDN
        return path;
    }

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] p-6 gap-6 animate-in fade-in duration-500 overflow-y-auto">
            {/* Header Area */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                    <h2 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
                        <Database className="h-8 w-8 text-indigo-400" />
                        Central Documental
                    </h2>
                    <p className="text-slate-400">
                        Catálogo técnico homologado de materiales aislantes y certificados de ahorro energético.
                    </p>
                </div>

                <div className="relative w-full md:w-96 group">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-slate-500 group-focus-within:text-indigo-400 transition-colors" />
                    <Input
                        placeholder="Buscar por nombre o marca (Ej: Supafil, URSA...)"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-9 h-11 bg-slate-900/50 border-slate-700 text-slate-100 focus:border-indigo-500 transition-all rounded-xl"
                    />
                </div>
            </div>

            {/* Content Area */}
            {loading ? (
                <div className="flex-1 flex flex-col items-center justify-center">
                    <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
                    <p className="mt-4 text-slate-500 text-sm">Cargando base de datos de materiales...</p>
                </div>
            ) : filtered.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-slate-800 rounded-3xl bg-slate-900/20 text-slate-600">
                    <Info className="h-12 w-12 opacity-10 mb-4" />
                    <p className="text-lg font-medium text-slate-400">No se han encontrado resultados</p>
                    <p className="text-sm mt-1">Pruebe con otros términos de búsqueda.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 pb-10">
                    {filtered.map((m) => (
                        <Card key={m.id} className="bg-slate-900/40 border-slate-800 overflow-hidden hover:border-indigo-500/50 hover:bg-slate-800/40 transition-all group flex flex-col">
                            <CardContent className="p-6 flex-1 flex flex-col">
                                <div className="flex items-start justify-between mb-4">
                                    <div className="p-3 bg-indigo-500/10 rounded-xl">
                                        <FileText className="h-6 w-6 text-indigo-400" />
                                    </div>
                                    <div className="flex flex-col items-end">
                                        <span className="text-[10px] text-indigo-400 font-bold tracking-widest uppercase mb-1">{m.marca}</span>
                                        <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-800/50 border border-slate-700">
                                            <span className="text-[10px] text-slate-500 font-mono">λ:</span>
                                            <span className="text-xs font-bold text-slate-100 font-mono">{m.lambda_w_mk} W/mK</span>
                                        </div>
                                    </div>
                                </div>

                                <h3 className="text-xl font-bold text-slate-100 mb-2 leading-tight">{m.nombre}</h3>
                                <p className="text-sm text-slate-500 mb-6 flex-1">
                                    Material certificado para inyectado y trasdosados térmicos. Datos vinculados a Cálculos CEA.
                                </p>

                                <div className="flex gap-2">
                                    {m.url_acermi ? (
                                        <a
                                            href={getStorageUrl(m.url_acermi) || "#"}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex-1 flex items-center justify-center gap-2 h-10 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-all group/btn"
                                        >
                                            <ShieldCheck className="h-4 w-4 text-emerald-400 group-hover/btn:scale-110 transition-transform" />
                                            Cert. ACERMI
                                        </a>
                                    ) : (
                                        <div className="flex-1 h-10 flex items-center justify-center border border-slate-800/50 text-slate-600 text-[10px] rounded-lg cursor-not-allowed italic">
                                            ACERMI no disp.
                                        </div>
                                    )}

                                    {m.url_ficha ? (
                                        <a
                                            href={getStorageUrl(m.url_ficha) || "#"}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex-1 flex items-center justify-center gap-2 h-10 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition-all shadow-lg shadow-indigo-500/10"
                                        >
                                            <Download className="h-4 w-4" />
                                            Ficha Técnica
                                        </a>
                                    ) : (
                                        <div className="flex-1 h-10 flex items-center justify-center border border-slate-800/50 text-slate-600 text-[10px] rounded-lg cursor-not-allowed italic">
                                            Ficha no disp.
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
