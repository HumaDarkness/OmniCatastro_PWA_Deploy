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
    Wind,
    ToggleLeft,
    ToggleRight,
    UploadCloud,
    Search,
    CreditCard,
    FileCode,
} from "lucide-react";
import {
    calcularAhorroCAE,
    generarInformeTexto,
    getB,
    VALORES_G,
    type CapaMaterial,
    type ResultadoTermico,
    type Scenario,
    type Caso,
} from "./lib/thermalCalculator";
import { generarPDFAnexoE1 } from "./lib/anexoE1Generator";
import { supabase } from "./lib/supabase";
import {
    CertificadoCapturasPanelControlado,
    createEmptyCapturasState,
    type CapturasState,
} from "./components/CertificadoCapturasPanel";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Badge } from "./components/ui/badge";

interface MaterialDB {
    id: string;
    nombre: string;
    marca: string;
    lambda_w_mk: number;
    is_default: boolean;
    application_method: string | null;
}

interface ClienteBasico {
    id: string;
    first_name: string;
    middle_name: string | null;
    last_name_1: string;
    last_name_2: string | null;
    dni: string;
    dni_address: string | null;
}

interface ParsedCE3X {
    clienteNombre: string;
    clienteDni: string;
    tecnicoNombre: string;
    tecnicoNif: string;
    tecnicoEntidadNif: string;
    zonaKey: string;
    superficieParticion: number;
    superficieCubierta: number;
    superficieEnvolvente: number;
}

function parseDecimal(value: string | null | undefined): number {
    if (!value) return 0;
    const normalized = value.replace(",", ".").trim();
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
}

function queryText(root: ParentNode, selectors: string[]): string {
    for (const selector of selectors) {
        const text = root.querySelector(selector)?.textContent?.trim();
        if (text) return text;
    }
    return "";
}

function normalizeDni(value: string): string {
    return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function roundTo(value: number, decimals = 2): number {
    const factor = 10 ** decimals;
    return Math.round((value + Number.EPSILON) * factor) / factor;
}

function normalizeTextKey(value: string): string {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();
}

function isEnvelopeElementLabel(value: string): boolean {
    const normalized = normalizeTextKey(value);
    const blockedFragments = [
        "SUELO",
        "CUBIERTA",
        "FACHADA",
        "HUECO",
        "LUCERNARIO",
        "PARTICION",
        "MURO",
        "FORJADO",
    ];

    return blockedFragments.some((fragment) => normalized.includes(fragment));
}

function parseClienteNombreFromScopes(doc: Document, scopeSelectors: string[]): string {
    for (const scopeSelector of scopeSelectors) {
        const scope = doc.querySelector(scopeSelector);
        if (!scope) continue;

        const fullName = queryText(scope, [
            "NombreYApellidos",
            "NombreyApellidos",
            "NombrePropietario",
            "Titular",
        ]);
        if (fullName && !isEnvelopeElementLabel(fullName)) {
            return fullName;
        }

        const nombre = queryText(scope, ["Nombre", "NombreTitular"]);
        const apellido1 = queryText(scope, ["PrimerApellido", "Apellido1", "Apellido"]);
        const apellido2 = queryText(scope, ["SegundoApellido", "Apellido2"]);

        const composed = [nombre, apellido1, apellido2]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();

        if (composed && !isEnvelopeElementLabel(composed)) {
            return composed;
        }
    }

    return "";
}

function parseCE3XXml(xmlText: string): ParsedCE3X {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) {
        throw new Error("XML CE3X malformado.");
    }

    const clienteScopeSelectors = [
        "DatosDelSolicitante",
        "DatosDelPropietario",
        "Solicitante",
        "Propietario",
        "Titular",
        "DatosAdministrativos",
    ];

    const clienteNombre = parseClienteNombreFromScopes(doc, clienteScopeSelectors);

    // En CE3X de producción el DNI del titular suele no venir o se confunde con el técnico.
    // Por fiabilidad operativa se desactiva extracción automática de DNI desde XML.
    const clienteDni = "";

    const tecnicoNombre = queryText(doc, [
        "DatosDelCertificador NombreyApellidos",
        "DatosDelCertificador NombreYApellidos",
        "DatosDelCertificador Nombre",
    ]);

    const tecnicoNif = normalizeDni(queryText(doc, ["DatosDelCertificador NIF"]));
    const tecnicoEntidadNif = normalizeDni(queryText(doc, ["DatosDelCertificador NIFEntidad"]));

    const zonaRaw = queryText(doc, ["ZonaClimatica"]);
    const zonaKey = zonaRaw === "α3" ? "alpha3" : zonaRaw;

    const elementos = [
        ...doc.querySelectorAll(
            "CerramientosOpacos Elemento, HuecosYLucernarios Elemento, HuecosyLucernarios Elemento",
        ),
    ];

    let superficieParticion = 0;
    let superficieCubierta = 0;
    let superficieEnvolvente = 0;

    for (const el of elementos) {
        const tipo = el.querySelector("Tipo")?.textContent?.trim() || "";
        const sup = parseDecimal(el.querySelector("Superficie")?.textContent);

        const tipoNorm = normalizeTextKey(tipo);

        if (
            tipoNorm.includes("PARTICIONINTERIORHORIZONTAL")
            || (tipoNorm.includes("PARTICION") && tipoNorm.includes("HORIZONTAL"))
        ) {
            superficieParticion += sup;
            superficieEnvolvente += sup;
        } else if (tipoNorm.includes("CUBIERTA")) {
            superficieCubierta += sup;
        } else {
            superficieEnvolvente += sup;
        }
    }

    return {
        clienteNombre,
        clienteDni,
        tecnicoNombre,
        tecnicoNif,
        tecnicoEntidadNif,
        zonaKey,
        superficieParticion: roundTo(superficieParticion, 2),
        superficieCubierta: roundTo(superficieCubierta, 2),
        superficieEnvolvente: roundTo(superficieEnvolvente, 2),
    };
}

function buildXmlImportSummary(parsed: ParsedCE3X): string {
    const parts = ["XML CE3X importado: superficies y zona actualizadas."];

    if (parsed.clienteNombre) {
        parts.push(
            `Cliente detectado: ${parsed.clienteNombre}.`,
        );
    } else {
        parts.push("Cliente no detectado en XML (completar manual o usar búsqueda por DNI).");
    }

    parts.push("DNI de cliente: CE3X normalmente no lo trae de forma fiable, úsalo manual o desde BD.");

    if (parsed.tecnicoNombre) {
        parts.push(`Técnico detectado (referencia): ${parsed.tecnicoNombre}.`);
    }

    return parts.join(" ");
}
const ZONAS_CLIMATICAS = Object.entries(VALORES_G).map(([zona, g]) => {
    const NOMBRES: Record<string, string> = {
        alpha3: "α3 — Canarias costa",
        A2: "A2", A3: "A3 — Málaga, Almería", A4: "A4 — Cádiz",
        B2: "B2", B3: "B3 — Valencia, Alicante", B4: "B4 — Sevilla, Córdoba",
        C1: "C1 — Santander, Bilbao", C2: "C2 — Barcelona", C3: "C3 — Granada", C4: "C4 — Cáceres",
        D1: "D1 — Vitoria, Pamplona", D2: "D2 — Valladolid, Zamora", D3: "D3 — Madrid, Toledo",
        E1: "E1 — Burgos, León, Soria", E2: "E2", E3: "E3",
    };
    return { zona, g, label: `${NOMBRES[zona] ?? zona} (G=${g})` };
});

// Opciones claras para escenarios de aislamiento
const ESCENARIOS_ANTES: { id: Scenario; label: string; emoji: string }[] = [
    { id: "nada_aislado", label: "Nada aislado (estado original)", emoji: "❌" },
    { id: "cubierta_aislada", label: "Cubierta ya aislada (caso especial)", emoji: "🏗️" },
];

const ESCENARIOS_DESPUES: { id: Scenario; label: string; emoji: string }[] = [
    { id: "particion_aislada", label: "Partición aislada (nuestro trabajo)", emoji: "🏠" },
    { id: "nada_aislado", label: "Nada aislado", emoji: "❌" },
];

const CASOS_VENTILACION: { id: Caso; label: string; emoji: string }[] = [
    { id: "estanco", label: "Estanco (pocas aberturas)", emoji: "🔒" },
    { id: "ventilado", label: "Ventilado (tejas rotas, rejillas)", emoji: "💨" },
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
    const [zonaKey, setZonaKey] = useState("D3");
    const [resultado, setResultado] = useState<ResultadoTermico | null>(null);
    const [copied, setCopied] = useState(false);
    const [materialesDB, setMaterialesDB] = useState<MaterialDB[]>([]);
    const [filtroMetodo, setFiltroMetodo] = useState<Record<number, string>>({});

    // Nuevos estados para escenario y ventilación
    const [scenarioI, setScenarioI] = useState<Scenario>("nada_aislado");
    const [scenarioF, setScenarioF] = useState<Scenario>("particion_aislada");
    const [caseI, setCaseI] = useState<Caso>("estanco");
    const [caseF, setCaseF] = useState<Caso>("estanco");
    const [modoCE3X, setModoCE3X] = useState(false);
    const [overrideUi, setOverrideUi] = useState("");
    const [overrideUf, setOverrideUf] = useState("");
    const [capturas, setCapturas] = useState<CapturasState>(createEmptyCapturasState());

    const [clienteNombre, setClienteNombre] = useState("");
    const [clienteDni, setClienteDni] = useState("");
    const [clienteDireccionDni, setClienteDireccionDni] = useState("");
    const [xmlImportMsg, setXmlImportMsg] = useState<string | null>(null);
    const [xmlFileName, setXmlFileName] = useState("");
    const [buscandoDni, setBuscandoDni] = useState(false);
    const [dniLookupMsg, setDniLookupMsg] = useState<string | null>(null);

    // Cargar materiales CE3X desde Supabase
    useEffect(() => {
        async function load() {
            if (!supabase) return;
            const { data } = await supabase
                .from("ce3x_materials")
                .select("id, nombre, marca, lambda_w_mk, is_default, application_method")
                .order("is_default", { ascending: false })
                .order("nombre", { ascending: true });
            if (data) setMaterialesDB(data);
        }
        load();
    }, []);

    // Auto-seleccionar aislantes favoritos
    useEffect(() => {
        if (!materialesDB || materialesDB.length === 0 || !filtroMetodo) return;

        setCapas((prevCapas) =>
            prevCapas.map((capa, idx) => {
                const metodo = filtroMetodo[idx];
                if (!metodo) return capa;

                const defaultMat = materialesDB.find(
                    (m) => m.application_method === metodo && m.is_default === true
                );
                if (!defaultMat) return capa;
                if (capa.lambda_val === defaultMat.lambda_w_mk && capa.nombre.includes(defaultMat.marca)) return capa;

                return {
                    ...capa,
                    nombre: `${defaultMat.nombre} (${defaultMat.marca})`,
                    lambda_val: defaultMat.lambda_w_mk,
                };
            })
        );
    }, [filtroMetodo, materialesDB, setCapas]);

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

    const buscarClientePorDni = async (dniInput?: string) => {
        const dni = normalizeDni(dniInput ?? clienteDni);
        setClienteDni(dni);

        if (!dni) {
            setDniLookupMsg("Introduce un DNI para buscar.");
            return;
        }

        if (!supabase) {
            setDniLookupMsg("Supabase no esta configurado en esta sesion.");
            return;
        }

        setBuscandoDni(true);
        try {
            const { data, error } = await supabase
                .from("clients")
                .select("id, first_name, middle_name, last_name_1, last_name_2, dni, dni_address")
                .eq("dni", dni)
                .limit(1)
                .maybeSingle();

            if (error) {
                setDniLookupMsg("No se pudo consultar la base de clientes.");
                return;
            }

            const client = data as ClienteBasico | null;
            if (!client) {
                setDniLookupMsg("No existe ese DNI en base de datos. Puedes seguir manual.");
                return;
            }

            const fullName = [
                client.first_name,
                client.middle_name,
                client.last_name_1,
                client.last_name_2,
            ]
                .filter(Boolean)
                .join(" ")
                .replace(/\s+/g, " ")
                .trim();

            if (fullName) setClienteNombre(fullName);
            if (client.dni_address) setClienteDireccionDni(client.dni_address);
            setDniLookupMsg(`Cliente cargado desde BD: ${fullName || client.dni}`);
        } catch {
            setDniLookupMsg("Fallo inesperado al buscar DNI.");
        } finally {
            setBuscandoDni(false);
        }
    };

    const importarXmlCE3X = async (file?: File) => {
        if (!file) return;

        // Limpieza preventiva para no arrastrar datos de importaciones previas.
        setClienteNombre("");
        setClienteDni("");
        setDniLookupMsg(null);

        try {
            const text = await file.text();
            const parsed = parseCE3XXml(text);

            // Siempre se actualizan superficies para no arrastrar valores previos del formulario.
            setAreaHNH(parsed.superficieParticion);
            setSupActuacion(parsed.superficieParticion);
            setAreaNHE(parsed.superficieCubierta);
            setSupEnvolvente(parsed.superficieEnvolvente);

            if (parsed.zonaKey && VALORES_G[parsed.zonaKey] !== undefined) {
                setZonaKey(parsed.zonaKey);
            }

            setClienteNombre(parsed.clienteNombre || "");

            setClienteDni(parsed.clienteDni);

            if (parsed.clienteDni && supabase) {
                await buscarClientePorDni(parsed.clienteDni);
            } else {
                setDniLookupMsg("DNI de cliente no disponible en XML CE3X. Usa búsqueda manual.");
            }

            setXmlFileName(file.name);
            setXmlImportMsg(buildXmlImportSummary(parsed));
        } catch {
            setClienteNombre("");
            setClienteDni("");
            setXmlImportMsg("No se pudo importar el XML CE3X. Revisa el archivo.");
        }
    };

    const calcular = () => {
        const gValue = VALORES_G[zonaKey] ?? 61;
        const res = calcularAhorroCAE({
            capas,
            area_h_nh: areaHNH,
            area_nh_e: areaNHE,
            superficie_actuacion: supActuacion,
            g: gValue,
            sup_envolvente_total: supEnvolvente,
            scenario_i: scenarioI,
            scenario_f: scenarioF,
            case_i: caseI,
            case_f: caseF,
            modoCE3X,
        });

        const parsedUi = Number.parseFloat(overrideUi);
        const parsedUf = Number.parseFloat(overrideUf);
        const uiFinal = Number.isFinite(parsedUi) ? parsedUi : res.ui_final;
        const ufFinal = Number.isFinite(parsedUf) ? parsedUf : res.uf_final;
        const ahorroFinal = uiFinal > ufFinal ? Math.round((uiFinal - ufFinal) * supActuacion * gValue) : 0;

        setResultado({
            ...res,
            ui_final: uiFinal,
            uf_final: ufFinal,
            ahorro: ahorroFinal,
        });
    };

    const copiarInforme = () => {
        if (!resultado) return;
        const gValue = VALORES_G[zonaKey] ?? 61;
        let texto = generarInformeTexto({
            capas,
            resultado,
            sup_actuacion: supActuacion,
            sup_envolvente_total: supEnvolvente,
            g: gValue,
            area_h_nh: areaHNH,
            area_nh_e: areaNHE,
        });

        if (clienteNombre.trim() || clienteDni.trim()) {
            const bloqueCliente = [
                "DATOS TITULAR",
                `Nombre: ${clienteNombre.trim() || "(no indicado)"}`,
                `DNI/NIE: ${clienteDni.trim() || "(no indicado)"}`,
                clienteDireccionDni.trim() ? `Direccion DNI: ${clienteDireccionDni.trim()}` : "",
                "",
            ]
                .filter(Boolean)
                .join("\n");

            texto = `${bloqueCliente}\n${texto}`;
        }

        if (overrideUi.trim() || overrideUf.trim()) {
            const uiLabel = overrideUi.trim() || "(sin ajuste)";
            const ufLabel = overrideUf.trim() || "(sin ajuste)";
            texto += "\n\nAJUSTE MANUAL CE3X\n";
            texto += `Ui manual: ${uiLabel}\n`;
            texto += `Uf manual: ${ufLabel}\n`;
            texto += "(Se han priorizado valores exactos de CE3X para el informe)";
        }

        navigator.clipboard.writeText(texto);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
    };

    // Preview del ratio y b en tiempo real
    const ratio = areaNHE > 0 ? areaHNH / areaNHE : 0;
    const previewBi = ratio > 0 ? getB(ratio, scenarioI, caseI) : null;
    const previewBf = ratio > 0 ? getB(ratio, scenarioF, caseF) : null;
    const materialSupportSlots: Array<{ key: keyof CapturasState; label: string }> = [
        { key: "materiales_antes", label: "Materiales antes" },
        { key: "materiales_despues", label: "Materiales despues" },
        { key: "ficha_tecnica", label: "Ficha tecnica" },
    ];

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] p-6 gap-5 animate-in fade-in duration-500 overflow-y-auto">
            {/* Cabecera */}
            <div>
                <h2 className="text-3xl font-bold tracking-tight text-slate-100 flex items-center gap-3">
                    <Calculator className="h-8 w-8 text-orange-400" />
                    Calculadora Térmica CAE
                </h2>
                <p className="text-slate-400 mt-1">
                    Calcula el ahorro energético (kWh/año) según CTE DB-HE — Tabla 7.
                </p>
            </div>

            <Card className="bg-slate-900/40 border-slate-800">
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg text-slate-200 flex items-center gap-2">
                        <FileCode className="h-5 w-5 text-cyan-400" />
                        Prioridad: Importar XML CE3X + Datos Cliente
                    </CardTitle>
                    <CardDescription className="text-slate-500">
                        Importa XML para rellenar superficies/zona y usa DNI para autocompletar cliente desde base de datos.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <label className="h-10 inline-flex items-center justify-center gap-2 px-4 rounded-md border border-dashed border-cyan-700/50 text-cyan-300 hover:bg-cyan-900/20 cursor-pointer transition-colors">
                            <UploadCloud className="h-4 w-4" />
                            Importar XML CE3X
                            <input
                                type="file"
                                accept=".xml,text/xml"
                                className="hidden"
                                onChange={(e) => importarXmlCE3X(e.target.files?.[0])}
                            />
                        </label>

                        <div className="h-10 flex items-center rounded-md bg-slate-900/50 border border-slate-700 px-3 text-xs text-slate-400">
                            {xmlFileName ? `Archivo: ${xmlFileName}` : "Sin XML cargado"}
                        </div>
                    </div>

                    {xmlImportMsg && (
                        <div className="text-xs text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 px-3 py-2 rounded-md">
                            {xmlImportMsg}
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="md:col-span-2">
                            <label className="text-[10px] text-slate-500 uppercase font-bold">Nombre cliente</label>
                            <Input
                                value={clienteNombre}
                                onChange={(e) => setClienteNombre(e.target.value)}
                                placeholder="Nombre completo del titular"
                                className="h-9 bg-slate-900/50 border-slate-700 text-slate-200"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] text-slate-500 uppercase font-bold">DNI / NIE</label>
                            <div className="flex gap-2">
                                <Input
                                    value={clienteDni}
                                    onChange={(e) => setClienteDni(normalizeDni(e.target.value))}
                                    placeholder="12345678Z"
                                    className="h-9 bg-slate-900/50 border-slate-700 text-slate-200 font-mono"
                                />
                                <button
                                    onClick={() => buscarClientePorDni()}
                                    disabled={buscandoDni}
                                    className="h-9 px-3 rounded-md bg-indigo-900/30 border border-indigo-700/40 text-indigo-300 hover:bg-indigo-800/40 disabled:opacity-40"
                                    title="Buscar en base de datos"
                                >
                                    {buscandoDni ? <Check className="h-4 w-4" /> : <Search className="h-4 w-4" />}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="text-[10px] text-slate-500 uppercase font-bold">Dirección DNI (si aplica)</label>
                        <Input
                            value={clienteDireccionDni}
                            onChange={(e) => setClienteDireccionDni(e.target.value)}
                            placeholder="Direccion del documento"
                            className="h-9 bg-slate-900/50 border-slate-700 text-slate-200"
                        />
                    </div>

                    {dniLookupMsg && (
                        <div className="text-xs text-indigo-300 bg-indigo-500/10 border border-indigo-500/30 px-3 py-2 rounded-md flex items-center gap-2">
                            <CreditCard className="h-3.5 w-3.5" />
                            {dniLookupMsg}
                        </div>
                    )}
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Columna izquierda: Capas y Parámetros */}
                <div className="lg:col-span-2 space-y-4">
                    {/* Capas del Cerramiento */}
                    <Card className="bg-slate-900/40 border-slate-800">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-lg text-slate-200 flex items-center gap-2">
                                <Snowflake className="h-5 w-5 text-blue-400" />
                                Capas del Cerramiento
                            </CardTitle>
                            <CardDescription className="text-slate-500">
                                Añada las capas existentes y las de mejora (nuevas). Rsi = Rse = 0.10 m²K/W
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-3">
                                <p className="text-[10px] font-bold uppercase text-cyan-300 mb-2">
                                    Referencias visuales mientras transcribes R y material
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                    {materialSupportSlots.map((slot) => {
                                        const data = capturas[slot.key];
                                        return (
                                            <div key={slot.key} className="rounded-md border border-slate-800 p-2 bg-slate-900/50">
                                                <p className="text-[10px] text-slate-400 mb-1">{slot.label}</p>
                                                {data ? (
                                                    <img
                                                        src={data.dataUrl}
                                                        alt={slot.label}
                                                        className="w-full h-24 object-cover rounded border border-slate-700"
                                                    />
                                                ) : (
                                                    <div className="w-full h-24 rounded border border-dashed border-slate-700 flex items-center justify-center text-[10px] text-slate-600">
                                                        Sin captura
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

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
                                            {c.es_nueva ? "✦ MEJORA" : "EXISTENTE"}
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
                                    {/* Selector rápido de material CE3X (Supabase) */}
                                    {materialesDB.length > 0 && c.es_nueva && (
                                        <div className="mt-2 space-y-1">
                                            <select
                                                className="w-full h-7 text-[10px] bg-slate-900/30 border border-slate-700/50 text-slate-400 rounded px-2"
                                                value={filtroMetodo[i] ?? ""}
                                                onChange={(e) => setFiltroMetodo(prev => ({ ...prev, [i]: e.target.value }))}
                                            >
                                                <option value="">Todos los métodos</option>
                                                <option value="Insuflado">Insuflado</option>
                                                <option value="Rollo">Rollo</option>
                                            </select>
                                            <select
                                                className="w-full h-8 text-xs bg-slate-900/50 border border-slate-700 text-slate-300 rounded-md px-2"
                                                defaultValue=""
                                                onChange={(e) => seleccionarMaterialDB(i, e.target.value)}
                                            >
                                                <option value="" disabled>
                                                    ↓ Seleccionar material CE3X...
                                                </option>
                                                {materialesDB
                                                    .filter((m) => !(filtroMetodo[i] ?? "") || m.application_method === (filtroMetodo[i] ?? ""))
                                                    .map((m) => (
                                                        <option key={m.id} value={m.id}>
                                                            {m.is_default ? "★ " : ""}{m.nombre} ({m.marca}) — λ={m.lambda_w_mk}{m.application_method ? ` [${m.application_method}]` : ""}
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
                                    <label className="text-[10px] text-blue-400 uppercase font-bold">Superficie Partición (m²)</label>
                                    <p className="text-[9px] text-slate-600 mb-1">Lo que se aísla</p>
                                    <Input type="number" value={areaHNH} onChange={(e) => setAreaHNH(+e.target.value)} className="h-9 bg-slate-900/50 border-slate-700 text-slate-200 font-mono" />
                                </div>
                                <div>
                                    <label className="text-[10px] text-amber-400 uppercase font-bold">Superficie Cubierta (m²)</label>
                                    <p className="text-[9px] text-slate-600 mb-1">Límite para coef. b</p>
                                    <Input type="number" value={areaNHE} onChange={(e) => setAreaNHE(+e.target.value)} className="h-9 bg-slate-900/50 border-slate-700 text-slate-200 font-mono" />
                                </div>
                                <div>
                                    <label className="text-[10px] text-slate-500 uppercase font-bold">Sup. Actuación (m²)</label>
                                    <p className="text-[9px] text-slate-600 mb-1">Superficie a aislar</p>
                                    <Input type="number" value={supActuacion} onChange={(e) => setSupActuacion(+e.target.value)} className="h-9 bg-slate-900/50 border-slate-700 text-slate-200 font-mono" />
                                </div>
                                <div>
                                    <label className="text-[10px] text-slate-500 uppercase font-bold">Envolvente Total (m²)</label>
                                    <p className="text-[9px] text-slate-600 mb-1">Sin cubiertas</p>
                                    <Input type="number" value={supEnvolvente} onChange={(e) => setSupEnvolvente(+e.target.value)} className="h-9 bg-slate-900/50 border-slate-700 text-slate-200 font-mono" />
                                </div>
                                <div className="col-span-2 md:col-span-2">
                                    <label className="text-[10px] text-slate-500 uppercase font-bold">Zona Climática</label>
                                    <select
                                        value={zonaKey}
                                        onChange={(e) => setZonaKey(e.target.value)}
                                        className="w-full h-9 bg-slate-900/50 border border-slate-700 text-slate-200 rounded-md px-3 text-sm"
                                    >
                                        {ZONAS_CLIMATICAS.map((z) => (
                                            <option key={z.zona} value={z.zona}>
                                                {z.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Ratio preview */}
                            {areaHNH > 0 && areaNHE > 0 && (
                                <div className="mt-3 flex justify-between items-center text-[11px] px-3 py-2 bg-slate-900/40 rounded-lg border border-slate-800">
                                    <span className="text-slate-500 font-bold">Ratio Partición / Cubierta</span>
                                    <span className="font-bold text-slate-300 font-mono">
                                        {areaHNH.toFixed(2)} / {areaNHE.toFixed(2)} = {ratio.toFixed(2)}
                                    </span>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Escenarios de Aislamiento y Ventilación */}
                    <Card className="bg-slate-900/40 border-slate-800">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-lg text-slate-200 flex items-center gap-2">
                                <Wind className="h-5 w-5 text-cyan-400" />
                                Coeficiente b — Aislamiento y Ventilación
                            </CardTitle>
                            <CardDescription className="text-slate-500">
                                Tabla 7 CTE DB-HE. Define cómo estaba el cerramiento ANTES y DESPUÉS de tu intervención.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Escenario ANTES */}
                                <div className="space-y-2">
                                    <label className="text-[10px] text-slate-400 uppercase font-bold">Escenario ANTES</label>
                                    <select
                                        value={scenarioI}
                                        onChange={(e) => setScenarioI(e.target.value as Scenario)}
                                        className="w-full h-9 bg-slate-900/50 border border-slate-700 text-slate-200 rounded-md px-3 text-xs"
                                    >
                                        {ESCENARIOS_ANTES.map((es) => (
                                            <option key={es.id} value={es.id}>
                                                {es.emoji} {es.label}
                                            </option>
                                        ))}
                                    </select>
                                    <select
                                        value={caseI}
                                        onChange={(e) => setCaseI(e.target.value as Caso)}
                                        className="w-full h-9 bg-slate-900/50 border border-slate-700 text-slate-200 rounded-md px-3 text-xs"
                                    >
                                        {CASOS_VENTILACION.map((c) => (
                                            <option key={c.id} value={c.id}>
                                                {c.emoji} {c.label}
                                            </option>
                                        ))}
                                    </select>
                                    {previewBi !== null && (
                                        <div className="text-[11px] text-slate-400 px-2">
                                            bi = <span className="font-bold text-slate-200">{previewBi}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Escenario DESPUÉS */}
                                <div className="space-y-2">
                                    <label className="text-[10px] text-emerald-400 uppercase font-bold">Escenario DESPUÉS</label>
                                    <select
                                        value={scenarioF}
                                        onChange={(e) => setScenarioF(e.target.value as Scenario)}
                                        className="w-full h-9 bg-slate-900/50 border border-emerald-700/30 text-slate-200 rounded-md px-3 text-xs"
                                    >
                                        {ESCENARIOS_DESPUES.map((es) => (
                                            <option key={es.id} value={es.id}>
                                                {es.emoji} {es.label}
                                            </option>
                                        ))}
                                    </select>
                                    <select
                                        value={caseF}
                                        onChange={(e) => setCaseF(e.target.value as Caso)}
                                        className="w-full h-9 bg-slate-900/50 border border-emerald-700/30 text-slate-200 rounded-md px-3 text-xs"
                                    >
                                        {CASOS_VENTILACION.map((c) => (
                                            <option key={c.id} value={c.id}>
                                                {c.emoji} {c.label}
                                            </option>
                                        ))}
                                    </select>
                                    {previewBf !== null && (
                                        <div className="text-[11px] text-emerald-400 px-2">
                                            bf = <span className="font-bold text-emerald-200">{previewBf}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Toggle CE3X */}
                            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                                <div>
                                    <p className="text-xs font-bold text-slate-400">Redondeo CE3X</p>
                                    <p className="text-[9px] text-slate-600">Up a 2 decimales para cuadrar con valores del programa CE3X</p>
                                </div>
                                <button
                                    onClick={() => setModoCE3X(!modoCE3X)}
                                    className={`transition-colors ${modoCE3X ? "text-blue-400" : "text-slate-600"}`}
                                    title={modoCE3X ? "Modo CE3X activo (Up = 2 dec)" : "Modo técnico (Up = 3 dec)"}
                                >
                                    {modoCE3X ? <ToggleRight className="h-8 w-8" /> : <ToggleLeft className="h-8 w-8" />}
                                </button>
                            </div>

                            <div className="pt-2 border-t border-slate-800 space-y-2">
                                <p className="text-[10px] text-purple-300 uppercase font-bold">Ajuste CE3X (opcional)</p>
                                <p className="text-[10px] text-slate-500">
                                    Si CE3X te da valores exactos de Ui/Uf, puedes forzarlos aqui para copiar el informe con esa precision.
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-[10px] text-slate-500 uppercase">Ui CE3X (antes)</label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            value={overrideUi}
                                            onChange={(e) => setOverrideUi(e.target.value)}
                                            placeholder="Ej: 2.66"
                                            className="h-8 text-xs bg-slate-900/50 border-slate-700 text-slate-200 font-mono"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-slate-500 uppercase">Uf CE3X (despues)</label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            value={overrideUf}
                                            onChange={(e) => setOverrideUf(e.target.value)}
                                            placeholder="Ej: 0.17"
                                            className="h-8 text-xs bg-slate-900/50 border-slate-700 text-slate-200 font-mono"
                                        />
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={calcular}
                                className="w-full h-11 rounded-md bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white font-semibold transition-all flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20"
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
                                    {modoCE3X && (
                                        <p className="text-[9px] text-blue-400 mt-2 font-bold">Modo CE3X activo</p>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Desglose */}
                            <Card className="bg-slate-900/40 border-slate-800">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm text-slate-300">Desglose</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-3 text-sm">
                                    <ResultRow label="ΣR materiales (i)" value={`${resultado.r_mat_inicial.toFixed(3)} m²K/W`} />
                                    <ResultRow label="ΣR materiales (f)" value={`${resultado.r_mat_final.toFixed(3)} m²K/W`} color="emerald" />
                                    <div className="border-t border-slate-800 my-2" />
                                    <ResultRow label="RT inicial" value={`${resultado.rt_inicial.toFixed(3)} m²K/W`} />
                                    <ResultRow label="RT final" value={`${resultado.rt_final.toFixed(3)} m²K/W`} color="emerald" />
                                    <div className="border-t border-slate-800 my-2" />
                                    <ResultRow label={`Up inicial (${modoCE3X ? '2' : '3'} dec)`} value={`${resultado.up_inicial.toFixed(modoCE3X ? 2 : 3)} W/m²K`} />
                                    <ResultRow label={`Up final (${modoCE3X ? '2' : '3'} dec)`} value={`${resultado.up_final.toFixed(modoCE3X ? 2 : 3)} W/m²K`} color="emerald" />
                                    <div className="border-t border-slate-800 my-2" />
                                    <ResultRow label="Factor b (antes)" value={resultado.b_inicial.toFixed(2)} />
                                    <ResultRow label="Factor b (después)" value={resultado.b_final.toFixed(2)} color="emerald" />
                                    <div className="border-t border-slate-800 my-2" />
                                    <ResultRow label="Ui (antes)" value={`${resultado.ui_final.toFixed(2)} W/m²K`} />
                                    <ResultRow label="Uf (después)" value={`${resultado.uf_final.toFixed(2)} W/m²K`} color="emerald" />
                                    <ResultRow label="ΔU" value={`${(resultado.ui_final - resultado.uf_final).toFixed(2)} W/m²K`} color="orange" />
                                    <div className="border-t border-slate-800 my-2" />
                                    <ResultRow label="% Envolvente" value={`${resultado.pct_envolvente.toFixed(2)}%`} />
                                    <ResultRow label="Ratio Part. / Cub." value={resultado.ratio.toFixed(2)} />
                                </CardContent>
                            </Card>

                            {/* Botones de acción */}
                            <div className="flex gap-2">
                                <button
                                    onClick={copiarInforme}
                                    className="flex-1 h-11 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all flex items-center justify-center gap-2 ring-1 ring-slate-700"
                                >
                                    {copied ? <Check className="h-5 w-5 text-emerald-400" /> : <Copy className="h-5 w-5" />}
                                    {copied ? "¡Copiado!" : "Copiar"}
                                </button>
                                <button
                                    onClick={() => generarPDFAnexoE1(capas, resultado)}
                                    className="flex-1 h-11 rounded-md bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 hover:text-blue-300 transition-all flex items-center justify-center gap-2 ring-1 ring-blue-500/50"
                                >
                                    Generar Anexo E.1
                                </button>
                            </div>
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

            <CertificadoCapturasPanelControlado
                capturas={capturas}
                onCapturasChange={setCapturas}
            />
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
