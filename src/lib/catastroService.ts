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
        const url = `${CATASTRO_API_URL}?RefCat=${encodeURIComponent(rc)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (e: any) {
        console.error("[Catastro API] Error:", e.message);
        return null;
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

    return { datos, error: null, fromCache: false };
}

// ─── Verificar errores de la API ─────────────────────────────────────

function verificarErrores(datos: any): string | null {
    const root = datos?.consulta_dnprcResult ?? datos?.consulta_dnp ?? datos;
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
    const root = datos?.consulta_dnprcResult ?? datos?.consulta_dnp ?? datos;
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
    const root = datos?.consulta_dnprcResult ?? datos?.consulta_dnp ?? datos;
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
} {
    const root = datos?.consulta_dnprcResult ?? datos?.consulta_dnp ?? datos;
    const bico = root?.bico ?? {};
    const bi = bico?.bi ?? {};
    const debi = bi?.debi ?? {};
    const dt = bi?.dt ?? {};

    // Dirección — dt.locs.lous.lourb.dir
    const locs = dt?.locs ?? {};
    const lous = locs?.lous ?? {};
    const lourb = lous?.lourb ?? {};
    const dir = lourb?.dir ?? {};
    const tv = dir?.tv ?? "";
    const nv = dir?.nv ?? "";
    const num = dir?.pnp ?? "";
    const direccion = `${tv} ${nv} ${num}`.trim();

    // Municipio/Provincia — directamente en dt.nm y dt.np
    const municipio = dt?.nm ?? locs?.locm?.nm ?? "";
    const provincia = dt?.np ?? "";

    // Código Postal — dt.locs.lous.lourb.dp
    const codigoPostal = lourb?.dp ?? "";

    // Finca info
    const finca = bico?.finca ?? {};
    const tipoFinca = finca?.ltp ?? "";
    const superficieSuelo = finca?.dff?.ss ?? "";
    const urlCartografia = finca?.infgraf?.igraf ?? "";

    // Construcciones (lcons) — array de unidades constructivas
    const construcciones = extraerConstrucciones(bico);

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
