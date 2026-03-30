import { useState } from "react";
import {
    Building2,
    Search,
    Loader2,
    MapPin,
    Calendar,
    Ruler,
    Home,
    ExternalLink,
    Database,
    Wifi,
    AlertCircle,
    ChevronDown,
    Copy,
    Check,
    Mail,
    Landmark,
    Layers,
} from "lucide-react";
import {
    consultarCatastro,
    validarRC,
    esParcerlaMultiple,
    extraerListaInmuebles,
    extraerDatosInmuebleUnico,
    getUrlCroquis,
    type InmuebleData,
    type ConstruccionData,
} from "./lib/catastroService";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Badge } from "./components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./components/ui/table";

function normalizarUso(uso: string): string {
    return uso
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase();
}

function esUsoVivienda(uso: string): boolean {
    return normalizarUso(uso).includes("VIVIENDA");
}

function parsearSuperficie(valor: string): number | null {
    const raw = String(valor ?? "").trim();
    if (!raw || raw === "N/D") return null;

    let normalizado = raw.replace(/\s/g, "");
    if (normalizado.includes(",") && normalizado.includes(".")) {
        normalizado = normalizado.replace(/\./g, "").replace(",", ".");
    } else {
        normalizado = normalizado.replace(",", ".");
    }

    normalizado = normalizado.replace(/[^0-9.-]/g, "");
    if (!normalizado || normalizado === "." || normalizado === "-") return null;

    const numero = Number.parseFloat(normalizado);
    return Number.isFinite(numero) ? numero : null;
}

function formatearSuperficie(valor: number): string {
    return valor.toLocaleString("es-ES", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

export function ConsultaCatastral() {
    const [rc, setRc] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [datos, setDatos] = useState<any>(null);
    const [fromCache, setFromCache] = useState(false);
    const [inmuebles, setInmuebles] = useState<InmuebleData[]>([]);
    const [inmuebleUnico, setInmuebleUnico] = useState<ReturnType<typeof extraerDatosInmuebleUnico> | null>(null);
    const [esMultiple, setEsMultiple] = useState(false);
    const [copied, setCopied] = useState<string | null>(null);

    // Validación en tiempo real
    const { valido: rcValido } = rc.trim() ? validarRC(rc) : { valido: false };
    const rcLength = rc.trim().replace(/[\s-]/g, "").length;
    const construccionesAnalizadas = inmuebleUnico
        ? inmuebleUnico.construcciones.map((c) => {
            const superficieNumero = parsearSuperficie(c.superficie);
            return {
                ...c,
                computaCe3x: esUsoVivienda(c.uso),
                superficieNumero,
            };
        })
        : [];
    const construccionesVivienda = construccionesAnalizadas.filter((c) => c.computaCe3x && c.superficieNumero !== null);
    const superficieViviendaTotal = construccionesVivienda.reduce((acc, c) => acc + (c.superficieNumero ?? 0), 0);
    const operacionVivienda = construccionesVivienda.map((c) => formatearSuperficie(c.superficieNumero as number)).join(" + ");
    const construccionesNoVivienda = construccionesAnalizadas.filter((c) => !c.computaCe3x);

    const handleConsultar = async () => {
        if (!rc.trim()) return;
        setLoading(true);
        setError(null);
        setDatos(null);
        setInmuebles([]);
        setInmuebleUnico(null);

        const result = await consultarCatastro(rc);
        setLoading(false);

        if (result.error) {
            setError(result.error);
            return;
        }

        setDatos(result.datos);
        setFromCache(result.fromCache);

        const { multiple } = esParcerlaMultiple(result.datos!);
        setEsMultiple(multiple);

        if (multiple) {
            const lista = extraerListaInmuebles(result.datos!);
            setInmuebles(lista);
        } else {
            const unico = extraerDatosInmuebleUnico(result.datos!);
            setInmuebleUnico(unico);
        }
    };

    const copiarRC = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(text);
        setTimeout(() => setCopied(null), 2000);
    };

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] p-6 gap-6 animate-in fade-in duration-500 overflow-y-auto">
            {/* Cabecera */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-slate-100 flex items-center gap-3">
                        <Building2 className="h-8 w-8 text-cyan-400" />
                        Consulta Catastral
                    </h2>
                    <p className="text-slate-400 mt-1">
                        Introduzca la Referencia Catastral para obtener los datos del inmueble.
                    </p>
                </div>
            </div>

            {/* Buscador de RC */}
            <Card className="bg-slate-900/40 border-slate-800 shadow-2xl shrink-0">
                <CardContent className="p-6">
                    <div className="flex gap-3 items-end">
                        <div className="flex-1 space-y-2">
                            <label className="text-sm font-medium text-slate-300">Referencia Catastral</label>
                            <div className="relative">
                                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                                <Input
                                    placeholder="Ej: 1538603UM1113N0001OD"
                                    value={rc}
                                    onChange={(e) => setRc(e.target.value.toUpperCase())}
                                    onKeyDown={(e) => e.key === "Enter" && rcValido && handleConsultar()}
                                    className="pl-10 bg-slate-900/50 border-slate-800 text-slate-200 font-mono text-lg tracking-wider focus-visible:ring-cyan-500"
                                />
                                {rc.trim() && (
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                                        <span className={`text-xs font-mono ${rcValido ? "text-emerald-400" : "text-slate-500"}`}>
                                            {rcLength}/20
                                        </span>
                                        {rcValido ? (
                                            <Check className="h-4 w-4 text-emerald-400" />
                                        ) : (
                                            <AlertCircle className="h-4 w-4 text-amber-400" />
                                        )}
                                    </div>
                                )}
                            </div>
                            <p className="text-xs text-slate-600">Formatos: 14 (parcela), 18 (inmueble), 20 (inmueble completo)</p>
                        </div>
                        <button
                            onClick={handleConsultar}
                            disabled={!rcValido || loading}
                            className="h-9 px-6 rounded-md bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold transition-all disabled:opacity-40 disabled:pointer-events-none flex items-center gap-2 shadow-lg shadow-cyan-500/20"
                        >
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                            Consultar
                        </button>
                    </div>
                </CardContent>
            </Card>

            {/* Error */}
            {error && (
                <div className="flex items-center gap-3 p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm animate-in fade-in slide-in-from-top-2 duration-300 shrink-0">
                    <AlertCircle className="h-5 w-5 shrink-0" />
                    {error}
                </div>
            )}

            {/* Resultado: Inmueble Único */}
            {inmuebleUnico && !esMultiple && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-4">
                    {/* Cache/Live badge */}
                    <div className="flex items-center gap-3">
                        <Badge className={`${fromCache ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30" : "bg-cyan-500/15 text-cyan-400 ring-1 ring-cyan-500/30"}`}>
                            {fromCache ? <><Database className="h-3 w-3 mr-1" />Desde Caché</> : <><Wifi className="h-3 w-3 mr-1" />Live API</>}
                        </Badge>
                        {inmuebleUnico.tipoFinca && (
                            <Badge className="bg-purple-500/15 text-purple-400 ring-1 ring-purple-500/30">
                                <Landmark className="h-3 w-3 mr-1" />
                                {inmuebleUnico.tipoFinca}
                            </Badge>
                        )}
                    </div>

                    {/* Info Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                        <InfoCard icon={<MapPin />} label="Dirección" value={inmuebleUnico.direccion || "N/D"} color="cyan" />
                        <InfoCard icon={<Building2 />} label="Municipio" value={inmuebleUnico.municipio || "N/D"} color="blue" />
                        <InfoCard icon={<Landmark />} label="Provincia" value={inmuebleUnico.provincia || "N/D"} color="indigo" />
                        <InfoCard icon={<Mail />} label="Código Postal" value={inmuebleUnico.codigoPostal || "N/D"} color="violet" />
                        <InfoCard icon={<Home />} label="Uso" value={inmuebleUnico.uso} color="purple" />
                        <InfoCard icon={<Ruler />} label="Superficie Catastral" value={`${inmuebleUnico.superficie} m²`} color="emerald" />
                        <InfoCard icon={<Calendar />} label="Año Construcción" value={inmuebleUnico.anoConstruccion} color="amber" />
                        <InfoCard icon={<Layers />} label="Sup. Suelo Parcela" value={inmuebleUnico.superficieSuelo ? `${inmuebleUnico.superficieSuelo} m²` : "N/D"} color="teal" />
                    </div>

                    <Card className="bg-slate-900/40 border-slate-800">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
                                <Home className="h-4 w-4 text-emerald-400" />
                                CE3X - Suma solo uso VIVIENDA
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="pt-0 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                <span className="text-slate-400">Total computable CE3X</span>
                                <span className="text-emerald-400 font-mono font-semibold">
                                    {formatearSuperficie(superficieViviendaTotal)} m²
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 font-mono break-words">
                                {construccionesVivienda.length > 0
                                    ? `Suma realizada: ${operacionVivienda} = ${formatearSuperficie(superficieViviendaTotal)} m²`
                                    : "Suma realizada: 0,00 m² (no hay unidades VIVIENDA con superficie numérica)."}
                            </p>
                            {construccionesNoVivienda.length > 0 && (
                                <p className="text-xs text-amber-400 break-words">
                                    No se suman (informativo): {construccionesNoVivienda.map((c) => `${c.uso} (${c.superficie} m²)`).join(" · ")}
                                </p>
                            )}
                        </CardContent>
                    </Card>

                    {/* Tabla de Construcciones */}
                    {inmuebleUnico.construcciones.length > 0 && (
                        <Card className="bg-slate-900/40 border-slate-800">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
                                    <Layers className="h-4 w-4 text-purple-400" />
                                    Unidades Constructivas ({inmuebleUnico.construcciones.length})
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="border-slate-800 hover:bg-transparent">
                                            <TableHead className="text-slate-500 text-xs">Uso</TableHead>
                                            <TableHead className="text-slate-500 text-xs">Computa CE3X</TableHead>
                                            <TableHead className="text-slate-500 text-xs">Tipo</TableHead>
                                            <TableHead className="text-slate-500 text-xs">Planta</TableHead>
                                            <TableHead className="text-slate-500 text-xs">Puerta</TableHead>
                                            <TableHead className="text-slate-500 text-xs text-right">Superficie</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {construccionesAnalizadas.map((c: ConstruccionData & { computaCe3x: boolean }, i: number) => (
                                            <TableRow key={i} className="border-slate-800/50">
                                                <TableCell className="text-sm text-slate-200 font-medium">{c.uso}</TableCell>
                                                <TableCell>
                                                    <Badge className={c.computaCe3x ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30" : "bg-slate-700/50 text-slate-400 ring-1 ring-slate-600/50"}>
                                                        {c.computaCe3x ? "SI (VIVIENDA)" : "NO"}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-xs text-slate-400">{c.tipo}</TableCell>
                                                <TableCell className="text-sm text-slate-300 font-mono">{c.planta}</TableCell>
                                                <TableCell className="text-sm text-slate-300 font-mono">{c.puerta}</TableCell>
                                                <TableCell className="text-sm text-emerald-400 font-mono text-right">{c.superficie} m²</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    )}

                    {/* Botones de acción */}
                    <Card className="bg-slate-900/40 border-slate-800 shrink-0">
                        <CardContent className="p-4 flex flex-wrap gap-3">
                            {inmuebleUnico.urlCartografia ? (
                                <a
                                    href={inmuebleUnico.urlCartografia}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors text-sm font-medium ring-1 ring-slate-700"
                                >
                                    <ExternalLink className="h-4 w-4 text-cyan-400" />
                                    Ver Cartografía
                                </a>
                            ) : (
                                <a
                                    href={getUrlCroquis(rc, datos)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors text-sm font-medium ring-1 ring-slate-700"
                                >
                                    <ExternalLink className="h-4 w-4 text-cyan-400" />
                                    Ver en Sede Catastro
                                </a>
                            )}
                            <button
                                onClick={() => copiarRC(rc.trim().toUpperCase().replace(/[\s-]/g, ""))}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors text-sm font-medium ring-1 ring-slate-700"
                            >
                                {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4 text-slate-400" />}
                                {copied ? "Copiado" : "Copiar RC"}
                            </button>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Resultado: Parcela Múltiple */}
            {esMultiple && inmuebles.length > 0 && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-4">
                    <div className="flex items-center gap-3 mb-2">
                        <Badge className="bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30">
                            <ChevronDown className="h-3 w-3 mr-1" />
                            Parcela con {inmuebles.length} inmuebles
                        </Badge>
                        <Badge className={`${fromCache ? "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30" : "bg-cyan-500/15 text-cyan-400 ring-1 ring-cyan-500/30"}`}>
                            {fromCache ? <><Database className="h-3 w-3 mr-1" />Caché</> : <><Wifi className="h-3 w-3 mr-1" />Live</>}
                        </Badge>
                    </div>

                    <div className="grid gap-3">
                        {inmuebles.map((inm, i) => (
                            <Card key={i} className="bg-slate-900/40 border-slate-800 hover:bg-slate-800/30 transition-colors cursor-pointer group">
                                <CardContent className="p-4 flex items-center gap-4">
                                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-cyan-500/10 text-cyan-400 font-mono text-sm font-bold shrink-0">
                                        {i + 1}
                                    </div>
                                    <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1">
                                        <div>
                                            <span className="text-[10px] uppercase tracking-wider text-slate-500">RC</span>
                                            <p className="text-xs font-mono text-slate-300">{inm.rc}</p>
                                        </div>
                                        <div>
                                            <span className="text-[10px] uppercase tracking-wider text-slate-500">Planta / Puerta</span>
                                            <p className="text-sm text-slate-200">{inm.planta} / {inm.puerta}</p>
                                        </div>
                                        <div>
                                            <span className="text-[10px] uppercase tracking-wider text-slate-500">Superficie</span>
                                            <p className="text-sm text-emerald-400 font-medium">{inm.superficie} m²</p>
                                        </div>
                                        <div>
                                            <span className="text-[10px] uppercase tracking-wider text-slate-500">Uso / Año</span>
                                            <p className="text-sm text-slate-300">{inm.uso} · {inm.ano}</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => copiarRC(inm.rc)}
                                        className="shrink-0 p-2 rounded-md hover:bg-slate-700 transition-colors"
                                        title="Copiar RC"
                                    >
                                        {copied === inm.rc ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4 text-slate-500" />}
                                    </button>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </div>
            )}

            {/* Estado vacío */}
            {!loading && !error && !datos && (
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center space-y-4 text-slate-600">
                        <Building2 className="h-16 w-16 mx-auto opacity-20" />
                        <p className="text-lg">Introduzca una referencia catastral para consultar</p>
                        <p className="text-sm">Se busca primero en el caché de Supabase. Si no existe, se consulta la API del Catastro en tiempo real.</p>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Info Card Component ─────────────────────────────────────────────

function InfoCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
    const colorMap: Record<string, string> = {
        cyan: "text-cyan-400 bg-cyan-500/10",
        blue: "text-blue-400 bg-blue-500/10",
        indigo: "text-indigo-400 bg-indigo-500/10",
        violet: "text-violet-400 bg-violet-500/10",
        purple: "text-purple-400 bg-purple-500/10",
        emerald: "text-emerald-400 bg-emerald-500/10",
        amber: "text-amber-400 bg-amber-500/10",
        pink: "text-pink-400 bg-pink-500/10",
        teal: "text-teal-400 bg-teal-500/10",
    };
    const classes = colorMap[color] ?? colorMap.cyan;

    return (
        <Card className="bg-slate-900/40 border-slate-800">
            <CardContent className="p-4 flex items-start gap-3">
                <div className={`p-2 rounded-lg ${classes} shrink-0 [&>svg]:h-5 [&>svg]:w-5`}>{icon}</div>
                <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">{label}</p>
                    <p className="text-sm font-medium text-slate-200 truncate" title={value}>{value}</p>
                </div>
            </CardContent>
        </Card>
    );
}
