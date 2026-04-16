import { useState, useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from "react";
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
    CheckCircle,
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
import { calcularDbHeRemoto, warmUpCloudApi } from "./lib/apiClient";
import { generarPDFAnexoE1 } from "./lib/anexoE1Generator";
import { generarCertificadoE1_3_5_DOCX } from "./lib/docxE1_3_5_Generator";
import {
    buildIntelliaCertificateFilename,
    buildIntelliaCertificateText,
    generarPDFCertificadoIntellia,
    type IntelliaCertificateTemplateInput,
} from "./lib/intelliaCertificatePdf";
import {
    getCurrentOrganizationId,
    getExpedienteMvpByRc,
    supabase,
    upsertExpedienteMvp,
    type ExpedienteStatus,
} from "./lib/supabase";
import {
    countOfflineExpedienteWrites,
    upsertOfflineExpedienteWrite,
} from "./lib/offlineQueue";
import { db } from "./infra/db/OmniCatastroDB";
import { clientSyncService } from "./lib/clientSyncService";
import {
    announceExpedienteTabWrite,
    EXPEDIENTE_NEEDS_RESOLUTION_EVENT,
    flushOfflineExpedienteQueueNow,
    isExpedienteMvpSyncEnabled,
    resolveQueuedConflictWithLocalWins,
    resolveQueuedConflictWithRemoteWins,
    startExpedienteMvpSyncLoop,
    type ExpedienteNeedsResolutionDetail,
    type ExpedienteSyncReport,
    type SyncReason,
} from "./lib/syncService";
import { fetchAltitudeAndProvince } from "./lib/climateZoneVerifier";
import { consultarCatastro, esParcerlaMultiple, extraerDatosInmuebleUnico, fetchLointDataFromRC } from "./lib/catastroService";
import { CertificadoCapturasPanelControlado, createEmptyCapturasState, type CapturasState } from "./components/CertificadoCapturasPanel";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Badge } from "./components/ui/badge";
import { ModoSwitch, useModoExperto } from "./components/ModoSwitch";
import { GestionLotesSheet } from "./components/GestionLotesSheet";
import { CertificadoSuccessState } from "./components/CertificadoSuccessState";
import { Button } from "./components/ui/button";
import { HojaEncargoModal } from "./components/HojaEncargoModal";

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
    comunidadAutonoma: string;
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

function isCubiertaTipo(tipo: string): boolean {
    return normalizeTextKey(tipo).includes("CUBIERTA");
}

function isParticionHorizontalTipo(tipo: string): boolean {
    const tipoNorm = normalizeTextKey(tipo);
    return tipoNorm.includes("PARTICIONINTERIORHORIZONTAL")
        || (tipoNorm.includes("PARTICION") && tipoNorm.includes("HORIZONTAL"));
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

    const docInmueble = doc.querySelector("IdentificacionEdificio") || doc.querySelector("DatosDelInmueble") || doc.querySelector("Entrada") || doc;
    const zonaRaw = queryText(docInmueble, ["ZonaClimatica"]);
    const zonaKey = zonaRaw === "α3" ? "alpha3" : zonaRaw;

    const rc = queryText(docInmueble, ["ReferenciaCatastral", "RefCatastral"]) || "";
    const comunidadAutonoma = queryText(docInmueble, [
        "ComunidadAutonoma",
        "ComunidadAutonomaDescripcion",
        "Comunidad",
        "CCAA",
    ]) || "";
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

        if (isCubiertaTipo(tipoNorm)) {
            superficieCubierta += sup;
            // Cubierta se muestra aparte, NO suma a envolvente ni opacos
        } else {
            if (isParticionHorizontalTipo(tipoNorm)) {
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
    }

    // Envolvente para cálculo/ratio: opacos sin cubierta.
    // Los huecos se registran y muestran aparte para evitar doble conteo
    // en XML CE3X donde los muros pueden venir ya con huecos incorporados.

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
        comunidadAutonoma,
        provincia,
        municipio,
        direccion,
        codigoPostal,
        elementosOpacosData,
        elementosHuecosData,
    };
}

function buildXmlImportSummary(parsed: ParsedCE3X): string {
    const parts = ["XML CE3X importado."];
    const sTotal = roundTo(parsed.superficieEnvolvente, 2);
    const huecos = roundTo(parsed.superficieHuecos, 2);
    const opacosNetosEstimados = roundTo(Math.max(sTotal - huecos, 0), 2);

    if (parsed.clienteNombre) {
        parts.push(`Cliente XML: ${parsed.clienteNombre}.`);
    } else {
        parts.push("Cliente: completar manualmente (el XML no suele traerlo fiable).",);
    }

    if (parsed.comunidadAutonoma) {
        parts.push(`CCAA XML: ${parsed.comunidadAutonoma}.`);
    }

    parts.push(
        `Envolvente útil (opacos sin cubierta): ${parsed.superficieEnvolvente.toFixed(2)} m².`,
    );
    parts.push(`Huecos (informativo): ${parsed.superficieHuecos.toFixed(2)} m².`);
    if (huecos > 0 && sTotal >= huecos) {
        parts.push(
            `Desglose equivalente CEE: ${opacosNetosEstimados.toFixed(2)} + ${huecos.toFixed(2)} = ${sTotal.toFixed(2)} m² (opacos netos + huecos).`,
        );
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
const CERT_ARCHIVE_INDEX_FILENAME = "_archived_index.json";
const CERT_IMPORT_AUDIT_FILENAME = "_import_audit.json";
const CERT_ISSUED_INDEX_FILENAME = "_issued_index.json";
const CERT_ISSUED_FOLDER = "emitidos";
const BACKUP_ZIP_VERSION = 2;
const LEGACY_CERT_PREFIX = "cert_";
const ENABLE_EXPEDIENTE_MVP_RPC = String(import.meta.env.VITE_EXPEDIENTES_RPC_ENABLED ?? "false").toLowerCase() === "true";

type CertDraftStatus = "pendiente" | "en_progreso" | "completado";
type MvpSyncUiStatus = "idle" | "queued" | "synced" | "conflict" | "error";
type ImportMergeStrategy = "overwrite" | "skip" | "merge";
type ImportAuditAction = "created" | "overwritten" | "merged" | "skipped" | "invalid" | "failed";

interface BatchProgress {
    mode: "export" | "import" | "repair";
    phase: string;
    current: number;
    total: number;
    detail?: string;
}

interface CatastroVerificationBanner {
    tone: "ok" | "warning" | "info";
    message: string;
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

type IssuedCertificateType = "anexo_e1_pdf" | "intellia_pdf";

interface IssuedCertificateRecord {
    id: string;
    rc: string;
    type: IssuedCertificateType;
    fileName: string;
    storagePath: string;
    issuedAt: string;
    clienteNombre: string;
    clienteDni: string;
    zonaKey: string;
    alturaMsnm: string;
    ahorroKwh: number;
}

interface GeneratedCertificatePdf {
    fileName: string;
    blob: Blob;
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

type QuickLayerPresetId = "hormigon" | "yeso" | "yeso_023" | "yeso_018" | "madera" | "aislante";

type CommonLayerSetId = "yeso" | "hormigon_yeso" | "madera_yeso";

const SUPAFIL_FICHA_PUBLIC_PATH = "/fichas_tecnicas/SUPAFIL_Loft_045.jpg";
const SUPAFIL_FICHA_FILE_NAME = "SUPAFIL_Loft_045.jpg";

const QUICK_LAYER_PRESETS: Record<QuickLayerPresetId, { nombre: string; r: number; espesor: number; lambda: number }> = {
    hormigon: { nombre: "Hormigón armado d > 2500", r: 0.04, espesor: 0.1, lambda: 2.5 },
    yeso: { nombre: "Yeso, de alta dureza 1200 < d < 1500", r: 0.036, espesor: 0.02, lambda: 0.56 },
    yeso_023: { nombre: "Yeso, de alta dureza 900 < d < 1200", r: 0.023, espesor: 0.01, lambda: 0.43 },
    yeso_018: { nombre: "Yeso, de alta dureza 1200 < d < 1500", r: 0.018, espesor: 0.01, lambda: 0.56 },
    madera: { nombre: "Frondosa muy pesada [d > 870]", r: 0.069, espesor: 0.02, lambda: 0.29 },
    aislante: { nombre: "SUPAFIL 23", r: 5.111, espesor: 0.23, lambda: 0.045 },
};

const COMMON_LAYER_SETS: Record<CommonLayerSetId, Array<{ preset: QuickLayerPresetId; esNueva: boolean }>> = {
    yeso: [{ preset: "yeso", esNueva: false }],
    hormigon_yeso: [
        { preset: "hormigon", esNueva: false },
        { preset: "yeso_023", esNueva: false },
    ],
    madera_yeso: [
        { preset: "madera", esNueva: false },
        { preset: "yeso_018", esNueva: false },
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

function sanitizeSegmentForPath(value: string, fallback: string): string {
    const cleaned = value
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return cleaned || fallback;
}

function normalizeLocationText(value: string): string {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .replace(/\bC\/?\b/g, "CALLE")
        .replace(/\bCL\b/g, "CALLE")
        .replace(/\bAVDA\b/g, "AVENIDA")
        .replace(/\bAV\b/g, "AVENIDA")
        .replace(/[^A-Z0-9]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function locationValuesMatch(xmlValue: string, catastroValue: string): boolean {
    const xml = normalizeLocationText(xmlValue);
    const catastro = normalizeLocationText(catastroValue);

    if (!xml || !catastro) return false;
    if (xml === catastro) return true;

    // Some Catastro strings are abbreviated/extended compared to CE3X.
    return xml.includes(catastro) || catastro.includes(xml);
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

function pickMostRecentIndexItem(a: CertificateDraftIndexItem, b: CertificateDraftIndexItem): CertificateDraftIndexItem {
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

function getArchiveIndexPath(organizationId: string): string {
    return `${organizationId}/${CERT_DRAFT_FOLDER}/${CERT_ARCHIVE_INDEX_FILENAME}`;
}

function getImportAuditPath(organizationId: string): string {
    return `${organizationId}/${CERT_DRAFT_FOLDER}/${CERT_IMPORT_AUDIT_FILENAME}`;
}

function getIssuedIndexPath(organizationId: string): string {
    return `${organizationId}/${CERT_DRAFT_FOLDER}/${CERT_ISSUED_INDEX_FILENAME}`;
}

function getLegacyIssuedIndexPath(organizationId: string): string {
    return `${CERT_DRAFT_FOLDER}/${organizationId}/${CERT_ISSUED_INDEX_FILENAME}`;
}

function getIssuedPdfPath(organizationId: string, rc: string, fileName: string): string {
    const safeRc = sanitizeSegmentForPath(normalizeRc(rc), "SIN_RC");
    const safeFileName = sanitizeSegmentForPath(fileName, "certificado.pdf");
    return `${organizationId}/${CERT_DRAFT_FOLDER}/${CERT_ISSUED_FOLDER}/${safeRc}/${safeFileName}`;
}

function getLegacyDraftPath(organizationId: string, rc: string): string {
    return `${CERT_DRAFT_FOLDER}/${organizationId}/${normalizeRc(rc)}.json`;
}

function getLegacyPrefixedDraftPath(organizationId: string, rc: string): string {
    return `${CERT_DRAFT_FOLDER}/${organizationId}/${LEGACY_CERT_PREFIX}${normalizeRc(rc)}.json`;
}

function getCurrentPrefixedDraftPath(organizationId: string, rc: string): string {
    return `${organizationId}/${CERT_DRAFT_FOLDER}/${LEGACY_CERT_PREFIX}${normalizeRc(rc)}.json`;
}

function getLegacyIndexPath(organizationId: string): string {
    return `${CERT_DRAFT_FOLDER}/${organizationId}/${CERT_INDEX_FILENAME}`;
}

function getLegacyArchiveIndexPath(organizationId: string): string {
    return `${CERT_DRAFT_FOLDER}/${organizationId}/${CERT_ARCHIVE_INDEX_FILENAME}`;
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

interface ExpedienteMvpSyncMeta {
    expedienteId: string;
    versionToken: string;
}

interface CalcFingerprintInput {
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
    modoCE3X: boolean;
    overrideUi: string;
    overrideUf: string;
}

function normalizeCalcFingerprintNumber(value: number | string | undefined | null): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return roundTo(parsed, 6);
}

function buildCalcFingerprint(input: CalcFingerprintInput): string {
    return JSON.stringify({
        capas: input.capas.map((capa) => ({
            nombre: (capa.nombre || "").trim(),
            espesor: normalizeCalcFingerprintNumber(capa.espesor),
            lambda_val: normalizeCalcFingerprintNumber(capa.lambda_val),
            r_valor: normalizeCalcFingerprintNumber(capa.r_valor),
            es_nueva: !!capa.es_nueva,
        })),
        areaHNH: normalizeCalcFingerprintNumber(input.areaHNH),
        areaNHE: normalizeCalcFingerprintNumber(input.areaNHE),
        supActuacion: normalizeCalcFingerprintNumber(input.supActuacion),
        supEnvolvente: normalizeCalcFingerprintNumber(input.supEnvolvente),
        zonaKey: input.zonaKey,
        scenarioI: input.scenarioI,
        scenarioF: input.scenarioF,
        caseI: input.caseI,
        caseF: input.caseF,
        modoCE3X: !!input.modoCE3X,
        overrideUi: input.overrideUi.trim(),
        overrideUf: input.overrideUf.trim(),
    });
}

export function CalculadoraTermica() {
    const { isExperto } = useModoExperto();
    const [isLotesSheetOpen, setIsLotesSheetOpen] = useState(false);
    const [isHojaEncargoModalOpen, setIsHojaEncargoModalOpen] = useState(false);
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
    const [lastCalculatedFingerprint, setLastCalculatedFingerprint] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [intelliaTemplateCopied, setIntelliaTemplateCopied] = useState(false);
    const [cloudReportText, setCloudReportText] = useState<string | null>(null);
    const [cloudReportCopied, setCloudReportCopied] = useState(false);
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
    
    // Remote Calculation Toggle
    const [isCloudCalculation, setIsCloudCalculation] = useState(true);
    const [isCalculating, setIsCalculating] = useState(false);

    const [clienteFirstName, setClienteFirstName] = useState("");
    const [clienteMiddleName, setClienteMiddleName] = useState("");
    const [clienteLastName1, setClienteLastName1] = useState("");
    const [clienteLastName2, setClienteLastName2] = useState("");
    const [clienteDni, setClienteDni] = useState("");
    const [clienteDireccionDni, setClienteDireccionDni] = useState("");
    const [xmlImportMsg, setXmlImportMsg] = useState<string | null>(null);
    const [catastroVerificationBanner, setCatastroVerificationBanner] = useState<CatastroVerificationBanner | null>(null);
    const [xmlFileName, setXmlFileName] = useState("");
    const [direccionInmueble, setDireccionInmueble] = useState("");
    const [municipioInmueble, setMunicipioInmueble] = useState("");
    const [cpInmueble, setCpInmueble] = useState("");
    const [provinciaInmueble, setProvinciaInmueble] = useState("");
    const [buscandoDni, setBuscandoDni] = useState(false);
    const [dniLookupMsg, setDniLookupMsg] = useState<string | null>(null);
    const [dniFlipped, setDniFlipped] = useState(false);
    const [capturaPreview, setCapturaPreview] = useState<{
        label: string;
        fileName: string;
        dataUrl: string;
    } | null>(null);
    const [draftQueue, setDraftQueue] = useState<CertificateDraftIndexItem[]>([]);
    const [archivedQueue, setArchivedQueue] = useState<CertificateDraftIndexItem[]>([]);
    const [issuedCertificatesCount, setIssuedCertificatesCount] = useState(0);
    const [showArchivedQueuePanel, setShowArchivedQueuePanel] = useState(false);
    const [isMoreOptionsOpen, setIsMoreOptionsOpen] = useState(false);
    const moreOptionsRef = useRef<HTMLDivElement>(null);
    const [queueSearch, setQueueSearch] = useState("");
    const [archivedSearch, setArchivedSearch] = useState("");
    const [draftLoading, setDraftLoading] = useState(false);
    const [draftSaving, setDraftSaving] = useState(false);
    const [draftMsg, setDraftMsg] = useState<string | null>(null);
    const [draftError, setDraftError] = useState<string | null>(null);
    const [draftStorageOrgId, setDraftStorageOrgId] = useState<string | null>(null);
    const [mvpSyncStatus, setMvpSyncStatus] = useState<MvpSyncUiStatus>("idle");
    const [mvpSyncPendingCount, setMvpSyncPendingCount] = useState(0);
    const [pendingConflictResolution, setPendingConflictResolution] = useState<ExpedienteNeedsResolutionDetail | null>(null);
    const [conflictDecisionBusy, setConflictDecisionBusy] = useState(false);
    const [backupImportStrategy, setBackupImportStrategy] = useState<ImportMergeStrategy>("merge");
    const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
    const latestResultadoRef = useRef<ResultadoTermico | null>(null);
    const cancelBatchRef = useRef(false);
    const expedienteMvpMetaRef = useRef<Record<string, ExpedienteMvpSyncMeta>>({});

    const currentCalcFingerprint = useMemo(() => buildCalcFingerprint({
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
        modoCE3X,
        overrideUi,
        overrideUf,
    }), [
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
        modoCE3X,
        overrideUi,
        overrideUf,
    ]);

    const resultadoDesactualizado = Boolean(resultado) && currentCalcFingerprint !== lastCalculatedFingerprint;
    const outputActionsDisabled = isCalculating || resultadoDesactualizado;
    const outputActionDisabledTitle = resultadoDesactualizado
        ? "Resultado desactualizado: vuelve a calcular antes de generar o copiar salidas."
        : "Calculando... espera a que finalice el proceso.";

    useEffect(() => {
        latestResultadoRef.current = resultado;
    }, [resultado]);

    useEffect(() => {
        if (!isCloudCalculation) {
            return;
        }

        void warmUpCloudApi();
        const keepAliveId = window.setInterval(() => {
            void warmUpCloudApi();
        }, 8 * 60 * 1000);

        return () => window.clearInterval(keepAliveId);
    }, [isCloudCalculation]);

    const applySyncReportToUi = (report: ExpedienteSyncReport) => {
        setMvpSyncPendingCount(report.pending);

        if (report.conflicts > 0) {
            setMvpSyncStatus("conflict");
        } else if (report.errors > 0) {
            setMvpSyncStatus("error");
        } else if (report.pending > 0) {
            setMvpSyncStatus("queued");
        } else if (report.synced > 0) {
            setMvpSyncStatus("synced");
        } else {
            setMvpSyncStatus("idle");
        }
    };

    const resolvePendingConflict = async (decision: "local_wins" | "remote_wins") => {
        if (!pendingConflictResolution) return;

        setConflictDecisionBusy(true);
        setDraftError(null);

        try {
            const report = decision === "local_wins"
                ? await resolveQueuedConflictWithLocalWins(pendingConflictResolution)
                : await resolveQueuedConflictWithRemoteWins(pendingConflictResolution);

            setPendingConflictResolution(null);
            applySyncReportToUi(report);

            if (decision === "local_wins") {
                setDraftMsg(
                    `Se priorizó tu versión local para ${pendingConflictResolution.rc}. Reintentando sincronización SQL MVP.`,
                );
            } else {
                setDraftMsg(
                    `Se aceptó la versión remota para ${pendingConflictResolution.rc}. El cambio local se descartó de la cola SQL.`,
                );
            }
        } catch (error: any) {
            setDraftError(error?.message ?? "No se pudo resolver el conflicto seleccionado.");
        } finally {
            setConflictDecisionBusy(false);
        }
    };

    useEffect(() => {
        if (!isExpedienteMvpSyncEnabled() || typeof window === "undefined") return;

        const handleNeedsResolution = (event: Event) => {
            const detail = (event as CustomEvent<ExpedienteNeedsResolutionDetail>).detail;
            if (!detail) return;

            setPendingConflictResolution(detail);
            setMvpSyncStatus("conflict");
            setDraftError(`Conflicto de versión detectado en ${detail.rc}. Elige qué versión conservar.`);
        };

        window.addEventListener(EXPEDIENTE_NEEDS_RESOLUTION_EVENT, handleNeedsResolution as EventListener);
        return () => {
            window.removeEventListener(EXPEDIENTE_NEEDS_RESOLUTION_EVENT, handleNeedsResolution as EventListener);
        };
    }, []);

    useEffect(() => {
        if (!isExpedienteMvpSyncEnabled()) return;

        let cancelled = false;

        const refreshPending = async () => {
            const pending = await countOfflineExpedienteWrites();
            if (cancelled) return;
            setMvpSyncPendingCount(pending);
            setMvpSyncStatus(pending > 0 ? "queued" : "idle");
        };

        void refreshPending();

        const stop = startExpedienteMvpSyncLoop((report, reason: SyncReason) => {
            if (cancelled) return;

            applySyncReportToUi(report);

            if (reason === "interval") return;

            if (report.synced > 0) {
                setDraftMsg(`Sincronización SQL MVP: ${report.synced} pendiente(s) enviados. Pendientes: ${report.pending}.`);
            }

            if (report.conflicts > 0) {
                setDraftError(`Hay ${report.conflicts} conflicto(s) de versión en la cola SQL MVP.`);
            }
        });

        return () => {
            cancelled = true;
            stop();
        };
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const raw = window.localStorage.getItem(CALC_STATE_STORAGE_KEY);
            if (!raw) return;

            // Inicia siempre con formulario limpio para evitar arrastre de estado parcial.
            // La cola (activo/archivado) sigue cargando desde nube y los borradores se
            // abren solo por acción explícita del usuario.
            window.localStorage.removeItem(CALC_STATE_STORAGE_KEY);
        } catch {
            // Si localStorage falla, no bloquear la UI.
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
        setLastCalculatedFingerprint(null);
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

        setBuscandoDni(true);
        try {
            // ── 1. Búsqueda LOCAL-FIRST en Dexie (funciona offline) ──
            const localClient = await db.clientes.where('nif').equals(dni).first();
            if (localClient) {
                // Separar nombre/apellidos almacenados como strings compuestos
                const nameParts = (localClient.nombre || "").split(" ");
                const surnameParts = (localClient.apellidos || "").split(" ");
                setClienteFirstName(nameParts[0] || "");
                setClienteMiddleName(nameParts.slice(1).join(" ") || "");
                setClienteLastName1(surnameParts[0] || "");
                setClienteLastName2(surnameParts.slice(1).join(" ") || "");
                const fullName = `${localClient.nombre} ${localClient.apellidos}`.trim();
                setDniLookupMsg(`📱 Cliente cargado desde local: ${fullName}`);
                return;
            }

            // ── 2. Fallback a Supabase (si está configurado y hay red) ──
            if (!supabase) {
                setDniLookupMsg("No existe en local. Supabase no configurado.");
                return;
            }

            const { data, error } = await supabase
                .from("clients")
                .select("id, first_name, middle_name, last_name_1, last_name_2, dni, dni_address")
                .eq("dni", dni)
                .limit(1)
                .maybeSingle();

            if (error) {
                setDniLookupMsg("No se pudo consultar la base remota de clientes.");
                return;
            }

            const client = data as ClienteBasico | null;
            if (!client) {
                setDniLookupMsg("No existe ese DNI ni en local ni en la nube. Puedes seguir manual.");
                return;
            }

            setClienteFirstName(client.first_name || "");
            setClienteMiddleName(client.middle_name || "");
            setClienteLastName1(client.last_name_1 || "");
            setClienteLastName2(client.last_name_2 || "");
            if (client.dni_address) setClienteDireccionDni(client.dni_address);

            const fullName = [client.first_name, client.middle_name, client.last_name_1, client.last_name_2].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
            setDniLookupMsg(`☁️ Cliente cargado desde la nube: ${fullName || client.dni}`);
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
        if (!clienteFirstName.trim() || !clienteLastName1.trim()) { setDniLookupMsg("Introduce al menos primer nombre y primer apellido."); return; }

        setSavingCliente(true);
        try {
            const first_name = clienteFirstName.trim();
            const middle_name = clienteMiddleName.trim() || "";
            const last_name_1 = clienteLastName1.trim();
            const last_name_2 = clienteLastName2.trim() || "";
            const apellidos = [last_name_1, last_name_2].filter(Boolean).join(" ");
            const nombre = [first_name, middle_name].filter(Boolean).join(" ");

            const parseDataUrlToBlob = async (dataUrl: string): Promise<Blob | undefined> => {
                if (!dataUrl) return undefined;
                try {
                    if (dataUrl.startsWith('data:')) {
                        const arr = dataUrl.split(',');
                        if (arr.length >= 2) {
                            try {
                                const mimeMatch = arr[0].match(/:(.*?);/);
                                const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
                                // Eliminar espacios, newlines u otros carácteres no válidos en base64
                                const cleanB64 = arr[1].replace(/[^A-Za-z0-9+/=]/g, '');
                                const bstr = atob(cleanB64);
                                let n = bstr.length;
                                const u8arr = new Uint8Array(n);
                                while (n--) {
                                    u8arr[n] = bstr.charCodeAt(n);
                                }
                                return new Blob([u8arr], { type: mime });
                            } catch (atobErr) {
                                console.warn('Falló decodificación manual, intentando fetch...', atobErr);
                            }
                        }
                    }
                    const response = await fetch(dataUrl);
                    if (response.ok) {
                        return await response.blob();
                    }
                } catch (e) {
                    console.warn('Fallo al recuperar Blob de dataUrl (ambos métodos)', e);
                }
                return undefined;
            };

            let dniBlobFront: Blob | undefined;
            if (capturas.dni_cliente?.dataUrl) {
                dniBlobFront = await parseDataUrlToBlob(capturas.dni_cliente.dataUrl);
            }

            let dniBlobBack: Blob | undefined;
            if (capturas.dni_cliente_back?.dataUrl) {
                dniBlobBack = await parseDataUrlToBlob(capturas.dni_cliente_back.dataUrl);
            }

            // ── Upsert Local-First (crea o actualiza por NIF, sin duplicados) ──
            const clienteId = await db.upsertCliente({
                nif: dni,
                nombre,
                apellidos,
                fuenteOrigen: 'calculadora',
                ...(dniBlobFront ? { dniBlobFront } : {}),
                ...(dniBlobBack ? { dniBlobBack } : {}),
            });

            await clientSyncService.enqueueClienteUpsert(clienteId, 'user_action');
            const existing = await db.clientes.where('nif').equals(dni).count();
            const verb = existing > 0 ? 'actualizado' : 'guardado';
            setDniLookupMsg(`✅ Cliente ${first_name} ${last_name_1} ${verb} en local y encolado para sync.`);

        } catch (err: any) {
            console.error("Fallo inesperado al guardar cliente:", err);
            setDniLookupMsg(`Fallo inesperado al guardar cliente: ${err.message || 'Desconocido'}`);
        } finally {
            setSavingCliente(false);
        }
    };

    const verificarCatastroDesdeDatos = async ({
        rc,
        zonaXml,
        direccionXml,
        municipioXml,
        provinciaXml,
        cpXml,
        baseMsg,
    }: {
        rc: string;
        zonaXml?: string;
        direccionXml?: string;
        municipioXml?: string;
        provinciaXml?: string;
        cpXml?: string;
        baseMsg: string;
    }) => {
        const rcNormalized = normalizeRc(rc);
        if (!rcNormalized) {
            setCatastroVerificationBanner({
                tone: "warning",
                message: "⚠️ No se pudo verificar Catastro porque falta la referencia catastral.",
            });
            setXmlImportMsg(baseMsg);
            return;
        }

        setXmlImportMsg(baseMsg + " Verificando Catastro (altura, zona y ubicación)...");

        const [climateCheck, catastroCheck] = await Promise.all([
            fetchAltitudeAndProvince(rcNormalized, provinciaXml || "", municipioXml || ""),
            consultarCatastro(rcNormalized),
        ]);

        let climateMsg = "";
        const xmlZona = (zonaXml || "").trim();
        const xmlProvincia = (provinciaXml || "").trim();
        const climateParts: string[] = [];

        if (climateCheck.detectedProvince && !xmlProvincia) {
            setProvinciaInmueble(climateCheck.detectedProvince);
            climateParts.push(`Provincia autocompletada: ${climateCheck.detectedProvince}.`);
        }

        if (climateCheck.altitude !== null) {
            setAlturaMsnm(String(climateCheck.altitude));
            climateParts.push(`Altura Catastro: ${climateCheck.altitude} m.`);
        } else {
            climateParts.push("⚠️ Altura Catastro: no disponible.");
        }

        if (climateCheck.zone !== null) {
            const zoneKnown = VALORES_G[climateCheck.zone] !== undefined;
            if (zoneKnown) {
                setZonaKey(climateCheck.zone);
            }

            if (xmlZona && climateCheck.zone !== xmlZona && zoneKnown) {
                climateParts.push(`⚠️ Zona: CE3X ${xmlZona} vs Catastro ${climateCheck.zone} (actualizada).`);
            } else if (xmlZona) {
                climateParts.push(`Zona: ${climateCheck.zone} (coincide con CE3X).`);
            } else {
                climateParts.push(`Zona automática: ${climateCheck.zone}${climateCheck.zoneProvince ? ` (${climateCheck.zoneProvince})` : ""}.`);
            }
        } else if (climateCheck.altitude !== null) {
            climateParts.push("⚠️ Zona: no disponible.");
        }

        climateMsg = climateParts.join(" ");

        let locationTone: CatastroVerificationBanner["tone"] = "info";
        let locationMsg = "ℹ️ Verificación de ubicación no disponible.";

        if (catastroCheck.error) {
            locationTone = "warning";
            locationMsg = `⚠️ No se pudo validar dirección/municipio/provincia con Catastro: ${catastroCheck.error}`;
        } else if (catastroCheck.datos) {
            const { multiple } = esParcerlaMultiple(catastroCheck.datos);
            if (multiple) {
                locationTone = "info";
                locationMsg = "ℹ️ RC con múltiples inmuebles; la verificación de ubicación es parcial.";
            } else {
                const catastroInfo = extraerDatosInmuebleUnico(catastroCheck.datos);
                let catDireccion = (catastroInfo.direccion || "").trim();
                
                if (rcNormalized.length === 20) {
                    try {
                        const loints = await fetchLointDataFromRC(rcNormalized);
                        if (loints.length > 0) {
                            const l = loints[0];
                            const parts = [];
                            if (l.bloque && l.bloque !== 'N/D' && l.bloque !== '-' && l.bloque !== '—') parts.push(`Blq. ${l.bloque}`);
                            if (l.escalera && l.escalera !== 'N/D' && l.escalera !== '-' && l.escalera !== '—') parts.push(`Esc. ${l.escalera}`);
                            if (l.planta && l.planta !== 'N/D' && l.planta !== '-' && l.planta !== '—') parts.push(`Pl. ${l.planta}`);
                            if (l.puerta && l.puerta !== 'N/D' && l.puerta !== '-' && l.puerta !== '—') parts.push(`Pt. ${l.puerta}`);

                            if (parts.length > 0) {
                                catDireccion = `${catDireccion}, ${parts.join(' ')}`;
                            }
                        }
                    } catch (e) {
                        console.warn("No se pudo obtener datos Loint (Codigos)", e);
                    }
                }

                const catMunicipio = (catastroInfo.municipio || "").trim();
                const catProvincia = (catastroInfo.provincia || "").trim();
                const catCp = (catastroInfo.codigoPostal || "").trim();

                const autoFilled: string[] = [];
                if (!(direccionXml || "").trim() && catDireccion) {
                    setDireccionInmueble(catDireccion);
                    autoFilled.push("dirección");
                }
                if (!(municipioXml || "").trim() && catMunicipio) {
                    setMunicipioInmueble(catMunicipio);
                    autoFilled.push("municipio");
                }
                if (!(provinciaXml || "").trim() && catProvincia) {
                    setProvinciaInmueble(catProvincia);
                    autoFilled.push("provincia");
                }
                if (!(cpXml || "").trim() && catCp) {
                    setCpInmueble(catCp);
                    autoFilled.push("CP");
                }

                const checks = [
                    { label: "Dirección", xml: (direccionXml || "").trim(), catastro: catDireccion },
                    { label: "Municipio", xml: (municipioXml || "").trim(), catastro: catMunicipio },
                    { label: "Provincia", xml: (provinciaXml || "").trim(), catastro: catProvincia },
                ];

                let matches = 0;
                const mismatches: string[] = [];

                for (const check of checks) {
                    if (!check.xml || !check.catastro) continue;
                    if (locationValuesMatch(check.xml, check.catastro)) {
                        matches += 1;
                    } else {
                        mismatches.push(check.label);
                    }
                }

                if (mismatches.length > 0) {
                    locationTone = "warning";
                    locationMsg = `⚠️ Ubicación XML vs Catastro: ${matches}/3 campos coinciden. Revisar: ${mismatches.join(", ")}.`;
                } else if (matches === 3) {
                    locationTone = "ok";
                    locationMsg = "✅ Ubicación verificada: dirección, municipio y provincia coinciden con Catastro.";
                } else {
                    locationTone = "info";
                    locationMsg = `ℹ️ Verificación parcial de ubicación (${matches}/3 coincidencias con datos completos).`;
                }

                if (autoFilled.length > 0) {
                    locationMsg += ` Autocompletado desde Catastro: ${autoFilled.join(", ")}.`;
                }
            }
        }

        setCatastroVerificationBanner({ tone: locationTone, message: locationMsg });
        setXmlImportMsg([baseMsg, climateMsg].filter(Boolean).join(" "));
    };

    const revalidarCatastroActual = async () => {
        if (!normalizeRc(expedienteRc)) {
            setCatastroVerificationBanner({
                tone: "warning",
                message: "⚠️ Define una referencia catastral para ejecutar la verificación.",
            });
            return;
        }

        await verificarCatastroDesdeDatos({
            rc: expedienteRc,
            zonaXml: zonaKey,
            direccionXml: direccionInmueble,
            municipioXml: municipioInmueble,
            provinciaXml: provinciaInmueble,
            cpXml: cpInmueble,
            baseMsg: "Verificación Catastro manual ejecutada.",
        });
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
        setCatastroVerificationBanner(null);
        setAlturaMsnm("");

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

            const newZonaKey = parsed.zonaKey;
            const finalMsg = buildXmlImportSummary(parsed);

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

            if (parsed.rc) {
                await verificarCatastroDesdeDatos({
                    rc: parsed.rc,
                    zonaXml: newZonaKey,
                    direccionXml: parsed.direccion,
                    municipioXml: parsed.municipio,
                    provinciaXml: parsed.provincia,
                    cpXml: parsed.codigoPostal,
                    baseMsg: finalMsg,
                });
            } else {
                setCatastroVerificationBanner({
                    tone: "warning",
                    message: "⚠️ XML sin referencia catastral: no se pudo verificar Catastro automáticamente.",
                });
            }

        } catch {
            setClienteFirstName("");
            setClienteMiddleName("");
            setClienteLastName1("");
            setClienteLastName2("");
            setClienteDni("");
            setCatastroVerificationBanner(null);
            setXmlImportMsg("No se pudo importar el XML CE3X. Revisa el archivo.");
        }
    };

    const calcular = async () => {
        setIsCalculating(true);
        setCloudReportText(null);
        setCloudReportCopied(false);
        try {
            const calculationFingerprint = currentCalcFingerprint;
            const gValue = VALORES_G[zonaKey] ?? 61;
            const applyOverrides = (base: ResultadoTermico): ResultadoTermico => {
                const parsedUi = Number.parseFloat(overrideUi);
                const parsedUf = Number.parseFloat(overrideUf);
                const uiFinal = Number.isFinite(parsedUi) ? parsedUi : base.ui_final;
                const ufFinal = Number.isFinite(parsedUf) ? parsedUf : base.uf_final;
                const ahorroFinal = uiFinal > ufFinal ? Math.round((uiFinal - ufFinal) * supActuacion * gValue) : 0;

                return {
                    ...base,
                    ui_final: uiFinal,
                    uf_final: ufFinal,
                    ahorro: ahorroFinal,
                };
            };

            const calcularLocal = () => {
                const localRes = calcularAhorroCAE({
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
                const nextResultado = applyOverrides(localRes);
                latestResultadoRef.current = nextResultado;
                setResultado(nextResultado);
                setLastCalculatedFingerprint(calculationFingerprint);
            };

            if (isCloudCalculation) {
                try {
                    const res = await calcularDbHeRemoto({
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

                    const { resultado: resTermico, informe } = res;
                    const normalizedInforme = typeof informe === "string" && informe.trim() ? informe.trim() : null;
                    setCloudReportText(normalizedInforme);
                    setXmlImportMsg(normalizedInforme
                        ? "✅ Cálculo Cloud completado. Informe cloud listo para copiar."
                        : "✅ Cálculo Cloud completado.");
                    const nextResultado = applyOverrides(resTermico);
                    latestResultadoRef.current = nextResultado;
                    setResultado(nextResultado);
                    setLastCalculatedFingerprint(calculationFingerprint);
                    return;
                } catch (error) {
                    const rawMessage = error instanceof Error ? error.message : "sin detalle";
                    const normalizedMessage = rawMessage.toLowerCase();
                    const message =
                        normalizedMessage.includes("401")
                            ? "sesion vencida o token invalido (vuelve a iniciar sesion)"
                            : normalizedMessage.includes("402")
                            ? "licencia cloud no activa"
                            : normalizedMessage.includes("403") || normalizedMessage.includes("origin")
                            ? "bloqueo de origen/cors"
                            : /(network error|failed to fetch|timeout|timed out|load failed)/i.test(rawMessage)
                            ? "latencia/red o API en arranque"
                            : rawMessage;
                    console.error("Cloud calculation failed, fallback to local:", error);
                    setIsCloudCalculation(false);
                    setCloudReportText(null);
                    setXmlImportMsg(`⚠️ Cálculo Cloud no disponible (${message}). Se aplicó cálculo local.`);
                }
            }

            calcularLocal();
        } catch (error: unknown) {
            setXmlImportMsg(null);
            const message = error instanceof Error ? error.message : "Error desconocido";
            alert(`Error en el cálculo: ${message}`);
        } finally {
            setIsCalculating(false);
        }
    };

    const getResultadoActual = () => latestResultadoRef.current ?? resultado;

    const getResultadoActualizado = (actionLabel: string): ResultadoTermico | null => {
        const resultadoActual = getResultadoActual();
        if (!resultadoActual) {
            setDraftError(`Primero calcula el expediente antes de ${actionLabel}.`);
            return null;
        }

        if (resultadoDesactualizado) {
            setDraftError(`Has modificado datos tras el último cálculo. Pulsa "Calcular Ahorro Energético" antes de ${actionLabel}.`);
            return null;
        }

        return resultadoActual;
    };

    const copiarInforme = async () => {
        const resultadoActual = getResultadoActualizado("copiar el informe");
        if (!resultadoActual) return;

        const gValue = VALORES_G[zonaKey] ?? 61;
        let texto = generarInformeTexto({
            capas,
            resultado: resultadoActual,
            sup_actuacion: supActuacion,
            sup_envolvente_total: supEnvolvente,
            sup_huecos: supHuecos,
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

        try {
            await navigator.clipboard.writeText(texto);
            setDraftError(null);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        } catch {
            setDraftError("No se pudo copiar el informe. Revisa permisos del navegador.");
        }
    };

    const copiarInformeCloud = async () => {
        if (!getResultadoActualizado("copiar el informe cloud")) {
            return;
        }

        if (!cloudReportText) {
            setDraftError("No hay informe cloud disponible todavía. Ejecuta un cálculo en modo On-Cloud.");
            return;
        }

        const rcNormalized = normalizeRc(expedienteRc) || "SIN_RC";
        const encabezado = [
            "INFORME CLOUD DB-HE",
            `RC: ${rcNormalized}`,
            `Fecha: ${new Date().toLocaleString("es-ES")}`,
            "",
        ].join("\n");

        try {
            await navigator.clipboard.writeText(`${encabezado}${cloudReportText}`);
            setDraftError(null);
            setCloudReportCopied(true);
            setTimeout(() => setCloudReportCopied(false), 2500);
        } catch {
            setDraftError("No se pudo copiar el informe cloud. Revisa permisos del navegador.");
        }
    };

    const buildIntelliaTemplateInput = (res: ResultadoTermico): IntelliaCertificateTemplateInput => {
        const fullClientName = [clienteFirstName, clienteMiddleName, clienteLastName1, clienteLastName2]
            .filter(Boolean)
            .join(" ")
            .trim();
        const fullAddress = [direccionInmueble, cpInmueble, municipioInmueble, provinciaInmueble]
            .filter(Boolean)
            .join(", ");
        const gValue = VALORES_G[zonaKey] ?? 61;
        const fechaEmision = new Date().toLocaleDateString("es-ES", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
        });
        const upDecimals = modoCE3X ? 2 : 3;
        const capasNuevas = capas.filter((capa) => capa.es_nueva);
        const espesorNuevaTotalMm = Math.round(
            capasNuevas.reduce((acc, capa) => acc + toFiniteNumber(capa.espesor, 0), 0) * 1000,
        );
        const nombreAislante = capasNuevas
            .map((capa) => (capa.nombre || "").trim())
            .filter(Boolean)
            .join(" + ") || "aislante";

        return {
            fullClientName,
            fullAddress,
            supEnvolvente,
            areaHNH,
            areaNHE,
            supActuacion,
            alturaMsnm,
            zonaKey,
            gValue,
            fechaEmision,
            upDecimals,
            espesorNuevaTotalMm,
            nombreAislante,
            resultado: res,
        };
    };

    const copiarPlantillaIntellia = async () => {
        const resultadoActual = getResultadoActualizado("generar la plantilla INTELLIA");
        if (!resultadoActual) return;

        const plantilla = buildIntelliaCertificateText(buildIntelliaTemplateInput(resultadoActual));

        try {
            await navigator.clipboard.writeText(plantilla);
            setDraftError(null);
            setIntelliaTemplateCopied(true);
            setTimeout(() => setIntelliaTemplateCopied(false), 2500);
            setDraftMsg("Plantilla INTELLIA copiada al portapapeles con fecha de emisión actual.");
        } catch {
            setDraftError("No se pudo copiar la plantilla INTELLIA. Revisa permisos del navegador.");
        }
    };

    const registrarCertificadoEmitido = async (
        type: IssuedCertificateType,
        generatedPdf: GeneratedCertificatePdf,
        resultSnapshot?: ResultadoTermico,
    ): Promise<boolean> => {
        if (!supabase) return false;

        try {
            const organizationId = await resolveOrganizationOrThrow();
            const rcNormalized = normalizeRc(expedienteRc) || "SIN_RC";
            const safeFileName = sanitizeSegmentForPath(generatedPdf.fileName, `${type}.pdf`);
            const storagePath = getIssuedPdfPath(organizationId, rcNormalized, safeFileName);

            const { error: uploadError } = await supabase.storage.from("work_photos").upload(storagePath, generatedPdf.blob, {
                upsert: true,
                contentType: "application/pdf",
            });

            if (uploadError) {
                throw uploadError;
            }

            const current = await loadIssuedCertificatesIndex(organizationId);
            const fullClientName = [clienteFirstName, clienteMiddleName, clienteLastName1, clienteLastName2]
                .filter(Boolean)
                .join(" ")
                .trim();

            const nextRecord: IssuedCertificateRecord = {
                id: `${Date.now()}_${type}_${rcNormalized}`,
                rc: rcNormalized,
                type,
                fileName: safeFileName,
                storagePath,
                issuedAt: new Date().toISOString(),
                clienteNombre: fullClientName,
                clienteDni: clienteDni.trim(),
                zonaKey,
                alturaMsnm: alturaMsnm.trim(),
                ahorroKwh: Math.round((resultSnapshot ?? getResultadoActual())?.ahorro ?? 0),
            };

            const merged = [nextRecord, ...current.filter((item) => item.storagePath !== storagePath)].slice(0, 1500);
            await saveIssuedCertificatesIndex(organizationId, merged);
            setIssuedCertificatesCount(merged.length);
            return true;
        } catch (error: any) {
            console.error("No se pudo registrar certificado emitido", error);
            setDraftError(`PDF generado, pero no se pudo guardar en historial cloud: ${error?.message ?? "error desconocido"}`);
            return false;
        }
    };

    const generarCertificadoIntelliaPDF = async () => {
        const resultadoActual = getResultadoActualizado("generar el PDF INTELLIA");
        if (!resultadoActual) return;

        try {
            const input = buildIntelliaTemplateInput(resultadoActual);
            const fileName = buildIntelliaCertificateFilename(expedienteRc);
            const generatedPdf = generarPDFCertificadoIntellia(input, fileName);
            setDraftError(null);
            const registered = await registrarCertificadoEmitido("intellia_pdf", generatedPdf, resultadoActual);
            setDraftMsg(
                registered
                    ? `PDF INTELLIA generado y guardado en historial cloud: ${fileName}`
                    : `PDF INTELLIA generado localmente: ${fileName}`,
            );
        } catch {
            setDraftError("No se pudo generar el PDF INTELLIA. Revisa la consola del navegador.");
        }
    };

    const generarDocumentoWord = async () => {
        const resultadoActual = getResultadoActualizado("generar el Word");
        if (!resultadoActual) return;

        try {
            setDraftMsg("Generando documento Word... (esto puede tardar unos segundos si hay imágenes grandes)");
            
            await generarCertificadoE1_3_5_DOCX({
                version: CERT_DRAFT_VERSION,
                rc: expedienteRc,
                status: certStatus,
                updatedAt: new Date().toISOString(),
                clienteNombre: [clienteFirstName, clienteMiddleName, clienteLastName1, clienteLastName2].filter(Boolean).join(" "),
                direccionInmueble,
                municipioInmueble,
                cpInmueble,
                provinciaInmueble,
                supEnvolvente,
                supActuacion,
                zonaKey,
                alturaMsnm: alturaMsnm ? Number(alturaMsnm) : undefined,
                areaNHE,
                case_i: caseI,
                case_f: caseF,
                capas,
                resultado: resultadoActual,
                capturas
            });

            setDraftError(null);
            setDraftMsg("Documento Word generado correctamente.");
        } catch (error: any) {
            console.error("Error al generar el Word:", error);
            setDraftError(error?.message ?? "Error al generar el Word.");
        }
    };

    const generarAnexoE1PDF = async () => {
        const resultadoActual = getResultadoActualizado("generar el Anexo E.1");
        if (!resultadoActual) return;

        try {
            const rcForName = normalizeRc(expedienteRc) || "SIN_RC";
            const fileName = `Anexo_E1_${rcForName}.pdf`;
            const generatedPdf = generarPDFAnexoE1(capas, resultadoActual, fileName);
            if (!generatedPdf) {
                setDraftError("No se pudo generar el PDF del Anexo E.1.");
                return;
            }

            setDraftError(null);
            const registered = await registrarCertificadoEmitido("anexo_e1_pdf", generatedPdf, resultadoActual);
            setDraftMsg(
                registered
                    ? `Anexo E.1 generado y guardado en historial cloud: ${fileName}`
                    : `Anexo E.1 generado localmente: ${fileName}`,
            );
        } catch {
            setDraftError("No se pudo generar el PDF del Anexo E.1. Revisa la consola del navegador.");
        }
    };

    // Preview del ratio y b en tiempo real
    const ratio = areaNHE > 0 ? areaHNH / areaNHE : 0;
    const previewBi = ratio > 0 ? getB(ratio, scenarioI, caseI) : null;
    const previewBf = ratio > 0 ? getB(ratio, scenarioF, caseF) : null;
    const supEnvolventeRounded = roundTo(supEnvolvente, 2);
    const supHuecosRounded = roundTo(supHuecos, 2);
    const supOpacosNetosEstimados = roundTo(Math.max(supEnvolventeRounded - supHuecosRounded, 0), 2);
    const hasHuecosBreakdown = supHuecosRounded > 0 && supEnvolventeRounded >= supHuecosRounded;
    const materialSupportSlots: Array<{ key: keyof CapturasState; label: string }> = [
        { key: "materiales_antes", label: "Materiales antes" },
        { key: "materiales_despues", label: "Materiales despues" },
        { key: "ficha_tecnica", label: "Ficha tecnica" },
    ];
    const dniPreview = capturas.dni_cliente;
    const dniBackPreview = capturas.dni_cliente_back;

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

    const toFiniteNumber = (value: unknown, fallback = 0): number => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    };

    const parseNumericInput = (value: string, fallback = 0): number => {
        const normalized = value.replace(",", ".").trim();
        if (!normalized) return fallback;
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : fallback;
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

    const normalizeDraftIndexItems = (items: CertificateDraftIndexItem[]): CertificateDraftIndexItem[] => {
        return items
            .filter((it) => typeof it?.rc === "string")
            .map((it) => {
                const normalizedRc = normalizeRc(String(it.rc ?? ""));
                return {
                    rc: normalizedRc,
                    status: isValidDraftStatus(it.status) ? it.status : "en_progreso",
                    updatedAt: typeof it.updatedAt === "string" && it.updatedAt.trim() ? it.updatedAt : new Date().toISOString(),
                    clienteNombre: typeof it.clienteNombre === "string" ? it.clienteNombre : "",
                    clienteDni: typeof it.clienteDni === "string" ? it.clienteDni : "",
                };
            })
            .filter((it) => Boolean(it.rc));
    };

    const normalizeIssuedCertificateRecords = (items: IssuedCertificateRecord[]): IssuedCertificateRecord[] => {
        return items
            .filter((it) => typeof it?.rc === "string")
            .map((it) => {
                const normalizedRc = normalizeRc(String(it.rc ?? ""));
                const type: IssuedCertificateType = it.type === "anexo_e1_pdf" ? "anexo_e1_pdf" : "intellia_pdf";
                const fileName = sanitizeSegmentForPath(String(it.fileName ?? ""), `${type}.pdf`);
                const storagePath = typeof it.storagePath === "string" && it.storagePath.trim()
                    ? it.storagePath
                    : "";
                return {
                    id: typeof it.id === "string" && it.id.trim()
                        ? it.id
                        : `${Date.now()}_${type}_${normalizedRc || "SIN_RC"}`,
                    rc: normalizedRc,
                    type,
                    fileName,
                    storagePath,
                    issuedAt: typeof it.issuedAt === "string" && it.issuedAt.trim()
                        ? it.issuedAt
                        : new Date().toISOString(),
                    clienteNombre: typeof it.clienteNombre === "string" ? it.clienteNombre : "",
                    clienteDni: typeof it.clienteDni === "string" ? it.clienteDni : "",
                    zonaKey: typeof it.zonaKey === "string" ? it.zonaKey : "",
                    alturaMsnm: typeof it.alturaMsnm === "string" ? it.alturaMsnm : "",
                    ahorroKwh: Number.isFinite(Number(it.ahorroKwh)) ? Number(it.ahorroKwh) : 0,
                };
            })
            .filter((it) => Boolean(it.rc))
            .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
    };

    const mergeDraftIndexes = (...groups: CertificateDraftIndexItem[][]): CertificateDraftIndexItem[] => {
        const mergedByRc = new Map<string, CertificateDraftIndexItem>();

        groups.flat().forEach((item) => {
            const normalizedRc = normalizeRc(item.rc || "");
            if (!normalizedRc) return;

            const normalizedItem: CertificateDraftIndexItem = {
                ...item,
                rc: normalizedRc,
                status: isValidDraftStatus(item.status) ? item.status : "en_progreso",
                updatedAt: typeof item.updatedAt === "string" && item.updatedAt.trim() ? item.updatedAt : new Date().toISOString(),
                clienteNombre: typeof item.clienteNombre === "string" ? item.clienteNombre : "",
                clienteDni: typeof item.clienteDni === "string" ? item.clienteDni : "",
            };

            const existing = mergedByRc.get(normalizedRc);
            if (!existing) {
                mergedByRc.set(normalizedRc, normalizedItem);
                return;
            }

            mergedByRc.set(normalizedRc, pickMostRecentIndexItem(existing, normalizedItem));
        });

        return sortDrafts(Array.from(mergedByRc.values()));
    };

    const indexesAreEqual = (a: CertificateDraftIndexItem[], b: CertificateDraftIndexItem[]): boolean => {
        const stable = (items: CertificateDraftIndexItem[]) => JSON.stringify(
            sortDrafts(items).map((it) => ({
                rc: normalizeRc(it.rc),
                status: isValidDraftStatus(it.status) ? it.status : "en_progreso",
                updatedAt: it.updatedAt,
                clienteNombre: it.clienteNombre || "",
                clienteDni: it.clienteDni || "",
            })),
        );
        return stable(a) === stable(b);
    };

    const reconcileQueueIndexes = (
        activeItems: CertificateDraftIndexItem[],
        archivedItems: CertificateDraftIndexItem[],
    ): { active: CertificateDraftIndexItem[]; archived: CertificateDraftIndexItem[] } => {
        const active = mergeDraftIndexes(activeItems);
        const activeRcSet = new Set(active.map((it) => normalizeRc(it.rc)));
        const archived = mergeDraftIndexes(archivedItems).filter((it) => !activeRcSet.has(normalizeRc(it.rc)));
        return { active, archived };
    };

    const queueItemMatchesSearch = (item: CertificateDraftIndexItem, searchValue: string): boolean => {
        const normalizedSearch = searchValue.trim().toLowerCase();
        if (!normalizedSearch) return true;
        return (
            item.rc.toLowerCase().includes(normalizedSearch)
            || (item.clienteNombre || "").toLowerCase().includes(normalizedSearch)
            || (item.clienteDni || "").toLowerCase().includes(normalizedSearch)
        );
    };

    const normalizeOrganizationCandidate = (value: unknown): string | null => {
        if (typeof value !== "string") return null;
        const normalized = value.trim();
        return normalized || null;
    };

    const resolvePrimaryOrganizationOrThrow = async (): Promise<string> => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const organizationId = await getCurrentOrganizationId();
            const normalized = normalizeOrganizationCandidate(organizationId);
            if (normalized) {
                return normalized;
            }

            if (attempt < 2) {
                await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 250));
            }
        }

        throw new Error("No se pudo resolver la empresa activa para guardar/cargar certificados.");
    };

    const collectDraftOrganizationCandidates = async (primaryOrgId: string): Promise<string[]> => {
        const candidateSet = new Set<string>();
        candidateSet.add(primaryOrgId);
        const cachedOrgId = normalizeOrganizationCandidate(draftStorageOrgId);
        if (cachedOrgId) {
            candidateSet.add(cachedOrgId);
        }

        const addRows = (rows: Array<{ organization_id?: unknown }> | null | undefined) => {
            if (!Array.isArray(rows)) return;
            rows.forEach((row) => {
                const candidate = normalizeOrganizationCandidate(row.organization_id);
                if (candidate) {
                    candidateSet.add(candidate);
                }
            });
        };

        if (!supabase) {
            return Array.from(candidateSet.values());
        }

        const { data: userCtx } = await supabase.auth.getUser();
        const userId = userCtx.user?.id ?? "";
        const userEmail = userCtx.user?.email?.trim().toLowerCase() ?? "";

        if (userId) {
            const { data: licensesByUser } = await supabase
                .from("licenses")
                .select("organization_id")
                .eq("user_id", userId)
                .eq("status", "active")
                .order("created_at", { ascending: false })
                .limit(25);
            addRows(licensesByUser as Array<{ organization_id?: unknown }> | null);

            const { data: projectsByUser } = await supabase
                .from("projects")
                .select("organization_id")
                .eq("created_by", userId)
                .order("created_at", { ascending: false })
                .limit(25);
            addRows(projectsByUser as Array<{ organization_id?: unknown }> | null);
        }

        if (userEmail) {
            const { data: licensesByEmail } = await supabase
                .from("licenses")
                .select("organization_id")
                .eq("user_email", userEmail)
                .eq("status", "active")
                .order("created_at", { ascending: false })
                .limit(25);
            addRows(licensesByEmail as Array<{ organization_id?: unknown }> | null);
        }

        return Array.from(candidateSet.values());
    };

    const resolveOrganizationOrThrow = async (): Promise<string> => {
        const cachedOrgId = normalizeOrganizationCandidate(draftStorageOrgId);
        if (cachedOrgId) {
            return cachedOrgId;
        }

        return resolvePrimaryOrganizationOrThrow();
    };

    const mapDraftStatusToExpedienteStatus = (status: CertDraftStatus): ExpedienteStatus => {
        return status === "completado" ? "completado" : "en_progreso";
    };

    const syncDraftToMvpExpediente = async (
        rcNormalized: string,
        finalStatus: CertDraftStatus,
        payload: CertificateDraftPayload,
    ): Promise<{ ok: boolean; warning?: string }> => {
        if (!ENABLE_EXPEDIENTE_MVP_RPC) {
            return { ok: true };
        }

        try {
            let meta = expedienteMvpMetaRef.current[rcNormalized];

            if (!meta) {
                const existing = await getExpedienteMvpByRc(rcNormalized);
                if (existing?.id && existing.versionToken) {
                    meta = { expedienteId: existing.id, versionToken: existing.versionToken };
                    expedienteMvpMetaRef.current[rcNormalized] = meta;
                }
            }

            const attempt = await upsertExpedienteMvp({
                expedienteId: meta?.expedienteId ?? null,
                rc: rcNormalized,
                datos: payload as unknown as Record<string, unknown>,
                versionActual: meta?.versionToken ?? null,
                status: mapDraftStatusToExpedienteStatus(finalStatus),
                projectId: null,
            });

            if (attempt.ok) {
                expedienteMvpMetaRef.current[rcNormalized] = {
                    expedienteId: attempt.id,
                    versionToken: attempt.versionToken,
                };
                return { ok: true };
            }

            // Si hay duplicado y no había metadata local, reintentar en modo update.
            if (!meta && attempt.error === "DUPLICATE_RC") {
                const existing = await getExpedienteMvpByRc(rcNormalized);
                if (existing?.id && existing.versionToken) {
                    const retry = await upsertExpedienteMvp({
                        expedienteId: existing.id,
                        rc: rcNormalized,
                        datos: payload as unknown as Record<string, unknown>,
                        versionActual: existing.versionToken,
                        status: mapDraftStatusToExpedienteStatus(finalStatus),
                        projectId: null,
                    });

                    if (retry.ok) {
                        expedienteMvpMetaRef.current[rcNormalized] = {
                            expedienteId: retry.id,
                            versionToken: retry.versionToken,
                        };
                        return { ok: true };
                    }

                    return {
                        ok: false,
                        warning: `MVP SQL no sincronizado (${retry.error}).`,
                    };
                }
            }

            return {
                ok: false,
                warning: `MVP SQL no sincronizado (${attempt.error}).`,
            };
        } catch {
            return {
                ok: false,
                warning: "MVP SQL no sincronizado (error de red o despliegue pendiente).",
            };
        }
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

    const loadIssuedCertificatesIndex = async (organizationId: string): Promise<IssuedCertificateRecord[]> => {
        const resolved = await readStorageTextByCandidates([
            getIssuedIndexPath(organizationId),
            getLegacyIssuedIndexPath(organizationId),
        ]);
        if (!resolved) return [];

        try {
            const parsed = JSON.parse(resolved.text) as IssuedCertificateRecord[];
            if (!Array.isArray(parsed)) return [];
            return normalizeIssuedCertificateRecords(parsed);
        } catch {
            return [];
        }
    };

    const saveIssuedCertificatesIndex = async (organizationId: string, items: IssuedCertificateRecord[]) => {
        const normalizedItems = normalizeIssuedCertificateRecords(items);
        const blob = new Blob([JSON.stringify(normalizedItems, null, 2)], { type: "application/json" });
        const { error } = await supabase.storage.from("work_photos").upload(getIssuedIndexPath(organizationId), blob, {
            upsert: true,
            contentType: "application/json",
        });
        if (error) throw error;
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
            return normalizeDraftIndexItems(parsed);
        } catch {
            return [];
        }
    };

    const loadArchivedDraftIndex = async (organizationId: string): Promise<CertificateDraftIndexItem[]> => {
        const resolved = await readStorageTextByCandidates([
            getArchiveIndexPath(organizationId),
            getLegacyArchiveIndexPath(organizationId),
        ]);
        if (!resolved) return [];

        try {
            const parsed = JSON.parse(resolved.text) as CertificateDraftIndexItem[];
            if (!Array.isArray(parsed)) return [];
            return normalizeDraftIndexItems(parsed);
        } catch {
            return [];
        }
    };

    const listDraftRcCandidatesFromFolder = async (folderPath: string): Promise<string[]> => {
        const allCandidates = new Set<string>();
        const pageSize = 100;
        let offset = 0;

        while (true) {
            const { data, error } = await supabase.storage.from("work_photos").list(folderPath, {
                limit: pageSize,
                offset,
            });

            if (error || !data || data.length === 0) {
                break;
            }

            data.forEach((entry) => {
                const rawName = typeof entry.name === "string" ? entry.name : "";
                if (!rawName || !rawName.endsWith(".json")) return;
                if (
                    rawName === CERT_INDEX_FILENAME
                    || rawName === CERT_ARCHIVE_INDEX_FILENAME
                    || rawName === CERT_IMPORT_AUDIT_FILENAME
                ) {
                    return;
                }

                const stem = rawName.slice(0, -5);
                const rcCandidate = stem.startsWith(LEGACY_CERT_PREFIX)
                    ? stem.slice(LEGACY_CERT_PREFIX.length)
                    : stem;
                const normalized = normalizeRc(rcCandidate);
                if (normalized) {
                    allCandidates.add(normalized);
                }
            });

            if (data.length < pageSize) {
                break;
            }
            offset += pageSize;
        }

        return Array.from(allCandidates.values());
    };

    const recoverIndexesFromStoredDrafts = async (
        organizationId: string,
    ): Promise<{ active: CertificateDraftIndexItem[]; archived: CertificateDraftIndexItem[]; recoveredCount: number }> => {
        const folderCandidates = [
            `${organizationId}/${CERT_DRAFT_FOLDER}`,
            `${CERT_DRAFT_FOLDER}/${organizationId}`,
        ];

        const rcSet = new Set<string>();
        for (const folder of folderCandidates) {
            const rcCandidates = await listDraftRcCandidatesFromFolder(folder);
            rcCandidates.forEach((rc) => rcSet.add(rc));
        }

        if (rcSet.size === 0) {
            return { active: [], archived: [], recoveredCount: 0 };
        }

        const activeRecovered: CertificateDraftIndexItem[] = [];
        const archivedRecovered: CertificateDraftIndexItem[] = [];

        for (const rc of rcSet) {
            const payload = await loadDraftPayload(organizationId, rc);
            if (!payload) continue;

            const item: CertificateDraftIndexItem = {
                rc,
                status: isValidDraftStatus(payload.status) ? payload.status : "en_progreso",
                updatedAt: payload.updatedAt || new Date().toISOString(),
                clienteNombre: payload.clienteNombre || [
                    payload.clienteFirstName,
                    payload.clienteMiddleName,
                    payload.clienteLastName1,
                    payload.clienteLastName2,
                ].filter(Boolean).join(" "),
                clienteDni: payload.clienteDni || "",
            };

            if (item.status === "completado") {
                archivedRecovered.push(item);
            } else {
                activeRecovered.push(item);
            }
        }

        const active = mergeDraftIndexes(activeRecovered);
        const archived = mergeDraftIndexes(archivedRecovered)
            .filter((it) => !active.some((activeItem) => normalizeRc(activeItem.rc) === normalizeRc(it.rc)));

        return {
            active,
            archived,
            recoveredCount: active.length + archived.length,
        };
    };

    const loadDraftPayload = async (organizationId: string, rc: string): Promise<CertificateDraftPayload | null> => {
        const normalizedRc = normalizeRc(rc);
        const resolved = await readStorageTextByCandidates([
            getDraftPath(organizationId, normalizedRc),
            getCurrentPrefixedDraftPath(organizationId, normalizedRc),
            getLegacyDraftPath(organizationId, normalizedRc),
            getLegacyPrefixedDraftPath(organizationId, normalizedRc),
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

    const saveIndexFile = async (indexPath: string, items: CertificateDraftIndexItem[]) => {
        const blob = new Blob([JSON.stringify(sortDrafts(items), null, 2)], { type: "application/json" });
        const { error } = await supabase.storage.from("work_photos").upload(indexPath, blob, {
            upsert: true,
            contentType: "application/json",
        });
        if (error) throw error;
    };

    const saveDraftIndex = async (organizationId: string, items: CertificateDraftIndexItem[]) => {
        await saveIndexFile(getIndexPath(organizationId), items);
    };

    const saveArchivedDraftIndex = async (organizationId: string, items: CertificateDraftIndexItem[]) => {
        await saveIndexFile(getArchiveIndexPath(organizationId), items);
    };

    const archivarCompletados = async (
        options?: { onlyRc?: string; skipConfirm?: boolean },
    ): Promise<boolean> => {
        if (!supabase) return false;
        try {
            setDraftLoading(true);
            setDraftError(null);
            setDraftMsg(null);
            const organizationId = await resolveOrganizationOrThrow();
            const [activeRaw, archivedRaw] = await Promise.all([
                loadDraftIndex(organizationId),
                loadArchivedDraftIndex(organizationId),
            ]);
            const { active, archived } = reconcileQueueIndexes(activeRaw, archivedRaw);

            const onlyRcNormalized = options?.onlyRc ? normalizeRc(options.onlyRc) : "";
            const completedItems = active.filter(
                (d) => d.status === "completado" && (!onlyRcNormalized || normalizeRc(d.rc) === onlyRcNormalized),
            );
            if (completedItems.length === 0) {
                setDraftQueue(active);
                setArchivedQueue(archived);
                setDraftMsg(onlyRcNormalized
                    ? `El expediente ${onlyRcNormalized} no esta completado en la cola activa.`
                    : "No hay expedientes completados para archivar.");
                return false;
            }

            if (!options?.skipConfirm) {
                const confirmMessage = onlyRcNormalized
                    ? `¿Seguro que deseas archivar el expediente ${onlyRcNormalized}?`
                    : `¿Seguro que deseas archivar ${completedItems.length} expediente(s) completado(s) del lote actual?`;
                if (!confirm(confirmMessage)) return false;
            }

            const inProgress = onlyRcNormalized
                ? active.filter((d) => normalizeRc(d.rc) !== onlyRcNormalized)
                : active.filter((d) => d.status !== "completado");
            const mergedArchived = mergeDraftIndexes(archived, completedItems);

            await Promise.all([
                saveDraftIndex(organizationId, inProgress),
                saveArchivedDraftIndex(organizationId, mergedArchived),
            ]);

            setDraftQueue(sortDrafts(inProgress));
            setArchivedQueue(sortDrafts(mergedArchived));
            setDraftMsg(onlyRcNormalized
                ? `Expediente ${onlyRcNormalized} archivado. Puedes restaurarlo en cualquier momento.`
                : `${completedItems.length} expediente(s) archivado(s). Puedes restaurarlos en cualquier momento.`);
            return true;
        } catch (error: any) {
            setDraftError(error?.message ?? "No se pudieron archivar los expedientes completados.");
            return false;
        } finally {
            setDraftLoading(false);
        }
    };

    const repararArchivadosEnvolvente = async () => {
        if (!supabase) return;
        if (archivedQueue.length === 0) {
            setDraftMsg("No hay expedientes archivados para revisar.");
            return;
        }

        const confirmed = confirm(
            `Se revisaran ${archivedQueue.length} expediente(s) archivado(s) para corregir S (envolvente) sin sumar huecos y recalcular resultados. ¿Continuar?`,
        );
        if (!confirmed) return;

        setDraftLoading(true);
        setDraftError(null);
        setDraftMsg(null);
        cancelBatchRef.current = false;

        try {
            const organizationId = await resolveOrganizationOrThrow();
            const [activeRaw, archivedRaw] = await Promise.all([
                loadDraftIndex(organizationId),
                loadArchivedDraftIndex(organizationId),
            ]);
            const { active, archived } = reconcileQueueIndexes(activeRaw, archivedRaw);

            if (archived.length === 0) {
                setDraftQueue(active);
                setArchivedQueue(archived);
                setDraftMsg("No hay expedientes archivados para revisar.");
                return;
            }

            const issues: string[] = [];
            const nowIso = new Date().toISOString();
            const updatedMeta = new Map<string, { updatedAt: string; clienteNombre: string; clienteDni: string; status: CertDraftStatus }>();

            const auditRows: Array<{
                rc: string;
                status: CertDraftStatus;
                oldS: number;
                newS: number;
                huecos: number;
                opacos: number;
                oldPart: number;
                newPart: number;
                oldAct: number;
                newAct: number;
                oldPct: number;
                newPct: number;
                oldAhorro: number;
                newAhorro: number;
                source: string;
                action: string;
                note: string;
            }> = [];

            let updatedCount = 0;
            let unchangedCount = 0;
            let failedCount = 0;

            setBatchStep({
                mode: "repair",
                phase: "Auditando archivados",
                current: 0,
                total: archived.length,
                detail: "Analizando superficies y resultados...",
            });

            for (let i = 0; i < archived.length; i += 1) {
                throwIfCancelled();
                const item = archived[i];
                const rc = normalizeRc(item.rc);

                updateBatchStep({
                    current: i,
                    detail: `Revisando ${rc}...`,
                });

                const payload = await loadDraftPayload(organizationId, rc);
                if (!payload) {
                    failedCount += 1;
                    issues.push(`${rc}: no se pudo descargar o validar payload.`);
                    auditRows.push({
                        rc,
                        status: item.status,
                        oldS: 0,
                        newS: 0,
                        huecos: 0,
                        opacos: 0,
                        oldPart: 0,
                        newPart: 0,
                        oldAct: 0,
                        newAct: 0,
                        oldPct: 0,
                        newPct: 0,
                        oldAhorro: 0,
                        newAhorro: 0,
                        source: "sin_payload",
                        action: "error",
                        note: "No se pudo cargar el borrador",
                    });
                    updateBatchStep({ current: i + 1 });
                    continue;
                }

                const opacosList = Array.isArray(payload.elementosOpacosList) ? payload.elementosOpacosList : [];
                const opacosNoCubiertaFromList = roundTo(
                    opacosList.reduce((sum, el) => {
                        const sup = toFiniteNumber(el?.superficie, 0);
                        return isCubiertaTipo(el?.tipo || "") ? sum : sum + sup;
                    }, 0),
                    2,
                );
                const cubiertaFromList = roundTo(
                    opacosList.reduce((sum, el) => {
                        const sup = toFiniteNumber(el?.superficie, 0);
                        return isCubiertaTipo(el?.tipo || "") ? sum + sup : sum;
                    }, 0),
                    2,
                );
                const particionFromList = roundTo(
                    opacosList.reduce((sum, el) => {
                        const sup = toFiniteNumber(el?.superficie, 0);
                        return isParticionHorizontalTipo(el?.tipo || "") ? sum + sup : sum;
                    }, 0),
                    2,
                );

                const oldS = roundTo(toFiniteNumber(payload.supEnvolvente, 0), 2);
                const oldOpacos = roundTo(toFiniteNumber(payload.supOpacos, 0), 2);
                const oldHuecos = roundTo(toFiniteNumber(payload.supHuecos, 0), 2);
                const oldPart = roundTo(toFiniteNumber(payload.areaHNH, 0), 2);
                const oldAct = roundTo(toFiniteNumber(payload.supActuacion, oldPart), 2);
                const oldPct = oldS > 0 ? roundTo((oldAct / oldS) * 100, 2) : 0;
                const oldAhorro = Math.round(toFiniteNumber(payload.resultado?.ahorro, 0));

                let newS = oldS;
                let source = "supEnvolvente";
                if (opacosNoCubiertaFromList > 0) {
                    newS = opacosNoCubiertaFromList;
                    source = "opacos_list";
                } else if (oldOpacos > 0) {
                    newS = oldOpacos;
                    source = "supOpacos";
                } else if (oldS > 0 && oldHuecos > 0) {
                    newS = roundTo(Math.max(oldS - oldHuecos, 0), 2);
                    source = "S-huecos";
                }

                const oldNHE = roundTo(toFiniteNumber(payload.areaNHE, 0), 2);
                const newPart = particionFromList > 0 ? particionFromList : oldPart;
                const newAct = newPart > 0 ? newPart : oldAct;
                const newNHE = cubiertaFromList > 0 ? cubiertaFromList : oldNHE;

                const zonaValida = payload.zonaKey && VALORES_G[payload.zonaKey] !== undefined
                    ? payload.zonaKey
                    : "D3";

                const recalculated = calcularAhorroCAE({
                    capas: Array.isArray(payload.capas) ? payload.capas : [],
                    area_h_nh: newPart > 0 ? newPart : 25,
                    area_nh_e: newNHE > 0 ? newNHE : 25,
                    superficie_actuacion: newAct > 0 ? newAct : 25,
                    g: VALORES_G[zonaValida],
                    sup_envolvente_total: newS > 0 ? newS : 120,
                    scenario_i: payload.scenarioI || "nada_aislado",
                    scenario_f: payload.scenarioF || "particion_aislada",
                    case_i: payload.caseI || "estanco",
                    case_f: payload.caseF || "estanco",
                    modoCE3X: !!payload.modoCE3X,
                });

                const newPct = newS > 0 ? roundTo((newAct / newS) * 100, 2) : 0;
                const newAhorro = Math.round(toFiniteNumber(recalculated.ahorro, 0));

                const changed =
                    Math.abs(newS - oldS) > 0.01
                    || Math.abs(newPart - oldPart) > 0.01
                    || Math.abs(newAct - oldAct) > 0.01
                    || Math.abs(newNHE - oldNHE) > 0.01;

                let action = "sin_cambios";
                let note = "No requiere ajuste";

                if (changed) {
                    const repairedPayload: CertificateDraftPayload = {
                        ...payload,
                        updatedAt: nowIso,
                        areaHNH: newPart > 0 ? newPart : payload.areaHNH,
                        areaNHE: newNHE > 0 ? newNHE : payload.areaNHE,
                        supActuacion: newAct > 0 ? newAct : payload.supActuacion,
                        supEnvolvente: newS > 0 ? newS : payload.supEnvolvente,
                        supOpacos: newS > 0 ? newS : payload.supOpacos,
                        resultado: recalculated,
                    };

                    const blob = new Blob([JSON.stringify(repairedPayload, null, 2)], { type: "application/json" });
                    const { error: uploadError } = await supabase.storage.from("work_photos").upload(
                        getDraftPath(organizationId, rc),
                        blob,
                        {
                            upsert: true,
                            contentType: "application/json",
                        },
                    );

                    if (uploadError) {
                        failedCount += 1;
                        action = "error";
                        note = `Error guardando: ${uploadError.message}`;
                        issues.push(`${rc}: ${uploadError.message}`);
                    } else {
                        updatedCount += 1;
                        action = "corregido";
                        note = "S ajustada y resultado recalculado";
                        updatedMeta.set(rc, {
                            updatedAt: repairedPayload.updatedAt,
                            clienteNombre: repairedPayload.clienteNombre || [
                                repairedPayload.clienteFirstName,
                                repairedPayload.clienteMiddleName,
                                repairedPayload.clienteLastName1,
                                repairedPayload.clienteLastName2,
                            ].filter(Boolean).join(" "),
                            clienteDni: repairedPayload.clienteDni || "",
                            status: repairedPayload.status,
                        });
                    }
                } else {
                    unchangedCount += 1;
                }

                auditRows.push({
                    rc,
                    status: payload.status,
                    oldS,
                    newS,
                    huecos: oldHuecos,
                    opacos: oldOpacos,
                    oldPart,
                    newPart,
                    oldAct,
                    newAct,
                    oldPct,
                    newPct,
                    oldAhorro,
                    newAhorro,
                    source,
                    action,
                    note,
                });

                updateBatchStep({
                    current: i + 1,
                    detail: `${rc}: ${action}`,
                });
            }

            if (updatedMeta.size > 0) {
                const archivedUpdated = archived.map((item) => {
                    const key = normalizeRc(item.rc);
                    const meta = updatedMeta.get(key);
                    if (!meta) return item;
                    return {
                        ...item,
                        updatedAt: meta.updatedAt,
                        clienteNombre: meta.clienteNombre || item.clienteNombre,
                        clienteDni: meta.clienteDni || item.clienteDni,
                        status: meta.status,
                    };
                });
                await saveArchivedDraftIndex(organizationId, archivedUpdated);
                setArchivedQueue(sortDrafts(archivedUpdated));
            } else {
                setArchivedQueue(sortDrafts(archived));
            }
            setDraftQueue(sortDrafts(active));

            if (auditRows.length > 0) {
                const toCsvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
                const header = [
                    "RC",
                    "Estado",
                    "S_anterior",
                    "S_corregida",
                    "Huecos",
                    "Opacos",
                    "Particion_anterior",
                    "Particion_corregida",
                    "Actuacion_anterior",
                    "Actuacion_corregida",
                    "%_envolvente_anterior",
                    "%_envolvente_corregido",
                    "Ahorro_anterior_kWh",
                    "Ahorro_corregido_kWh",
                    "Fuente_S",
                    "Accion",
                    "Nota",
                ].join(",");

                const rows = auditRows.map((row) => [
                    row.rc,
                    row.status,
                    row.oldS.toFixed(2),
                    row.newS.toFixed(2),
                    row.huecos.toFixed(2),
                    row.opacos.toFixed(2),
                    row.oldPart.toFixed(2),
                    row.newPart.toFixed(2),
                    row.oldAct.toFixed(2),
                    row.newAct.toFixed(2),
                    row.oldPct.toFixed(2),
                    row.newPct.toFixed(2),
                    row.oldAhorro,
                    row.newAhorro,
                    row.source,
                    row.action,
                    row.note,
                ].map(toCsvCell).join(","));

                const csv = [header, ...rows].join("\n");
                const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = `auditoria_reparacion_envolvente_${new Date().toISOString().slice(0, 10)}.csv`;
                link.click();
                URL.revokeObjectURL(url);
            }

            const summary = `Revisión completada: ${updatedCount} corregido(s), ${unchangedCount} sin cambio, ${failedCount} con error.`;
            setDraftMsg(`${summary} Se descargó un CSV de auditoría para corregir PDFs.`);
            if (issues.length > 0) {
                setDraftError(`Incidencias detectadas: ${truncateIssues(issues)}`);
            }
        } catch (error: any) {
            if (isCancelledError(error)) {
                setDraftMsg("Reparación cancelada por el usuario.");
            } else {
                setDraftError(error?.message ?? "No se pudo completar la reparación de archivados.");
            }
        } finally {
            cancelBatchRef.current = false;
            setBatchProgress(null);
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

    const exportarHistorialEmitidosCSV = async () => {
        if (!supabase) return;

        setDraftLoading(true);
        setDraftError(null);
        setDraftMsg(null);

        try {
            const organizationId = await resolveOrganizationOrThrow();
            const issued = await loadIssuedCertificatesIndex(organizationId);
            if (issued.length === 0) {
                setDraftMsg("No hay certificados emitidos registrados en cloud para exportar.");
                setIssuedCertificatesCount(0);
                return;
            }

            const toCsvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
            const header = [
                "RC",
                "Tipo",
                "Archivo",
                "Fecha_emision",
                "Cliente",
                "DNI",
                "Zona",
                "Altitud_msnm",
                "Ahorro_kWh",
                "Ruta_storage",
            ].join(",");

            const rows = issued.map((item) => [
                item.rc,
                item.type,
                item.fileName,
                item.issuedAt,
                item.clienteNombre,
                item.clienteDni,
                item.zonaKey,
                item.alturaMsnm,
                item.ahorroKwh,
                item.storagePath,
            ].map(toCsvCell).join(","));

            const csv = [header, ...rows].join("\n");
            const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `historial_emitidos_${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);

            setIssuedCertificatesCount(issued.length);
            setDraftMsg(`Historial de emitidos exportado (${issued.length} registro(s)).`);
        } catch (error: any) {
            setDraftError(error?.message ?? "No se pudo exportar el historial de emitidos.");
        } finally {
            setDraftLoading(false);
        }
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
            const archivedBeforeImport = await loadArchivedDraftIndex(organizationId);
            const importedRcSet = new Set(indexItems.map((it) => normalizeRc(it.rc)));
            const archivedAfterImport = archivedBeforeImport.filter((it) => !importedRcSet.has(normalizeRc(it.rc)));
            if (archivedAfterImport.length !== archivedBeforeImport.length) {
                await saveArchivedDraftIndex(organizationId, archivedAfterImport);
            }
            await appendImportAudit(organizationId, auditEntries);

            setDraftQueue(sortDrafts(indexItems));
            setArchivedQueue(sortDrafts(archivedAfterImport));
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
            const primaryOrganizationId = await resolvePrimaryOrganizationOrThrow();
            const organizationCandidates = await collectDraftOrganizationCandidates(primaryOrganizationId);

            const loadQueueForOrganization = async (organizationId: string) => {
                const [indexItemsRaw, archivedItemsRaw] = await Promise.all([
                    loadDraftIndex(organizationId),
                    loadArchivedDraftIndex(organizationId),
                ]);

                let { active, archived } = reconcileQueueIndexes(indexItemsRaw, archivedItemsRaw);
                let recoveredCount = 0;

                if (active.length === 0 && archived.length === 0) {
                    const recovered = await recoverIndexesFromStoredDrafts(organizationId);
                    if (recovered.recoveredCount > 0) {
                        active = recovered.active;
                        archived = recovered.archived;
                        recoveredCount = recovered.recoveredCount;
                    }
                }

                return {
                    organizationId,
                    indexItemsRaw,
                    archivedItemsRaw,
                    active,
                    archived,
                    recoveredCount,
                };
            };

            let selectedQueue = await loadQueueForOrganization(primaryOrganizationId);
            let selectedScore = selectedQueue.active.length + selectedQueue.archived.length;

            if (selectedScore === 0) {
                for (const candidateOrgId of organizationCandidates) {
                    if (candidateOrgId === primaryOrganizationId) continue;

                    const candidateQueue = await loadQueueForOrganization(candidateOrgId);
                    const candidateScore = candidateQueue.active.length + candidateQueue.archived.length;
                    if (candidateScore > selectedScore) {
                        selectedQueue = candidateQueue;
                        selectedScore = candidateScore;
                    }

                    if (candidateScore > 0) {
                        break;
                    }
                }
            }

            const persistTasks: Promise<unknown>[] = [];
            if (!indexesAreEqual(selectedQueue.indexItemsRaw, selectedQueue.active)) {
                persistTasks.push(saveDraftIndex(selectedQueue.organizationId, selectedQueue.active));
            }
            if (!indexesAreEqual(selectedQueue.archivedItemsRaw, selectedQueue.archived)) {
                persistTasks.push(saveArchivedDraftIndex(selectedQueue.organizationId, selectedQueue.archived));
            }
            if (persistTasks.length > 0) {
                await Promise.all(persistTasks);
            }

            const switchedOrganization = selectedQueue.organizationId !== primaryOrganizationId;
            if (switchedOrganization && selectedScore > 0) {
                setDraftMsg(
                    `Se detectaron ${selectedScore} expediente(s) en otra organización activa de tu sesión y se cargaron automáticamente.`,
                );
            } else if (selectedQueue.recoveredCount > 0) {
                setDraftMsg(
                    `Se recuperaron ${selectedQueue.recoveredCount} expediente(s) desde nube. `
                    + "Completados quedaron en Archivados y pendientes en cola activa.",
                );
            }

            setDraftStorageOrgId(selectedQueue.organizationId);
            setDraftQueue(selectedQueue.active);
            setArchivedQueue(selectedQueue.archived);

            const issued = await loadIssuedCertificatesIndex(selectedQueue.organizationId);
            setIssuedCertificatesCount(issued.length);
        } catch (error: any) {
            setDraftError(error?.message ?? "No se pudo cargar la cola de certificados.");
        } finally {
            setDraftLoading(false);
        }
    };

    useEffect(() => {
        void refreshDraftQueue();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!ventilationLocked) return;
        setCaseF(caseI);
    }, [caseI, ventilationLocked]);

    useEffect(() => {
        if (!isMoreOptionsOpen) return;
        const handleOutsideClick = (e: MouseEvent) => {
            if (moreOptionsRef.current && !moreOptionsRef.current.contains(e.target as Node)) {
                setIsMoreOptionsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleOutsideClick);
        return () => document.removeEventListener("mousedown", handleOutsideClick);
    }, [isMoreOptionsOpen]);

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
        setDireccionInmueble(payload.direccionInmueble || "");
        setMunicipioInmueble(payload.municipioInmueble || "");
        setCpInmueble(payload.cpInmueble || "");
        setProvinciaInmueble(payload.provinciaInmueble || "");
        setFiltroMetodo(payload.filtroMetodo || {});
        setMaterialSearchByLayer(payload.materialSearchByLayer || {});
        setSoloFavoritosPorCapa(payload.soloFavoritosPorCapa || {});
        setCapturas(payload.capturas || createEmptyCapturasState());
        setResultado(payload.resultado ?? null);
        setLastCalculatedFingerprint(
            payload.resultado
                ? buildCalcFingerprint({
                    capas: Array.isArray(payload.capas) && payload.capas.length > 0 ? payload.capas : cloneInitialCapas(),
                    areaHNH: payload.areaHNH ?? 25,
                    areaNHE: payload.areaNHE ?? 25,
                    supActuacion: payload.supActuacion ?? 25,
                    supEnvolvente: payload.supEnvolvente ?? 120,
                    zonaKey: payload.zonaKey || "D3",
                    scenarioI: payload.scenarioI || "nada_aislado",
                    scenarioF: payload.scenarioF || "particion_aislada",
                    caseI: payload.caseI || "estanco",
                    caseF: payload.caseF || "estanco",
                    modoCE3X: !!payload.modoCE3X,
                    overrideUi: payload.overrideUi || "",
                    overrideUf: payload.overrideUf || "",
                })
                : null,
        );
        setSupOpacos(payload.supOpacos ?? 0);
        setSupHuecos(payload.supHuecos ?? 0);
        setElementosOpacosList(payload.elementosOpacosList || []);
        setElementosHuecosList(payload.elementosHuecosList || []);
    };

    const saveCurrentDraft = async (
        statusOverride?: CertDraftStatus,
        options?: { suppressSuccessMessage?: boolean },
    ): Promise<boolean> => {
        const rcNormalized = normalizeRc(expedienteRc);
        if (!rcNormalized) {
            setDraftError("Debes indicar Referencia Catastral para guardar el certificado.");
            return false;
        }
        if (!supabase) {
            setDraftError("Supabase no está configurado en esta sesión.");
            return false;
        }

        setDraftSaving(true);
        setDraftError(null);
        setDraftMsg(null);
        try {
            const organizationId = await resolveOrganizationOrThrow();
            const finalStatus = statusOverride ?? certStatus;
            const nowIso = new Date().toISOString();
            const localUpdatedAt = Date.now();

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
                direccionInmueble,
                municipioInmueble,
                cpInmueble,
                provinciaInmueble,
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

            let mvpSyncWarning: string | null = null;
            let mvpSyncNote: string | null = null;

            if (isExpedienteMvpSyncEnabled()) {
                announceExpedienteTabWrite(rcNormalized);
            }

            const mvpSyncResult = await syncDraftToMvpExpediente(rcNormalized, finalStatus, payload);
            if (!mvpSyncResult.ok && mvpSyncResult.warning) {
                mvpSyncWarning = mvpSyncResult.warning;
                console.warn(`[MVP anti-loss] ${mvpSyncWarning}`);
                setMvpSyncStatus("error");
            }

            if (mvpSyncResult.ok && isExpedienteMvpSyncEnabled()) {
                setMvpSyncStatus("synced");
            }

            if (isExpedienteMvpSyncEnabled()) {
                if (!mvpSyncResult.ok) {
                    const currentMeta = expedienteMvpMetaRef.current[rcNormalized];
                    await upsertOfflineExpedienteWrite({
                        rc: rcNormalized,
                        datos: payload as unknown as Record<string, unknown>,
                        status: mapDraftStatusToExpedienteStatus(finalStatus),
                        expedienteId: currentMeta?.expedienteId ?? null,
                        versionToken: currentMeta?.versionToken ?? null,
                        localUpdatedAt,
                        lastError: mvpSyncWarning,
                    });

                    const pendingWrites = await countOfflineExpedienteWrites();
                    setMvpSyncPendingCount(pendingWrites);
                    setMvpSyncStatus("queued");
                    mvpSyncNote = `Guardado en cola SQL offline (${pendingWrites} pendiente(s)).`;
                } else {
                    const report = await flushOfflineExpedienteQueueNow("manual");
                    applySyncReportToUi(report);

                    if (report.synced > 0) {
                        mvpSyncNote = `Sincronización SQL MVP: ${report.synced} pendiente(s) enviados.`;
                    }
                }
            }

            const draftPath = getDraftPath(organizationId, rcNormalized);
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
            const { error } = await supabase.storage.from("work_photos").upload(draftPath, blob, {
                upsert: true,
                contentType: "application/json",
            });
            if (error) throw error;

            const [activeRaw, archivedRaw] = await Promise.all([
                loadDraftIndex(organizationId),
                loadArchivedDraftIndex(organizationId),
            ]);

            const { active, archived } = reconcileQueueIndexes(activeRaw, archivedRaw);
            const updatedItem: CertificateDraftIndexItem = {
                rc: rcNormalized,
                status: finalStatus,
                updatedAt: nowIso,
                clienteNombre: [clienteFirstName, clienteMiddleName, clienteLastName1, clienteLastName2].filter(Boolean).join(" "),
                clienteDni: clienteDni.trim(),
            };

            const merged = mergeDraftIndexes(active, [updatedItem]);
            const archivedFiltered = archived.filter((it) => normalizeRc(it.rc) !== rcNormalized);

            const persistTasks: Promise<unknown>[] = [saveDraftIndex(organizationId, merged)];
            if (!indexesAreEqual(archivedRaw, archivedFiltered)) {
                persistTasks.push(saveArchivedDraftIndex(organizationId, archivedFiltered));
            }
            await Promise.all(persistTasks);

            setCertStatus(finalStatus);
            setExpedienteRc(rcNormalized);
            setDraftQueue(sortDrafts(merged));
            setArchivedQueue(sortDrafts(archivedFiltered));
            if (!options?.suppressSuccessMessage) {
                const successMsg = finalStatus === "completado"
                    ? `Certificado ${rcNormalized} marcado como completado y guardado.`
                    : `Borrador ${rcNormalized} guardado correctamente.`;

                const extraMsg = [
                    mvpSyncNote,
                    mvpSyncWarning ? `Aviso: ${mvpSyncWarning}` : null,
                ].filter(Boolean).join(" ");

                setDraftMsg(extraMsg ? `${successMsg} ${extraMsg}` : successMsg);
            }
            return true;
        } catch (error: any) {
            setDraftError(error?.message ?? "No se pudo guardar el borrador.");
            return false;
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

    const restaurarArchivado = async (item: CertificateDraftIndexItem) => {
        if (!supabase) return;
        setDraftLoading(true);
        setDraftError(null);
        setDraftMsg(null);
        try {
            const organizationId = await resolveOrganizationOrThrow();
            const [activeRaw, archivedRaw] = await Promise.all([
                loadDraftIndex(organizationId),
                loadArchivedDraftIndex(organizationId),
            ]);

            const { active, archived } = reconcileQueueIndexes(activeRaw, archivedRaw);

            const rcNormalized = normalizeRc(item.rc);
            const archivedItem = archived.find((it) => normalizeRc(it.rc) === rcNormalized) ?? item;
            const archivedRemaining = archived.filter((it) => normalizeRc(it.rc) !== rcNormalized);
            const restored = mergeDraftIndexes(active, [archivedItem]);

            await Promise.all([
                saveDraftIndex(organizationId, restored),
                saveArchivedDraftIndex(organizationId, archivedRemaining),
            ]);

            setDraftQueue(restored);
            setArchivedQueue(sortDrafts(archivedRemaining));
            setDraftMsg(`Expediente ${item.rc} restaurado a la cola activa.`);
        } catch (error: any) {
            setDraftError(error?.message ?? "No se pudo restaurar el expediente archivado.");
        } finally {
            setDraftLoading(false);
        }
    };

    const restaurarTodosArchivados = async () => {
        if (!supabase) return;
        if (archivedQueue.length === 0) {
            setDraftMsg("No hay expedientes archivados para restaurar.");
            return;
        }
        if (!confirm(`¿Restaurar ${archivedQueue.length} expediente(s) archivado(s) a la cola activa?`)) return;

        setDraftLoading(true);
        setDraftError(null);
        setDraftMsg(null);
        try {
            const organizationId = await resolveOrganizationOrThrow();
            const [activeRaw, archivedRaw] = await Promise.all([
                loadDraftIndex(organizationId),
                loadArchivedDraftIndex(organizationId),
            ]);

            const { active, archived } = reconcileQueueIndexes(activeRaw, archivedRaw);

            if (archived.length === 0) {
                setArchivedQueue([]);
                setDraftMsg("No hay expedientes archivados disponibles en nube.");
                return;
            }

            const restored = mergeDraftIndexes(active, archived);
            await Promise.all([
                saveDraftIndex(organizationId, restored),
                saveArchivedDraftIndex(organizationId, []),
            ]);

            setDraftQueue(restored);
            setArchivedQueue([]);
            setDraftMsg(`${archived.length} expediente(s) restaurado(s) a la cola activa.`);
        } catch (error: any) {
            setDraftError(error?.message ?? "No se pudieron restaurar los expedientes archivados.");
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
        setLastCalculatedFingerprint(null);
        setXmlFileName("");
        setXmlImportMsg("Nuevo expediente preparado. Define RC y comienza el siguiente certificado.");
        setDraftMsg(null);
        setDraftError(null);
    };

    const guardarSueltoRapido = async () => {
        const rcNormalized = normalizeRc(expedienteRc);
        if (!rcNormalized) {
            setDraftError("Debes indicar Referencia Catastral para guardar el certificado.");
            return;
        }

        const saved = await saveCurrentDraft("completado", { suppressSuccessMessage: true });
        if (!saved) return;

        const archived = await archivarCompletados({ onlyRc: rcNormalized, skipConfirm: true });
        if (!archived) return;

        resetForNewCertificate();
        setDraftMsg(`Expediente ${rcNormalized} completado y archivado. Listo para el siguiente.`);
    };

    const completarYCargarSiguiente = async () => {
        const rcNormalized = normalizeRc(expedienteRc);
        if (!rcNormalized) {
            setDraftError("Debes indicar Referencia Catastral para completar y cargar el siguiente.");
            return;
        }

        const saved = await saveCurrentDraft("completado", { suppressSuccessMessage: true });
        if (!saved) return;

        if (!supabase) {
            setDraftMsg(`Expediente ${rcNormalized} marcado como completado.`);
            return;
        }

        setDraftLoading(true);
        setDraftError(null);
        try {
            const organizationId = await resolveOrganizationOrThrow();
            const [activeRaw, archivedRaw] = await Promise.all([
                loadDraftIndex(organizationId),
                loadArchivedDraftIndex(organizationId),
            ]);

            const { active, archived } = reconcileQueueIndexes(activeRaw, archivedRaw);
            const activeSorted = sortDrafts(active);
            const archivedSorted = sortDrafts(archived);

            setDraftQueue(activeSorted);
            setArchivedQueue(archivedSorted);

            const next = activeSorted.find((item) => {
                const itemRc = normalizeRc(item.rc);
                return item.status !== "completado" && itemRc !== rcNormalized;
            });

            if (!next) {
                setDraftMsg(`Expediente ${rcNormalized} completado. No hay pendientes para cargar.`);
                return;
            }

            const payload = await loadDraftPayload(organizationId, next.rc);
            if (!payload) {
                setDraftMsg(`Expediente ${rcNormalized} completado. El siguiente (${next.rc}) no se pudo cargar automáticamente.`);
                return;
            }

            applyDraftPayload(payload);
            setDraftMsg(`Expediente ${rcNormalized} completado. Cargado siguiente pendiente: ${next.rc}.`);
        } catch (error: any) {
            setDraftError(error?.message ?? "No se pudo completar y cargar el siguiente expediente.");
        } finally {
            setDraftLoading(false);
        }
    };

    const copiarDatosClavePDF = async () => {
        const rcNormalized = normalizeRc(expedienteRc);
        if (!rcNormalized) {
            setDraftError("Debes indicar Referencia Catastral antes de copiar datos para PDF.");
            return;
        }

        const porcentajeEnvolvente = supEnvolvente > 0
            ? roundTo((supActuacion / supEnvolvente) * 100, 2)
            : 0;
        const ahorro = Math.round(toFiniteNumber(resultado?.ahorro, 0));
        const supEnvolventeFmt = roundTo(supEnvolvente, 2);
        const supHuecosFmt = roundTo(supHuecos, 2);
        const supOpacosNetosFmt = roundTo(Math.max(supEnvolventeFmt - supHuecosFmt, 0), 2);

        const resumen = [
            `RC: ${rcNormalized}`,
            `S envolvente (m2): ${supEnvolventeFmt.toFixed(2)}`,
            ...(supHuecosFmt > 0 && supEnvolventeFmt >= supHuecosFmt
                ? [`Desglose S (opacos netos + huecos): ${supOpacosNetosFmt.toFixed(2)} + ${supHuecosFmt.toFixed(2)} = ${supEnvolventeFmt.toFixed(2)}`]
                : []),
            `% envolvente: ${porcentajeEnvolvente.toFixed(2)}`,
            `Particion HNH (m2): ${roundTo(areaHNH, 2).toFixed(2)}`,
            `Superficie actuacion (m2): ${roundTo(supActuacion, 2).toFixed(2)}`,
            `Ahorro (kWh): ${ahorro}`,
        ].join("\n");

        try {
            await navigator.clipboard.writeText(resumen);
            setDraftError(null);
            setDraftMsg(`Datos clave del expediente ${rcNormalized} copiados al portapapeles.`);
        } catch {
            setDraftError("No se pudo copiar al portapapeles. Revisa permisos del navegador.");
        }
    };

    const prepararSiguienteLote = async () => {
        const completedInUi = draftQueue.filter((item) => item.status === "completado").length;
        const pendingInUi = draftQueue.length - completedInUi;
        const summaryChunks: string[] = [];

        if (completedInUi > 0) {
            summaryChunks.push(`${completedInUi} completado(s) se archivaran`);
        }
        if (pendingInUi > 0) {
            summaryChunks.push(`${pendingInUi} pendiente(s) quedaran en cola activa`);
        }

        if (summaryChunks.length > 0) {
            const ok = confirm(`Preparar siguiente lote: ${summaryChunks.join(" · ")}. ¿Continuar?`);
            if (!ok) return;
        }

        if (!supabase) {
            resetForNewCertificate();
            setQueueSearch("");
            setArchivedSearch("");
            setDraftMsg("Pantalla preparada para el siguiente lote (modo local).");
            return;
        }

        setDraftLoading(true);
        setDraftError(null);
        setDraftMsg(null);
        try {
            const organizationId = await resolveOrganizationOrThrow();
            const [activeRaw, archivedRaw] = await Promise.all([
                loadDraftIndex(organizationId),
                loadArchivedDraftIndex(organizationId),
            ]);

            const { active, archived } = reconcileQueueIndexes(activeRaw, archivedRaw);
            const completedActive = active.filter((item) => item.status === "completado");
            const activeWithoutCompleted = active.filter((item) => item.status !== "completado");
            const archivedUpdated = completedActive.length > 0 ? mergeDraftIndexes(archived, completedActive) : archived;

            const persistTasks: Promise<unknown>[] = [];
            if (!indexesAreEqual(activeRaw, activeWithoutCompleted)) {
                persistTasks.push(saveDraftIndex(organizationId, activeWithoutCompleted));
            }
            if (!indexesAreEqual(archivedRaw, archivedUpdated)) {
                persistTasks.push(saveArchivedDraftIndex(organizationId, archivedUpdated));
            }
            if (persistTasks.length > 0) {
                await Promise.all(persistTasks);
            }

            setDraftQueue(sortDrafts(activeWithoutCompleted));
            setArchivedQueue(sortDrafts(archivedUpdated));
            setQueueSearch("");
            setArchivedSearch("");
            resetForNewCertificate();

            const archivedMsg = completedActive.length > 0
                ? `${completedActive.length} completado(s) archivado(s). `
                : "";
            setDraftMsg(
                `${archivedMsg}Pantalla lista para el proximo lote. Activos: ${activeWithoutCompleted.length} · Archivados: ${archivedUpdated.length}.`,
            );
        } catch (error: any) {
            setDraftError(error?.message ?? "No se pudo preparar la pantalla para el siguiente lote.");
        } finally {
            setDraftLoading(false);
        }
    };

    const queueTotal = draftQueue.length;
    const queueCompleted = draftQueue.filter((it) => it.status === "completado").length;
    const queuePending = queueTotal - queueCompleted;
    const archivedTotal = archivedQueue.length;
    const filteredDraftQueue = useMemo(
        () => draftQueue.filter((item) => queueItemMatchesSearch(item, queueSearch)),
        [draftQueue, queueSearch],
    );
    const filteredArchivedQueue = useMemo(
        () => archivedQueue.filter((item) => queueItemMatchesSearch(item, archivedSearch)),
        [archivedQueue, archivedSearch],
    );
    const batchProgressPercent = batchProgress
        ? (batchProgress.total > 0 ? Math.min(100, Math.round((batchProgress.current / batchProgress.total) * 100)) : 0)
        : 0;
    const batchModeLabel = batchProgress?.mode === "export"
        ? "Exportación"
        : batchProgress?.mode === "import"
            ? "Importación"
            : "Reparación";

    const mvpSyncBadge = {
        idle: {
            label: "SQL MVP inactivo",
            className: "border-slate-700/40 text-slate-300 bg-slate-900/20",
        },
        queued: {
            label: `SQL MVP en cola (${mvpSyncPendingCount})`,
            className: "border-amber-700/40 text-amber-300 bg-amber-900/20",
        },
        synced: {
            label: "SQL MVP sincronizado",
            className: "border-emerald-700/40 text-emerald-300 bg-emerald-900/20",
        },
        conflict: {
            label: "SQL MVP conflicto",
            className: "border-rose-700/40 text-rose-300 bg-rose-900/20",
        },
        error: {
            label: "SQL MVP error",
            className: "border-orange-700/40 text-orange-300 bg-orange-900/20",
        },
    }[mvpSyncStatus];

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

    const toggleArchivedQueuePanel = () => {
        setShowArchivedQueuePanel((prev) => {
            const next = !prev;
            if (!next) setArchivedSearch("");
            return next;
        });
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
                <div className="flex items-center gap-4">
                    <ModoSwitch />
                    <button
                        onClick={clearLocalCalcMemory}
                        className="h-8 px-3 rounded-md border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 text-xs hidden sm:flex"
                        title="Borra memoria local del formulario guardada en este navegador"
                    >
                        Limpiar memoria local
                    </button>
                </div>
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
                        <div className={`transition-all duration-300 ${isExperto ? 'block' : 'hidden'}`}>
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
                        <div className={`md:col-span-2 grid-cols-3 gap-2 items-end transition-all duration-300 ${isExperto ? 'grid' : 'hidden'}`}>
                            <button
                                onClick={() => saveCurrentDraft()}
                                disabled={draftSaving}
                                className="h-9 px-3 rounded-md bg-amber-900/30 border border-amber-700/40 text-amber-300 hover:bg-amber-800/40 disabled:opacity-40 text-xs inline-flex items-center justify-center gap-1"
                            >
                                <Save className="h-3.5 w-3.5" />
                                Guardar
                            </button>
                            <button
                                onClick={() => completarYCargarSiguiente()}
                                disabled={draftSaving || draftLoading}
                                className="h-9 px-3 rounded-md bg-emerald-900/30 border border-emerald-700/40 text-emerald-300 hover:bg-emerald-800/40 disabled:opacity-40 text-xs inline-flex items-center justify-center gap-1"
                                title="Flujo lote: completa el actual y abre automáticamente el siguiente pendiente"
                            >
                                <CircleCheckBig className="h-3.5 w-3.5" />
                                Completar + sig.
                            </button>
                            <button
                                onClick={() => guardarSueltoRapido()}
                                disabled={draftSaving || draftLoading}
                                className="h-9 px-3 rounded-md bg-violet-900/30 border border-violet-700/40 text-violet-300 hover:bg-violet-800/40 disabled:opacity-40 text-xs inline-flex items-center justify-center gap-1"
                                title="Pensado para trabajo suelto: guarda, completa y archiva en un solo paso"
                            >
                                <Archive className="h-3.5 w-3.5" />
                                Suelto rapido
                            </button>
                        </div>
                    </div>

                    <div className={`flex flex-wrap items-center gap-2 text-xs transition-all duration-300 ${isExperto ? 'block' : 'hidden'}`}>
                        <span className="px-2 py-1 rounded border border-slate-700 text-slate-300 bg-slate-900/40">Total: {queueTotal}</span>
                        <span className="px-2 py-1 rounded border border-amber-700/40 text-amber-300 bg-amber-900/20">Pendientes: {queuePending}</span>
                        <span className="px-2 py-1 rounded border border-emerald-700/40 text-emerald-300 bg-emerald-900/20">Completados: {queueCompleted}</span>
                        <span className="px-2 py-1 rounded border border-violet-700/40 text-violet-300 bg-violet-900/20">Archivados: {archivedTotal}</span>
                        <span className="px-2 py-1 rounded border border-cyan-700/40 text-cyan-300 bg-cyan-900/20">Emitidos cloud: {issuedCertificatesCount}</span>
                        {isExpedienteMvpSyncEnabled() && (
                            <span className={`px-2 py-1 rounded border ${mvpSyncBadge.className}`}>
                                {mvpSyncBadge.label}
                            </span>
                        )}
                        <button
                            onClick={toggleArchivedQueuePanel}
                            className="h-8 px-3 rounded-md bg-violet-900/20 border border-violet-700/40 text-violet-200 hover:bg-violet-800/40 inline-flex items-center gap-1"
                            title="Muestra u oculta la cola archivada sin perderla"
                        >
                            {showArchivedQueuePanel ? "Ocultar archivados" : "Ver archivados"}
                        </button>
                        <button
                            onClick={() => refreshDraftQueue()}
                            disabled={draftLoading}
                            className="h-8 px-3 rounded-md bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 disabled:opacity-40 inline-flex items-center gap-1"
                        >
                            <RefreshCcw className="h-3.5 w-3.5" />
                            Refrescar cola
                        </button>
                    </div>

                    <input type="file" ref={fileInputRef} onChange={importarBackupJSON} accept=".json,.zip,application/zip" className="hidden" />
                    <div className="flex flex-wrap gap-2 items-center">
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

                        {/* Botón Gestión Avanzada de Lotes */}
                        <div className="relative">
                            <Button
                                variant="outline"
                                className="h-8 text-xs border-slate-600 bg-slate-700/40"
                                onClick={() => setIsLotesSheetOpen(true)}
                            >
                                <Zap className="mr-2 h-3.5 w-3.5 text-cyan-400" />
                                Gestión de Lotes
                            </Button>
                            
                            <GestionLotesSheet open={isLotesSheetOpen} onOpenChange={setIsLotesSheetOpen}>
                                    <button
                                        onClick={() => { void copiarDatosClavePDF(); setIsLotesSheetOpen(false); }}
                                        disabled={draftLoading || draftSaving}
                                        className="h-10 px-3 rounded-md bg-teal-900/30 border border-teal-700/40 text-teal-300 hover:bg-teal-800/40 disabled:opacity-40 text-sm inline-flex items-center gap-3 w-full"
                                        title="Copia RC, S, % envolvente y ahorro para pegar en PDF sin errores"
                                    >
                                        <Copy className="h-4 w-4" />
                                        Copiar datos PDF
                                    </button>
                                    <button
                                        onClick={() => { prepararSiguienteLote(); setIsLotesSheetOpen(false); }}
                                        disabled={draftLoading || draftSaving}
                                        className="h-10 px-3 rounded-md bg-sky-900/30 border border-sky-700/40 text-sky-300 hover:bg-sky-800/40 disabled:opacity-40 text-sm inline-flex items-center gap-3 w-full"
                                        title="Archiva completados activos, limpia el formulario y deja la cola lista para arrancar otro lote"
                                    >
                                        <ArrowRight className="h-4 w-4" />
                                        Preparar siguiente lote
                                    </button>
                                    <button
                                        onClick={() => { void exportarHistorialEmitidosCSV(); setIsLotesSheetOpen(false); }}
                                        disabled={draftLoading || issuedCertificatesCount === 0}
                                        className="h-10 px-3 rounded-md bg-cyan-900/30 border border-cyan-700/40 text-cyan-300 hover:bg-cyan-800/40 disabled:opacity-40 text-sm inline-flex items-center gap-3 w-full"
                                        title="Exportar historial cloud de certificados emitidos"
                                    >
                                        <FileDown className="h-4 w-4" />
                                        Historial emitidos CSV
                                    </button>
                                    <button
                                        onClick={() => { exportarLoteCSV(); setIsLotesSheetOpen(false); }}
                                        disabled={queueTotal === 0}
                                        className="h-10 px-3 rounded-md bg-emerald-900/30 border border-emerald-700/40 text-emerald-300 hover:bg-emerald-800/40 disabled:opacity-40 text-sm inline-flex items-center gap-3 w-full"
                                    >
                                        <FileDown className="h-4 w-4" />
                                        Lote CSV
                                    </button>
                                    <button
                                        onClick={() => { exportarBackupJSON(); setIsLotesSheetOpen(false); }}
                                        disabled={draftLoading || queueTotal === 0}
                                        className="h-10 px-3 rounded-md bg-cyan-900/30 border border-cyan-700/40 text-cyan-300 hover:bg-cyan-800/40 disabled:opacity-40 text-sm inline-flex items-center gap-3 w-full"
                                        title="Exportar lote completo con imágenes en ZIP comprimido"
                                    >
                                        <Save className="h-4 w-4" />
                                        Exportar ZIP
                                    </button>
                                    <button
                                        onClick={() => { fileInputRef.current?.click(); setIsLotesSheetOpen(false); }}
                                        disabled={draftLoading}
                                        className="h-10 px-3 rounded-md bg-blue-900/30 border border-blue-700/40 text-blue-300 hover:bg-blue-800/40 disabled:opacity-40 text-sm inline-flex items-center gap-3 w-full"
                                        title="Importar backup JSON o ZIP"
                                    >
                                        <UploadCloud className="h-4 w-4" />
                                        Importar backup
                                    </button>
                                    <button
                                        onClick={() => { archivarCompletados(); setIsLotesSheetOpen(false); }}
                                        disabled={draftLoading || queueCompleted === 0}
                                        className="h-10 px-3 rounded-md bg-rose-900/30 border border-rose-700/40 text-rose-300 hover:bg-rose-800/40 disabled:opacity-40 text-sm inline-flex items-center gap-3 w-full"
                                        title="Mueve a archivados los expedientes completados de la cola activa"
                                    >
                                        <Archive className="h-4 w-4" />
                                        Archivar completados
                                    </button>
                                    <button
                                        onClick={() => { repararArchivadosEnvolvente(); setIsLotesSheetOpen(false); }}
                                        disabled={draftLoading || archivedTotal === 0}
                                        className="h-10 px-3 rounded-md bg-orange-900/30 border border-orange-700/40 text-orange-300 hover:bg-orange-800/40 disabled:opacity-40 text-sm inline-flex items-center gap-3 w-full"
                                        title="Audita archivados, corrige S sin huecos y recalcula automáticamente"
                                    >
                                        <Zap className="h-4 w-4" />
                                        Reparar S archivados
                                    </button>
                                    <button
                                        onClick={() => { restaurarTodosArchivados(); setIsLotesSheetOpen(false); }}
                                        disabled={draftLoading || archivedTotal === 0}
                                        className="h-10 px-3 rounded-md bg-violet-900/30 border border-violet-700/40 text-violet-300 hover:bg-violet-800/40 disabled:opacity-40 text-sm inline-flex items-center gap-3 w-full"
                                        title="Restaura todos los expedientes archivados a la cola"
                                    >
                                        <RefreshCcw className="h-4 w-4" />
                                        Restaurar archivados
                                    </button>
                                    <div className="h-10 px-3 rounded-md border border-slate-700 bg-slate-900/40 flex flex-col justify-center gap-1 text-xs text-slate-300 w-full mb-4">
                                        <span>Acción al duplicar:</span>
                                        <select
                                            value={backupImportStrategy}
                                            onChange={(e) => setBackupImportStrategy(e.target.value as ImportMergeStrategy)}
                                            disabled={draftLoading}
                                            className="h-8 rounded bg-slate-900 border border-slate-700 px-2 text-xs w-full"
                                            title="Estrategia al detectar RC duplicada durante importación"
                                        >
                                            <option value="merge">Fusionar datos</option>
                                            <option value="overwrite">Sobrescribir</option>
                                            <option value="skip">Omitir</option>
                                        </select>
                                    </div>
                            </GestionLotesSheet>
                        </div>
                    </div>

                    {batchProgress && (
                        <div className="rounded-md border border-cyan-700/40 bg-cyan-900/10 px-3 py-2 space-y-2">
                            <div className="flex items-center justify-between text-[11px] text-cyan-200">
                                <span>
                                    {batchModeLabel}
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

                    {pendingConflictResolution && (
                        <div className="text-xs text-rose-200 bg-rose-950/30 border border-rose-700/40 px-3 py-3 rounded-md space-y-2">
                            <p className="font-semibold">
                                Conflicto SQL MVP en {pendingConflictResolution.rc}
                            </p>
                            <p className="text-rose-100/90">
                                {pendingConflictResolution.context.sameUser
                                    ? "Se detectó un cambio reciente de tu misma sesión (posible multi-pestaña)."
                                    : "Se detectó un cambio remoto de otra sesión o usuario."}
                            </p>
                            <p className="text-rose-100/80">
                                Campos distintos: {pendingConflictResolution.context.diffKeys.length > 0
                                    ? pendingConflictResolution.context.diffKeys.slice(0, 8).join(", ")
                                    : "sin detalle disponible"}.
                            </p>
                            <p className="text-rose-100/70">
                                Última actualización remota: {pendingConflictResolution.context.remoteUpdatedAt
                                    ? new Date(pendingConflictResolution.context.remoteUpdatedAt).toLocaleString()
                                    : "sin fecha remota"}.
                            </p>
                            <div className="flex flex-wrap gap-2 pt-1">
                                <button
                                    onClick={() => void resolvePendingConflict("local_wins")}
                                    disabled={conflictDecisionBusy}
                                    className="h-8 px-3 rounded-md bg-amber-900/40 border border-amber-700/40 text-amber-200 hover:bg-amber-800/50 disabled:opacity-40"
                                >
                                    Conservar mi versión
                                </button>
                                <button
                                    onClick={() => void resolvePendingConflict("remote_wins")}
                                    disabled={conflictDecisionBusy}
                                    className="h-8 px-3 rounded-md bg-slate-800 border border-slate-600 text-slate-200 hover:bg-slate-700 disabled:opacity-40"
                                >
                                    Aceptar versión remota
                                </button>
                            </div>
                        </div>
                    )}

                    <div className={`grid grid-cols-1 ${showArchivedQueuePanel ? "md:grid-cols-2" : ""} gap-2 transition-all duration-300 ${isExperto ? 'block' : 'hidden'}`}>
                        <div className="flex items-center gap-2">
                            <Input
                                value={queueSearch}
                                onChange={(e) => setQueueSearch(e.target.value)}
                                placeholder="Buscar en cola activa (RC, nombre, DNI)"
                                className="h-8 bg-slate-900/50 border-slate-700 text-slate-200 text-xs"
                            />
                            {queueSearch.trim() && (
                                <button
                                    onClick={() => setQueueSearch("")}
                                    className="h-8 w-8 rounded-md border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500 inline-flex items-center justify-center"
                                    title="Limpiar búsqueda activa"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            )}
                        </div>
                        {showArchivedQueuePanel && (
                            <div className="flex items-center gap-2">
                                <Input
                                    value={archivedSearch}
                                    onChange={(e) => setArchivedSearch(e.target.value)}
                                    placeholder="Buscar en archivados (RC, nombre, DNI)"
                                    className="h-8 bg-violet-950/20 border-violet-800/40 text-violet-100 text-xs"
                                />
                                {archivedSearch.trim() && (
                                    <button
                                        onClick={() => setArchivedSearch("")}
                                        className="h-8 w-8 rounded-md border border-violet-700/40 text-violet-200 hover:text-white hover:border-violet-500 inline-flex items-center justify-center"
                                        title="Limpiar búsqueda en archivados"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {!showArchivedQueuePanel && archivedTotal > 0 && (
                        <p className="text-[11px] text-violet-200/70">
                            Archivados ocultos para no mezclar el lote actual. Usa "Ver archivados" cuando necesites recuperar alguno.
                        </p>
                    )}

                    <div className={`rounded-md border border-slate-800 bg-slate-950/30 max-h-52 overflow-y-auto transition-all duration-300 ${isExperto ? 'block' : 'hidden'}`}>
                        {draftLoading ? (
                            <div className="px-3 py-3 text-xs text-slate-400">Cargando cola de certificados...</div>
                        ) : draftQueue.length === 0 ? (
                            <div className="px-3 py-3 text-xs text-slate-500">Sin expedientes en cola. Guarda el primero para iniciar el lote.</div>
                        ) : filteredDraftQueue.length === 0 ? (
                            <div className="px-3 py-3 text-xs text-slate-500">Sin coincidencias en cola activa para "{queueSearch}".</div>
                        ) : (
                            <div className="divide-y divide-slate-800">
                                {filteredDraftQueue.map((item) => (
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

                    {showArchivedQueuePanel && (
                        <div className="rounded-md border border-violet-900/40 bg-violet-950/20 max-h-44 overflow-y-auto">
                            {archivedQueue.length === 0 ? (
                                <div className="px-3 py-3 text-xs text-violet-200/70">Sin expedientes archivados.</div>
                            ) : filteredArchivedQueue.length === 0 ? (
                                <div className="px-3 py-3 text-xs text-violet-200/70">Sin coincidencias en archivados para "{archivedSearch}".</div>
                            ) : (
                                <div className="divide-y divide-violet-900/40">
                                    {filteredArchivedQueue.map((item) => (
                                        <div key={`archived-${item.rc}`} className="px-3 py-2 flex items-center gap-2">
                                            <button
                                                onClick={() => loadDraft(item)}
                                                className="text-left flex-1 min-w-0"
                                                title="Cargar expediente archivado en el formulario"
                                            >
                                                <p className="text-xs text-violet-100 font-mono truncate">{item.rc}</p>
                                                <p className="text-[11px] text-violet-200/70 truncate">
                                                    {item.clienteNombre || "Sin nombre"}
                                                    {item.clienteDni ? ` · ${item.clienteDni}` : ""}
                                                    {` · ${new Date(item.updatedAt).toLocaleString()}`}
                                                </p>
                                            </button>
                                            <button
                                                onClick={() => restaurarArchivado(item)}
                                                disabled={draftLoading}
                                                className="h-7 px-2 rounded-md bg-violet-900/30 border border-violet-700/40 text-violet-200 hover:bg-violet-800/40 disabled:opacity-40 text-[11px] inline-flex items-center gap-1"
                                                title="Restaurar este expediente a la cola activa"
                                            >
                                                <RefreshCcw className="h-3 w-3" />
                                                Restaurar
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
                    )}
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
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
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

                        <button
                            type="button"
                            onClick={() => void revalidarCatastroActual()}
                            disabled={!normalizeRc(expedienteRc)}
                            className="h-10 inline-flex items-center justify-center gap-2 px-4 rounded-md border border-emerald-700/40 text-emerald-300 hover:bg-emerald-900/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <Search className="h-4 w-4" />
                            Revalidar Catastro
                        </button>
                    </div>

                    {xmlImportMsg && (
                        <div className={`text-xs px-3 py-2 rounded-md border ${xmlImportMsg.includes("⚠️")
                            ? "text-amber-300 bg-amber-500/10 border-amber-500/30"
                            : "text-cyan-300 bg-cyan-500/10 border-cyan-500/30"
                            }`}>
                            {xmlImportMsg}
                        </div>
                    )}

                    {catastroVerificationBanner && (
                        <div className={`text-xs px-3 py-2 rounded-md border ${catastroVerificationBanner.tone === "warning"
                            ? "text-amber-300 bg-amber-500/10 border-amber-500/30"
                            : catastroVerificationBanner.tone === "ok"
                                ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/30"
                                : "text-sky-300 bg-sky-500/10 border-sky-500/30"
                            }`}>
                            {catastroVerificationBanner.message}
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

                    {(() => {
                        const activeKey = dniFlipped ? "dni_cliente_back" : "dni_cliente";
                        const activeLabel = dniFlipped ? "Reverso" : "Anverso";
                        const activeData = dniFlipped ? dniBackPreview : dniPreview;
                        return (
                            <div className="rounded-md border border-indigo-500/20 bg-indigo-500/5 p-3">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <p className="text-[10px] uppercase font-bold text-indigo-300">DNI {activeLabel}</p>
                                        <span className="text-[9px] text-slate-500">({dniFlipped ? "2/2" : "1/2"})</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            onClick={() => openCapturaPreview(activeKey, `DNI ${activeLabel}`)}
                                            disabled={!activeData}
                                            className="h-6 px-2 rounded bg-indigo-900/30 border border-indigo-700/40 text-indigo-300 hover:bg-indigo-800/40 disabled:opacity-40 text-[10px] inline-flex items-center gap-1"
                                        >
                                            <ZoomIn className="h-3 w-3" />
                                            Zoom
                                        </button>
                                        <button
                                            onClick={() => setDniFlipped(f => !f)}
                                            className="h-6 px-2.5 rounded bg-indigo-900/40 border border-indigo-700/40 text-indigo-300 hover:bg-indigo-800/50 text-[10px] font-semibold inline-flex items-center gap-1 transition-all active:scale-95"
                                            title={`Ver ${dniFlipped ? 'Anverso' : 'Reverso'}`}
                                        >
                                            <RefreshCcw className={`h-3 w-3 transition-transform duration-300 ${dniFlipped ? 'rotate-180' : ''}`} />
                                            Voltear
                                        </button>
                                    </div>
                                </div>
                                {activeData ? (
                                    <HoverZoomImage
                                        src={activeData.dataUrl}
                                        alt={`DNI ${activeLabel}`}
                                        onClick={() => openCapturaPreview(activeKey, `DNI ${activeLabel}`)}
                                        imageClassName="w-full h-40 md:h-52 object-contain rounded border border-indigo-700/30 bg-slate-950/40"
                                        panelTitle={`Zoom DNI ${activeLabel}`}
                                        zoomPanelClassName="w-[420px] h-[280px]"
                                        zoom={3}
                                    />
                                ) : (
                                    <div className="w-full h-20 rounded border border-dashed border-indigo-700/30 flex items-center justify-center text-[10px] text-slate-500">
                                        Sin captura de {activeLabel.toLowerCase()} — cárgala en el panel de capturas inferior
                                    </div>
                                )}
                            </div>
                        );
                    })()}

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
                                        <div className="space-y-2 text-center border border-slate-700/50 p-2 rounded-lg bg-slate-900/50 hover:border-slate-500 transition-colors">
                                            <HoverZoomImage
                                                src={capturas.ce3x_antes.dataUrl}
                                                alt="CE3X Antes"
                                                onClick={() => openCapturaPreview("ce3x_antes", "CE3X Antes")}
                                                frameClassName="w-full h-40 max-h-48 rounded-md overflow-hidden border border-slate-700 bg-black"
                                                imageClassName="w-full h-full object-contain opacity-90 hover:opacity-100 transition-opacity"
                                                panelTitle="Zoom CE3X Antes"
                                                zoomPanelClassName="w-[420px] h-[260px]"
                                                zoom={2.8}
                                            />
                                            <p className="text-xs text-slate-400 font-bold uppercase">Estado Actual (CE3X Antes)</p>
                                        </div>
                                    )}
                                    {capturas.ce3x_despues?.dataUrl && (
                                        <div className="space-y-2 text-center border border-slate-700/50 p-2 rounded-lg bg-slate-900/50 hover:border-slate-500 transition-colors">
                                            <HoverZoomImage
                                                src={capturas.ce3x_despues.dataUrl}
                                                alt="CE3X Después"
                                                onClick={() => openCapturaPreview("ce3x_despues", "CE3X Después")}
                                                frameClassName="w-full h-40 max-h-48 rounded-md overflow-hidden border border-slate-700 bg-black"
                                                imageClassName="w-full h-full object-contain opacity-90 hover:opacity-100 transition-opacity"
                                                panelTitle="Zoom CE3X Después"
                                                zoomPanelClassName="w-[420px] h-[260px]"
                                                zoom={2.8}
                                            />
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
                                    <Input
                                        type="number"
                                        step="0.01"
                                        value={areaHNH}
                                        onChange={(e) => {
                                            const next = parseNumericInput(e.target.value, 0);
                                            setAreaHNH(next);
                                            setSupActuacion(next);
                                        }}
                                        className="h-9 bg-slate-900/50 border-slate-700 text-slate-200 font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] text-amber-400 uppercase font-bold">Superficie Cubierta (m²)</label>
                                    <p className="text-[9px] text-slate-600 mb-1">Límite para coef. b</p>
                                    <Input
                                        type="number"
                                        step="0.01"
                                        value={areaNHE}
                                        onChange={(e) => setAreaNHE(parseNumericInput(e.target.value, 0))}
                                        className="h-9 bg-slate-900/50 border-slate-700 text-slate-200 font-mono"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] text-slate-500 uppercase font-bold">Envolvente Total (m²)</label>
                                    <p className="text-[9px] text-slate-600 mb-1">Sin cubierta; si CE3X trae huecos embebidos en S, revisa el desglose.</p>
                                    <Input
                                        type="number"
                                        step="0.01"
                                        value={supEnvolvente}
                                        onChange={(e) => setSupEnvolvente(parseNumericInput(e.target.value, 0))}
                                        className="h-9 bg-slate-900/50 border-slate-700 text-slate-200 font-mono"
                                    />
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

                            <div className="flex items-center justify-between gap-4 mb-4">
                                <div className="text-sm font-medium text-slate-300">Modo de Cálculo</div>
                                <div className="flex items-center gap-2">
                                    <span className={`text-xs transition-colors ${!isCloudCalculation ? "text-slate-200 font-bold" : "text-slate-500"}`}>Local</span>
                                    <button 
                                        type="button"
                                        onClick={() => setIsCloudCalculation(!isCloudCalculation)}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isCloudCalculation ? "bg-amber-500" : "bg-slate-600"}`}
                                    >
                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isCloudCalculation ? "translate-x-6" : "translate-x-1"}`} />
                                    </button>
                                    <span className={`text-xs transition-colors ${isCloudCalculation ? "text-amber-500 font-bold" : "text-slate-500"}`}>On-Cloud</span>
                                </div>
                            </div>

                            <button
                                onClick={calcular}
                                disabled={isCalculating}
                                className={`w-full h-11 rounded-md bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white font-semibold transition-all flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20 ${isCalculating ? "opacity-70 cursor-not-allowed" : ""}`}
                            >
                                {isCalculating ? (
                                    <div className="animate-spin h-5 w-5 border-2 border-white/20 border-t-white rounded-full" />
                                ) : (
                                    <Zap className="h-5 w-5" />
                                )}
                                {isCalculating ? "Calculando Remotamente..." : "Calcular Ahorro Energético"}
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
                                                                <span className="text-[11px] text-slate-300 font-semibold px-1">Cerramientos Opacos (CE3X)</span>
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
                                                    {hasHuecosBreakdown && (
                                                        <div className="flex justify-between items-center bg-slate-900/60 border border-slate-700 rounded py-1.5 px-2">
                                                            <span className="text-slate-400 font-semibold text-[11px]">Desglose equivalente CEE:</span>
                                                            <span className="font-mono font-bold text-slate-200 text-[11px]">
                                                                {supOpacosNetosEstimados.toFixed(2)} + {supHuecosRounded.toFixed(2)} = {supEnvolventeRounded.toFixed(2)} m²
                                                            </span>
                                                        </div>
                                                    )}
                                                    <p className="text-[9px] text-slate-500 text-right -mt-1">
                                                        S proviene del CE3X en opacos sin cubierta; para lectura CEE, opacos netos ≈ S - huecos.
                                                    </p>
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

                            {resultadoDesactualizado && (
                                <Card className="bg-amber-950/40 border-amber-500/40">
                                    <CardContent className="p-3 text-xs text-amber-200 flex items-center gap-2">
                                        <Info className="h-4 w-4 text-amber-300 shrink-0" />
                                        <span>
                                            Resultado desactualizado: has cambiado datos después del último cálculo. Pulsa "Calcular Ahorro Energético" antes de copiar o generar documentos.
                                        </span>
                                    </CardContent>
                                </Card>
                            )}

                            {/* Botones de acción */}
                            <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-2">
                                <button
                                    onClick={() => void copiarInforme()}
                                    disabled={outputActionsDisabled}
                                    className="h-11 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-all flex items-center justify-center gap-2 ring-1 ring-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                    title={outputActionsDisabled ? outputActionDisabledTitle : "Copiar informe textual local"}
                                >
                                    {copied ? <Check className="h-5 w-5 text-emerald-400" /> : <Copy className="h-5 w-5" />}
                                    {copied ? "¡Copiado!" : "Copiar informe"}
                                </button>
                                <button
                                    onClick={() => void copiarInformeCloud()}
                                    disabled={outputActionsDisabled || !cloudReportText}
                                    className="h-11 rounded-md bg-cyan-700/20 hover:bg-cyan-700/40 text-cyan-300 hover:text-cyan-200 transition-all flex items-center justify-center gap-2 ring-1 ring-cyan-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
                                    title={
                                        outputActionsDisabled
                                            ? outputActionDisabledTitle
                                            : cloudReportText
                                                ? "Copia informe textual generado por backend cloud"
                                                : "Disponible tras calcular en modo On-Cloud"
                                    }
                                >
                                    {cloudReportCopied ? <Check className="h-5 w-5 text-emerald-400" /> : <UploadCloud className="h-5 w-5" />}
                                    {cloudReportCopied ? "Cloud copiado" : "Informe Cloud"}
                                </button>
                                <button
                                    onClick={copiarPlantillaIntellia}
                                    disabled={outputActionsDisabled}
                                    className="h-11 rounded-md bg-violet-600/20 hover:bg-violet-600/40 text-violet-300 hover:text-violet-200 transition-all flex items-center justify-center gap-2 ring-1 ring-violet-500/50 disabled:opacity-40 disabled:cursor-not-allowed"
                                    title={outputActionsDisabled ? outputActionDisabledTitle : "Copiar plantilla INTELLIA"}
                                >
                                    {intelliaTemplateCopied ? <Check className="h-5 w-5 text-emerald-400" /> : <FileCode className="h-5 w-5" />}
                                    {intelliaTemplateCopied ? "Plantilla copiada" : "Plantilla INTELLIA"}
                                </button>
                                <button
                                    onClick={() => void generarCertificadoIntelliaPDF()}
                                    disabled={outputActionsDisabled}
                                    className="h-11 rounded-md bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 hover:text-emerald-200 transition-all flex items-center justify-center gap-2 ring-1 ring-emerald-500/50 disabled:opacity-40 disabled:cursor-not-allowed"
                                    title={outputActionsDisabled ? outputActionDisabledTitle : "Generar certificado PDF INTELLIA"}
                                >
                                    <FileDown className="h-5 w-5" />
                                    Generar PDF INTELLIA
                                </button>
                                <button
                                    onClick={() => setIsHojaEncargoModalOpen(true)}
                                    disabled={false}
                                    className="h-11 rounded-md bg-pink-600/20 hover:bg-pink-600/40 text-pink-400 hover:text-pink-300 transition-all flex items-center justify-center gap-2 ring-1 ring-pink-500/50 disabled:opacity-40"
                                >
                                    Hoja de Encargo
                                </button>
                                <button
                                    onClick={() => void generarAnexoE1PDF()}
                                    disabled={outputActionsDisabled}
                                    className="h-11 rounded-md bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 hover:text-blue-300 transition-all flex items-center justify-center gap-2 ring-1 ring-blue-500/50 disabled:opacity-40 disabled:cursor-not-allowed"
                                    title={outputActionsDisabled ? outputActionDisabledTitle : "Generar Anexo E.1 en PDF"}
                                >
                                    Generar Anexo E.1
                                </button>
                                <button
                                    onClick={() => void generarDocumentoWord()}
                                    disabled={outputActionsDisabled}
                                    className="h-11 rounded-md bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 hover:text-indigo-300 transition-all flex items-center justify-center gap-2 ring-1 ring-indigo-500/50 disabled:opacity-40 disabled:cursor-not-allowed"
                                    title={outputActionsDisabled ? outputActionDisabledTitle : "Generar certificado en Word (DOCX)"}
                                >
                                    Generar Word DOCX
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

                    {!isExperto && resultado && certStatus !== "completado" && (
                        <div className="pt-6 border-t border-slate-800 flex justify-center">
                            <Button 
                                size="lg" 
                                className="w-full sm:w-auto text-lg h-14 bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg"
                                onClick={() => { 
                                    setCertStatus("completado");
                                    void saveCurrentDraft("completado", { suppressSuccessMessage: true });
                                }}
                                disabled={draftSaving || draftLoading}
                            >
                                <CheckCircle className="mr-2 h-6 w-6" />
                                Finalizar Certificado
                            </Button>
                        </div>
                    )}

                    {certStatus === "completado" && (
                        <CertificadoSuccessState
                            referencia={expedienteRc}
                            fecha={new Date().toLocaleDateString()}
                            textoPDF={`Ref: ${expedienteRc}\nAhorro: ${resultado?.ahorro.toLocaleString() || '0'} kWh/año`}
                            onDescargarPDF={() => { void generarCertificadoIntelliaPDF(); }}
                            modoExperto={isExperto}
                            onCrearOtro={() => {
                                resetForNewCertificate();
                                setCertStatus("en_progreso");
                            }}
                        />
                    )}
                </div>
            </div>

            <CertificadoCapturasPanelControlado
                capturas={capturas}
                onCapturasChange={setCapturas}
            />

            {isHojaEncargoModalOpen && (
                <HojaEncargoModal
                    prefillData={{
                        propietario: { 
                            nombre: "", 
                            nif: "", 
                            direccion: "" 
                        },
                        inmueble: {
                            tipoVia: "CALLE",
                            nombreVia: "",
                            numero: "",
                            bloque: "",
                            escalera: "",
                            planta: "",
                            puerta: "",
                            municipio: "",
                            provincia: "",
                            cp: "",
                            uso: "RESIDENCIAL"
                        }
                    }}
                    onClose={() => setIsHojaEncargoModalOpen(false)}
                />
            )}

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

interface HoverZoomImageProps {
    src: string;
    alt: string;
    onClick?: () => void;
    imageClassName: string;
    frameClassName?: string;
    zoomPanelClassName?: string;
    zoom?: number;
    panelTitle?: string;
}

type ZoomPanelPlacement = "right" | "left" | "inside";

function HoverZoomImage({
    src,
    alt,
    onClick,
    imageClassName,
    frameClassName = "",
    zoomPanelClassName = "w-[360px] h-[240px]",
    zoom = 2.6,
    panelTitle = "Zoom",
}: HoverZoomImageProps) {
    const [supportsHover, setSupportsHover] = useState(false);
    const [isHovering, setIsHovering] = useState(false);
    const [focusPoint, setFocusPoint] = useState({ x: 50, y: 50 });
    const [panelPlacement, setPanelPlacement] = useState<ZoomPanelPlacement>("right");
    const containerRef = useRef<HTMLDivElement | null>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);
    const zoomPanelRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (typeof window === "undefined") return;

        const media = window.matchMedia("(hover: hover) and (pointer: fine)");
        const update = () => setSupportsHover(media.matches);
        update();

        if (typeof media.addEventListener === "function") {
            media.addEventListener("change", update);
            return () => media.removeEventListener("change", update);
        }

        media.addListener(update);
        return () => media.removeListener(update);
    }, []);

    const recalculatePanelPlacement = () => {
        if (!supportsHover || !containerRef.current) return;

        const frameRect = containerRef.current.getBoundingClientRect();
        const panelWidth = zoomPanelRef.current?.offsetWidth ?? 420;
        const gap = 12;
        const viewportPadding = 8;

        const fitsRight = frameRect.right + gap + panelWidth <= window.innerWidth - viewportPadding;
        const fitsLeft = frameRect.left - gap - panelWidth >= viewportPadding;

        if (fitsRight) {
            setPanelPlacement("right");
            return;
        }

        if (fitsLeft) {
            setPanelPlacement("left");
            return;
        }

        setPanelPlacement("inside");
    };

    useEffect(() => {
        if (!supportsHover || !isHovering) return;

        recalculatePanelPlacement();
        const handleResize = () => recalculatePanelPlacement();
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [supportsHover, isHovering]);

    const handleMove = (event: ReactMouseEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        let x = ((event.clientX - rect.left) / rect.width) * 100;
        let y = ((event.clientY - rect.top) / rect.height) * 100;

        const imageEl = imageRef.current;
        if (imageEl && imageEl.naturalWidth > 0 && imageEl.naturalHeight > 0) {
            const scale = Math.min(rect.width / imageEl.naturalWidth, rect.height / imageEl.naturalHeight);
            const renderedWidth = imageEl.naturalWidth * scale;
            const renderedHeight = imageEl.naturalHeight * scale;

            if (renderedWidth > 0 && renderedHeight > 0) {
                const offsetX = (rect.width - renderedWidth) / 2;
                const offsetY = (rect.height - renderedHeight) / 2;

                const localX = event.clientX - rect.left - offsetX;
                const localY = event.clientY - rect.top - offsetY;
                const clampedX = Math.max(0, Math.min(renderedWidth, localX));
                const clampedY = Math.max(0, Math.min(renderedHeight, localY));

                x = (clampedX / renderedWidth) * 100;
                y = (clampedY / renderedHeight) * 100;
            }
        }

        setFocusPoint({
            x: Math.max(0, Math.min(100, x)),
            y: Math.max(0, Math.min(100, y)),
        });
    };

    const zoomImageStyle = {
        transformOrigin: `${focusPoint.x}% ${focusPoint.y}%`,
        transform: `scale(${zoom})`,
    };

    const panelPositionClass = panelPlacement === "right"
        ? "left-[calc(100%+12px)] top-0"
        : panelPlacement === "left"
            ? "right-[calc(100%+12px)] top-0"
            : "right-2 top-2";

    const panelInlineStyle = panelPlacement === "inside"
        ? { maxWidth: "calc(100vw - 16px)" }
        : undefined;

    return (
        <div
            ref={containerRef}
            className="relative"
            onMouseEnter={() => {
                if (!supportsHover) return;
                recalculatePanelPlacement();
                setIsHovering(true);
            }}
            onMouseLeave={() => setIsHovering(false)}
            onMouseMove={handleMove}
        >
            <div className={`relative ${frameClassName}`}>
                <img
                    ref={imageRef}
                    src={src}
                    alt={alt}
                    onClick={onClick}
                    className={`${imageClassName} ${onClick ? "cursor-zoom-in" : ""}`}
                    title={supportsHover ? "Hover para acercar · click para ampliar" : "Click para ampliar"}
                />

                {supportsHover && (
                    <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-slate-950/70 border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300">
                        Hover para zoom
                    </div>
                )}
            </div>

            {supportsHover && isHovering && (
                <div
                    ref={zoomPanelRef}
                    className={`pointer-events-none hidden xl:flex absolute ${panelPositionClass} z-30 rounded-lg border border-cyan-700/50 bg-slate-950 shadow-2xl ${zoomPanelClassName} flex-col overflow-hidden`}
                    style={panelInlineStyle}
                >
                    <div className="px-2 py-1 text-[10px] uppercase tracking-wide font-bold text-cyan-300 border-b border-slate-800">
                        {panelTitle}
                    </div>
                    <div className="flex-1 bg-black overflow-hidden">
                        <img
                            src={src}
                            alt={alt}
                            className="w-full h-full object-contain select-none"
                            style={zoomImageStyle}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
