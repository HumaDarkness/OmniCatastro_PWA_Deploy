import { useState, useEffect } from "react";
import {
    Calculator,
    Plus,
    Trash2,
    Copy,
    Check,
    Zap,
    ArrowRight,
    Info,
    Flame,
    Snowflake,
} from "lucide-react";
import {
    calcularAhorroCAE,
    generarInformeTexto,
    type CapaMaterial,
    type ResultadoTermico,
} from "./lib/thermalCalculator";
import { supabase } from "./lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Badge } from "./components/ui/badge";

interface MaterialDB {
    id: string;
    nombre: string;
    marca: string;
    lambda_w_mk: number;
}

// Zonas climáticas de España (Grados-hora en horas·kelvin)
const ZONAS_CLIMATICAS = [
    { label: "α3 (Canarias costa)", valor: 583 },
    { label: "A3 (Málaga, Almería)", valor: 783 },
    { label: "A4 (Cádiz)", valor: 783 },
    { label: "B3 (Valencia, Alicante)", valor: 958 },
    { label: "B4 (Sevilla, Córdoba)", valor: 958 },
    { label: "C1 (Santander, Bilbao)", valor: 1133 },
    { label: "C2 (Barcelona)", valor: 1133 },
    { label: "C3 (Granada)", valor: 1133 },
    { label: "C4 (Cáceres)", valor: 1133 },
    { label: "D1 (Vitoria, Pamplona)", valor: 1483 },
    { label: "D2 (Valladolid, Zamora)", valor: 1483 },
    { label: "D3 (Madrid, Toledo)", valor: 1483 },
    { label: "E1 (Burgos, León, Soria)", valor: 1858 },
];

export function CalculadoraTermica() {
    const [capas, setCapas] = useState<CapaMaterial[]>([
        { nombre: "Ladrillo hueco", espesor: 0.07, lambda_val: 0.49, r_valor: 0, es_nueva: false },
        { nombre: "Cámara de aire", espesor: 0, lambda_val: 0, r_valor: 0.18, es_nueva: false },
    ]);
    const [areaHNH, setAreaHNH] = useState(25);
    const [areaNHE, setAreaNHE] = useState(25);
    const [supActuacion, setSupActuacion] = useState(25);
    const [supEnvolvente, setSupEnvolvente] = useState(120);
    const [zonaIdx, setZonaIdx] = useState(10); // D3 (Madrid)
    const [resultado, setResultado] = useState<ResultadoTermico | null>(null);
    const [copied, setCopied] = useState(false);
    const [materialesDB, setMaterialesDB] = useState<MaterialDB[]>([]);

    // Cargar materiales de la Central Documental para el selector rápido
    useEffect(() => {
        async function load() {
            if (!supabase) return;
            const { data } = await supabase
                .from("materiales_referencia")
                .select("id, nombre, marca, lambda_w_mk")
                .eq("activo", true);
            if (data) setMaterialesDB(data);
        }
        load();
    }, []);

    const addCapa = (esNueva: boolean) => {
        setCapas([...capas, { nombre: "", espesor: 0, lambda_val: 0, r_valor: 0, es_nueva: esNueva }]);
    };

    const removeCapa = (idx: number) => {
        setCapas(capas.filter((_, i) => i !== idx));
    };

    const updateCapa = (idx: number, field: keyof CapaMaterial, value: any) => {
        const updated = [...capas];
        (updated[idx] as any)[field] = value;
        setCapas(updated);
    };

    const seleccionarMaterialDB = (idx: number, materialId: string) => {
        const mat = materialesDB.find((m) => m.id === materialId);
        if (!mat) return;
        const updated = [...capas];
        updated[idx] = {
            ...updated[idx],
            nombre: `${mat.nombre} (${mat.marca})`,
            lambda_val: mat.lambda_w_mk,
        };
        setCapas(updated);
    };

    const calcular = () => {
        const res = calcularAhorroCAE({
            capas,
            area_h_nh: areaHNH,
            area_nh_e: areaNHE,
            superficie_actuacion: supActuacion,
            zona_climatica: ZONAS_CLIMATICAS[zonaIdx].valor,
            sup_envolvente_total: supEnvolvente,
        });
        setResultado(res);
    };

    const copiarInforme = () => {
        if (!resultado) return;
        const texto = generarInformeTexto({
            capas,
            resultado,
            sup_actuacion: supActuacion,
            sup_envolvente_total: supEnvolvente,
            zona_climatica: ZONAS_CLIMATICAS[zonaIdx].valor,
            area_h_nh: areaHNH,
            area_nh_e: areaNHE,
        });
        navigator.clipboard.writeText(texto);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
    };

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] p-6 gap-5 animate-in fade-in duration-500 overflow-y-auto">
            {/* Cabecera */}
            <div>
                <h2 className="text-3xl font-bold tracking-tight text-slate-100 flex items-center gap-3">
                    <Calculator className="h-8 w-8 text-orange-400" />
                    Calculadora Térmica CAE
                </h2>
                <p className="text-slate-400 mt-1">
                    Calcula el ahorro energético (kWh/año) según el Reglamento de Certificados de Ahorro Energético.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Columna izquierda: Capas de material */}
                <div className="lg:col-span-2 space-y-4">
                    <Card className="bg-slate-900/40 border-slate-800">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-lg text-slate-200 flex items-center gap-2">
                                <Snowflake className="h-5 w-5 text-blue-400" />
                                Capas del Cerramiento
                            </CardTitle>
                            <CardDescription className="text-slate-500">
                                Añada las capas existentes y las de mejora (nuevas).
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {capas.map((c, i) => (
                                <div
                                    key={i}
                                    className={`p-3 rounded-lg border transition-colors ${c.es_nueva
                                            ? "bg-emerald-500/5 border-emerald-500/20"
                                            : "bg-slate-800/30 border-slate-800"
                                        }`}
                                >
                                    <div className="flex items-center gap-2 mb-2">
                                        <Badge
                                            className={`text-[10px] ${c.es_nueva
                                                    ? "bg-emerald-500/15 text-emerald-400"
                                                    : "bg-slate-700 text-slate-400"
                                                }`}
                                        >
                                            {c.es_nueva ? "NUEVA" : "EXISTENTE"}
                                        </Badge>
                                        <button onClick={() => removeCapa(i)} className="ml-auto text-slate-600 hover:text-red-400 transition-colors">
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                        <div className="col-span-2 md:col-span-1">
                                            <label className="text-[10px] text-slate-500 uppercase">Nombre</label>
                                            <Input
                                                value={c.nombre}
                                                onChange={(e) => updateCapa(i, "nombre", e.target.value)}
                                                placeholder="Ej: Ladrillo"
                                                className="h-8 text-xs bg-slate-900/50 border-slate-700 text-slate-200"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-slate-500 uppercase">Espesor (m)</label>
                                            <Input
                                                type="number"
                                                step="0.001"
                                                value={c.espesor || ""}
                                                onChange={(e) => updateCapa(i, "espesor", parseFloat(e.target.value) || 0)}
                                                className="h-8 text-xs bg-slate-900/50 border-slate-700 text-slate-200 font-mono"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-slate-500 uppercase">λ (W/mK)</label>
                                            <Input
                                                type="number"
                                                step="0.001"
                                                value={c.lambda_val || ""}
                                                onChange={(e) => updateCapa(i, "lambda_val", parseFloat(e.target.value) || 0)}
                                                className="h-8 text-xs bg-slate-900/50 border-slate-700 text-slate-200 font-mono"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-slate-500 uppercase">R directo</label>
                                            <Input
                                                type="number"
                                                step="0.01"
                                                value={c.r_valor || ""}
                                                onChange={(e) => updateCapa(i, "r_valor", parseFloat(e.target.value) || 0)}
                                                placeholder="Ej: 0.18"
                                                className="h-8 text-xs bg-slate-900/50 border-slate-700 text-slate-200 font-mono"
                                            />
                                        </div>
                                    </div>
                                    {/* Selector rápido de material de la BD */}
                                    {materialesDB.length > 0 && c.es_nueva && (
                                        <div className="mt-2">
                                            <select
                                                className="w-full h-8 text-xs bg-slate-900/50 border border-slate-700 text-slate-300 rounded-md px-2"
                                                defaultValue=""
                                                onChange={(e) => seleccionarMaterialDB(i, e.target.value)}
                                            >
                                                <option value="" disabled>
                                                    ↓ Seleccionar de Central Documental...
                                                </option>
                                                {materialesDB.map((m) => (
                                                    <option key={m.id} value={m.id}>
                                                        {m.nombre} ({m.marca}) — λ={m.lambda_w_mk}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                </div>
                            ))}

                            <div className="flex gap-2 pt-2">
                                <button
                                    onClick={() => addCapa(false)}
                                    className="flex-1 h-9 rounded-md border border-dashed border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600 transition-colors text-xs flex items-center justify-center gap-1"
                                >
                                    <Plus className="h-3 w-3" /> Capa Existente
                                </button>
                                <button
                                    onClick={() => addCapa(true)}
                                    className="flex-1 h-9 rounded-md border border-dashed border-emerald-700 text-emerald-500 hover:text-emerald-300 hover:border-emerald-500 transition-colors text-xs flex items-center justify-center gap-1"
                                >
                                    <Plus className="h-3 w-3" /> Capa de Mejora
                                </button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Parámetros del proyecto */}
                    <Card className="bg-slate-900/40 border-slate-800">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-lg text-slate-200 flex items-center gap-2">
                                <Info className="h-5 w-5 text-purple-400" />
                                Parámetros del Proyecto
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                <div>
                                    <label className="text-[10px] text-slate-500 uppercase">Área H↔NH (m²)</label>
                                    <Input type="number" value={areaHNH} onChange={(e) => setAreaHNH(+e.target.value)} className="h-9 bg-slate-900/50 border-slate-700 text-slate-200 font-mono" />
                                </div>
                                <div>
                                    <label className="text-[10px] text-slate-500 uppercase">Área NH↔E (m²)</label>
                                    <Input type="number" value={areaNHE} onChange={(e) => setAreaNHE(+e.target.value)} className="h-9 bg-slate-900/50 border-slate-700 text-slate-200 font-mono" />
                                </div>
                                <div>
                                    <label className="text-[10px] text-slate-500 uppercase">Sup. Actuación (m²)</label>
                                    <Input type="number" value={supActuacion} onChange={(e) => setSupActuacion(+e.target.value)} className="h-9 bg-slate-900/50 border-slate-700 text-slate-200 font-mono" />
                                </div>
                                <div>
                                    <label className="text-[10px] text-slate-500 uppercase">Sup. Envolvente Total (m²)</label>
                                    <Input type="number" value={supEnvolvente} onChange={(e) => setSupEnvolvente(+e.target.value)} className="h-9 bg-slate-900/50 border-slate-700 text-slate-200 font-mono" />
                                </div>
                                <div className="col-span-2 md:col-span-2">
                                    <label className="text-[10px] text-slate-500 uppercase">Zona Climática</label>
                                    <select
                                        value={zonaIdx}
                                        onChange={(e) => setZonaIdx(+e.target.value)}
                                        className="w-full h-9 bg-slate-900/50 border border-slate-700 text-slate-200 rounded-md px-3 text-sm"
                                    >
                                        {ZONAS_CLIMATICAS.map((z, i) => (
                                            <option key={i} value={i}>
                                                {z.label} — G = {z.valor} h·K
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <button
                                onClick={calcular}
                                className="mt-5 w-full h-11 rounded-md bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white font-semibold transition-all flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20"
                            >
                                <Zap className="h-5 w-5" />
                                Calcular Ahorro Energético
                            </button>
                        </CardContent>
                    </Card>
                </div>

                {/* Columna derecha: Resultado */}
                <div className="space-y-4">
                    {resultado ? (
                        <>
                            {/* KPI principal */}
                            <Card className="bg-gradient-to-br from-orange-600/20 to-amber-600/10 border-orange-500/30 shadow-2xl">
                                <CardContent className="p-6 text-center">
                                    <Flame className="h-10 w-10 mx-auto text-orange-400 mb-3" />
                                    <p className="text-4xl font-bold text-orange-400 font-mono">
                                        {resultado.ahorro.toLocaleString()}
                                    </p>
                                    <p className="text-sm text-orange-300/80 mt-1">kWh/año de ahorro</p>
                                </CardContent>
                            </Card>

                            {/* Desglose */}
                            <Card className="bg-slate-900/40 border-slate-800">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm text-slate-300">Desglose</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-3 text-sm">
                                    <ResultRow label="RT inicial" value={`${resultado.rt_inicial.toFixed(3)} m²K/W`} />
                                    <ResultRow label="RT final" value={`${resultado.rt_final.toFixed(3)} m²K/W`} color="emerald" />
                                    <div className="border-t border-slate-800 my-2" />
                                    <ResultRow label="Up inicial" value={`${resultado.up_inicial.toFixed(3)} W/m²K`} />
                                    <ResultRow label="Up final" value={`${resultado.up_final.toFixed(3)} W/m²K`} color="emerald" />
                                    <div className="border-t border-slate-800 my-2" />
                                    <ResultRow label="Factor b (inicial)" value={resultado.b_inicial.toFixed(2)} />
                                    <ResultRow label="Factor b (final)" value={resultado.b_final.toFixed(2)} />
                                    <div className="border-t border-slate-800 my-2" />
                                    <ResultRow label="Ui" value={`${resultado.ui_final.toFixed(2)} W/m²K`} />
                                    <ResultRow label="Uf" value={`${resultado.uf_final.toFixed(2)} W/m²K`} color="emerald" />
                                    <ResultRow label="ΔU" value={`${(resultado.ui_final - resultado.uf_final).toFixed(2)} W/m²K`} color="orange" />
                                    <div className="border-t border-slate-800 my-2" />
                                    <ResultRow label="% Envolvente" value={`${resultado.pct_envolvente.toFixed(2)}%`} />
                                    <ResultRow label="Ratio Ah-nh/Anh-e" value={resultado.ratio.toFixed(2)} />
                                </CardContent>
                            </Card>

                            {/* Botón copiar informe */}
                            <button
                                onClick={copiarInforme}
                                className="w-full h-11 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all flex items-center justify-center gap-2 ring-1 ring-slate-700"
                            >
                                {copied ? <Check className="h-5 w-5 text-emerald-400" /> : <Copy className="h-5 w-5" />}
                                {copied ? "¡Informe copiado!" : "Copiar Informe al Portapapeles"}
                            </button>
                        </>
                    ) : (
                        <Card className="bg-slate-900/40 border-slate-800">
                            <CardContent className="p-8 text-center text-slate-600 space-y-3">
                                <Calculator className="h-12 w-12 mx-auto opacity-20" />
                                <p>Configure las capas y parámetros, luego pulse "Calcular".</p>
                                <div className="flex items-center justify-center gap-2 text-xs text-slate-700">
                                    <span>Existente</span>
                                    <ArrowRight className="h-3 w-3" />
                                    <span className="text-emerald-600">+ Mejora</span>
                                    <ArrowRight className="h-3 w-3" />
                                    <span className="text-orange-600">Ahorro</span>
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    );
}

function ResultRow({ label, value, color }: { label: string; value: string; color?: string }) {
    const colorClasses: Record<string, string> = {
        emerald: "text-emerald-400",
        orange: "text-orange-400",
    };
    return (
        <div className="flex items-center justify-between">
            <span className="text-slate-500">{label}</span>
            <span className={`font-mono ${colorClasses[color ?? ""] ?? "text-slate-300"}`}>{value}</span>
        </div>
    );
}
