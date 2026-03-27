import { useState, useEffect, useRef } from "react";
import JSZip from "jszip";
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
    ZoomIn,
    X,
    Save,
    ListChecks,
    RefreshCcw,
    Download,
    FolderPlus,
    CircleCheckBig,
    Archive,
    FileDown,
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
import { getCurrentOrganizationId, supabase } from "./lib/supabase";
import { fetchAltitudeAndProvince } from "./lib/climateZoneVerifier";
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

interface ElementoEnvolvente {
    nombre: string;
    tipo: string;
    superficie: number;
    transmitancia: number;
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
    superficieOpacos: number;
    superficieHuecos: number;
    rc: string;
    provincia: string;
    municipio: string;
    direccion: string;
    codigoPostal: string;
    elementosOpacosData: ElementoEnvolvente[];
    elementosHuecosData: ElementoEnvolvente[];
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

    const docInmueble = doc.querySelector("DatosDelInmueble") || doc.querySelector("Entrada") || doc;
    const zonaRaw = queryText(docInmueble, ["ZonaClimatica"]);
    const zonaKey = zonaRaw === "α3" ? "alpha3" : zonaRaw;

    const rc = queryText(docInmueble, ["ReferenciaCatastral", "RefCatastral"]) || "";
    const provincia = queryText(docInmueble, ["Provincia"]) || "";
    const municipio = queryText(docInmueble, ["Municipio"]) || "";
    const direccion = queryText(docInmueble, ["Direccion", "Calle", "Domicilio"]) || "";
    const codigoPostal = queryText(docInmueble, ["CodigoPostal", "CP"]) || "";

    const elementosOpacos = [...doc.querySelectorAll("CerramientosOpacos Elemento")];
    const elementosHuecos = [...doc.querySelectorAll("HuecosYLucernarios Elemento, HuecosyLucernarios Elemento")];

    const elementosOpacosData: ElementoEnvolvente[] = [];
    let superficieParticion = 0;
    let superficieCubierta = 0;
    let superficieEnvolvente = 0;
    let superficieOpacos = 0;
    let superficieHuecos = 0;

    for (const el of elementosOpacos) {
        const nombre = el.querySelector("Nombre")?.textContent?.trim() || "Opaco";
        const tipo = el.querySelector("Tipo")?.textContent?.trim() || "";
        const sup = parseDecimal(el.querySelector("Superficie")?.textContent);
        const uNode = el.querySelector("U") || el.querySelector("Transmitancia");
        const u = parseDecimal(uNode?.textContent);
        const tipoNorm = normalizeTextKey(tipo);

        elementosOpacosData.push({ nombre, tipo, superficie: sup, transmitancia: u });

        if (tipoNorm.includes("CUBIERTA")) {
            superficieCubierta += sup;
            // Cubierta se muestra aparte, NO suma a envolvente ni opacos
        } else {
            if (
                tipoNorm.includes("PARTICIONINTERIORHORIZONTAL")
                || (tipoNorm.includes("PARTICION") && tipoNorm.includes("HORIZONTAL"))
            ) {
                superficieParticion += sup;
            }
            superficieOpacos += sup;
            superficieEnvolvente += sup;
        }
    }

    const elementosHuecosData: ElementoEnvolvente[] = [];
    for (const el of elementosHuecos) {
        const nombre = el.querySelector("Nombre")?.textContent?.trim() || "Hueco";
        const tipo = el.querySelector("Tipo")?.textContent?.trim() || "";
        const sup = parseDecimal(el.querySelector("Superficie")?.textContent);
        const uNode = el.querySelector("U") || el.querySelector("Transmitancia");
        const u = parseDecimal(uNode?.textContent);

        elementosHuecosData.push({ nombre, tipo, superficie: sup, transmitancia: u });

        superficieHuecos += sup;
        superficieEnvolvente += sup;
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
        superficieOpacos: roundTo(superficieOpacos, 2),
        superficieHuecos: roundTo(superficieHuecos, 2),
        rc,
        provincia,
        municipio,
        direccion,
        codigoPostal,
        elementosOpacosData,
        elementosHuecosData,
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

const CALC_STATE_STORAGE_KEY = "omnicatastro.calc-state.v1";
const CERT_DRAFT_VERSION = 1;
const CERT_DRAFT_FOLDER = "certificados";
const CERT_INDEX_FILENAME = "_index.json";
const CERT_IMPORT_AUDIT_FILENAME = "_import_audit.json";
const BACKUP_ZIP_VERSION = 2;
const LEGACY_CERT_PREFIX = "cert_";

type CertDraftStatus = "pendiente" | "en_progreso" | "completado";
type ImportMergeStrategy = "overwrite" | "skip" | "merge";
type ImportAuditAction = "created" | "overwritten" | "merged" | "skipped" | "invalid" | "failed";

interface BatchProgress {
    mode: "export" | "import";
    phase: string;
    current: number;
    total: number;
    detail?: string;
}

interface ImportAuditEntry {
    at: string;
    importedByUserId: string | null;
    importedByEmail: string | null;
    sourceFile: string;
    strategy: ImportMergeStrategy;
    rc: string;
    action: ImportAuditAction;
    detail?: string;
}

interface BackupEnvelope {
    version: number;
    exportDate: string;
    organizationId: string;
    draftCount: number;
    drafts: CertificateDraftPayload[];
}

interface BackupManifest {
    version: number;
    exportDate: string;
    organizationId: string;
    draftCount: number;
    format: "zip";
    includes: string[];
}

type QuickLayerPresetId = "hormigon" | "yeso" | "yeso_023" | "madera" | "aislante";

type CommonLayerSetId = "yeso" | "hormigon_yeso" | "madera_yeso";

const SUPAFIL_FICHA_PUBLIC_PATH = "/fichas_tecnicas/SUPAFIL_Loft_045.jpg";
const SUPAFIL_FICHA_FILE_NAME = "SUPAFIL_Loft_045.jpg";

const QUICK_LAYER_PRESETS: Record<QuickLayerPresetId, { nombre: string; r: number; espesor: number; lambda: number }> = {
    hormigon: { nombre: "Hormigón armado", r: 0.04, espesor: 0.1, lambda: 2.5 },
    yeso: { nombre: "Yeso", r: 0.036, espesor: 0.01, lambda: 0.43 },
    yeso_023: { nombre: "Yeso", r: 0.023, espesor: 0.01, lambda: 0.43 },
    madera: { nombre: "Madera", r: 0.069, espesor: 0.02, lambda: 0.13 },
    aislante: { nombre: "SUPAFIL LOFT 045", r: 5.111, espesor: 0.23, lambda: 0.045 },
};

const COMMON_LAYER_SETS: Record<CommonLayerSetId, Array<{ preset: QuickLayerPresetId; esNueva: boolean }>> = {
    yeso: [{ preset: "yeso", esNueva: false }],
    hormigon_yeso: [
        { preset: "hormigon", esNueva: false },
        { preset: "yeso_023", esNueva: false },
    ],
    madera_yeso: [
        { preset: "madera", esNueva: false },
        { preset: "yeso", esNueva: false },
    ],
};

interface CertificateDraftIndexItem {
    rc: string;
    status: CertDraftStatus;
    updatedAt: string;
    clienteNombre: string;
    clienteDni: string;
}

interface CertificateDraftPayload {
    version: number;
    rc: string;
    status: CertDraftStatus;
    updatedAt: string;
    capas: CapaMaterial[];
    areaHNH: number;
    areaNHE: number;
    supActuacion: number;
    supEnvolvente: number;
    supOpacos?: number;
    supHuecos?: number;
    elementosOpacosList?: ElementoEnvolvente[];
    elementosHuecosList?: ElementoEnvolvente[];
    zonaKey: string;
    alturaMsnm?: number;
    scenarioI: Scenario;
    scenarioF: Scenario;
    caseI: Caso;
    caseF: Caso;
    ventilationLocked: boolean;
    modoCE3X: boolean;
    overrideUi: string;
    overrideUf: string;
    clienteNombre?: string;
    clienteFirstName?: string;
    clienteMiddleName?: string;
    clienteLastName1?: string;
    clienteLastName2?: string;
    clienteDni: string;
    clienteDireccionDni: string;
    direccionInmueble?: string;
    municipioInmueble?: string;
    cpInmueble?: string;
    provinciaInmueble?: string;
    xmlFileName?: string;
    filtroMetodo: Record<number, string>;
    materialSearchByLayer: Record<number, string>;
    soloFavoritosPorCapa: Record<number, boolean>;
    capturas: CapturasState;
    resultado: ResultadoTermico | null;
}

const INITIAL_CAPAS: CapaMaterial[] = [];

function cloneInitialCapas(): CapaMaterial[] {
    return INITIAL_CAPAS.map((capa) => ({ ...capa }));
}

function normalizeRc(value: string): string {
    return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isValidDraftStatus(value: unknown): value is CertDraftStatus {
    return value === "pendiente" || value === "en_progreso" || value === "completado";
}

function sanitizeDraftPayload(raw: unknown): { payload?: CertificateDraftPayload; error?: string } {
    if (!isRecord(raw)) {
        return { error: "No es un objeto JSON válido" };
    }

    const rc = normalizeRc(String(raw.rc ?? ""));
    if (!rc) {
        return { error: "Falta RC o no tiene formato válido" };
    }

    const status = isValidDraftStatus(raw.status) ? raw.status : "en_progreso";
    const version = Number.isFinite(Number(raw.version)) ? Number(raw.version) : CERT_DRAFT_VERSION;
    const updatedAt = typeof raw.updatedAt === "string" && raw.updatedAt.trim()
        ? raw.updatedAt
        : new Date().toISOString();

    const payload: CertificateDraftPayload = {
        version,
        rc,
        status,
        updatedAt,
        capas: Array.isArray(raw.capas) ? (raw.capas as CapaMaterial[]) : cloneInitialCapas(),
        areaHNH: Number.isFinite(Number(raw.areaHNH)) ? Number(raw.areaHNH) : 25,
        areaNHE: Number.isFinite(Number(raw.areaNHE)) ? Number(raw.areaNHE) : 25,
        supActuacion: Number.isFinite(Number(raw.supActuacion)) ? Number(raw.supActuacion) : 25,
        supEnvolvente: Number.isFinite(Number(raw.supEnvolvente)) ? Number(raw.supEnvolvente) : 120,
        zonaKey: typeof raw.zonaKey === "string" && raw.zonaKey ? raw.zonaKey : "D3",
        alturaMsnm: Number.isFinite(Number(raw.alturaMsnm)) ? Number(raw.alturaMsnm) : undefined,
        scenarioI: raw.scenarioI === "cubierta_aislada" ? "cubierta_aislada" : "nada_aislado",
        scenarioF: raw.scenarioF === "nada_aislado" ? "nada_aislado" : "particion_aislada",
        caseI: raw.caseI === "ventilado" ? "ventilado" : "estanco",
        caseF: raw.caseF === "ventilado" ? "ventilado" : "estanco",
        ventilationLocked: typeof raw.ventilationLocked === "boolean" ? raw.ventilationLocked : true,
        modoCE3X: !!raw.modoCE3X,
        overrideUi: typeof raw.overrideUi === "string" ? raw.overrideUi : "",
        overrideUf: typeof raw.overrideUf === "string" ? raw.overrideUf : "",
        clienteNombre: typeof raw.clienteNombre === "string" ? raw.clienteNombre : "",
        clienteFirstName: typeof raw.clienteFirstName === "string" ? raw.clienteFirstName : "",
        clienteMiddleName: typeof raw.clienteMiddleName === "string" ? raw.clienteMiddleName : "",
        clienteLastName1: typeof raw.clienteLastName1 === "string" ? raw.clienteLastName1 : "",
        clienteLastName2: typeof raw.clienteLastName2 === "string" ? raw.clienteLastName2 : "",
        clienteDni: typeof raw.clienteDni === "string" ? raw.clienteDni : "",
        clienteDireccionDni: typeof raw.clienteDireccionDni === "string" ? raw.clienteDireccionDni : "",
        direccionInmueble: typeof raw.direccionInmueble === "string" ? raw.direccionInmueble : "",
        municipioInmueble: typeof raw.municipioInmueble === "string" ? raw.municipioInmueble : "",
        cpInmueble: typeof raw.cpInmueble === "string" ? raw.cpInmueble : "",
        provinciaInmueble: typeof raw.provinciaInmueble === "string" ? raw.provinciaInmueble : "",
        xmlFileName: typeof raw.xmlFileName === "string" ? raw.xmlFileName : "",
        supOpacos: typeof raw.supOpacos === "number" ? raw.supOpacos : 0,
        supHuecos: typeof raw.supHuecos === "number" ? raw.supHuecos : 0,
        elementosOpacosList: Array.isArray(raw.elementosOpacosList) ? raw.elementosOpacosList : [],
        elementosHuecosList: Array.isArray(raw.elementosHuecosList) ? raw.elementosHuecosList : [],
        filtroMetodo: isRecord(raw.filtroMetodo) ? (raw.filtroMetodo as Record<number, string>) : {},
        materialSearchByLayer: isRecord(raw.materialSearchByLayer)
            ? (raw.materialSearchByLayer as Record<number, string>)
            : {},
        soloFavoritosPorCapa: isRecord(raw.soloFavoritosPorCapa)
            ? (raw.soloFavoritosPorCapa as Record<number, boolean>)
            : {},
        capturas: isRecord(raw.capturas) ? (raw.capturas as CapturasState) : createEmptyCapturasState(),
        resultado: isRecord(raw.resultado) ? (raw.resultado as unknown as ResultadoTermico) : null,
    };

    return { payload };
}

function mergeDraftPayload(base: CertificateDraftPayload, incoming: CertificateDraftPayload): CertificateDraftPayload {
    return {
        ...base,
        ...incoming,
        rc: incoming.rc || base.rc,
        status: incoming.status || base.status,
        updatedAt: incoming.updatedAt || base.updatedAt || new Date().toISOString(),
        capas: Array.isArray(incoming.capas) && incoming.capas.length > 0 ? incoming.capas : base.capas,
        capturas: isRecord(incoming.capturas) ? incoming.capturas : base.capturas,
        resultado: incoming.resultado ?? base.resultado ?? null,
    };
}

function pickMostRecentDraft(a: CertificateDraftPayload, b: CertificateDraftPayload): CertificateDraftPayload {
    const aTime = Date.parse(a.updatedAt || "");
    const bTime = Date.parse(b.updatedAt || "");
    if (Number.isFinite(aTime) && Number.isFinite(bTime)) {
        return bTime >= aTime ? b : a;
    }
    return b;
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
        reader.readAsDataURL(blob);
    });
}

function getDraftPath(organizationId: string, rc: string): string {
    return `${organizationId}/${CERT_DRAFT_FOLDER}/${normalizeRc(rc)}.json`;
}

function getIndexPath(organizationId: string): string {
    return `${organizationId}/${CERT_DRAFT_FOLDER}/${CERT_INDEX_FILENAME}`;
}

function getImportAuditPath(organizationId: string): string {
    return `${organizationId}/${CERT_DRAFT_FOLDER}/${CERT_IMPORT_AUDIT_FILENAME}`;
}

function getLegacyDraftPath(organizationId: string, rc: string): string {
    return `${organizationId}/${CERT_DRAFT_FOLDER}/${LEGACY_CERT_PREFIX}${normalizeRc(rc)}.json`;
}

function getLegacyIndexPath(organizationId: string): string {
    return `${organizationId}/${CERT_DRAFT_FOLDER}/${CERT_INDEX_FILENAME}`;
}

interface CalcStateSnapshot {
    expedienteRc: string;
    certStatus: CertDraftStatus;
    capas: CapaMaterial[];
    areaHNH: number;
    areaNHE: number;
    supActuacion: number;
    supEnvolvente: number;
    zonaKey: string;
    scenarioI: Scenario;
    scenarioF: Scenario;
    caseI: Caso;
    caseF: Caso;
    ventilationLocked: boolean;
    modoCE3X: boolean;
    overrideUi: string;
    overrideUf: string;
    clienteFirstName: string;
    clienteMiddleName: string;
    clienteLastName1: string;
    clienteLastName2: string;
    clienteDni: string;
    clienteDireccionDni: string;
    direccionInmueble: string;
    municipioInmueble: string;
    cpInmueble: string;
    provinciaInmueble: string;
    xmlFileName: string;
    supOpacos: number;
    supHuecos: number;
    elementosOpacosList: ElementoEnvolvente[];
    elementosHuecosList: ElementoEnvolvente[];
    alturaMsnm: string;
    filtroMetodo: Record<number, string>;
    materialSearchByLayer: Record<number, string>;
    soloFavoritosPorCapa: Record<number, boolean>;
    resultado: ResultadoTermico | null;
}

export function CalculadoraTermica() {
    const [expedienteRc, setExpedienteRc] = useState("");
    const [certStatus, setCertStatus] = useState<CertDraftStatus>("en_progreso");

    const [capas, setCapas] = useState<CapaMaterial[]>(cloneInitialCapas());
    const [areaHNH, setAreaHNH] = useState(25);
    const [areaNHE, setAreaNHE] = useState(25);
    const [supActuacion, setSupActuacion] = useState(25);
    const [supEnvolvente, setSupEnvolvente] = useState(120);
    const [supOpacos, setSupOpacos] = useState(0);
    const [supHuecos, setSupHuecos] = useState(0);
    const [elementosOpacosList, setElementosOpacosList] = useState<ElementoEnvolvente[]>([]);
    const [elementosHuecosList, setElementosHuecosList] = useState<ElementoEnvolvente[]>([]);
    const [desgloseOpen, setDesgloseOpen] = useState(false);
    const [zonaKey, setZonaKey] = useState("D3");
    const [alturaMsnm, setAlturaMsnm] = useState<string>(""); // Added
    const [resultado, setResultado] = useState<ResultadoTermico | null>(null);
    const [copied, setCopied] = useState(false);
    const [materialesDB, setMaterialesDB] = useState<MaterialDB[]>([]);
    const [filtroMetodo, setFiltroMetodo] = useState<Record<number, string>>({});
    const [materialSearchByLayer, setMaterialSearchByLayer] = useState<Record<number, string>>({});
    const [soloFavoritosPorCapa, setSoloFavoritosPorCapa] = useState<Record<number, boolean>>({});
    const [showAdvancedByLayer, setShowAdvancedByLayer] = useState<Record<number, boolean>>({});

    // Nuevos estados para escenario y ventilación
    const [scenarioI, setScenarioI] = useState<Scenario>("nada_aislado");
    const [scenarioF, setScenarioF] = useState<Scenario>("particion_aislada");
    const [caseI, setCaseI] = useState<Caso>("estanco");
    const [caseF, setCaseF] = useState<Caso>("estanco");
    const [ventilationLocked, setVentilationLocked] = useState(true);
    const [modoCE3X, setModoCE3X] = useState(false);
    const [overrideUi, setOverrideUi] = useState("");
    const [overrideUf, setOverrideUf] = useState("");
    const [capturas, setCapturas] = useState<CapturasState>(createEmptyCapturasState());

    const [clienteFirstName, setClienteFirstName] = useState("");
    const [clienteMiddleName, setClienteMiddleName] = useState("");
    const [clienteLastName1, setClienteLastName1] = useState("");
    const [clienteLastName2, setClienteLastName2] = useState("");
    const [clienteDni, setClienteDni] = useState("");
    const [clienteDireccionDni, setClienteDireccionDni] = useState("");
    const [xmlImportMsg, setXmlImportMsg] = useState<string | null>(null);
    const [xmlFileName, setXmlFileName] = useState("");
    const [direccionInmueble, setDireccionInmueble] = useState("");
    const [municipioInmueble, setMunicipioInmueble] = useState("");
    const [cpInmueble, setCpInmueble] = useState("");
    const [provinciaInmueble, setProvinciaInmueble] = useState("");
    const [buscandoDni, setBuscandoDni] = useState(false);
    const [dniLookupMsg, setDniLookupMsg] = useState<string | null>(null);
    const [capturaPreview, setCapturaPreview] = useState<{
        label: string;
        fileName: string;
        dataUrl: string;
    } | null>(null);
    const [draftQueue, setDraftQueue] = useState<CertificateDraftIndexItem[]>([]);
    const [draftLoading, setDraftLoading] = useState(false);
    const [draftSaving, setDraftSaving] = useState(false);
    const [draftMsg, setDraftMsg] = useState<string | null>(null);
    const [draftError, setDraftError] = useState<string | null>(null);
    const [backupImportStrategy, setBackupImportStrategy] = useState<ImportMergeStrategy>("merge");
    const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
    const cancelBatchRef = useRef(false);

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const raw = window.localStorage.getItem(CALC_STATE_STORAGE_KEY);
            if (!raw) return;

            const saved = JSON.parse(raw) as Partial<CalcStateSnapshot>;

            if (typeof saved.expedienteRc === "string") setExpedienteRc(saved.expedienteRc);
            if (saved.certStatus === "pendiente" || saved.certStatus === "en_progreso" || saved.certStatus === "completado") {
                setCertStatus(saved.certStatus);
            }
            if (Array.isArray(saved.capas) && typeof saved.expedienteRc === "string" && saved.expedienteRc.trim()) {
                setCapas(saved.capas);
            }
            if (typeof saved.areaHNH === "number") setAreaHNH(saved.areaHNH);
            if (typeof saved.areaNHE === "number") setAreaNHE(saved.areaNHE);
            if (typeof saved.supActuacion === "number") setSupActuacion(saved.supActuacion);
            if (typeof saved.supEnvolvente === "number") setSupEnvolvente(saved.supEnvolvente);
            if (typeof saved.zonaKey === "string" && saved.zonaKey) setZonaKey(saved.zonaKey);
            if (saved.scenarioI) setScenarioI(saved.scenarioI);
            if (saved.scenarioF) setScenarioF(saved.scenarioF);
            if (saved.caseI) setCaseI(saved.caseI);
            if (saved.caseF) setCaseF(saved.caseF);
            if (typeof saved.ventilationLocked === "boolean") setVentilationLocked(saved.ventilationLocked);
            if (typeof saved.modoCE3X === "boolean") setModoCE3X(saved.modoCE3X);
            if (typeof saved.overrideUi === "string") setOverrideUi(saved.overrideUi);
            if (typeof saved.overrideUf === "string") setOverrideUf(saved.overrideUf);
            if (typeof saved.clienteFirstName === "string") setClienteFirstName(saved.clienteFirstName);
            if (typeof saved.clienteMiddleName === "string") setClienteMiddleName(saved.clienteMiddleName);
            if (typeof saved.clienteLastName1 === "string") setClienteLastName1(saved.clienteLastName1);
            if (typeof saved.clienteLastName2 === "string") setClienteLastName2(saved.clienteLastName2);
            if (typeof saved.clienteDni === "string") setClienteDni(saved.clienteDni);
            if (typeof saved.clienteDireccionDni === "string") setClienteDireccionDni(saved.clienteDireccionDni);
            if (typeof saved.xmlFileName === "string") setXmlFileName(saved.xmlFileName);
            if (typeof saved.direccionInmueble === "string") setDireccionInmueble(saved.direccionInmueble);
            if (typeof saved.municipioInmueble === "string") setMunicipioInmueble(saved.municipioInmueble);
            if (typeof saved.cpInmueble === "string") setCpInmueble(saved.cpInmueble);
            if (typeof saved.provinciaInmueble === "string") setProvinciaInmueble(saved.provinciaInmueble);
            if (typeof saved.supOpacos === "number") setSupOpacos(saved.supOpacos);
            if (typeof saved.supHuecos === "number") setSupHuecos(saved.supHuecos);
            if (Array.isArray(saved.elementosOpacosList)) setElementosOpacosList(saved.elementosOpacosList);
            if (Array.isArray(saved.elementosHuecosList)) setElementosHuecosList(saved.elementosHuecosList);
            if (saved.alturaMsnm !== undefined) setAlturaMsnm(String(saved.alturaMsnm));
            if (saved.filtroMetodo && typeof saved.filtroMetodo === "object") setFiltroMetodo(saved.filtroMetodo);
            if (saved.materialSearchByLayer && typeof saved.materialSearchByLayer === "object") {
                setMaterialSearchByLayer(saved.materialSearchByLayer);
            }
            if (saved.soloFavoritosPorCapa && typeof saved.soloFavoritosPorCapa === "object") {
                setSoloFavoritosPorCapa(saved.soloFavoritosPorCapa);
            }
            if (saved.resultado && typeof saved.resultado === "object") setResultado(saved.resultado as ResultadoTermico);
        } catch {
            // Si hay datos corruptos en localStorage, no bloquear la UI.
        }
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const snapshot: CalcStateSnapshot = {
                expedienteRc,
                certStatus,
                capas,
                areaHNH,
                areaNHE,
                supActuacion,
                supEnvolvente,
                zonaKey,
                scenarioI,
                scenarioF,
                caseI,
                caseF,
                ventilationLocked,
                modoCE3X,
                overrideUi,
                overrideUf,
                clienteFirstName,
                clienteMiddleName,
                clienteLastName1,
                clienteLastName2,
                clienteDni,
                clienteDireccionDni,
                direccionInmueble,
                municipioInmueble,
                cpInmueble,
                provinciaInmueble,
                xmlFileName,
                supOpacos,
                supHuecos,
                elementosOpacosList,
                elementosHuecosList,
                alturaMsnm,
                filtroMetodo,
                materialSearchByLayer,
                soloFavoritosPorCapa,
                resultado,
            };

            window.localStorage.setItem(CALC_STATE_STORAGE_KEY, JSON.stringify(snapshot));
        } catch {
            // Evitar interrumpir flujo si localStorage no está disponible.
        }
    }, [
        expedienteRc,
        certStatus,
        capas,
        areaHNH,
        areaNHE,
        supActuacion,
        supEnvolvente,
        zonaKey,
        scenarioI,
        scenarioF,
        caseI,
        caseF,
        ventilationLocked,
        modoCE3X,
        overrideUi,
        overrideUf,
        clienteFirstName,
        clienteMiddleName,
        clienteLastName1,
        clienteLastName2,
        clienteDni,
        clienteDireccionDni,
        direccionInmueble,
        municipioInmueble,
        cpInmueble,
        provinciaInmueble,
        xmlFileName,
        supOpacos,
        supHuecos,
        elementosOpacosList,
        elementosHuecosList,
        alturaMsnm,
        filtroMetodo,
        materialSearchByLayer,
        soloFavoritosPorCapa,
        resultado,
    ]);

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

    const reindexRecordAfterRemove = <T,>(record: Record<number, T>, removedIndex: number): Record<number, T> => {
        const next: Record<number, T> = {};
        Object.entries(record).forEach(([key, value]) => {
            const idx = Number(key);
            if (!Number.isFinite(idx) || idx === removedIndex) return;
            const targetIdx = idx > removedIndex ? idx - 1 : idx;
            next[targetIdx] = value;
        });
        return next;
    };

    const addCapa = (esNueva: boolean) => {
        setCapas((prev) => [...prev, { nombre: "", espesor: 0, lambda_val: 0, r_valor: 0, es_nueva: esNueva }]);
    };

    const addPresetLayer = (presetId: QuickLayerPresetId, esNueva: boolean) => {
        const preset = QUICK_LAYER_PRESETS[presetId];
        setCapas((prev) => [
            ...prev,
            {
                nombre: preset.nombre,
                espesor: preset.espesor,
                lambda_val: preset.lambda,
                r_valor: preset.r,
                es_nueva: esNueva,
            },
        ]);

        if (presetId === "aislante") {
            void loadSupafilFichaTecnica();
        }
    };

    const resetLayerAuxState = () => {
        setFiltroMetodo({});
        setMaterialSearchByLayer({});
        setSoloFavoritosPorCapa({});
        setShowAdvancedByLayer({});
        setResultado(null);
    };

    const applyCommonLayerSet = (setId: CommonLayerSetId) => {
        const definition = COMMON_LAYER_SETS[setId];
        const nextLayers: CapaMaterial[] = definition.map((item) => {
            const preset = QUICK_LAYER_PRESETS[item.preset];
            return {
                nombre: preset.nombre,
                espesor: preset.espesor,
                lambda_val: preset.lambda,
                r_valor: preset.r,
                es_nueva: item.esNueva,
            };
        });

        setCapas(nextLayers);
        resetLayerAuxState();
    };

    const loadSupafilFichaTecnica = async () => {
        if (capturas.ficha_tecnica?.fileName === SUPAFIL_FICHA_FILE_NAME) return;

        try {
            const response = await fetch(SUPAFIL_FICHA_PUBLIC_PATH);
            if (!response.ok) throw new Error("No disponible");
            const blob = await response.blob();
            const dataUrl = await blobToDataUrl(blob);

            setCapturas((prev) => ({
                ...prev,
                ficha_tecnica: {
                    fileName: SUPAFIL_FICHA_FILE_NAME,
                    mimeType: blob.type || "image/png",
                    dataUrl,
                },
            }));

            setDraftMsg("Ficha técnica SUPAFIL cargada automáticamente para copiar al PDF.");
        } catch {
            setDraftError("No se pudo cargar la ficha técnica SUPAFIL automática. Puedes subirla manualmente en Capturas.");
        }
    };

    const removeCapa = (idx: number) => {
        setCapas(capas.filter((_, i) => i !== idx));
        setFiltroMetodo((prev) => reindexRecordAfterRemove(prev, idx));
        setMaterialSearchByLayer((prev) => reindexRecordAfterRemove(prev, idx));
        setSoloFavoritosPorCapa((prev) => reindexRecordAfterRemove(prev, idx));
        setShowAdvancedByLayer((prev) => reindexRecordAfterRemove(prev, idx));
    };

    const updateCapa = <K extends keyof CapaMaterial>(idx: number, field: K, value: CapaMaterial[K]) => {
        setCapas((prev) => {
            const updated = [...prev];
            updated[idx] = {
                ...updated[idx],
                [field]: value,
            };
            return updated;
        });
    };

    const applyQuickPresetToLayer = (idx: number, presetId: QuickLayerPresetId) => {
        const preset = QUICK_LAYER_PRESETS[presetId];
        setCapas((prev) => {
            const updated = [...prev];
            updated[idx] = {
                ...updated[idx],
                nombre: preset.nombre,
                r_valor: preset.r,
                espesor: preset.espesor,
                lambda_val: preset.lambda,
            };
            return updated;
        });
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

            setClienteFirstName(client.first_name || "");
            setClienteMiddleName(client.middle_name || "");
            setClienteLastName1(client.last_name_1 || "");
            setClienteLastName2(client.last_name_2 || "");
            if (client.dni_address) setClienteDireccionDni(client.dni_address);
            
            const fullName = [client.first_name, client.middle_name, client.last_name_1, client.last_name_2].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
            setDniLookupMsg(`Cliente cargado desde BD: ${fullName || client.dni}`);
        } catch {
            setDniLookupMsg("Fallo inesperado al buscar DNI.");
        } finally {
            setBuscandoDni(false);
        }
    };

    const [savingCliente, setSavingCliente] = useState(false);
    const guardarCliente = async () => {
        const dni = normalizeDni(clienteDni);
        if (!dni) { setDniLookupMsg("Introduce un DNI para guardar el cliente."); return; }
        if (!supabase) { setDniLookupMsg("Supabase no está configurado."); return; }
        if (!clienteFirstName.trim() || !clienteLastName1.trim()) { setDniLookupMsg("Introduce al menos primer nombre y primer apellido."); return; }

        setSavingCliente(true);
        try {
            const organizationId = await resolveOrganizationOrThrow();
            const first_name = clienteFirstName.trim();
            const middle_name = clienteMiddleName.trim() || null;
            const last_name_1 = clienteLastName1.trim();
            const last_name_2 = clienteLastName2.trim() || null;

            const { data: newClient, error } = await supabase
                .from("clients")
                .upsert(
                    { organization_id: organizationId, dni, first_name, middle_name, last_name_1, last_name_2, dni_address: clienteDireccionDni.trim() || null },
                    { onConflict: "organization_id,dni" }
                )
                .select()
                .single();

            if (error) {
                setDniLookupMsg(`Error al guardar: ${error.message}`);
            } else if (newClient) {
                if (capturas.dni_cliente) {
                    try {
                        setDniLookupMsg(`Subiendo imagen de DNI...`);
                        const dniCaptura = capturas.dni_cliente;
                        const response = await fetch(dniCaptura.dataUrl);
                        const blob = await response.blob();
                        const fileExt = dniCaptura.fileName.split('.').pop() || 'png';
                        const fileName = `dni_front_${Date.now()}.${fileExt}`;
                        const filePath = `${organizationId}/clients/${newClient.id}/${fileName}`;
                        
                        const { error: uploadError } = await supabase.storage
                            .from('work_photos')
                            .upload(filePath, blob, { upsert: true });
                            
                        if (!uploadError) {
                            await supabase.from("clients").update({ dni_front_path: filePath }).eq("id", newClient.id);
                        }
                    } catch (err) {
                        console.error("Error subiendo DNI:", err);
                    }
                }
                setDniLookupMsg(`✅ Cliente ${first_name} ${last_name_1} guardado en BD.`);
            }
        } catch {
            setDniLookupMsg("Fallo inesperado al guardar cliente.");
        } finally {
            setSavingCliente(false);
        }
    };

    const importarXmlCE3X = async (file?: File) => {
        if (!file) return;

        // Limpieza preventiva para no arrastrar datos de importaciones previas.
        setClienteFirstName("");
        setClienteMiddleName("");
        setClienteLastName1("");
        setClienteLastName2("");
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
            setSupOpacos(parsed.superficieOpacos);
            setSupHuecos(parsed.superficieHuecos);
            setElementosOpacosList(parsed.elementosOpacosData);
            setElementosHuecosList(parsed.elementosHuecosData);

            let newZonaKey = parsed.zonaKey;
            let finalMsg = buildXmlImportSummary(parsed);

            if (parsed.zonaKey && VALORES_G[parsed.zonaKey] !== undefined) {
                setZonaKey(parsed.zonaKey);
            }

            if (parsed.clienteNombre) {
                const parts = parsed.clienteNombre.trim().split(/\s+/);
                if (parts.length === 1) {
                    setClienteFirstName(parts[0]);
                } else if (parts.length === 2) {
                    setClienteFirstName(parts[0]);
                    setClienteLastName1(parts[1]);
                } else if (parts.length === 3) {
                    setClienteFirstName(parts[0]);
                    setClienteLastName1(parts[1]);
                    setClienteLastName2(parts[2]);
                } else if (parts.length >= 4) {
                    setClienteLastName2(parts.pop() || "");
                    setClienteLastName1(parts.pop() || "");
                    setClienteFirstName(parts.shift() || "");
                    setClienteMiddleName(parts.join(" "));
                }
            }
            setClienteDni(parsed.clienteDni);

            if (parsed.clienteDni && supabase) {
                await buscarClientePorDni(parsed.clienteDni);
            } else {
                setDniLookupMsg("DNI de cliente no disponible en XML CE3X. Usa búsqueda manual.");
            }
            
            setXmlFileName(file.name);
            setXmlImportMsg(finalMsg);
            
            if (parsed.rc) {
                setExpedienteRc(parsed.rc);
            }
            if (parsed.direccion) setDireccionInmueble(parsed.direccion);
            if (parsed.municipio) setMunicipioInmueble(parsed.municipio);
            if (parsed.codigoPostal) setCpInmueble(parsed.codigoPostal);
            if (parsed.provincia) setProvinciaInmueble(parsed.provincia);

            // Integración Catastro Automática
            if (parsed.rc && parsed.provincia && parsed.municipio) {
                 setXmlImportMsg(finalMsg + " Verificando datos climáticos con Catastro...");
                 const { altitude, zone } = await fetchAltitudeAndProvince(parsed.rc, parsed.provincia, parsed.municipio);
                 let catastroMsg = "";
                 
                 if (altitude !== null) {
                     setAlturaMsnm(altitude.toString());
                     catastroMsg += ` ✅ Altura Catastro: ${altitude}m.`;
                 }
                 if (zone !== null) {
                     // Check mismatch
                     if (newZonaKey && zone !== newZonaKey && VALORES_G[zone] !== undefined) {
                         catastroMsg += ` ⚠️ ATENCIÓN: CE3X indica zona ${newZonaKey}, pero la real calculada es ${zone}. Por favor corrige en CE3X.`;
                     } else {
                         catastroMsg += ` ✅ Zona climática coincide (${zone}).`;
                     }
                 }
                 if (catastroMsg) {
                     setXmlImportMsg(finalMsg + catastroMsg);
                 } else {
                     setXmlImportMsg(finalMsg + " ⚠️ No se pudo verificar la altura / zona automáticamente.");
                 }
            }
            
        } catch {
            setClienteFirstName("");
            setClienteMiddleName("");
            setClienteLastName1("");
            setClienteLastName2("");
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
            zonaKey: zonaKey,
        });

        const fullClientName = [clienteFirstName, clienteMiddleName, clienteLastName1, clienteLastName2].filter(Boolean).join(" ").trim();
        const fullAddress = [
            direccionInmueble,
            cpInmueble,
            municipioInmueble,
            provinciaInmueble
        ].filter(Boolean).join(", ");

        const infoInmueble = [
            "DATOS DEL INMUEBLE",
            fullAddress ? `Dirección: ${fullAddress}` : "",
            alturaMsnm ? `Altitud: ${alturaMsnm} msnm` : "",
            "",
        ].filter(v => v !== null && v !== undefined && v !== "").join("\n");

        if (fullClientName || clienteDni.trim()) {
            const bloqueCliente = [
                "DATOS TITULAR",
                `Nombre: ${fullClientName || "(no indicado)"}`,
                `DNI/NIE: ${clienteDni.trim() || "(no indicado)"}`,
                clienteDireccionDni.trim() ? `Direccion DNI: ${clienteDireccionDni.trim()}` : "",
                "",
            ]
                .filter(Boolean)
                .join("\n");

            texto = `${bloqueCliente}\n${infoInmueble}\n${texto}`;
        } else if (infoInmueble) {
            texto = `${infoInmueble}\n${texto}`;
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
    const dniPreview = capturas.dni_cliente;

    const openCapturaPreview = (key: keyof CapturasState, label: string) => {
        const data = capturas[key];
        if (!data) return;
        setCapturaPreview({
            label,
            fileName: data.fileName,
            dataUrl: data.dataUrl,
        });
    };

    const clearLocalCalcMemory = () => {
        if (typeof window !== "undefined") {
            window.localStorage.removeItem(CALC_STATE_STORAGE_KEY);
        }
        setXmlImportMsg("Memoria local limpiada. Mantienes la sesión online, pero este formulario vuelve a estado manual.");
    };

    const isCancelledError = (error: unknown): boolean => {
        return error instanceof Error && error.message === "OPERACION_CANCELADA";
    };

    const throwIfCancelled = () => {
        if (cancelBatchRef.current) {
            throw new Error("OPERACION_CANCELADA");
        }
    };

    const setBatchStep = (next: BatchProgress) => {
        setBatchProgress(next);
    };

    const updateBatchStep = (patch: Partial<BatchProgress>) => {
        setBatchProgress((prev) => {
            if (!prev) return prev;
            return { ...prev, ...patch };
        });
    };

    const requestBatchCancel = () => {
        cancelBatchRef.current = true;
        updateBatchStep({ detail: "Cancelando... esperando finalizar la operación en curso." });
    };

    const truncateIssues = (issues: string[]): string => {
        if (issues.length === 0) return "";
        const top = issues.slice(0, 4).join(" | ");
        if (issues.length <= 4) return top;
        return `${top} | +${issues.length - 4} incidencias más`;
    };

    const sortDrafts = (items: CertificateDraftIndexItem[]): CertificateDraftIndexItem[] => {
        const statusOrder: Record<CertDraftStatus, number> = {
            pendiente: 0,
            en_progreso: 1,
            completado: 2,
        };

        return [...items].sort((a, b) => {
            const statusDiff = statusOrder[a.status] - statusOrder[b.status];
            if (statusDiff !== 0) return statusDiff;
            return b.updatedAt.localeCompare(a.updatedAt);
        });
    };

    const resolveOrganizationOrThrow = async (): Promise<string> => {
        const organizationId = await getCurrentOrganizationId();
        if (!organizationId) {
            throw new Error("No se pudo resolver la empresa activa para guardar/cargar certificados.");
        }
        return organizationId;
    };

    const readStorageTextByCandidates = async (candidates: string[]): Promise<{ text: string; path: string } | null> => {
        for (const candidate of candidates) {
            const { data, error } = await supabase.storage.from("work_photos").download(candidate);
            if (!error && data) {
                const text = await data.text();
                return { text, path: candidate };
            }
        }
        return null;
    };

    const loadDraftIndex = async (organizationId: string): Promise<CertificateDraftIndexItem[]> => {
        const resolved = await readStorageTextByCandidates([
            getIndexPath(organizationId),
            getLegacyIndexPath(organizationId),
        ]);
        if (!resolved) return [];

        try {
            const parsed = JSON.parse(resolved.text) as CertificateDraftIndexItem[];
            if (!Array.isArray(parsed)) return [];
            return parsed
                .filter((it) => typeof it.rc === "string" && typeof it.updatedAt === "string")
                .map((it) => ({
                    ...it,
                    rc: normalizeRc(it.rc),
                    status: isValidDraftStatus(it.status) ? it.status : "en_progreso",
                }));
        } catch {
            return [];
        }
    };

    const loadDraftPayload = async (organizationId: string, rc: string): Promise<CertificateDraftPayload | null> => {
        const normalizedRc = normalizeRc(rc);
        const resolved = await readStorageTextByCandidates([
            getDraftPath(organizationId, normalizedRc),
            getLegacyDraftPath(organizationId, normalizedRc),
        ]);
        if (!resolved) return null;

        try {
            const raw = JSON.parse(resolved.text) as unknown;
            const validated = sanitizeDraftPayload(raw);
            if (!validated.payload) return null;
            return validated.payload;
        } catch {
            return null;
        }
    };

    const loadImportAudit = async (organizationId: string): Promise<ImportAuditEntry[]> => {
        const auditPath = getImportAuditPath(organizationId);
        const { data, error } = await supabase.storage.from("work_photos").download(auditPath);
        if (error || !data) return [];

        try {
            const text = await data.text();
            const parsed = JSON.parse(text) as ImportAuditEntry[];
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    };

    const appendImportAudit = async (organizationId: string, entries: ImportAuditEntry[]) => {
        if (entries.length === 0) return;
        const current = await loadImportAudit(organizationId);
        const merged = [...entries, ...current].slice(0, 800);
        const auditPath = getImportAuditPath(organizationId);
        const blob = new Blob([JSON.stringify(merged, null, 2)], { type: "application/json" });
        const { error } = await supabase.storage.from("work_photos").upload(auditPath, blob, {
            upsert: true,
            contentType: "application/json",
        });
        if (error) {
            throw error;
        }
    };

    const saveDraftIndex = async (organizationId: string, items: CertificateDraftIndexItem[]) => {
        const indexPath = getIndexPath(organizationId);
        const blob = new Blob([JSON.stringify(sortDrafts(items), null, 2)], { type: "application/json" });
        const { error } = await supabase.storage.from("work_photos").upload(indexPath, blob, {
            upsert: true,
            contentType: "application/json",
        });
        if (error) throw error;
    };

    const archivarCompletados = async () => {
        if (!supabase) return;
        if (!confirm("¿Seguro que deseas archivar/limpiar los expedientes completados del lote actual?")) return;
        try {
            setDraftLoading(true);
            const organizationId = await resolveOrganizationOrThrow();
            const inProgress = draftQueue.filter(d => d.status !== "completado");
            await saveDraftIndex(organizationId, inProgress);
            setDraftQueue(inProgress);
            setDraftMsg("Expedientes completados archivados (eliminados de la cola).");
        } catch (e: any) {
            alert("Error al archivar: " + e.message);
        } finally {
            setDraftLoading(false);
        }
    };

    const exportarLoteCSV = () => {
        let csv = "RC,Estado,Cliente Nombre,Cliente DNI,Actualizado\n";
        draftQueue.forEach(d => {
            csv += `${d.rc},${d.status},"${d.clienteNombre}","${d.clienteDni}",${new Date(d.updatedAt).toLocaleString()}\n`;
        });
        const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `lote_certificados_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const exportarBackupJSON = async () => {
        if (draftQueue.length === 0) {
            alert("No hay certificados en la cola para exportar.");
            return;
        }

        setDraftLoading(true);
        setDraftError(null);
        setDraftMsg(null);
        cancelBatchRef.current = false;

        try {
            const organizationId = await resolveOrganizationOrThrow();
            const draftsForExport: CertificateDraftPayload[] = [];
            const exportIssues: string[] = [];

            setBatchStep({
                mode: "export",
                phase: "Descargando borradores",
                current: 0,
                total: draftQueue.length,
                detail: "Preparando exportación...",
            });

            for (let i = 0; i < draftQueue.length; i += 1) {
                throwIfCancelled();
                const item = draftQueue[i];
                updateBatchStep({
                    current: i,
                    detail: `Descargando ${item.rc}...`,
                });

                const payload = await loadDraftPayload(organizationId, item.rc);
                if (!payload) {
                    exportIssues.push(`${item.rc}: no se pudo descargar o validar.`);
                    continue;
                }

                draftsForExport.push(payload);
                updateBatchStep({ current: i + 1 });
            }

            if (draftsForExport.length === 0) {
                throw new Error("No se encontró ningún certificado válido para exportar.");
            }

            throwIfCancelled();

            const exportDate = new Date().toISOString();
            const backupData: BackupEnvelope = {
                version: BACKUP_ZIP_VERSION,
                exportDate,
                organizationId,
                draftCount: draftsForExport.length,
                drafts: draftsForExport,
            };

            const zip = new JSZip();
            const manifest: BackupManifest = {
                version: BACKUP_ZIP_VERSION,
                exportDate,
                organizationId,
                draftCount: draftsForExport.length,
                format: "zip",
                includes: ["manifest.json", "backup.json", "drafts/*.json"],
            };
            zip.file("manifest.json", JSON.stringify(manifest, null, 2));
            zip.file("backup.json", JSON.stringify(backupData));

            draftsForExport.forEach((draft) => {
                zip.file(`drafts/${normalizeRc(draft.rc)}.json`, JSON.stringify(draft));
            });

            setBatchStep({
                mode: "export",
                phase: "Comprimiendo ZIP",
                current: 0,
                total: 100,
                detail: "Aplicando compresión DEFLATE nivel 9...",
            });

            const zipBlob = await zip.generateAsync(
                {
                    type: "blob",
                    compression: "DEFLATE",
                    compressionOptions: { level: 9 },
                },
                (metadata) => {
                    updateBatchStep({
                        current: Math.round(metadata.percent),
                        total: 100,
                        detail: metadata.currentFile
                            ? `Comprimiendo: ${metadata.currentFile}`
                            : "Comprimiendo backup...",
                    });
                },
            );

            throwIfCancelled();

            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `backup_lote_completo_${new Date().toISOString().slice(0, 10)}.zip`;
            a.click();
            URL.revokeObjectURL(url);

            const warningText = exportIssues.length > 0
                ? ` Omitidos ${exportIssues.length} borradores con incidencia.`
                : "";
            setDraftMsg(`Backup ZIP exportado (${draftsForExport.length}/${draftQueue.length}).${warningText}`);
            if (exportIssues.length > 0) {
                setDraftError(`Exportación parcial: ${truncateIssues(exportIssues)}`);
            }
        } catch (error: any) {
            if (isCancelledError(error)) {
                setDraftMsg("Exportación cancelada por el usuario.");
            } else {
                console.error("Error exportando backup", error);
                setDraftError(error?.message ?? "Error al exportar el backup completo");
            }
        } finally {
            cancelBatchRef.current = false;
            setBatchProgress(null);
            setDraftLoading(false);
        }
    };

    const fileInputRef = useRef<HTMLInputElement>(null);

    const importarBackupJSON = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setDraftLoading(true);
        setDraftError(null);
        setDraftMsg(null);
        cancelBatchRef.current = false;
        try {
            const organizationId = await resolveOrganizationOrThrow();
            const { data: userCtx } = await supabase.auth.getUser();
            const importedByUserId = userCtx.user?.id ?? null;
            const importedByEmail = userCtx.user?.email ?? null;

            const importIssues: string[] = [];
            const auditEntries: ImportAuditEntry[] = [];

            let rawDrafts: unknown[] = [];
            if (file.name.toLowerCase().endsWith(".zip")) {
                setBatchStep({
                    mode: "import",
                    phase: "Leyendo ZIP",
                    current: 0,
                    total: 100,
                    detail: "Cargando archivo ZIP...",
                });
                const zip = await JSZip.loadAsync(file);
                throwIfCancelled();

                const backupFile = zip.file("backup.json");
                if (backupFile) {
                    const backupText = await backupFile.async("string");
                    const parsed = JSON.parse(backupText) as Partial<BackupEnvelope>;
                    rawDrafts = Array.isArray(parsed.drafts) ? parsed.drafts : [];
                } else {
                    const draftFiles = Object.values(zip.files)
                        .filter((entry) => !entry.dir && /^drafts\/.+\.json$/i.test(entry.name));

                    setBatchStep({
                        mode: "import",
                        phase: "Extrayendo borradores",
                        current: 0,
                        total: draftFiles.length,
                        detail: "Leyendo archivos internos...",
                    });

                    for (let i = 0; i < draftFiles.length; i += 1) {
                        throwIfCancelled();
                        const entry = draftFiles[i];
                        const text = await entry.async("string");
                        rawDrafts.push(JSON.parse(text));
                        updateBatchStep({
                            current: i + 1,
                            detail: `Extraido ${entry.name}`,
                        });
                    }
                }
            } else {
                const text = await file.text();
                const parsed = JSON.parse(text) as Partial<BackupEnvelope> & { drafts?: unknown[] };
                rawDrafts = Array.isArray(parsed.drafts) ? parsed.drafts : [];
            }

            if (rawDrafts.length === 0) {
                throw new Error("El backup no contiene certificados.");
            }

            const validatedDrafts: CertificateDraftPayload[] = [];
            setBatchStep({
                mode: "import",
                phase: "Validando estructura",
                current: 0,
                total: rawDrafts.length,
                detail: "Comprobando payloads...",
            });

            for (let i = 0; i < rawDrafts.length; i += 1) {
                throwIfCancelled();
                const rawDraft = rawDrafts[i];
                const validation = sanitizeDraftPayload(rawDraft);
                if (!validation.payload) {
                    const rcHint = isRecord(rawDraft) ? normalizeRc(String(rawDraft.rc ?? "")) : "SIN_RC";
                    importIssues.push(`${rcHint}: ${validation.error ?? "payload inválido"}`);
                    auditEntries.push({
                        at: new Date().toISOString(),
                        importedByUserId,
                        importedByEmail,
                        sourceFile: file.name,
                        strategy: backupImportStrategy,
                        rc: rcHint || "SIN_RC",
                        action: "invalid",
                        detail: validation.error,
                    });
                } else {
                    validatedDrafts.push(validation.payload);
                }

                updateBatchStep({ current: i + 1 });
            }

            if (validatedDrafts.length === 0) {
                throw new Error("Ningún certificado del backup supera la validación estructural.");
            }

            // Detectar duplicados internos por RC y conservar el más reciente.
            const dedupedByRc = new Map<string, CertificateDraftPayload>();
            let duplicateCount = 0;
            for (const draft of validatedDrafts) {
                const normalizedRc = normalizeRc(draft.rc);
                const existing = dedupedByRc.get(normalizedRc);
                if (existing) {
                    duplicateCount += 1;
                    dedupedByRc.set(normalizedRc, pickMostRecentDraft(existing, draft));
                } else {
                    dedupedByRc.set(normalizedRc, draft);
                }
            }

            const draftsToRestore = Array.from(dedupedByRc.values());
            let importedCount = 0;
            let skippedCount = 0;
            let mergedCount = 0;
            let overwrittenCount = 0;
            let failedCount = 0;

            let indexItems = await loadDraftIndex(organizationId);

            setBatchStep({
                mode: "import",
                phase: "Subiendo a Supabase",
                current: 0,
                total: draftsToRestore.length,
                detail: "Aplicando estrategia de merge...",
            });

            for (let i = 0; i < draftsToRestore.length; i += 1) {
                throwIfCancelled();
                const incoming = draftsToRestore[i];
                const rc = normalizeRc(incoming.rc);
                const existsIdx = indexItems.findIndex((q) => normalizeRc(q.rc) === rc);
                let payloadToStore = incoming;
                let auditAction: ImportAuditAction = "created";

                if (existsIdx >= 0) {
                    if (backupImportStrategy === "skip") {
                        skippedCount += 1;
                        auditAction = "skipped";
                        auditEntries.push({
                            at: new Date().toISOString(),
                            importedByUserId,
                            importedByEmail,
                            sourceFile: file.name,
                            strategy: backupImportStrategy,
                            rc,
                            action: auditAction,
                            detail: "Duplicado detectado. Se conserva el existente.",
                        });
                        updateBatchStep({ current: i + 1, detail: `Saltado ${rc}` });
                        continue;
                    }

                    if (backupImportStrategy === "merge") {
                        const existingPayload = await loadDraftPayload(organizationId, rc);
                        if (existingPayload) {
                            payloadToStore = mergeDraftPayload(existingPayload, incoming);
                        }
                        mergedCount += 1;
                        auditAction = "merged";
                    } else {
                        overwrittenCount += 1;
                        auditAction = "overwritten";
                    }
                }

                const blob = new Blob([JSON.stringify(payloadToStore)], { type: "application/json" });
                const filePath = getDraftPath(organizationId, rc);
                const { error: uploadError } = await supabase.storage.from("work_photos").upload(filePath, blob, {
                    upsert: true,
                    contentType: "application/json",
                });

                if (uploadError) {
                    failedCount += 1;
                    importIssues.push(`${rc}: fallo subida (${uploadError.message})`);
                    auditEntries.push({
                        at: new Date().toISOString(),
                        importedByUserId,
                        importedByEmail,
                        sourceFile: file.name,
                        strategy: backupImportStrategy,
                        rc,
                        action: "failed",
                        detail: uploadError.message,
                    });
                    updateBatchStep({ current: i + 1, detail: `Error en ${rc}` });
                    continue;
                }

                importedCount += 1;
                const newItem: CertificateDraftIndexItem = {
                    rc,
                    status: payloadToStore.status || "en_progreso",
                    updatedAt: payloadToStore.updatedAt || new Date().toISOString(),
                    clienteNombre: payloadToStore.clienteNombre || [payloadToStore.clienteFirstName, payloadToStore.clienteMiddleName, payloadToStore.clienteLastName1, payloadToStore.clienteLastName2].filter(Boolean).join(" "),
                    clienteDni: payloadToStore.clienteDni || "",
                };

                if (existsIdx >= 0) {
                    indexItems[existsIdx] = newItem;
                } else {
                    indexItems.push(newItem);
                }

                auditEntries.push({
                    at: new Date().toISOString(),
                    importedByUserId,
                    importedByEmail,
                    sourceFile: file.name,
                    strategy: backupImportStrategy,
                    rc,
                    action: auditAction,
                });

                updateBatchStep({
                    current: i + 1,
                    detail: `Procesado ${rc}`,
                });
            }

            throwIfCancelled();

            await saveDraftIndex(organizationId, indexItems);
            await appendImportAudit(organizationId, auditEntries);

            setDraftQueue(sortDrafts(indexItems));
            const summary = [
                `Importación completada: ${importedCount} aplicados`,
                `${skippedCount} omitidos`,
                `${mergedCount} merged`,
                `${overwrittenCount} overwrite`,
                `${failedCount} fallidos`,
                `${duplicateCount} duplicados internos detectados`,
            ].join(" · ");
            setDraftMsg(summary);

            if (importIssues.length > 0) {
                setDraftError(`Importación con incidencias: ${truncateIssues(importIssues)}`);
            }
        } catch (error: any) {
            if (isCancelledError(error)) {
                setDraftMsg("Importación cancelada por el usuario.");
            } else {
                console.error("Error importando", error);
                setDraftError(error?.message ?? "Error al importar el lote");
            }
        } finally {
            cancelBatchRef.current = false;
            setBatchProgress(null);
            setDraftLoading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const refreshDraftQueue = async () => {
        if (!supabase) return;
        setDraftLoading(true);
        setDraftError(null);
        try {
            const organizationId = await resolveOrganizationOrThrow();
            const indexItems = await loadDraftIndex(organizationId);
            setDraftQueue(sortDrafts(indexItems));
        } catch (error: any) {
            setDraftError(error?.message ?? "No se pudo cargar la cola de certificados.");
        } finally {
            setDraftLoading(false);
        }
    };

    useEffect(() => {
        refreshDraftQueue();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!ventilationLocked) return;
        setCaseF(caseI);
    }, [caseI, ventilationLocked]);

    const applyDraftPayload = (payload: CertificateDraftPayload) => {
        setExpedienteRc(payload.rc || "");
        setCertStatus(payload.status || "en_progreso");
        setCapas(Array.isArray(payload.capas) && payload.capas.length > 0 ? payload.capas : cloneInitialCapas());
        setAreaHNH(payload.areaHNH ?? 25);
        setAreaNHE(payload.areaNHE ?? 25);
        setSupActuacion(payload.supActuacion ?? 25);
        setSupEnvolvente(payload.supEnvolvente ?? 120);
        setZonaKey(payload.zonaKey || "D3");
        setAlturaMsnm(payload.alturaMsnm ? String(payload.alturaMsnm) : "");
        setScenarioI(payload.scenarioI || "nada_aislado");
        setScenarioF(payload.scenarioF || "particion_aislada");
        setCaseI(payload.caseI || "estanco");
        setCaseF(payload.caseF || "estanco");
        setVentilationLocked(typeof payload.ventilationLocked === "boolean" ? payload.ventilationLocked : true);
        setModoCE3X(!!payload.modoCE3X);
        setOverrideUi(payload.overrideUi || "");
        setOverrideUf(payload.overrideUf || "");
        if (payload.clienteNombre && !payload.clienteFirstName && !payload.clienteLastName1) {
            const parts = payload.clienteNombre.trim().split(/\s+/);
            setClienteFirstName(parts[0] || "");
            if (parts.length === 2) {
                setClienteLastName1(parts[1]);
                setClienteMiddleName("");
                setClienteLastName2("");
            } else if (parts.length === 3) {
                setClienteLastName1(parts[1]);
                setClienteLastName2(parts[2]);
                setClienteMiddleName("");
            } else if (parts.length >= 4) {
                setClienteLastName1(parts[parts.length - 2]);
                setClienteLastName2(parts[parts.length - 1]);
                setClienteMiddleName(parts.slice(1, parts.length - 2).join(" "));
            } else {
                setClienteLastName1("");
                setClienteLastName2("");
                setClienteMiddleName("");
            }
        } else {
            setClienteFirstName(payload.clienteFirstName || "");
            setClienteMiddleName(payload.clienteMiddleName || "");
            setClienteLastName1(payload.clienteLastName1 || "");
            setClienteLastName2(payload.clienteLastName2 || "");
        }
        setClienteDni(payload.clienteDni || "");
        setClienteDireccionDni(payload.clienteDireccionDni || "");
        setXmlFileName(payload.xmlFileName || "");
        setFiltroMetodo(payload.filtroMetodo || {});
        setMaterialSearchByLayer(payload.materialSearchByLayer || {});
        setSoloFavoritosPorCapa(payload.soloFavoritosPorCapa || {});
        setCapturas(payload.capturas || createEmptyCapturasState());
        setResultado(payload.resultado ?? null);
        setSupOpacos(payload.supOpacos ?? 0);
        setSupHuecos(payload.supHuecos ?? 0);
        setElementosOpacosList(payload.elementosOpacosList || []);
        setElementosHuecosList(payload.elementosHuecosList || []);
    };

    const saveCurrentDraft = async (statusOverride?: CertDraftStatus) => {
        const rcNormalized = normalizeRc(expedienteRc);
        if (!rcNormalized) {
            setDraftError("Debes indicar Referencia Catastral para guardar el certificado.");
            return;
        }
        if (!supabase) {
            setDraftError("Supabase no está configurado en esta sesión.");
            return;
        }

        setDraftSaving(true);
        setDraftError(null);
        setDraftMsg(null);
        try {
            const organizationId = await resolveOrganizationOrThrow();
            const finalStatus = statusOverride ?? certStatus;
            const nowIso = new Date().toISOString();

            const payload: CertificateDraftPayload = {
                version: CERT_DRAFT_VERSION,
                rc: rcNormalized,
                status: finalStatus,
                updatedAt: nowIso,
                capas,
                areaHNH,
                areaNHE,
                supActuacion,
                supEnvolvente,
                zonaKey,
                alturaMsnm: alturaMsnm ? Number(alturaMsnm) : undefined,
                scenarioI,
                scenarioF,
                caseI,
                caseF,
                ventilationLocked,
                modoCE3X,
                overrideUi,
                overrideUf,
                clienteFirstName,
                clienteMiddleName,
                clienteLastName1,
                clienteLastName2,
                clienteNombre: [clienteFirstName, clienteMiddleName, clienteLastName1, clienteLastName2].filter(Boolean).join(" "),
                clienteDni,
                clienteDireccionDni,
                xmlFileName,
                supOpacos,
                supHuecos,
                elementosOpacosList,
                elementosHuecosList,
                filtroMetodo,
                materialSearchByLayer,
                soloFavoritosPorCapa,
                capturas,
                resultado,
            };

            const draftPath = getDraftPath(organizationId, rcNormalized);
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
            const { error } = await supabase.storage.from("work_photos").upload(draftPath, blob, {
                upsert: true,
                contentType: "application/json",
            });
            if (error) throw error;

            const currentIndex = await loadDraftIndex(organizationId);
            const merged: CertificateDraftIndexItem[] = [
                {
                    rc: rcNormalized,
                    status: finalStatus,
                    updatedAt: nowIso,
                    clienteNombre: [clienteFirstName, clienteMiddleName, clienteLastName1, clienteLastName2].filter(Boolean).join(" "),
                    clienteDni: clienteDni.trim(),
                },
                ...currentIndex.filter((it) => normalizeRc(it.rc) !== rcNormalized),
            ];

            await saveDraftIndex(organizationId, merged);
            setCertStatus(finalStatus);
            setExpedienteRc(rcNormalized);
            setDraftQueue(sortDrafts(merged));
            setDraftMsg(finalStatus === "completado"
                ? `Certificado ${rcNormalized} marcado como completado y guardado.`
                : `Borrador ${rcNormalized} guardado correctamente.`);
        } catch (error: any) {
            setDraftError(error?.message ?? "No se pudo guardar el borrador.");
        } finally {
            setDraftSaving(false);
        }
    };

    const loadDraft = async (item: CertificateDraftIndexItem) => {
        if (!supabase) return;
        setDraftLoading(true);
        setDraftError(null);
        setDraftMsg(null);
        try {
            const organizationId = await resolveOrganizationOrThrow();
            const payload = await loadDraftPayload(organizationId, item.rc);
            if (!payload) {
                throw new Error("No se pudo descargar o validar el borrador seleccionado.");
            }
            applyDraftPayload(payload);
            setDraftMsg(`Cargado certificado ${item.rc}.`);
        } catch (error: any) {
            setDraftError(error?.message ?? "No se pudo cargar el borrador.");
        } finally {
            setDraftLoading(false);
        }
    };

    const loadNextPendingDraft = async () => {
        const next = draftQueue.find((it) => it.status !== "completado");
        if (!next) {
            setDraftMsg("No hay certificados pendientes en la cola.");
            return;
        }
        await loadDraft(next);
    };

    const resetForNewCertificate = () => {
        setExpedienteRc("");
        setCertStatus("en_progreso");
        setCapas(cloneInitialCapas());
        setAreaHNH(25);
        setAreaNHE(25);
        setSupActuacion(25);
        setSupEnvolvente(120);
        setSupOpacos(0);
        setSupHuecos(0);
        setZonaKey("D3");
        setAlturaMsnm("");
        setScenarioI("nada_aislado");
        setScenarioF("particion_aislada");
        setCaseI("estanco");
        setCaseF("estanco");
        setVentilationLocked(true);
        setModoCE3X(false);
        setOverrideUi("");
        setOverrideUf("");
        setClienteFirstName("");
        setClienteMiddleName("");
        setClienteLastName1("");
        setClienteLastName2("");
        setClienteDni("");
        setClienteDireccionDni("");
        setCapturas(createEmptyCapturasState());
        setResultado(null);
        setXmlFileName("");
        setXmlImportMsg("Nuevo expediente preparado. Define RC y comienza el siguiente certificado.");
        setDraftMsg(null);
        setDraftError(null);
    };

    const queueTotal = draftQueue.length;
    const queueCompleted = draftQueue.filter((it) => it.status === "completado").length;
    const queuePending = queueTotal - queueCompleted;
    const batchProgressPercent = batchProgress
        ? (batchProgress.total > 0 ? Math.min(100, Math.round((batchProgress.current / batchProgress.total) * 100)) : 0)
        : 0;

    const materialFlags = {
        hormigon: capas.some((c) => c.nombre.toLowerCase().includes("hormig")),
        yeso: capas.some((c) => c.nombre.toLowerCase().includes("yeso")),
        madera: capas.some((c) => c.nombre.toLowerCase().includes("madera")),
    };

    const draftStatusLabel = (status: CertDraftStatus) => {
        if (status === "completado") return "Completado";
        if (status === "en_progreso") return "En progreso";
        return "Pendiente";
    };

    return (
        <div className="flex flex-col h-[calc(100vh-4rem)] p-6 gap-5 animate-in fade-in duration-500 overflow-y-auto">
            {/* Cabecera */}
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-slate-100 flex items-center gap-3">
                        <Calculator className="h-8 w-8 text-orange-400" />
                        Calculadora Térmica CAE
                    </h2>
                    <p className="text-slate-400 mt-1">
                        Calcula el ahorro energético (kWh/año) según CTE DB-HE — Tabla 7.
                    </p>
                </div>
                <button
                    onClick={clearLocalCalcMemory}
                    className="h-8 px-3 rounded-md border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 text-xs"
                    title="Borra memoria local del formulario guardada en este navegador"
                >
                    Limpiar memoria local
                </button>
            </div>

            <Card className="bg-slate-900/40 border-slate-800">
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg text-slate-200 flex items-center gap-2">
                        <ListChecks className="h-5 w-5 text-amber-300" />
                        Flujo por lote de certificados
                    </CardTitle>
                    <CardDescription className="text-slate-500">
                        Guarda por Referencia Catastral, retoma expedientes en segundos y marca completados sin perder cálculos ni capturas.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                        <div className="md:col-span-2">
                            <label className="text-[10px] text-slate-500 uppercase font-bold">Referencia catastral</label>
                            <Input
                                value={expedienteRc}
                                onChange={(e) => setExpedienteRc(normalizeRc(e.target.value))}
                                placeholder="Ej: 1234567AB1234C0001DE"
                                className="h-9 bg-slate-900/50 border-slate-700 text-slate-200 font-mono"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] text-slate-500 uppercase font-bold">Estado</label>
                            <select
                                value={certStatus}
                                onChange={(e) => setCertStatus(e.target.value as CertDraftStatus)}
                                className="h-9 w-full rounded-md bg-slate-900/50 border border-slate-700 text-slate-200 px-2 text-sm"
                            >
                                <option value="pendiente">Pendiente</option>
                                <option value="en_progreso">En progreso</option>
                                <option value="completado">Completado</option>
                            </select>
                        </div>
                        <div className="md:col-span-2 grid grid-cols-2 gap-2 items-end">
                            <button
                                onClick={() => saveCurrentDraft()}
                                disabled={draftSaving}
                                className="h-9 px-3 rounded-md bg-amber-900/30 border border-amber-700/40 text-amber-300 hover:bg-amber-800/40 disabled:opacity-40 text-xs inline-flex items-center justify-center gap-1"
                            >
                                <Save className="h-3.5 w-3.5" />
                                Guardar
                            </button>
                            <button
                                onClick={() => saveCurrentDraft("completado")}
                                disabled={draftSaving}
                                className="h-9 px-3 rounded-md bg-emerald-900/30 border border-emerald-700/40 text-emerald-300 hover:bg-emerald-800/40 disabled:opacity-40 text-xs inline-flex items-center justify-center gap-1"
                            >
                                <CircleCheckBig className="h-3.5 w-3.5" />
                                Guardar + completar
                            </button>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="px-2 py-1 rounded border border-slate-700 text-slate-300 bg-slate-900/40">Total: {queueTotal}</span>
                        <span className="px-2 py-1 rounded border border-amber-700/40 text-amber-300 bg-amber-900/20">Pendientes: {queuePending}</span>
                        <span className="px-2 py-1 rounded border border-emerald-700/40 text-emerald-300 bg-emerald-900/20">Completados: {queueCompleted}</span>
                        <button
                            onClick={() => refreshDraftQueue()}
                            disabled={draftLoading}
                            className="ml-auto h-8 px-3 rounded-md bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 disabled:opacity-40 inline-flex items-center gap-1"
                        >
                            <RefreshCcw className="h-3.5 w-3.5" />
                            Refrescar cola
                        </button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={() => loadNextPendingDraft()}
                            disabled={draftLoading || queueTotal === 0}
                            className="h-8 px-3 rounded-md bg-indigo-900/30 border border-indigo-700/40 text-indigo-300 hover:bg-indigo-800/40 disabled:opacity-40 text-xs inline-flex items-center gap-1"
                        >
                            <Download className="h-3.5 w-3.5" />
                            Cargar siguiente pendiente
                        </button>
                        <button
                            onClick={resetForNewCertificate}
                            className="h-8 px-3 rounded-md bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 text-xs inline-flex items-center gap-1"
                        >
                            <FolderPlus className="h-3.5 w-3.5" />
                            Nuevo expediente
                        </button>
                        <button
                            onClick={() => exportarLoteCSV()}
                            disabled={queueTotal === 0}
                            className="ml-auto h-8 px-3 rounded-md bg-emerald-900/30 border border-emerald-700/40 text-emerald-300 hover:bg-emerald-800/40 disabled:opacity-40 text-xs inline-flex items-center gap-1"
                        >
                            <FileDown className="h-3.5 w-3.5" />
                            Lote CSV
                        </button>
                        <button
                            onClick={() => exportarBackupJSON()}
                            disabled={draftLoading || queueTotal === 0}
                            className="h-8 px-3 rounded-md bg-cyan-900/30 border border-cyan-700/40 text-cyan-300 hover:bg-cyan-800/40 disabled:opacity-40 text-xs inline-flex items-center gap-1"
                            title="Exportar lote completo con imágenes en ZIP comprimido"
                        >
                            <Save className="h-3.5 w-3.5" />
                            Exportar ZIP
                        </button>
                        <div className="h-8 px-2 rounded-md border border-slate-700 bg-slate-900/40 flex items-center gap-2 text-[11px] text-slate-300">
                            <span>Acción al duplicar:</span>
                            <select
                                value={backupImportStrategy}
                                onChange={(e) => setBackupImportStrategy(e.target.value as ImportMergeStrategy)}
                                disabled={draftLoading}
                                className="h-6 rounded bg-slate-900 border border-slate-700 px-1 text-[11px]"
                                title="Estrategia al detectar RC duplicada durante importación"
                            >
                                <option value="merge">Fusionar datos</option>
                                <option value="overwrite">Sobrescribir</option>
                                <option value="skip">Omitir</option>
                            </select>
                        </div>
                        <input type="file" ref={fileInputRef} onChange={importarBackupJSON} accept=".json,.zip,application/zip" className="hidden" />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={draftLoading}
                            className="h-8 px-3 rounded-md bg-blue-900/30 border border-blue-700/40 text-blue-300 hover:bg-blue-800/40 disabled:opacity-40 text-xs inline-flex items-center gap-1"
                            title="Importar backup JSON o ZIP"
                        >
                            <UploadCloud className="h-3.5 w-3.5" />
                            Restaurar
                        </button>
                        <button
                            onClick={() => archivarCompletados()}
                            disabled={draftLoading || queueTotal === 0}
                            className="h-8 px-3 rounded-md bg-rose-900/30 border border-rose-700/40 text-rose-300 hover:bg-rose-800/40 disabled:opacity-40 text-xs inline-flex items-center gap-1"
                            title="Limpia los expedientes completados del lote actual"
                        >
                            <Archive className="h-3.5 w-3.5" />
                            Archivar Completados
                        </button>
                    </div>

                    {batchProgress && (
                        <div className="rounded-md border border-cyan-700/40 bg-cyan-900/10 px-3 py-2 space-y-2">
                            <div className="flex items-center justify-between text-[11px] text-cyan-200">
                                <span>
                                    {batchProgress.mode === "export" ? "Exportación" : "Importación"}
                                    {" · "}
                                    {batchProgress.phase}
                                </span>
                                <span>
                                    {batchProgress.current}/{batchProgress.total}
                                    {" · "}
                                    {batchProgressPercent}%
                                </span>
                            </div>
                            <div className="h-2 rounded bg-slate-800 overflow-hidden">
                                <div
                                    className="h-full bg-cyan-400 transition-all duration-200"
                                    style={{ width: `${batchProgressPercent}%` }}
                                />
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-[11px] text-cyan-100/90 truncate">{batchProgress.detail || "Procesando..."}</p>
                                <button
                                    onClick={requestBatchCancel}
                                    className="h-7 px-2 rounded border border-cyan-600/50 text-cyan-200 hover:bg-cyan-800/30 text-[11px] inline-flex items-center gap-1"
                                >
                                    <X className="h-3 w-3" />
                                    Cancelar
                                </button>
                            </div>
                        </div>
                    )}

                    {draftMsg && (
                        <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 rounded-md">
                            {draftMsg}
                        </div>
                    )}
                    {draftError && (
                        <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 px-3 py-2 rounded-md">
                            {draftError}
                        </div>
                    )}

                    <div className="rounded-md border border-slate-800 bg-slate-950/30 max-h-52 overflow-y-auto">
                        {draftLoading ? (
                            <div className="px-3 py-3 text-xs text-slate-400">Cargando cola de certificados...</div>
                        ) : draftQueue.length === 0 ? (
                            <div className="px-3 py-3 text-xs text-slate-500">Sin expedientes en cola. Guarda el primero para iniciar el lote.</div>
                        ) : (
                            <div className="divide-y divide-slate-800">
                                {draftQueue.map((item) => (
                                    <div key={item.rc} className="px-3 py-2 flex items-center gap-2">
                                        <button
                                            onClick={() => loadDraft(item)}
                                            className="text-left flex-1 min-w-0"
                                        >
                                            <p className="text-xs text-slate-200 font-mono truncate">{item.rc}</p>
                                            <p className="text-[11px] text-slate-500 truncate">
                                                {item.clienteNombre || "Sin nombre"}
                                                {item.clienteDni ? ` · ${item.clienteDni}` : ""}
                                                {` · ${new Date(item.updatedAt).toLocaleString()}`}
                                            </p>
                                        </button>
                                        <span className={`px-2 py-1 rounded border text-[10px] ${item.status === "completado"
                                            ? "border-emerald-700/40 text-emerald-300 bg-emerald-900/20"
                                            : item.status === "en_progreso"
                                                ? "border-amber-700/40 text-amber-300 bg-amber-900/20"
                                                : "border-slate-700 text-slate-300 bg-slate-900/20"
                                            }`}>
                                            {draftStatusLabel(item.status)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

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
                        <div className={`text-xs px-3 py-2 rounded-md border ${
                            xmlImportMsg.includes("⚠️")
                                ? "text-amber-300 bg-amber-500/10 border-amber-500/30"
                                : "text-cyan-300 bg-cyan-500/10 border-cyan-500/30"
                        }`}>
                            {xmlImportMsg}
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4">
                        <div>
                            <label className="text-[10px] text-slate-500 uppercase font-bold">Primer Nombre *</label>
                            <Input value={clienteFirstName} onChange={(e) => setClienteFirstName(e.target.value)} placeholder="Juan" className="h-9 bg-slate-900/50 border-slate-700 text-slate-200" />
                        </div>
                        <div>
                            <label className="text-[10px] text-slate-500 uppercase font-bold">Segundo Nombre</label>
                            <Input value={clienteMiddleName} onChange={(e) => setClienteMiddleName(e.target.value)} placeholder="Carlos" className="h-9 bg-slate-900/50 border-slate-700 text-slate-200" />
                        </div>
                        <div>
                            <label className="text-[10px] text-slate-500 uppercase font-bold">Primer Apellido *</label>
                            <Input value={clienteLastName1} onChange={(e) => setClienteLastName1(e.target.value)} placeholder="García" className="h-9 bg-slate-900/50 border-slate-700 text-slate-200" />
                        </div>
                        <div>
                            <label className="text-[10px] text-slate-500 uppercase font-bold">Segundo Apellido</label>
                            <Input value={clienteLastName2} onChange={(e) => setClienteLastName2(e.target.value)} placeholder="López" className="h-9 bg-slate-900/50 border-slate-700 text-slate-200" />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-2">
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
                                <button
                                    onClick={() => guardarCliente()}
                                    disabled={savingCliente || !clienteFirstName.trim() || !clienteLastName1.trim() || !clienteDni.trim()}
                                    className="h-9 px-3 rounded-md bg-emerald-900/30 border border-emerald-700/40 text-emerald-300 hover:bg-emerald-800/40 disabled:opacity-40 text-[11px] font-bold"
                                    title="Guardar cliente en base de datos"
                                >
                                    {savingCliente ? "..." : "Guardar"}
                                </button>
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
                    </div>

                    <div className="rounded-md border border-indigo-500/20 bg-indigo-500/5 p-3">
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-[10px] uppercase font-bold text-indigo-300">Vista previa DNI cliente</p>
                            <button
                                onClick={() => openCapturaPreview("dni_cliente", "DNI cliente")}
                                disabled={!dniPreview}
                                className="h-7 px-2 rounded-md bg-indigo-900/30 border border-indigo-700/40 text-indigo-300 hover:bg-indigo-800/40 disabled:opacity-40 text-[11px] inline-flex items-center gap-1"
                            >
                                <ZoomIn className="h-3.5 w-3.5" />
                                Ver grande
                            </button>
                        </div>

                        {dniPreview ? (
                            <img
                                src={dniPreview.dataUrl}
                                alt="DNI cliente"
                                onClick={() => openCapturaPreview("dni_cliente", "DNI cliente")}
                                className="w-full h-44 md:h-56 object-contain rounded border border-indigo-700/30 bg-slate-950/40 cursor-zoom-in"
                                title="Click para ampliar"
                            />
                        ) : (
                            <div className="w-full h-24 rounded border border-dashed border-indigo-700/30 flex items-center justify-center text-[11px] text-slate-500">
                                Sin captura de DNI (cárgala en el panel de capturas inferior)
                            </div>
                        )}
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
                                <div className="flex flex-wrap items-center gap-2 mb-2">
                                    <span className="text-[10px] uppercase font-bold text-slate-400">Materiales detectados en capas:</span>
                                    <span className={`px-2 py-1 rounded border text-[10px] ${materialFlags.hormigon ? "border-emerald-600/40 text-emerald-300 bg-emerald-900/20" : "border-slate-700 text-slate-500"}`}>Hormigón</span>
                                    <span className={`px-2 py-1 rounded border text-[10px] ${materialFlags.yeso ? "border-emerald-600/40 text-emerald-300 bg-emerald-900/20" : "border-slate-700 text-slate-500"}`}>Yeso</span>
                                    <span className={`px-2 py-1 rounded border text-[10px] ${materialFlags.madera ? "border-emerald-600/40 text-emerald-300 bg-emerald-900/20" : "border-slate-700 text-slate-500"}`}>Madera</span>
                                </div>
                                <p className="text-[11px] text-slate-500">
                                    El bloque de capas ahora empieza vacío. Añade capas y trabaja rápido con R directo; espesor/λ quedan como detalle opcional.
                                </p>
                            </div>

                            <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-3">
                                <p className="text-[10px] font-bold uppercase text-cyan-300 mb-2">
                                    Referencias visuales mientras transcribes R y material
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                    {materialSupportSlots.map((slot) => {
                                        const data = capturas[slot.key];
                                        return (
                                            <div key={slot.key} className="rounded-md border border-slate-800 p-2 bg-slate-900/50">
                                                <div className="flex items-center justify-between mb-1">
                                                    <p className="text-[10px] text-slate-400">{slot.label}</p>
                                                    <button
                                                        onClick={() => openCapturaPreview(slot.key, slot.label)}
                                                        disabled={!data}
                                                        className="h-6 px-2 rounded bg-slate-800 text-cyan-300 border border-slate-700 hover:bg-slate-700 disabled:opacity-40 text-[10px] inline-flex items-center gap-1"
                                                    >
                                                        <ZoomIn className="h-3 w-3" />
                                                        Ampliar
                                                    </button>
                                                </div>
                                                {data ? (
                                                    <img
                                                        src={data.dataUrl}
                                                        alt={slot.label}
                                                        onClick={() => openCapturaPreview(slot.key, slot.label)}
                                                        className="w-full h-40 md:h-48 object-contain rounded border border-slate-700 bg-slate-950/40 cursor-zoom-in"
                                                        title="Click para ampliar"
                                                    />
                                                ) : (
                                                    <div className="w-full h-40 md:h-48 rounded border border-dashed border-slate-700 flex items-center justify-center text-[10px] text-slate-600">
                                                        Sin captura
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {capas.map((c, i) => {
                                const methodFilter = filtroMetodo[i] ?? "";
                                const searchTerm = (materialSearchByLayer[i] ?? "").trim().toLowerCase();
                                const onlyFavorites = !!soloFavoritosPorCapa[i];
                                const materialesFiltrados = materialesDB
                                    .filter((m) => !methodFilter || m.application_method === methodFilter)
                                    .filter((m) => !onlyFavorites || m.is_default)
                                    .filter((m) => {
                                        if (!searchTerm) return true;
                                        const haystack = `${m.nombre} ${m.marca}`.toLowerCase();
                                        return haystack.includes(searchTerm);
                                    });

                                return (
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
                                            <div className="col-span-2 md:col-span-3">
                                                <label className="text-[10px] text-slate-500 uppercase">Nombre</label>
                                                <Input
                                                    value={c.nombre}
                                                    onChange={(e) => updateCapa(i, "nombre", e.target.value)}
                                                    placeholder="Ej: Hormigón armado"
                                                    className="h-8 text-xs bg-slate-900/50 border-slate-700 text-slate-200"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-slate-500 uppercase">R directo</label>
                                                <Input
                                                    type="number"
                                                    step="0.001"
                                                    value={c.r_valor === 0 ? "" : c.r_valor}
                                                    onChange={(e) => updateCapa(i, "r_valor", e.target.value)}
                                                    placeholder="Ej: 0.18"
                                                    className="h-8 text-xs bg-slate-900/50 border-slate-700 text-slate-200 font-mono"
                                                />
                                            </div>
                                        </div>

                                        <div className="mt-2 flex flex-wrap gap-1">
                                            <button
                                                onClick={() => applyQuickPresetToLayer(i, "hormigon")}
                                                className="h-7 px-2 rounded border border-slate-700 text-[10px] text-slate-300 hover:border-slate-500"
                                            >
                                                Hormigón
                                            </button>
                                            <button
                                                onClick={() => applyQuickPresetToLayer(i, "yeso")}
                                                className="h-7 px-2 rounded border border-slate-700 text-[10px] text-slate-300 hover:border-slate-500"
                                            >
                                                Yeso
                                            </button>
                                            <button
                                                onClick={() => applyQuickPresetToLayer(i, "yeso_023")}
                                                className="h-7 px-2 rounded border border-slate-700 text-[10px] text-slate-300 hover:border-slate-500"
                                            >
                                                Yeso (0.023)
                                            </button>
                                            <button
                                                onClick={() => applyQuickPresetToLayer(i, "madera")}
                                                className="h-7 px-2 rounded border border-slate-700 text-[10px] text-slate-300 hover:border-slate-500"
                                            >
                                                Madera
                                            </button>
                                            <button
                                                onClick={() => applyQuickPresetToLayer(i, "aislante")}
                                                className="h-7 px-2 rounded border border-emerald-700/40 text-[10px] text-emerald-300 hover:border-emerald-500"
                                            >
                                                Aislante
                                            </button>
                                            <button
                                                onClick={() => setShowAdvancedByLayer((prev) => ({ ...prev, [i]: !prev[i] }))}
                                                className="h-7 px-2 rounded border border-indigo-700/40 text-[10px] text-indigo-300 hover:border-indigo-500"
                                            >
                                                {showAdvancedByLayer[i] ? "Ocultar detalles" : "Mostrar espesor/λ"}
                                            </button>
                                        </div>

                                        {showAdvancedByLayer[i] && (
                                            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                                                <div>
                                                    <label className="text-[10px] text-slate-500 uppercase">Espesor (m)</label>
                                                    <Input
                                                        type="number"
                                                        step="0.001"
                                                        value={c.espesor === 0 ? "" : c.espesor}
                                                        onChange={(e) => updateCapa(i, "espesor", e.target.value)}
                                                        className="h-8 text-xs bg-slate-900/50 border-slate-700 text-slate-200 font-mono"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-[10px] text-slate-500 uppercase">λ (W/mK)</label>
                                                    <Input
                                                        type="number"
                                                        step="0.001"
                                                        value={c.lambda_val === 0 ? "" : c.lambda_val}
                                                        onChange={(e) => updateCapa(i, "lambda_val", e.target.value)}
                                                        className="h-8 text-xs bg-slate-900/50 border-slate-700 text-slate-200 font-mono"
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        {/* Selector rápido de material CE3X (Supabase) */}
                                        {materialesDB.length > 0 && c.es_nueva && (
                                            <div className="mt-2 space-y-1">
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                    <select
                                                        className="w-full h-7 text-[10px] bg-slate-900/30 border border-slate-700/50 text-slate-400 rounded px-2"
                                                        value={methodFilter}
                                                        onChange={(e) => setFiltroMetodo(prev => ({ ...prev, [i]: e.target.value }))}
                                                    >
                                                        <option value="">Todos los métodos</option>
                                                        <option value="Insuflado">Insuflado</option>
                                                        <option value="Rollo">Rollo</option>
                                                    </select>
                                                    <Input
                                                        value={materialSearchByLayer[i] ?? ""}
                                                        onChange={(e) => setMaterialSearchByLayer((prev) => ({ ...prev, [i]: e.target.value }))}
                                                        placeholder="Buscar por nombre o marca"
                                                        className="h-7 text-[10px] bg-slate-900/40 border-slate-700 text-slate-300"
                                                    />
                                                </div>
                                                <label className="inline-flex items-center gap-2 text-[10px] text-slate-400">
                                                    <input
                                                        type="checkbox"
                                                        checked={onlyFavorites}
                                                        onChange={(e) => setSoloFavoritosPorCapa((prev) => ({ ...prev, [i]: e.target.checked }))}
                                                        className="accent-emerald-500"
                                                    />
                                                    Solo favoritos
                                                </label>
                                                <select
                                                    className="w-full h-8 text-xs bg-slate-900/50 border border-slate-700 text-slate-300 rounded-md px-2"
                                                    defaultValue=""
                                                    onChange={(e) => seleccionarMaterialDB(i, e.target.value)}
                                                >
                                                    <option value="" disabled>
                                                        {materialesFiltrados.length > 0
                                                            ? `↓ Seleccionar material CE3X... (${materialesFiltrados.length})`
                                                            : "Sin resultados con ese filtro"}
                                                    </option>
                                                    {materialesFiltrados
                                                        .map((m) => (
                                                            <option key={m.id} value={m.id}>
                                                                {m.is_default ? "★ " : ""}{m.nombre} ({m.marca}) — λ={m.lambda_w_mk}{m.application_method ? ` [${m.application_method}]` : ""}
                                                            </option>
                                                        ))}
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

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

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                <button
                                    onClick={() => addPresetLayer("hormigon", false)}
                                    className="h-8 rounded-md border border-slate-700 text-slate-300 hover:border-slate-500 text-[11px]"
                                >
                                    + Hormigón
                                </button>
                                <button
                                    onClick={() => addPresetLayer("yeso", false)}
                                    className="h-8 rounded-md border border-slate-700 text-slate-300 hover:border-slate-500 text-[11px]"
                                >
                                    + Yeso
                                </button>
                                <button
                                    onClick={() => addPresetLayer("madera", false)}
                                    className="h-8 rounded-md border border-slate-700 text-slate-300 hover:border-slate-500 text-[11px]"
                                >
                                    + Madera
                                </button>
                                <button
                                    onClick={() => addPresetLayer("aislante", true)}
                                    className="h-8 rounded-md border border-emerald-700/40 text-emerald-300 hover:border-emerald-500 text-[11px]"
                                >
                                    + Aislante mejora
                                </button>
                            </div>

                            <div className="rounded-md border border-slate-800 bg-slate-900/20 p-2 space-y-2">
                                <p className="text-[10px] uppercase font-bold text-slate-400">Plantillas rápidas para tu lote</p>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                    <button
                                        onClick={() => applyCommonLayerSet("yeso")}
                                        className="h-8 rounded-md border border-slate-700 text-slate-200 hover:border-slate-500 text-[11px]"
                                    >
                                        YESO
                                    </button>
                                    <button
                                        onClick={() => applyCommonLayerSet("hormigon_yeso")}
                                        className="h-8 rounded-md border border-slate-700 text-slate-200 hover:border-slate-500 text-[11px]"
                                    >
                                        HORMIGÓN + YESO
                                    </button>
                                    <button
                                        onClick={() => applyCommonLayerSet("madera_yeso")}
                                        className="h-8 rounded-md border border-slate-700 text-slate-200 hover:border-slate-500 text-[11px]"
                                    >
                                        MADERA + YESO
                                    </button>
                                </div>
                                <button
                                    onClick={() => void loadSupafilFichaTecnica()}
                                    className="w-full h-8 rounded-md border border-cyan-700/40 text-cyan-300 hover:border-cyan-500 text-[11px]"
                                >
                                    Cargar ficha técnica SUPAFIL en Capturas
                                </button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Validar Capturas de CE3X */}
                    {(capturas.ce3x_antes?.dataUrl || capturas.ce3x_despues?.dataUrl) && (
                        <Card className="bg-slate-900/40 border-slate-800">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-lg text-slate-200 flex items-center gap-2">
                                    <ZoomIn className="h-5 w-5 text-indigo-400" />
                                    Referencias visuales (CE3X)
                                </CardTitle>
                                <CardDescription className="text-slate-500">
                                    Verifica la información mientras transcribes los parámetros del proyecto.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                     {capturas.ce3x_antes?.dataUrl && (
                                         <div className="space-y-2 text-center cursor-zoom-in group border border-slate-700/50 p-2 rounded-lg bg-slate-900/50 hover:border-slate-500 transition-colors" onClick={() => openCapturaPreview("ce3x_antes", "CE3X Antes")}>
                                             <div className="w-full h-40 max-h-48 rounded-md overflow-hidden relative border border-slate-700 bg-black">
                                                 <img src={capturas.ce3x_antes.dataUrl} className="w-full h-full object-contain opacity-90 group-hover:opacity-100 transition-opacity" />
                                                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/40 transition-opacity text-white text-sm font-bold">Ampliar</div>
                                             </div>
                                             <p className="text-xs text-slate-400 font-bold uppercase">Estado Actual (CE3X Antes)</p>
                                         </div>
                                     )}
                                     {capturas.ce3x_despues?.dataUrl && (
                                         <div className="space-y-2 text-center cursor-zoom-in group border border-slate-700/50 p-2 rounded-lg bg-slate-900/50 hover:border-slate-500 transition-colors" onClick={() => openCapturaPreview("ce3x_despues", "CE3X Después")}>
                                             <div className="w-full h-40 max-h-48 rounded-md overflow-hidden relative border border-slate-700 bg-black">
                                                 <img src={capturas.ce3x_despues.dataUrl} className="w-full h-full object-contain opacity-90 group-hover:opacity-100 transition-opacity" />
                                                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/40 transition-opacity text-white text-sm font-bold">Ampliar</div>
                                             </div>
                                             <p className="text-xs text-slate-400 font-bold uppercase">Estado Mejorado (CE3X Después)</p>
                                         </div>
                                     )}
                                </div>
                            </CardContent>
                        </Card>
                    )}

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
                                    <Input type="number" step="0.01" value={areaHNH} onChange={(e) => { setAreaHNH(e.target.value as any); setSupActuacion(e.target.value as any); }} className="h-9 bg-slate-900/50 border-slate-700 text-slate-200 font-mono" />
                                </div>
                                <div>
                                    <label className="text-[10px] text-amber-400 uppercase font-bold">Superficie Cubierta (m²)</label>
                                    <p className="text-[9px] text-slate-600 mb-1">Límite para coef. b</p>
                                    <Input type="number" step="0.01" value={areaNHE} onChange={(e) => setAreaNHE(e.target.value as any)} className="h-9 bg-slate-900/50 border-slate-700 text-slate-200 font-mono" />
                                </div>
                                <div>
                                    <label className="text-[10px] text-slate-500 uppercase font-bold">Envolvente Total (m²)</label>
                                    <p className="text-[9px] text-slate-600 mb-1">Sin cubiertas</p>
                                    <Input type="number" step="0.01" value={supEnvolvente} onChange={(e) => setSupEnvolvente(e.target.value as any)} className="h-9 bg-slate-900/50 border-slate-700 text-slate-200 font-mono" />
                                </div>
                                <div className="col-span-1 md:col-span-1">
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
                                    {alturaMsnm && Number(alturaMsnm) > 1000 && (
                                        <p className="text-[9px] text-amber-400 mt-1">
                                            ¡Ojo! Altura ({alturaMsnm}m) alta. Revisa si cambia la severidad.
                                        </p>
                                    )}
                                </div>
                                <div className="col-span-1 md:col-span-1">
                                    <label className="text-[10px] text-slate-500 uppercase font-bold">Altura (msnm)</label>
                                    <p className="text-[9px] text-slate-600 mb-1">Impacta zona C.T.E.</p>
                                    <Input
                                        type="number"
                                        value={alturaMsnm}
                                        onChange={(e) => setAlturaMsnm(e.target.value)}
                                        className="h-9 bg-slate-900/50 border-slate-700 text-slate-200 font-mono"
                                        placeholder="Ej: 600"
                                    />
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
                            <div className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900/30 px-3 py-2">
                                <div>
                                    <p className="text-xs text-slate-300 font-semibold">Ventilación anclada (Sincronizada)</p>
                                    <p className="text-[10px] text-slate-500">Al cambiar el caso ANTES, el caso DESPUÉS se ajustará igual.</p>
                                </div>
                                <button
                                    onClick={() => {
                                        setVentilationLocked((prev) => {
                                            if (!prev) setCaseF(caseI); // Sync immediately upon locking
                                            return !prev;
                                        });
                                    }}
                                    className={`h-8 px-3 rounded-md border text-xs ${ventilationLocked
                                        ? "border-emerald-700/40 text-emerald-300 bg-emerald-900/20"
                                        : "border-amber-700/40 text-amber-300 bg-amber-900/20"
                                        }`}
                                >
                                    {ventilationLocked ? "Anclada" : "Editable"}
                                </button>
                            </div>

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
                                        onChange={(e) => {
                                            const val = e.target.value as Caso;
                                            setCaseI(val);
                                            if (ventilationLocked) setCaseF(val);
                                        }}
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
                                        disabled={ventilationLocked}
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
                    {/* Resumen de Superficies CEE */}
                    <div className="grid grid-cols-1 gap-4">
                        <Card className="bg-slate-900/40 border-slate-800">
                            <CardHeader className="pb-2">
                                <CardTitle className="text-[11px] text-slate-400 uppercase font-bold flex items-center justify-between">
                                    <span className="flex items-center gap-1"><ZoomIn className="h-3 w-3" /> Resumen CEE Inicial</span>
                                    {capturas.cee_inicial?.dataUrl && (
                                        <span className="text-[9px] text-emerald-400">Captura vinculada</span>
                                    )}
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3 p-3">
                                 {capturas.cee_inicial?.dataUrl && (
                                    <div className="w-full h-40 rounded overflow-hidden relative border border-slate-700 bg-black cursor-zoom-in group" onClick={() => openCapturaPreview("cee_inicial", "Etiqueta CEE Inicial")}>
                                        <img src={capturas.cee_inicial.dataUrl} className="w-full h-full object-contain opacity-80 group-hover:opacity-100 transition-opacity" />
                                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/40 transition-opacity text-white text-xs font-bold">Ver Completa</div>
                                    </div>
                                )}
                                <div
                                    className="space-y-2 text-xs text-slate-300 bg-slate-900/50 rounded-lg border border-slate-800 overflow-hidden"
                                >
                                    <button
                                        onClick={() => setDesgloseOpen(!desgloseOpen)}
                                        className="w-full flex items-center justify-between px-3 py-2 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
                                    >
                                        <span>Desglose de envolvente (del XML CE3X importado)</span>
                                        <span className="text-[9px]">{desgloseOpen ? "▲ Minimizar" : "▼ Expandir"}</span>
                                    </button>
                                    {desgloseOpen && (
                                        <div className="px-3 pb-3 space-y-3">
                                            {(supOpacos > 0 || supHuecos > 0) ? (
                                                <>
                                                    {elementosOpacosList.length > 0 && (
                                                        <div className="space-y-1">
                                                            <div className="flex justify-between items-center bg-slate-800/80 p-1 rounded">
                                                                <span className="text-[11px] text-slate-300 font-semibold px-1">Cerramientos Opacos</span>
                                                                <span className="font-mono text-[11px] font-bold text-slate-300 mr-1">{Number(supOpacos).toFixed(2)} m²</span>
                                                            </div>
                                                            <div className="overflow-x-auto rounded border border-slate-800">
                                                                <table className="w-full text-[10px] text-left">
                                                                    <thead className="bg-slate-900/80 text-slate-400">
                                                                        <tr>
                                                                            <th className="py-1 px-2 font-medium">Nombre</th>
                                                                            <th className="py-1 px-2 font-medium">Tipo</th>
                                                                            <th className="py-1 px-2 font-medium text-right">Sup.</th>
                                                                            <th className="py-1 px-2 font-medium text-right">U</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody className="divide-y divide-slate-800/80 bg-slate-900/30">
                                                                        {elementosOpacosList.map((el, i) => (
                                                                            <tr key={i} className="text-slate-300 hover:bg-slate-800/50 transition-colors">
                                                                                <td className="py-1 px-2 truncate max-w-[120px]" title={el.nombre}>{el.nombre}</td>
                                                                                <td className="py-1 px-2 truncate max-w-[80px] text-slate-500" title={el.tipo}>{el.tipo}</td>
                                                                                <td className="py-1 px-2 text-right font-mono">{el.superficie.toFixed(2)}</td>
                                                                                <td className="py-1 px-2 text-right font-mono text-slate-500">{el.transmitancia ? el.transmitancia.toFixed(2) : "—"}</td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {elementosHuecosList.length > 0 && (
                                                        <div className="space-y-1">
                                                            <div className="flex justify-between items-center bg-slate-800/80 p-1 rounded mt-2">
                                                                <span className="text-[11px] text-slate-300 font-semibold px-1">Huecos y Lucernarios</span>
                                                                <span className="font-mono text-[11px] font-bold text-slate-300 mr-1">{Number(supHuecos).toFixed(2)} m²</span>
                                                            </div>
                                                            <div className="overflow-x-auto rounded border border-slate-800">
                                                                <table className="w-full text-[10px] text-left">
                                                                    <thead className="bg-slate-900/80 text-slate-400">
                                                                        <tr>
                                                                            <th className="py-1 px-2 font-medium">Nombre</th>
                                                                            <th className="py-1 px-2 font-medium text-right">Sup.</th>
                                                                            <th className="py-1 px-2 font-medium text-right">U</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody className="divide-y divide-slate-800/80 bg-slate-900/30">
                                                                        {elementosHuecosList.map((el, i) => (
                                                                            <tr key={i} className="text-slate-300 hover:bg-slate-800/50 transition-colors">
                                                                                <td className="py-1 px-2 truncate max-w-[140px]" title={el.nombre}>{el.nombre}</td>
                                                                                <td className="py-1 px-2 text-right font-mono">{el.superficie.toFixed(2)}</td>
                                                                                <td className="py-1 px-2 text-right font-mono text-slate-500">{el.transmitancia ? el.transmitancia.toFixed(2) : "—"}</td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {Number(areaNHE) > 0 && (
                                                        <div className="flex justify-between bg-cyan-950/30 border border-cyan-900/50 rounded py-1.5 px-2 mt-2">
                                                            <span className="text-cyan-400 font-semibold text-[11px]">Cubierta (no suma):</span>
                                                            <span className="font-mono font-bold text-cyan-300 text-[11px]">{Number(areaNHE).toFixed(2)} m²</span>
                                                        </div>
                                                    )}
                                                    <div className="flex justify-between items-center bg-amber-950/30 border border-amber-900/50 rounded py-1.5 px-2 mt-2">
                                                        <span className="text-amber-500 font-bold text-[11px] uppercase">Envolvente Total:</span>
                                                        <span className="font-mono font-bold text-amber-400 text-xs">{Number(supEnvolvente).toFixed(2)} m²</span>
                                                    </div>
                                                </>
                                            ) : (
                                                <p className="text-[10px] text-slate-600 italic text-center py-2">Importa un XML CE3X para ver el desglose detallado.</p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </div>

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

            {capturaPreview && (
                <div
                    className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm p-4 md:p-8 flex items-center justify-center"
                    onClick={() => setCapturaPreview(null)}
                >
                    <div
                        className="w-full max-w-6xl max-h-[92vh] rounded-xl border border-slate-700 bg-slate-950 shadow-2xl p-3 md:p-4 flex flex-col gap-3"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-sm font-semibold text-cyan-300">{capturaPreview.label}</p>
                                <p className="text-[11px] text-slate-500">{capturaPreview.fileName}</p>
                            </div>
                            <button
                                onClick={() => setCapturaPreview(null)}
                                className="h-8 w-8 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 inline-flex items-center justify-center"
                                title="Cerrar"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        <div className="flex-1 min-h-0 rounded-lg border border-slate-800 bg-black/40 p-2 overflow-auto">
                            <img
                                src={capturaPreview.dataUrl}
                                alt={capturaPreview.label}
                                className="w-full max-h-[78vh] object-contain rounded"
                            />
                        </div>
                    </div>
                </div>
            )}
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
