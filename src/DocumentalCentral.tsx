import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { Search, Download, FileText, Beaker } from "lucide-react";
import { Input } from "./components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Badge } from "./components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "./components/ui/table";
import { ScrollArea } from "./components/ui/scroll-area";

interface MaterialReferencia {
    id: string;
    nombre: string;
    marca: string;
    tipo_material: string;
    lambda_w_mk: number;
    r2_pdf_path: string;
    tags: string[];
}

export function CentralDocumental() {
    const [materiales, setMateriales] = useState<MaterialReferencia[]>([]);
    const [busqueda, setBusqueda] = useState("");
    const [cargando, setCargando] = useState(true);

    // El R2 Public URL desde las variables de entorno para armar los links de descarga
    const R2_PUBLIC_URL = import.meta.env.VITE_R2_PUBLIC_URL || "";

    useEffect(() => {
        async function fetchMateriales() {
            if (!supabase) return;
            try {
                const { data, error } = await supabase
                    .from("materiales_referencia")
                    .select("*")
                    .eq("activo", true)
                    .order("marca", { ascending: true });

                if (error) {
                    console.error("Error cargando materiales:", error);
                    return;
                }

                if (data) {
                    setMateriales(data as MaterialReferencia[]);
                }
            } catch (err) {
                console.error("Excepción cargando materiales:", err);
            } finally {
                setCargando(false);
            }
        }

        fetchMateriales();
    }, []);

    const materialesFiltrados = materiales.filter((mat) => {
        const termino = busqueda.toLowerCase();
        return (
            mat.nombre.toLowerCase().includes(termino) ||
            mat.marca.toLowerCase().includes(termino) ||
            mat.tipo_material.toLowerCase().includes(termino) ||
            (mat.tags && mat.tags.some(tag => tag.toLowerCase().includes(termino)))
        );
    });

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] p-6 gap-6 animate-in fade-in duration-500">

            {/* Cabecera y Buscador */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-slate-100 flex items-center gap-3">
                        <FileText className="h-8 w-8 text-indigo-400" />
                        Central Documental Técnica
                    </h2>
                    <p className="text-slate-400 mt-1">
                        Encuentre ACERMIs, Fichas Técnicas y valores Lambda (λ) oficiales de los fabricantes.
                    </p>
                </div>
                <div className="relative w-full md:w-96">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                    <Input
                        placeholder="Buscar por marca, material, lana, inyección..."
                        className="pl-10 bg-slate-900/50 border-slate-800 text-slate-200 w-full focus-visible:ring-indigo-500"
                        value={busqueda}
                        onChange={(e) => setBusqueda(e.target.value)}
                    />
                </div>
            </div>

            {/* Tabla de Resultados */}
            <Card className="flex-1 bg-slate-900/40 border-slate-800 shadow-2xl flex flex-col overflow-hidden">
                <CardHeader className="pb-3 border-b border-slate-800/50">
                    <CardTitle className="text-lg text-slate-200">
                        Catálogo de Aislantes ({materialesFiltrados.length})
                    </CardTitle>
                    <CardDescription className="text-slate-500">
                        Los documentos se descargan directamente desde nuestro CDN seguro y rápido.
                    </CardDescription>
                </CardHeader>

                <CardContent className="p-0 flex-1 overflow-hidden">
                    <ScrollArea className="h-full">
                        {cargando ? (
                            <div className="flex justify-center items-center h-40 text-slate-500">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mr-3"></div>
                                Cargando base de datos técnica...
                            </div>
                        ) : materialesFiltrados.length === 0 ? (
                            <div className="flex flex-col justify-center items-center h-60 text-slate-500 gap-3">
                                <Search className="h-10 w-10 opacity-20" />
                                <p>No se encontraron materiales para "{busqueda}"</p>
                            </div>
                        ) : (
                            <Table>
                                <TableHeader className="bg-slate-900/80 sticky top-0 z-10 backdrop-blur-sm">
                                    <TableRow className="border-slate-800 hover:bg-transparent">
                                        <TableHead className="text-slate-400 font-semibold w-[250px]">Nombre del Producto</TableHead>
                                        <TableHead className="text-slate-400 font-semibold">Fabricante</TableHead>
                                        <TableHead className="text-slate-400 font-semibold">Tipo de Material</TableHead>
                                        <TableHead className="text-slate-400 font-semibold text-center"><span className="flex items-center justify-center gap-1" title="Conductividad Térmica"><Beaker className="w-4 h-4" /> Lambda (λ)</span></TableHead>
                                        <TableHead className="text-slate-400 font-semibold text-right">Documentación</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {materialesFiltrados.map((mat) => (
                                        <TableRow key={mat.id} className="border-slate-800 hover:bg-slate-800/30 transition-colors">
                                            <TableCell className="font-medium text-slate-200">
                                                {mat.nombre}
                                                {mat.tags && mat.tags.length > 0 && (
                                                    <div className="flex flex-wrap gap-1 mt-1.5">
                                                        {mat.tags.map(tag => (
                                                            <Badge key={tag} variant="secondary" className="text-[10px] bg-slate-800 text-slate-400 hover:bg-slate-700">
                                                                {tag}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-slate-300">
                                                <span className="inline-flex items-center px-2 py-1 rounded-md bg-indigo-500/10 text-indigo-400 text-xs font-semibold ring-1 ring-inset ring-indigo-500/20">
                                                    {mat.marca}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-slate-400">
                                                {mat.tipo_material}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <span className="font-mono text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded">
                                                    {mat.lambda_w_mk.toFixed(3)}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <a
                                                    href={`${R2_PUBLIC_URL}/${mat.r2_pdf_path}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-300 disabled:pointer-events-none disabled:opacity-50 border border-slate-700 hover:bg-slate-800 hover:text-slate-50 bg-slate-900 text-slate-300 h-9 px-4 py-2 hover:border-indigo-500 group"
                                                >
                                                    <Download className="mr-2 h-4 w-4 text-indigo-400 group-hover:text-indigo-300 transition-colors" />
                                                    Descargar Ficha
                                                </a>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
    );
}
