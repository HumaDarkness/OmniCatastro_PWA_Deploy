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
import { isCatastroNormalizarEnabled } from "./featureFlags";

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
    fromNormalizar?: boolean;
}

/** Shape returned by /api/v1/catastro/normalizar/{rc} */
export interface CatastroNormalizedApiResponse {
    ref_catastral: string;
    direccion_certificador: string;
    codigo_postal: string;
    municipio: string;
    provincia: string;
    comunidad_autonoma: string;
    provincia_codigo: string | null;
    comunidad_codigo: string | null;
    coordenadas: { lat: number | null; lon: number | null; source: string };
    altitud_msnm: number | null;
    altitud_source: string | null;
    zona_climatica: string | null;
    tipo_via: string;
    nombre_via: string;
    numero: string;
    bloque: string;
    escalera: string;
    planta: string;
    puerta: string;
    display: { full: string };
    raw: { catastro: any; coordinates: any };
    warnings: string[];
    meta: { parser_version: string; catastro_source_format: string };
}

export interface ConstruccionData {
    uso: string;
    tipo: string;
    planta: string;
    puerta: string;
    escalera: string;
    superficie: string;
    _semanticLabel?: string;
}

// ─── Constants & Utils ─────────────────────────────────────────────

export const TIPO_VIA_MAP: Record<string, string> = {
    CL: "CALLE", C: "CALLE",
    AV: "AVENIDA", AVDA: "AVENIDA",
    PZ: "PLAZA", PL: "PLAZA",
    PS: "PASEO", CM: "CAMINO",
    CR: "CARRETERA", CTRA: "CARRETERA",
    UR: "URBANIZACION", URB: "URBANIZACION",
    TR: "TRAVESIA", PB: "POBLADO",
    GL: "GLORIETA", PJ: "PASAJE",
    CJ: "CALLEJON", RD: "RONDA",
    AL: "ALDEA", LG: "LUGAR",
    PR: "PARQUE", POL: "POLIGONO",
    AD: "ALAMEDA", CS: "CUESTA",
    DS: "DISEMINADO",
};

// Catastro semantic labels: es+pt+pu can form words like TODOS, PARTE, RESTO
export const SEMANTIC_LABELS = new Set([
    "TODO", "TODOS", "TODA", "TODAS",
    "PARTE", "RESTO", "TOTAL", "UNICO", "UNICA",
]);

export function detectSemanticLabel(es: string, pt: string, pu: string): string | null {
    const concat3 = `${es}${pt}${pu}`.trim().toUpperCase();
    if (SEMANTIC_LABELS.has(concat3)) return concat3;
    const concat2 = `${es}${pt}`.trim().toUpperCase();
    if (SEMANTIC_LABELS.has(concat2)) return concat2;
    return null;
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
                return null;
            }
        } catch (errDirect: any) {
            console.error("[Catastro Direct API] Error en fallback directo:", errDirect.message);
            return null;
        }
    }
}

/**
 * Gate 6 — Calls the new /normalizar/ endpoint.
 * Returns a CatastroNormalizedApiResponse or null on failure.
 * Falls back to legacy /consultar/ on error.
 */
async function llamarAPINormalizar(rc: string): Promise<CatastroNormalizedApiResponse | null> {
    try {
        const res = await kyClient.get(`api/v1/catastro/normalizar/${encodeURIComponent(rc)}`);
        return await res.json<CatastroNormalizedApiResponse>();
    } catch (e: any) {
        console.warn("[Catastro Normalizar] Error, will use legacy fallback:", e.message);
        return null;
    }
}

// ─── Función principal de consulta ──────────────────────────────────

export async function consultarCatastro(referenciaCatastral: string, userId?: string): Promise<CatastroResult> {
    const { valido, resultado } = validarRC(referenciaCatastral);
    if (!valido) return { datos: null, error: resultado, fromCache: false };

    const rc = resultado;

    // Gate 6 — Try normalized endpoint if feature flag is active
    if (userId) {
        try {
            const useNormalizar = await isCatastroNormalizarEnabled(userId);
            if (useNormalizar) {
                const normalized = await llamarAPINormalizar(rc);
                if (normalized) {
                    // Wrap the response so downstream consumers can detect it
                    const wrappedDatos = {
                        ...normalized,
                        _fromNormalizar: true,
                        // Map to legacy-compatible fields para extraerDatosInmuebleUnico
                        raw_response: normalized.raw?.catastro,
                        direccion: normalized.direccion_certificador,
                        direccion_cruda: normalized.display?.full || "",
                        tipo_via: normalized.tipo_via,
                        nombre_via: normalized.nombre_via,
                        numero: normalized.numero,
                        bloque: normalized.bloque,
                        escalera: normalized.escalera,
                        planta: normalized.planta,
                        puerta: normalized.puerta,
                        codigo_postal: normalized.codigo_postal,
                        zona_climatica: normalized.zona_climatica,
                        altitud: normalized.altitud_msnm,
                    };
                    return { datos: wrappedDatos, error: null, fromCache: false, fromNormalizar: true };
                }
                // If normalizar failed, fall through to legacy path
            }
        } catch (e: any) {
            // Feature flag check failed or normalizar threw 401/403/500, fall through to legacy
            console.warn("[Catastro Normalizar] Error, will use legacy fallback:", e.message);
        }
    }

    // 1. Buscar en cache Supabase
    const cached = await buscarEnCache(rc);
    if (cached) {
        return { datos: cached, error: null, fromCache: true };
    }

    // 2. Llamar a la API del Catastro (legacy)
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

// ─── Tabla oficial provincia → comunidad autónoma (determinista) ──────
const PROVINCIA_CCAA_MAP: Record<string, string> = {
    // Andalucía
    "ALMERIA": "Andalucía", "CADIZ": "Andalucía", "CORDOBA": "Andalucía",
    "GRANADA": "Andalucía", "HUELVA": "Andalucía", "JAEN": "Andalucía",
    "MALAGA": "Andalucía", "SEVILLA": "Andalucía",
    // Aragón
    "HUESCA": "Aragón", "TERUEL": "Aragón", "ZARAGOZA": "Aragón",
    // Asturias
    "ASTURIAS": "Principado de Asturias", "OVIEDO": "Principado de Asturias",
    // Baleares
    "BALEARES": "Illes Balears", "ILLES BALEARS": "Illes Balears", "ISLAS BALEARES": "Illes Balears",
    // Canarias
    "LAS PALMAS": "Canarias", "SANTA CRUZ DE TENERIFE": "Canarias", "PALMAS, LAS": "Canarias",
    // Cantabria
    "CANTABRIA": "Cantabria", "SANTANDER": "Cantabria",
    // Castilla y León
    "AVILA": "Castilla y León", "BURGOS": "Castilla y León", "LEON": "Castilla y León",
    "PALENCIA": "Castilla y León", "SALAMANCA": "Castilla y León",
    "SEGOVIA": "Castilla y León", "SORIA": "Castilla y León",
    "VALLADOLID": "Castilla y León", "ZAMORA": "Castilla y León",
    // Castilla-La Mancha
    "ALBACETE": "Castilla-La Mancha", "CIUDAD REAL": "Castilla-La Mancha",
    "CUENCA": "Castilla-La Mancha", "GUADALAJARA": "Castilla-La Mancha",
    "TOLEDO": "Castilla-La Mancha",
    // Cataluña
    "BARCELONA": "Cataluña", "GIRONA": "Cataluña", "GERONA": "Cataluña",
    "LLEIDA": "Cataluña", "LERIDA": "Cataluña", "TARRAGONA": "Cataluña",
    // Comunitat Valenciana
    "ALICANTE": "Comunitat Valenciana", "CASTELLON": "Comunitat Valenciana",
    "VALENCIA": "Comunitat Valenciana", "ALACANT": "Comunitat Valenciana",
    "CASTELLO": "Comunitat Valenciana",
    // Extremadura
    "BADAJOZ": "Extremadura", "CACERES": "Extremadura",
    // Galicia
    "A CORUNA": "Galicia", "CORUNA, A": "Galicia", "LA CORUNA": "Galicia",
    "LUGO": "Galicia", "OURENSE": "Galicia", "ORENSE": "Galicia",
    "PONTEVEDRA": "Galicia",
    // Madrid
    "MADRID": "Comunidad de Madrid",
    // Murcia
    "MURCIA": "Región de Murcia",
    // Navarra
    "NAVARRA": "Comunidad Foral de Navarra", "PAMPLONA": "Comunidad Foral de Navarra",
    // País Vasco
    "ALAVA": "País Vasco", "ARABA": "País Vasco",
    "BIZKAIA": "País Vasco", "VIZCAYA": "País Vasco",
    "GIPUZKOA": "País Vasco", "GUIPUZCOA": "País Vasco",
    // La Rioja
    "LA RIOJA": "La Rioja", "RIOJA": "La Rioja", "LOGRONO": "La Rioja",
    // Ceuta y Melilla
    "CEUTA": "Ceuta", "MELILLA": "Melilla",
};

/** Resolve comunidad_autonoma from province name (deterministic, no guessing). */
function resolverComunidadAutonoma(provincia: string): { ccaa: string; warning?: string } {
    if (!provincia || !provincia.trim()) return { ccaa: "", warning: "provincia_empty" };
    const normalized = provincia.trim()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents
        .toUpperCase();
    const ccaa = PROVINCIA_CCAA_MAP[normalized];
    if (ccaa) return { ccaa };
    // Try partial match for edge cases like "CORUNA" vs "A CORUNA"
    for (const [key, val] of Object.entries(PROVINCIA_CCAA_MAP)) {
        if (normalized.includes(key) || key.includes(normalized)) return { ccaa: val };
    }
    return { ccaa: "", warning: `ccaa_unresolvable:${provincia}` };
}

/**
 * Strip trailing territorial block from Catastro ldt.
 * Input:  "DS DISEMINADO 7 Polígono 2 Parcela 30014 ... LOS ARENALES. 45522 ALBARREAL DE TAJO (TOLEDO)"
 * Output: "DS DISEMINADO 7 Polígono 2 Parcela 30014 ... LOS ARENALES."
 */
function limpiarLdtTerritorial(ldt: string): string {
    if (!ldt) return "";
    // Pattern: trailing " 45522 MUNICIPIO (PROVINCIA)" — CP is 5 digits at the END
    // Use greedy .+ to match everything up to the LAST 5-digit block + territorial
    const match = ldt.match(/^(.+)\s+\d{5}\s+.+\([^)]+\)\s*$/);
    if (match) return match[1].trim();
    // Fallback: " CP MUNICIPIO" without parenthesized province
    const match2 = ldt.match(/^(.+)\s+\d{5}\s+[A-ZÁÉÍÓÚÑ\s]+$/i);
    if (match2) return match2[1].trim();
    return ldt;
}

export function extraerDatosParcela(datos: any): {
    direccion: string;
    municipio: string;
    provincia: string;
    codigoPostal: string;
    zona_climatica?: string;
    altitud?: number;
} {
    const fromBackend = datos?.direccion_cruda !== undefined && datos?.raw_response !== undefined;
    
    if (fromBackend) {
        return {
            direccion: datos.direccion_certificador || datos.direccion || "",
            municipio: datos.municipio || "",
            provincia: datos.provincia || "",
            codigoPostal: datos.codigo_postal || "",
            zona_climatica: datos.zona_climatica,
            altitud: datos.altitud,
        };
    }

    const raw = datos?.raw_response ?? datos;
    const root = raw?.consulta_dnprcResult ?? raw?.consulta_dnp ?? raw;
    const lrcdnp = root?.lrcdnp ?? {};
    const rcdnpList = Array.isArray(lrcdnp?.rcdnp) ? lrcdnp.rcdnp : (lrcdnp?.rcdnp ? [lrcdnp.rcdnp] : []);
    const primerItem = rcdnpList[0] || {};
    const dt = primerItem?.dt ?? {};
    const locs = dt?.locs ?? {};
    const lous = locs?.lous ?? {};
    const lourb = lous?.lourb ?? {};

    const ldtRaw = (primerItem?.ldt ?? dt?.ldt ?? "").toString().trim();
    const direccion = limpiarLdtTerritorial(ldtRaw) || "";
    const municipio = dt?.nm ?? locs?.locm?.nm ?? "";
    const provincia = dt?.np ?? "";
    const codigoPostal = lourb?.dp ?? "";

    return {
        direccion,
        municipio,
        provincia,
        codigoPostal,
    };
}

export function extraerDatosInmuebleUnico(datos: any): {
    direccion: string;
    direccion_certificador: string;
    comunidad_autonoma: string;
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
    _semanticLabel?: string;
    tipoVia?: string;
    nombreVia?: string;
    numero?: string;
    planta?: string;
    puerta?: string;
    escalera?: string;
    bloque?: string;
    _warnings?: string[];
} {
    // Si la respuesta vino del backend con campos pre-extraidos y smart parsing:
    const fromBackend = datos?.direccion_cruda !== undefined && datos?.raw_response !== undefined;
    
    const raw = datos?.raw_response ?? datos;
    const root = raw?.consulta_dnprcResult ?? raw?.consulta_dnp ?? raw;
    const bico = root?.bico ?? {};
    const bi = bico?.bi ?? {};
    const debi = bi?.debi ?? {};
    const dt = bi?.dt ?? {};

    // Localización literal completa (ldt) — contiene TODO: dirección + CP + municipio + (provincia)
    const ldtRaw = (bi?.ldt ?? bico?.finca?.ldt ?? dt?.ldt ?? "").toString().trim();
    // Limpiar: quitar bloque territorial del final → solo la parte de dirección
    const localizacionLiteral = limpiarLdtTerritorial(ldtRaw);

    // Dirección — dt.locs.lous.lourb.dir
    const locs = dt?.locs ?? {};
    const lous = locs?.lous ?? {};
    const lourb = lous?.lourb ?? {};
    const dir = lourb?.dir ?? {};
    const tv = dir?.tv ?? "";
    const nv = dir?.nv ?? "";
    const num = dir?.pnp ?? "";
    // Municipio/Provincia — directamente en dt.nm y dt.np
    const municipio = dt?.nm ?? locs?.locm?.nm ?? "";
    const provincia = dt?.np ?? "";



    let direccion = "";
    if (fromBackend) {
        direccion = datos.direccion; // Usa la ya parseada por Python
    } else {
        const tvRaw = tv.toUpperCase();
        const tipoVia = TIPO_VIA_MAP[tvRaw] || tvRaw || "CALLE";
        const loint = lourb?.loint ?? dt?.loint ?? {};
        
        let d = `${tipoVia} ${nv} ${num}`.trim();
        
        const ptStr = (loint?.pt ?? "").trim();
        const puStr = (loint?.pu ?? "").trim();
        const esStr = (loint?.es ?? "").trim();

        const semanticLabel = detectSemanticLabel(esStr, ptStr, puStr);

        if (semanticLabel) {
            // es/pt/pu form a semantic word — NOT a real location
            direccion = d;
            datos._parsed = {
                tipoVia: tipoVia,
                nombreVia: nv,
                numero: num,
                planta: "",
                puerta: "",
                escalera: "",
                _semanticLabel: semanticLabel,
            };
        } else {
            const planta = ptStr ? ` Pl:${ptStr}` : "";
            const puerta = puStr ? ` Pt:${puStr}` : "";
            const escalera = esStr ? ` Es:${esStr}` : "";
            
            direccion = `${d}${escalera}${planta}${puerta}`.trim();
            
            datos._parsed = {
                tipoVia: tipoVia,
                nombreVia: nv,
                numero: num,
                planta: ptStr,
                puerta: puStr,
                escalera: esStr
            };
        }
    }

    // Código Postal — dt.locs.lous.lourb.dp
    const codigoPostal = lourb?.dp ?? "";

    // Finca info
    const finca = bico?.finca ?? {};
    const tipoFinca = finca?.ltp ?? "";
    const superficieSuelo = finca?.dff?.ss ?? "";
    const urlCartografia = finca?.infgraf?.igraf ?? "";

    // Construcciones (lcons) — array de unidades constructivas
    const construcciones = extraerConstrucciones(bico);

    // Resolver provincia → comunidad autónoma de forma determinista
    const provinciaFinal = fromBackend ? datos.provincia : provincia;
    const ccaaResult = resolverComunidadAutonoma(provinciaFinal);
    const warnings: string[] = [];
    if (ccaaResult.warning) warnings.push(ccaaResult.warning);

    // Semantic label (from es+pt+pu detection) for consumers to know
    const semanticLabel = datos._parsed?._semanticLabel ?? undefined;

    return {
        // direccion_certificador = ldt LIMPIO (sin bloque territorial)
        // Solo la parte de dirección/localización, SIN CP/municipio/provincia
        direccion_certificador: fromBackend
            ? (datos.direccion_certificador || localizacionLiteral || datos.direccion)
            : (localizacionLiteral || direccion),
        // direccion legacy (tipo_via + nombre_via + num)
        direccion: fromBackend ? datos.direccion : direccion,
        municipio: fromBackend ? datos.municipio : municipio,
        provincia: provinciaFinal,
        comunidad_autonoma: fromBackend
            ? (datos.comunidad_autonoma || ccaaResult.ccaa)
            : ccaaResult.ccaa,
        codigoPostal: fromBackend ? datos.codigo_postal : codigoPostal,
        
        uso: debi?.luso ?? "N/D",
        superficie: debi?.sfc ?? "N/D",
        anoConstruccion: debi?.ant ?? "N/D",
        participacion: debi?.cpt ?? "N/D",
        tipoFinca,
        superficieSuelo,
        construcciones,
        urlCartografia,
        
        zona_climatica: fromBackend ? datos.zona_climatica : undefined,
        altitud: fromBackend ? datos.altitud : undefined,
        direccion_cruda: fromBackend ? datos.direccion_cruda : undefined,
        _semanticLabel: semanticLabel,
        _warnings: warnings.length > 0 ? warnings : undefined,

        tipoVia: fromBackend ? datos.tipo_via : datos._parsed?.tipoVia,
        nombreVia: fromBackend ? datos.nombre_via : datos._parsed?.nombreVia,
        numero: fromBackend ? datos.numero : datos._parsed?.numero,
        planta: fromBackend ? datos.planta : datos._parsed?.planta,
        puerta: fromBackend ? datos.puerta : datos._parsed?.puerta,
        escalera: fromBackend ? datos.escalera : datos._parsed?.escalera,
        bloque: fromBackend ? datos.bloque : undefined,
    };
}

// ─── Extraer construcciones (lcons) ─────────────────────────────────

function extraerConstrucciones(bico: any): ConstruccionData[] {
    let lcons = bico?.lcons ?? [];
    if (!Array.isArray(lcons)) lcons = lcons ? [lcons] : [];

    return lcons.map((c: any) => {
        const loint = c?.dt?.lourb?.loint ?? {};
        const pt = (loint?.pt ?? "").trim();
        const pu = (loint?.pu ?? "").trim();
        const es = (loint?.es ?? "").trim();
        const semantic = detectSemanticLabel(es, pt, pu);

        return {
            uso: c?.lcd ?? "N/D",
            tipo: c?.dvcons?.dtip ?? "N/D",
            planta: semantic ? "" : (pt || "N/D"),
            puerta: semantic ? "" : (pu || "N/D"),
            escalera: semantic ? "" : (es || "—"),
            superficie: c?.dfcons?.stl ?? "N/D",
            _semanticLabel: semantic || undefined,
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
