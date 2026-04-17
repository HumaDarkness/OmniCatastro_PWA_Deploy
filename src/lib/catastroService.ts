/**
 * catastroService.ts
 * Port de api/catastro.py + core/api_repository.py para la PWA.
 * 
 * Flujo:
 *   1. Validar formato de RC (14/18/20 chars)
 *   2. Buscar en catastro_cache (Supabase) — equivalente a cache L2 del Desktop
 *   3. Si no hay cache, llamar a la API del Catastro directamente
 *   4. Parsear respuesta: detectar parcela múltiple, extraer lista de inmuebles
 */

import { supabase } from "./supabase";
import { kyClient } from "./kyClient";

// ─── Tipos ───────────────────────────────────────────────────────────

export interface InmuebleData {
    rc: string;
    uso: string;
    superficie: string;
    ano: string;
    planta: string;
    puerta: string;
    escalera: string;
}

export interface CatastroResult {
    datos: any | null;
    error: string | null;
    fromCache: boolean;
}

export interface ConstruccionData {
    uso: string;
    tipo: string;
    planta: string;
    puerta: string;
    escalera: string;
    superficie: string;
}

export type CatastroAvailabilityState = "active" | "maintenance" | "offline";

export interface CatastroAvailabilitySnapshot {
    state: CatastroAvailabilityState;
    checkedAt: number;
    latencyMs: number | null;
    message: string;
    maintenanceUntil: string | null;
    details: string | null;
}

const TIPO_VIA_MAP: Record<string, string> = {
    CL: "CALLE",
    C: "CALLE",
    DS: "DISEMINADO",
    AV: "AVENIDA",
    AVDA: "AVENIDA",
    PZ: "PLAZA",
    PL: "PLAZA",
    PS: "PASEO",
    PSO: "PASEO",
    CM: "CAMINO",
    CR: "CARRETERA",
    CTRA: "CARRETERA",
    UR: "URBANIZACION",
    URB: "URBANIZACION",
    BRR: "BARRIO",
    TR: "TRAVESIA",
    GL: "GLORIETA",
    RD: "RONDA",
    LG: "LUGAR",
    PQ: "PARQUE",
    PR: "PARQUE",
    BLD: "BULEVAR",
    SND: "SENDA",
    VIA: "VIA",
    POL: "POLIGONO",
    PJ: "PASAJE",
    CJ: "CALLEJON",
    PB: "POBLADO",
    AL: "ALDEA",
    AD: "ALAMEDA",
    CS: "CUESTA",
};

const TIPO_VIA_ALIAS_MAP: Record<string, string> = {
    CALLE: "CALLE",
    DISEMINADO: "DISEMINADO",
    AVENIDA: "AVENIDA",
    PLAZA: "PLAZA",
    PASEO: "PASEO",
    CAMINO: "CAMINO",
    CARRETERA: "CARRETERA",
    URBANIZACION: "URBANIZACION",
    BARRIO: "BARRIO",
    TRAVESIA: "TRAVESIA",
    GLORIETA: "GLORIETA",
    RONDA: "RONDA",
    LUGAR: "LUGAR",
    PARQUE: "PARQUE",
    BULEVAR: "BULEVAR",
    SENDA: "SENDA",
    VIA: "VIA",
    POLIGONO: "POLIGONO",
    PASAJE: "PASAJE",
    CALLEJON: "CALLEJON",
    POBLADO: "POBLADO",
    ALDEA: "ALDEA",
    ALAMEDA: "ALAMEDA",
    CUESTA: "CUESTA",
};

const NUMERO_VIA_FINAL_REGEX = /\b(\d+[A-Z]?|S\/N|SN)\s*$/i;
const RC_EMBEDDED_TOKEN_REGEX = /^(?=.*\d)[A-Z0-9]{14,20}$/;
const TD_SANITIZED_MAX_LENGTH = 40;
const TD_CONTROL_CHAR_REGEX = /[\x00-\x1F\x7F]/g;
const TD_ALLOWED_CHARS_REGEX = /[^A-Z0-9/\- ]+/g;

function cleanCatastroText(value: unknown): string {
    if (value === null || value === undefined) return "";
    return String(value).replace(/\s+/g, " ").trim();
}

function normalizarTipoVia(value: string): string {
    const normalized = cleanCatastroText(value).toUpperCase().replace(/\.+$/g, "");
    if (!normalized) return "";
    return TIPO_VIA_MAP[normalized] ?? TIPO_VIA_ALIAS_MAP[normalized] ?? normalized;
}

function normalizarNumeroVia(value: string): string {
    const normalized = cleanCatastroText(value).toUpperCase().replace(/\.+$/g, "");
    if (!normalized) return "";
    if (normalized === "SN") return "S/N";
    return normalized;
}

function extraerNumeroAlFinal(value: string): { nombreVia: string; numero: string } {
    const normalized = cleanCatastroText(value).toUpperCase();
    if (!normalized) return { nombreVia: "", numero: "" };

    const match = normalized.match(NUMERO_VIA_FINAL_REGEX);
    if (!match) {
        return { nombreVia: normalized, numero: "" };
    }

    const numero = normalizarNumeroVia(match[1] ?? "");
    const nombreVia = cleanCatastroText(normalized.slice(0, match.index ?? normalized.length));
    return { nombreVia, numero };
}

function limpiarNombreVia(nombreVia: string, tipoVia: string): string {
    const normalized = cleanCatastroText(nombreVia).toUpperCase();
    if (!normalized) return "";

    const tokens = normalized
        .split(/\s+/)
        .filter(Boolean)
        .filter((token) => !RC_EMBEDDED_TOKEN_REGEX.test(token));

    let cleaned = tokens.join(" ");
    if (!cleaned) return "";

    if (tipoVia === "DISEMINADO") {
        cleaned = cleaned.replace(/^DISEMINADO(?:\s+|$)/, "").trim();
    }

    return cleaned;
}

function sanitizarTokenRuralTd(value: string): string {
    const normalized = cleanCatastroText(value).toUpperCase();
    if (!normalized) return "";

    const sanitizedRaw = normalized
        .replace(TD_CONTROL_CHAR_REGEX, " ")
        .replace(TD_ALLOWED_CHARS_REGEX, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (!sanitizedRaw) return "";

    // td se espera como identificador/trozo codificado: conservamos solo tokens con al menos un dígito.
    const sanitized = sanitizedRaw
        .split(/\s+/)
        .filter((token) => /\d/.test(token))
        .join(" ")
        .trim();

    if (!sanitized) return "";
    if (sanitized.length <= TD_SANITIZED_MAX_LENGTH) return sanitized;
    return sanitized.slice(0, TD_SANITIZED_MAX_LENGTH).trim();
}

function construirDireccionHastaCp(direccionCruda: string, codigoPostal: string): string {
    const raw = cleanCatastroText(direccionCruda).toUpperCase();
    if (!raw) return "";

    const cp = cleanCatastroText(codigoPostal);
    if (cp) {
        const idxCp = raw.indexOf(cp);
        if (idxCp >= 0) {
            const cut = raw.slice(0, idxCp + cp.length);
            return cleanCatastroText(cut.replace(/[.,;:]+$/g, ""));
        }
    }

    const cpMatch = raw.match(/\b\d{5}\b/);
    if (cpMatch && cpMatch.index !== undefined) {
        const cut = raw.slice(0, cpMatch.index + cpMatch[0].length);
        return cleanCatastroText(cut.replace(/[.,;:]+$/g, ""));
    }

    return raw;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsWordGroup(text: string, prefix: string, value: string): boolean {
    if (!text || !value) return false;
    const regex = new RegExp(`\\b${escapeRegExp(prefix)}\\s+${escapeRegExp(value)}\\b`, "i");
    return regex.test(text);
}

function construirDireccionRuralHastaCp(params: {
    tipoVia: string;
    nombreVia: string;
    numero: string;
    dirTd: string;
    paraje: string;
    poligono: string;
    parcela: string;
    codigoPostal: string;
}): string {
    const tipoVia = cleanCatastroText(params.tipoVia).toUpperCase();
    const nombreVia = cleanCatastroText(params.nombreVia).toUpperCase();
    const numero = normalizarNumeroVia(params.numero);
    const dirTd = sanitizarTokenRuralTd(params.dirTd);
    const paraje = cleanCatastroText(params.paraje).toUpperCase();
    const poligono = cleanCatastroText(params.poligono).toUpperCase();
    const parcela = cleanCatastroText(params.parcela).toUpperCase();
    const cp = cleanCatastroText(params.codigoPostal);

    const base = [tipoVia, nombreVia, numero].filter(Boolean).join(" ").trim();
    const chunks: string[] = [];

    if (base) {
        chunks.push(base);
    }
    if (poligono && !containsWordGroup(base, "POLIGONO", poligono)) {
        chunks.push(`POLIGONO ${poligono}`);
    }
    if (parcela && !containsWordGroup(base, "PARCELA", parcela)) {
        chunks.push(`PARCELA ${parcela}`);
    }
    if (dirTd && !base.includes(dirTd)) {
        chunks.push(dirTd);
    }
    if (paraje && !base.includes(paraje)) {
        chunks.push(paraje);
    }
    if (cp) {
        chunks.push(cp);
    }

    return cleanCatastroText(chunks.join(" "));
}

function parseDireccionDictionaryFirst(direccionCruda: string): {
    tipoVia: string;
    nombreVia: string;
    numero: string;
} {
    const normalized = cleanCatastroText(direccionCruda)
        .toUpperCase()
        .replace(/,/g, " ");

    if (!normalized) {
        return { tipoVia: "", nombreVia: "", numero: "" };
    }

    const tokens = normalized.split(/\s+/).filter(Boolean);
    const firstToken = (tokens[0] ?? "").replace(/\.+$/g, "");
    const dictionaryHit = TIPO_VIA_MAP[firstToken] || TIPO_VIA_ALIAS_MAP[firstToken];

    if (dictionaryHit) {
        const tail = tokens.slice(1).join(" ");
        const { nombreVia, numero } = extraerNumeroAlFinal(tail);
        return {
            tipoVia: normalizarTipoVia(firstToken),
            nombreVia,
            numero,
        };
    }

    const regexMatch = normalized.match(/^([A-Z.]+)\s+(.+)$/);
    if (regexMatch) {
        const tipoViaToken = regexMatch[1].replace(/\.+$/g, "");
        const maybeTipoVia = normalizarTipoVia(tipoViaToken);
        const { nombreVia, numero } = extraerNumeroAlFinal(regexMatch[2]);
        if (TIPO_VIA_MAP[tipoViaToken] || TIPO_VIA_ALIAS_MAP[tipoViaToken]) {
            return {
                tipoVia: maybeTipoVia,
                nombreVia,
                numero,
            };
        }
    }

    const fallback = extraerNumeroAlFinal(normalized);
    return {
        tipoVia: "CALLE",
        nombreVia: fallback.nombreVia,
        numero: fallback.numero,
    };
}

function resolveDireccionParts(params: {
    tipoViaRaw: string;
    nombreViaRaw: string;
    numeroRaw: string;
    direccionCruda: string;
}): { tipoVia: string; nombreVia: string; numero: string } {
    const tipoViaNormalizado = normalizarTipoVia(params.tipoViaRaw);
    const nombreViaNormalizado = cleanCatastroText(params.nombreViaRaw).toUpperCase();
    const numeroNormalizado = normalizarNumeroVia(params.numeroRaw);

    if (tipoViaNormalizado && nombreViaNormalizado) {
        const nombreViaLimpio = limpiarNombreVia(nombreViaNormalizado, tipoViaNormalizado);
        return {
            tipoVia: tipoViaNormalizado,
            nombreVia: nombreViaLimpio,
            numero: numeroNormalizado,
        };
    }

    const parsed = parseDireccionDictionaryFirst(params.direccionCruda);
    const tipoViaFinal = tipoViaNormalizado || parsed.tipoVia;
    const nombreViaFinal = limpiarNombreVia(nombreViaNormalizado || parsed.nombreVia, tipoViaFinal);
    return {
        tipoVia: tipoViaFinal,
        nombreVia: nombreViaFinal,
        numero: numeroNormalizado || parsed.numero,
    };
}

function esPlaceholderCatastro(tipo: "planta" | "puerta" | "escalera", value: string): boolean {
    const normalized = cleanCatastroText(value).toUpperCase();
    if (!normalized) return true;
    if (tipo === "planta") return normalized === "00" || normalized === "01";
    if (tipo === "puerta") return normalized === "00" || normalized === "01";
    return normalized === "1" || normalized === "01";
}

// ─── Validación de RC ────────────────────────────────────────────────

export function validarRC(rc: string): { valido: boolean; resultado: string } {
    if (!rc) return { valido: false, resultado: "Referencia catastral vacía" };

    const limpio = rc.trim().toUpperCase().replace(/[\s-]/g, "");

    if (limpio.length === 14) {
        if (/^[A-Z0-9]{7}[A-Z0-9]{7}$/.test(limpio)) return { valido: true, resultado: limpio };
    } else if (limpio.length === 18) {
        if (/^[A-Z0-9]{7}[A-Z0-9]{7}[0-9]{4}$/.test(limpio)) return { valido: true, resultado: limpio };
    } else if (limpio.length === 20) {
        if (/^[A-Z0-9]{7}[A-Z0-9]{7}[0-9]{4}[A-Z]{2}$/.test(limpio)) return { valido: true, resultado: limpio };
    }

    return {
        valido: false,
        resultado: `Formato inválido: debe tener 14, 18 o 20 caracteres (actual: ${limpio.length})`,
    };
}

// ─── Cache Supabase (catastro_cache) ─────────────────────────────────

async function buscarEnCache(rc: string): Promise<any | null> {
    if (!supabase) return null;
    try {
        const { data, error } = await supabase
            .from("catastro_cache")
            .select("raw_json, direccion, municipio, provincia")
            .eq("rc", rc)
            .maybeSingle();

        if (error || !data) return null;
        return data.raw_json;
    } catch {
        return null;
    }
}

// ─── Llamada directa a la API del Catastro ──────────────────────────

const CATASTRO_API_URL =
    "https://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero/COVCCallejero.svc/json/Consulta_DNPRC";
const CATASTRO_STATUS_PROBE_RC = "0000000AA0000A0000AA";
const CATASTRO_STATUS_TIMEOUT_MS = 8000;
const CATASTRO_MAINTENANCE_PATTERN = /(mantenim|temporalm|interrup|indisponib|fuera de servicio|servicio no disponible|ca[ii]d[ao]|no operativo)/i;

function normalizeServiceMessage(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

function extractCatastroErrors(datos: any): string[] {
    const root = datos?.consulta_dnprcResult ?? datos?.consulta_dnp ?? datos;
    const control = root?.control ?? {};
    const cuerr = Number.parseInt(String(control?.cuerr ?? "0"), 10);

    if (!Number.isFinite(cuerr) || cuerr <= 0) {
        return [];
    }

    const lerr = root?.lerr?.err;
    if (!lerr) return [];

    const errores = Array.isArray(lerr) ? lerr : [lerr];
    return errores
        .map((entry: any) => normalizeServiceMessage(String(entry?.des ?? "")))
        .filter(Boolean);
}

function extractMaintenanceUntil(message: string): string | null {
    const normalized = normalizeServiceMessage(message);
    if (!normalized) return null;

    const fullDateTime = normalized.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}[:.]\d{2})\b/i);
    if (fullDateTime) {
        return `${fullDateTime[1]} ${fullDateTime[2].replace(".", ":")}`;
    }

    const untilTime = normalized.match(/hasta\s+las?\s+(\d{1,2}[:.]\d{2})\b/i);
    if (untilTime) {
        return `hoy ${untilTime[1].replace(".", ":")}`;
    }

    const genericTime = normalized.match(/\b(\d{1,2}[:.]\d{2})\s*h\b/i);
    if (genericTime) {
        return `hoy ${genericTime[1].replace(".", ":")}`;
    }

    return null;
}

function parseCatastroProbeBody(rawBody: string, latencyMs: number): CatastroAvailabilitySnapshot {
    const checkedAt = Date.now();
    const normalizedBody = normalizeServiceMessage(rawBody);

    if (!normalizedBody) {
        return {
            state: "active",
            checkedAt,
            latencyMs,
            message: "Catastro operativo",
            maintenanceUntil: null,
            details: null,
        };
    }

    let parsedJson: any = null;
    try {
        parsedJson = JSON.parse(normalizedBody);
    } catch {
        parsedJson = null;
    }

    if (parsedJson) {
        const errors = extractCatastroErrors(parsedJson);
        const details = errors.length ? errors.join(" | ") : null;

        if (details && CATASTRO_MAINTENANCE_PATTERN.test(details)) {
            return {
                state: "maintenance",
                checkedAt,
                latencyMs,
                message: "Catastro en mantenimiento",
                maintenanceUntil: extractMaintenanceUntil(details),
                details,
            };
        }

        return {
            state: "active",
            checkedAt,
            latencyMs,
            message: "Catastro operativo",
            maintenanceUntil: null,
            details,
        };
    }

    if (CATASTRO_MAINTENANCE_PATTERN.test(normalizedBody)) {
        return {
            state: "maintenance",
            checkedAt,
            latencyMs,
            message: "Catastro en mantenimiento",
            maintenanceUntil: extractMaintenanceUntil(normalizedBody),
            details: normalizedBody.slice(0, 220),
        };
    }

    return {
        state: "active",
        checkedAt,
        latencyMs,
        message: "Catastro operativo",
        maintenanceUntil: null,
        details: null,
    };
}

export async function getCatastroAvailabilitySnapshot(options?: {
    timeoutMs?: number;
}): Promise<CatastroAvailabilitySnapshot> {
    const timeoutMs = options?.timeoutMs ?? CATASTRO_STATUS_TIMEOUT_MS;
    const probeUrl = `${CATASTRO_API_URL}?RefCat=${encodeURIComponent(CATASTRO_STATUS_PROBE_RC)}`;
    const startedAt = Date.now();

    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(probeUrl, {
            signal: controller.signal,
            cache: "no-store",
        });
        const latencyMs = Math.max(Date.now() - startedAt, 0);
        const bodyText = await response.text();

        if (!response.ok) {
            const parsedBody = parseCatastroProbeBody(bodyText, latencyMs);
            if (parsedBody.state === "maintenance") {
                return parsedBody;
            }

            return {
                state: "offline",
                checkedAt: Date.now(),
                latencyMs,
                message: `Catastro no disponible (HTTP ${response.status})`,
                maintenanceUntil: null,
                details: normalizeServiceMessage(bodyText).slice(0, 220) || null,
            };
        }

        return parseCatastroProbeBody(bodyText, latencyMs);
    } catch (error: any) {
        const isAbort = error instanceof DOMException && error.name === "AbortError";
        return {
            state: "offline",
            checkedAt: Date.now(),
            latencyMs: null,
            message: isAbort ? "Catastro sin respuesta (timeout)" : "Catastro no disponible (red)",
            maintenanceUntil: null,
            details: error?.message ? String(error.message) : null,
        };
    } finally {
        globalThis.clearTimeout(timeoutId);
    }
}

async function llamarAPICatastro(rc: string): Promise<any | null> {
    try {
        const res = await kyClient.get(`api/v1/catastro/consultar/${encodeURIComponent(rc)}`);
        const jsonResponse = await res.json<any>();
        return jsonResponse;
    } catch (e: any) {
        console.warn("[Catastro Backend API] Error (posible bloqueo de IP al Data Center). Usando fallback PWA directo:", e.message);
        try {
            const probeUrl = `${CATASTRO_API_URL}?RefCat=${encodeURIComponent(rc)}`;
            const response = await fetch(probeUrl, {
                headers: {
                    "Accept": "application/json"
                }
            });
            if (!response.ok) return null;
            const textResponse = await response.text();
            try {
                return JSON.parse(textResponse);
            } catch (err) {
                // Return root format directly since fromBackend logic relies on wrapper absence if raw
                return null;
            }
        } catch (errDirect: any) {
            console.error("[Catastro Direct API] Error en fallback directo:", errDirect.message);
            return null;
        }
    }
}

// ─── Función principal de consulta ──────────────────────────────────

export async function consultarCatastro(referenciaCatastral: string): Promise<CatastroResult> {
    const { valido, resultado } = validarRC(referenciaCatastral);
    if (!valido) return { datos: null, error: resultado, fromCache: false };

    const rc = resultado;

    // 1. Buscar en cache Supabase
    const cached = await buscarEnCache(rc);
    if (cached) {
        return { datos: cached, error: null, fromCache: true };
    }

    // 2. Llamar a la API del Catastro directamente
    const datos = await llamarAPICatastro(rc);
    if (!datos) {
        return {
            datos: null,
            error: "No se pudo conectar al Catastro. Reintente en unos segundos.",
            fromCache: false,
        };
    }

    // 3. Verificar errores en la respuesta
    const errorMsg = verificarErrores(datos);
    if (errorMsg) return { datos: null, error: errorMsg, fromCache: false };

    // Si viene del backend FastAPI, ya devolvemos el raw_response en la raíz para compatibilidad
    // con el extractor o extraemos los atributos limpios. Lo más sencillo es devolver
    // el objeto completo para que las otras funciones puedan extraer 'raw_response'
    return { datos, error: null, fromCache: false };
}

// ─── Verificar errores de la API ─────────────────────────────────────

function verificarErrores(datos: any): string | null {
    const raw = datos?.raw_response ?? datos;
    const root = raw?.consulta_dnprcResult ?? raw?.consulta_dnp ?? raw;
    const control = root?.control ?? {};
    const cuerr = control?.cuerr;
    if (cuerr && cuerr > 0) {
        const lerr = root?.lerr?.err;
        if (lerr) {
            const errores = Array.isArray(lerr) ? lerr : [lerr];
            const msgs = errores.map((e: any) => e?.des || "Error desconocido");
            return msgs.join(". ");
        }
        return "Error en la consulta al Catastro.";
    }
    return null;
}

// ─── Detección de parcela múltiple ───────────────────────────────────

export function esParcerlaMultiple(datos: any): { multiple: boolean; numInmuebles: number } {
    const raw = datos?.raw_response ?? datos;
    const root = raw?.consulta_dnprcResult ?? raw?.consulta_dnp ?? raw;
    const control = root?.control ?? {};
    let cudnp = 1;
    try {
        cudnp = parseInt(control?.cudnp ?? "1", 10);
    } catch {
        cudnp = 1;
    }

    const lrcdnp = root?.lrcdnp;
    if (lrcdnp && lrcdnp.rcdnp) {
        return { multiple: true, numInmuebles: cudnp };
    }
    return { multiple: false, numInmuebles: 1 };
}

// ─── Extracción de lista de inmuebles ────────────────────────────────

export function extraerListaInmuebles(datos: any): InmuebleData[] {
    const raw = datos?.raw_response ?? datos;
    const root = raw?.consulta_dnprcResult ?? raw?.consulta_dnp ?? raw;
    const lrcdnp = root?.lrcdnp ?? {};
    let rcdnpList = lrcdnp?.rcdnp ?? [];
    if (!Array.isArray(rcdnpList)) rcdnpList = rcdnpList ? [rcdnpList] : [];

    return rcdnpList.map((item: any) => {
        const rcData = item?.rc ?? {};
        const pc1 = rcData?.pc1 ?? "";
        const pc2 = rcData?.pc2 ?? "";
        const car = rcData?.car ?? "";
        const cc1 = rcData?.cc1 ?? "";
        const cc2 = rcData?.cc2 ?? "";
        const rcCompleta = `${pc1}${pc2}${car}${cc1}${cc2}`;

        const debi = item?.debi ?? {};
        const dt = item?.dt ?? {};

        // Múltiples rutas para planta/puerta/escalera (igual que Python)
        const locs = dt?.locs ?? {};
        const lous = locs?.lous ?? {};
        const lourb = lous?.lourb ?? {};
        const loint = lourb?.loint ?? {};
        const lointDirect = dt?.loint ?? {};

        const planta = loint?.pt || lointDirect?.pt || cc1?.trim() || "N/D";
        const puerta = loint?.pu || lointDirect?.pu || cc2?.trim() || "N/D";
        const escalera = loint?.es || lointDirect?.es || lourb?.es || "—";

        return {
            rc: rcCompleta,
            uso: debi?.luso ?? "N/D",
            superficie: debi?.sfc ?? "N/D",
            ano: debi?.ant ?? "N/D",
            planta: planta || "N/D",
            puerta: puerta || "N/D",
            escalera: escalera || "—",
        };
    });
}

// ─── Extraer datos de un inmueble único (bico) ──────────────────────

export function extraerDatosInmuebleUnico(datos: any): {
    direccion: string;
    // ... rest is similar, let's keep the signature ...
    municipio: string;
    provincia: string;
    codigoPostal: string;
    uso: string;
    superficie: string;
    anoConstruccion: string;
    participacion: string;
    tipoFinca: string;
    superficieSuelo: string;
    construcciones: ConstruccionData[];
    urlCartografia: string;
    zona_climatica?: string;
    altitud?: number;
    direccion_cruda?: string;
    // Campos extra finos:
    tipoVia?: string;
    nombreVia?: string;
    numero?: string;
    planta?: string;
    puerta?: string;
    escalera?: string;
    bloque?: string;
} {
    // Si la respuesta vino del backend con campos pre-extraidos y smart parsing.
    const fromBackend = datos?.direccion_cruda !== undefined && datos?.raw_response !== undefined;

    const raw = datos?.raw_response ?? datos;
    const root = raw?.consulta_dnprcResult ?? raw?.consulta_dnp ?? raw;
    const bico = root?.bico ?? {};
    const bi = bico?.bi ?? {};
    const debi = bi?.debi ?? {};
    const dt = bi?.dt ?? {};

    const locs = dt?.locs ?? {};
    const lous = locs?.lous ?? {};
    const lors = locs?.lors ?? {};
    const lourb = lous?.lourb ?? lors?.lourb ?? {};
    const lorus = lous?.lorus ?? lors?.lorus ?? {};
    const locLegacy = dt?.locs?.ls?.loc ?? {};
    const dir = lourb?.dir ?? locLegacy?.dtic ?? {};
    const loint = lourb?.loint ?? dt?.loint ?? locLegacy?.loint ?? {};

    const rawTipoVia = fromBackend ? cleanCatastroText(datos?.tipo_via) : cleanCatastroText(dir?.tv);
    const rawNombreVia = fromBackend ? cleanCatastroText(datos?.nombre_via) : cleanCatastroText(dir?.nv);
    const rawNumero = fromBackend ? cleanCatastroText(datos?.numero) : cleanCatastroText(dir?.pnp);
    const direccionCruda = cleanCatastroText(
        fromBackend ? datos?.direccion_cruda : lourb?.ldt ?? locLegacy?.ldt ?? bi?.ldt ?? ""
    );

    const direccionParts = resolveDireccionParts({
        tipoViaRaw: rawTipoVia,
        nombreViaRaw: rawNombreVia,
        numeroRaw: rawNumero,
        direccionCruda,
    });

    const plantaRaw = fromBackend ? cleanCatastroText(datos?.planta) : cleanCatastroText(loint?.pt);
    const puertaRaw = fromBackend ? cleanCatastroText(datos?.puerta) : cleanCatastroText(loint?.pu);
    const escaleraRaw = fromBackend ? cleanCatastroText(datos?.escalera) : cleanCatastroText(loint?.es);
    const bloqueRaw = fromBackend ? cleanCatastroText(datos?.bloque) : cleanCatastroText(loint?.bq);

    const planta = esPlaceholderCatastro("planta", plantaRaw) ? "" : plantaRaw;
    const puerta = esPlaceholderCatastro("puerta", puertaRaw) ? "" : puertaRaw;
    const escalera = esPlaceholderCatastro("escalera", escaleraRaw) ? "" : escaleraRaw;
    const bloque = bloqueRaw || "";

    const municipio = cleanCatastroText(fromBackend ? datos?.municipio : dt?.nm ?? locs?.locm?.nm ?? locLegacy?.nm);
    const provincia = cleanCatastroText(fromBackend ? datos?.provincia : dt?.np ?? locLegacy?.np);
    const codigoPostal = cleanCatastroText(
        fromBackend ? datos?.codigo_postal : lourb?.dp ?? locLegacy?.cdpid?.cp
    );

    const direccionBase = [direccionParts.tipoVia, direccionParts.nombreVia, direccionParts.numero]
        .filter(Boolean)
        .join(" ")
        .trim();

    const direccionEstructurada = [
        direccionBase,
        escalera ? `Es:${escalera}` : "",
        planta ? `Pl:${planta}` : "",
        puerta ? `Pt:${puerta}` : "",
    ]
        .filter(Boolean)
        .join(" ")
        .trim();

    const direccionRural = construirDireccionRuralHastaCp({
        tipoVia: direccionParts.tipoVia || "",
        nombreVia: direccionParts.nombreVia || "",
        numero: direccionParts.numero || "",
        dirTd: cleanCatastroText(dir?.td),
        paraje: cleanCatastroText(lorus?.npa),
        poligono: cleanCatastroText(lorus?.cpp?.cpo),
        parcela: cleanCatastroText(lorus?.cpp?.cpa),
        codigoPostal,
    });

    const direccion = construirDireccionHastaCp(direccionCruda, codigoPostal) || direccionRural || direccionEstructurada;

    // Finca info
    const finca = bico?.finca ?? {};
    const tipoFinca = finca?.ltp ?? "";
    const superficieSuelo = finca?.dff?.ss ?? "";
    const urlCartografia = finca?.infgraf?.igraf ?? "";

    // Construcciones (lcons) — array de unidades constructivas
    const construcciones = extraerConstrucciones(bico);

    const altitudRaw = fromBackend ? datos?.altitud : undefined;
    const altitud =
        typeof altitudRaw === "number"
            ? altitudRaw
            : altitudRaw !== undefined && altitudRaw !== null && Number.isFinite(Number(altitudRaw))
                ? Number(altitudRaw)
                : undefined;

    return {
        direccion,
        municipio,
        provincia,
        codigoPostal,

        uso: debi?.luso ?? "N/D",
        superficie: debi?.sfc ?? "N/D",
        anoConstruccion: debi?.ant ?? "N/D",
        participacion: debi?.cpt ?? "N/D",
        tipoFinca,
        superficieSuelo,
        construcciones,
        urlCartografia,

        // Atributos enriquecidos del backend
        zona_climatica: fromBackend ? cleanCatastroText(datos?.zona_climatica) || undefined : undefined,
        altitud,
        direccion_cruda: direccionCruda || undefined,

        tipoVia: direccionParts.tipoVia || undefined,
        nombreVia: direccionParts.nombreVia || undefined,
        numero: direccionParts.numero || undefined,
        planta: planta || undefined,
        puerta: puerta || undefined,
        escalera: escalera || undefined,
        bloque: bloque || undefined,
    };
}

// ─── Extraer construcciones (lcons) ─────────────────────────────────

function extraerConstrucciones(bico: any): ConstruccionData[] {
    let lcons = bico?.lcons ?? [];
    if (!Array.isArray(lcons)) lcons = lcons ? [lcons] : [];

    return lcons.map((c: any) => {
        const loint = c?.dt?.lourb?.loint ?? {};
        return {
            uso: c?.lcd ?? "N/D",
            tipo: c?.dvcons?.dtip ?? "N/D",
            planta: loint?.pt ?? "N/D",
            puerta: loint?.pu ?? "N/D",
            escalera: loint?.es ?? "—",
            superficie: c?.dfcons?.stl ?? "N/D",
        };
    });
}

// ─── URLs de imágenes del Catastro ──────────────────────────────────

export function getUrlFachada(rc: string, datos: any): string {
    const root = datos?.consulta_dnprcResult ?? datos?.consulta_dnp ?? datos;
    const { cp, cmc } = extraerCodigosGeo(root);
    return `https://www1.sedecatastro.gob.es/CYCBienInmworkinmuble/OVCConCiworkinYCBieni.aspx?del=${cp}&mun=${cmc}&UrbRus=U&RefC=${rc}&pest=fot`;
}

export function getUrlPlano(rc: string, _datos: any): string {
    const rc14 = rc.substring(0, 14);
    return `https://ovc.catastro.meh.es/OVCServWeb/OVCWcfLibres/OVCFotoFachworkinada.svc/RecuperarFotoFachworkinadaRC?ReferenciaCatastral=${rc14}`;
}

export function getUrlCroquis(rc: string, _datos: any): string {
    const rc14 = rc.substring(0, 14);
    return `https://www1.sedecatastro.gob.es/Cartografia/mapa.aspx?refcat=${rc14}&tipocarto=CARTO`;
}

function extraerCodigosGeo(root: any): { cp: string; cmc: string } {
    const bico = root?.bico ?? {};
    const bi = bico?.bi ?? {};
    const dt = bi?.dt ?? {};
    // Prioridad: dt.loine.cp para delegación, dt.cmc para municipio
    const loine = dt?.loine ?? {};
    return {
        cp: loine?.cp ?? dt?.locs?.cpro ?? "",
        cmc: dt?.cmc ?? loine?.cm ?? "",
    };
}

// ─── Extraer Escalera, Planta, Puerta (Consulta_DNPRC_Codigos) ──────

const CATASTRO_BASE = 'https://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero/COVCCallejeroCodigos.svc/json';

/** Descompone una RC de 20 caracteres en sus partes constitutivas */
function _parseRC20(rc: string): { pc1: string; pc2: string; car: string; cc1: string; cc2: string } | null {
  if (rc.length !== 20) return null;
  return {
    pc1: rc.slice(0, 7),
    pc2: rc.slice(7, 14),
    car: rc.slice(14, 18),   // "cargo" = identificador de unidad constructiva
    cc1: rc[18],
    cc2: rc[19],
  };
}

export interface LointData {
  escalera: string | null;
  planta: string | null;
  puerta: string | null;
  bloque: string | null;
  superficieTotal: number | null;
}

/**
 * Para RCs de 20 dígitos: usa Consulta_DNPRC_Codigos para obtener
 * escalera, planta y puerta del nodo <loint> (Localización Interior).
 */
export async function fetchLointDataFromRC(rc: string): Promise<LointData[]> {
  const parts = _parseRC20(rc.trim().toUpperCase());
  if (!parts) throw new Error(`RC inválida: ${rc} (debe tener 20 caracteres)`);

  const url = `${CATASTRO_BASE}/Consulta_DNPRC_Codigos?RefCat=${rc}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Catastro HTTP ${res.status}`);

  const json = await res.json();

  // El nodo de datos está en consulta_dnp > bico > bi
  const bi = json?.consulta_dnp?.bico?.bi;
  if (!bi) return [];

  // lcons puede contener un objeto único o un array si hay varias unidades
  const consList: any[] = Array.isArray(bi?.lcons?.cons)
    ? bi.lcons.cons
    : bi?.lcons?.cons
      ? [bi.lcons.cons]
      : [];

  return consList.map((cons: any): LointData => ({
    escalera:       cons?.dt?.lourb?.loint?.es   ?? null,
    planta:         cons?.dt?.lourb?.loint?.pt   ?? null,
    puerta:         cons?.dt?.lourb?.loint?.pu   ?? null,
    bloque:         cons?.dt?.lourb?.loint?.bq   ?? null,
    superficieTotal: cons?.dfcons?.stl != null ? Number(cons.dfcons.stl) : null,
  }));
}
