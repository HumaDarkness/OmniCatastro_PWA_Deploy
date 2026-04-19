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

export interface CatastroUIModel {
  es_multiple: boolean;
  num_inmuebles: number;
  inmuebles: InmuebleData[];
  
  // Transversales
  direccion_certificador: string;
  direccion_cruda: string;
  municipio: string;
  provincia: string;
  comunidad_autonoma: string;
  codigo_postal: string;
  zona_climatica: string | null;
  altitud: number | null;
  coordenadas: { lat: number | null; lon: number | null };

  // Detalles de inmueble o lista
  detalle_inmueble: {
    uso: string;
    superficie: string;
    ano_construccion: string;
    participacion: string;
    tipo_finca: string;
    superficie_suelo: string;
    construcciones: ConstruccionData[];
    url_cartografia: string;
    tipo_via: string;
    nombre_via: string;
    numero: string;
    planta: string;
    puerta: string;
    escalera: string;
    bloque: string;
    _warnings: string[];
    _semanticLabel?: string;
  };
  
  source: 'backend_normalized' | 'backend_legacy' | 'direct' | 'cache';
}

// ─── Constants & Utils ─────────────────────────────────────────────

export const TIPO_VIA_MAP: Record<string, string> = {
  CL: "CALLE",
  C: "CALLE",
  AV: "AVENIDA",
  AVDA: "AVENIDA",
  PZ: "PLAZA",
  PL: "PLAZA",
  PS: "PASEO",
  CM: "CAMINO",
  CR: "CARRETERA",
  CTRA: "CARRETERA",
  UR: "URBANIZACION",
  URB: "URBANIZACION",
  TR: "TRAVESIA",
  PB: "POBLADO",
  GL: "GLORIETA",
  PJ: "PASAJE",
  CJ: "CALLEJON",
  RD: "RONDA",
  AL: "ALDEA",
  LG: "LUGAR",
  PR: "PARQUE",
  POL: "POLIGONO",
  AD: "ALAMEDA",
  CS: "CUESTA",
  DS: "DISEMINADO",
};

// Catastro semantic labels: es+pt+pu can form words like TODOS, PARTE, RESTO
export const SEMANTIC_LABELS = new Set([
  "TODO",
  "TODOS",
  "TODA",
  "TODAS",
  "PARTE",
  "RESTO",
  "TOTAL",
  "UNICO",
  "UNICA",
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
    if (/^[A-Z0-9]{7}[A-Z0-9]{7}[0-9]{4}[A-Z]{2}$/.test(limpio))
      return { valido: true, resultado: limpio };
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
const CATASTRO_MAINTENANCE_PATTERN =
  /(mantenim|temporalm|interrup|indisponib|fuera de servicio|servicio no disponible|ca[ii]d[ao]|no operativo)/i;

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
    console.warn(
      "[Catastro Backend API] Error (posible bloqueo de IP al Data Center). Usando fallback PWA directo:",
      e.message
    );
    try {
      const probeUrl = `${CATASTRO_API_URL}?RefCat=${encodeURIComponent(rc)}`;
      const response = await fetch(probeUrl, {
        headers: {
          Accept: "application/json",
        },
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

export async function consultarCatastro(
  referenciaCatastral: string,
  userId?: string
): Promise<CatastroResult> {
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
          const uiModel = mapCatastroResponseToUIModel(normalized, "backend_normalized");
          return { datos: uiModel, error: null, fromCache: false, fromNormalizar: true };
        }
      }
    } catch (e: any) {
      console.warn("[Catastro Normalizar] Error, will use legacy fallback:", e.message);
    }
  }

  // 1. Buscar en cache Supabase
  const cached = await buscarEnCache(rc);
  if (cached) {
    // Asumimos que la cache guarda backend legacy / raw json
    // Ajustaremos con mapCatastroResponseToUIModel
    return { datos: mapCatastroResponseToUIModel(cached, "cache"), error: null, fromCache: true };
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

  // Identificar si vino del python API o es direct JSON PWA 
  const isDirect = datos.raw_response === undefined;
  const source = isDirect ? "direct" : "backend_legacy";

  return { datos: mapCatastroResponseToUIModel(datos, source), error: null, fromCache: false };
}

// ─── Mapper a CatastroUIModel ────────────────────────────────────────

export function mapCatastroResponseToUIModel(datos: any, source: CatastroUIModel['source']): CatastroUIModel {
  const fromBackend = (source === 'backend_normalized' || source === 'backend_legacy' || (source === 'cache' && datos?.raw_response !== undefined));
  
  const raw = datos?.raw_response ?? datos?.raw?.catastro ?? datos;

  // Analizar si es múltiple
  const root = raw?.consulta_dnprcResult ?? raw?.consulta_dnp ?? raw;
  const control = root?.control ?? {};
  let cudnp = 1;
  try {
    cudnp = parseInt(control?.cudnp ?? "1", 10);
  } catch {
    cudnp = 1;
  }
  const lrcdnp = root?.lrcdnp;
  const es_multiple = !!(lrcdnp && lrcdnp.rcdnp);
  
  const inmuebles = extraerListaInmuebles(raw);

  // Extraer Finca y Primera Fila (bico)
  const bico = root?.bico ?? (root?.lrcdnp?.rcdnp?.[0]?.bico) ?? {};
  const bi = bico?.bi ?? {};
  const debi = bi?.debi ?? {};
  const dt = bi?.dt ?? {};
  
  const ldtRaw = (bi?.ldt ?? bico?.finca?.ldt ?? dt?.ldt ?? "").toString().trim();
  const localizacionLiteral = limpiarLdtTerritorial(ldtRaw);
  
  const locs = dt?.locs ?? {};
  const lous = locs?.lous ?? {};
  const lourb = lous?.lourb ?? {};
  const dir = lourb?.dir ?? {};
  const tv = dir?.tv ?? "";
  const nv = dir?.nv ?? "";
  const num = dir?.pnp ?? "";

  const municipio = fromBackend ? datos.municipio : (dt?.nm ?? locs?.locm?.nm ?? "");
  const provincia = fromBackend ? datos.provincia : (dt?.np ?? "");
  const codigoPostal = fromBackend ? (datos.codigo_postal ?? datos.codigoPostal ?? "") : (lourb?.dp ?? "");

  const tvRaw = tv.toUpperCase();
  const tipoVia = TIPO_VIA_MAP[tvRaw] || tvRaw || "CALLE";
  const loint = lourb?.loint ?? dt?.loint ?? {};
  
  let d = `${tipoVia} ${nv} ${num}`.trim();
  let semanticLabel = undefined;
  let parsed = { tipoVia, nombreVia: nv, numero: num, planta: "", puerta: "", escalera: "" };
  let direccionCrudaFallback = "";
  
  if (!fromBackend) {
    const ptStr = (loint?.pt ?? "").trim();
    const puStr = (loint?.pu ?? "").trim();
    const esStr = (loint?.es ?? "").trim();
    semanticLabel = detectSemanticLabel(esStr, ptStr, puStr) || undefined;
    if (semanticLabel) {
      parsed = { ...parsed, _semanticLabel: semanticLabel } as any;
      direccionCrudaFallback = d;
    } else {
      const planta = ptStr ? ` Pl:${ptStr}` : "";
      const puerta = puStr ? ` Pt:${puStr}` : "";
      const escalera = esStr ? ` Es:${esStr}` : "";
      direccionCrudaFallback = `${d}${escalera}${planta}${puerta}`.trim();
      parsed = { ...parsed, planta: ptStr, puerta: puStr, escalera: esStr };
    }
  }

  const ccaaResult = resolverComunidadAutonoma(provincia);
  const comunidad_autonoma = fromBackend ? (datos.comunidad_autonoma || ccaaResult.ccaa) : ccaaResult.ccaa;
  
  const finca = bico?.finca ?? {};
  const tipoFinca = finca?.ltp ?? "";
  const superficieSuelo = finca?.dff?.ss ?? "";
  const urlCartografia = finca?.infgraf?.igraf ?? "";
  const construcciones = extraerConstrucciones(bico);

  const warnings: string[] = [];
  if (ccaaResult.warning) warnings.push(ccaaResult.warning);

  return {
    es_multiple,
    num_inmuebles: cudnp,
    inmuebles,
    // Transversales
    direccion_certificador: fromBackend ? (datos.direccion_certificador || datos.direccion || "") : localizacionLiteral,
    direccion_cruda: fromBackend ? (datos.display?.full || datos.direccion_cruda || "") : direccionCrudaFallback,
    municipio,
    provincia,
    comunidad_autonoma,
    codigo_postal: codigoPostal,
    zona_climatica: fromBackend ? (datos.zona_climatica ?? null) : null,
    altitud: fromBackend ? (datos.altitud_msnm ?? datos.altitud ?? null) : null,
    coordenadas: fromBackend ? (datos.coordenadas ?? { lat: null, lon: null }) : { lat: null, lon: null },
    source,
    
    // Detalle general primer inmueble
    detalle_inmueble: {
      uso: debi?.luso ?? "N/D",
      superficie: debi?.sfc ?? "N/D",
      ano_construccion: debi?.ant ?? "N/D",
      participacion: debi?.cpt ?? "N/D",
      tipo_finca: tipoFinca,
      superficie_suelo: superficieSuelo,
      construcciones,
      url_cartografia: urlCartografia,
      tipo_via: fromBackend ? datos.tipo_via : parsed.tipoVia,
      nombre_via: fromBackend ? datos.nombre_via : parsed.nombreVia,
      numero: fromBackend ? datos.numero : parsed.numero,
      planta: fromBackend ? datos.planta : parsed.planta,
      puerta: fromBackend ? datos.puerta : parsed.puerta,
      escalera: fromBackend ? datos.escalera : parsed.escalera,
      bloque: fromBackend ? datos.bloque : "",
      _warnings: warnings,
      _semanticLabel: semanticLabel,
    }
  };
}

/** 
 * Compatibility wrapper for legacy components.
 * Returns whether the parcel contains multiple properties.
 */
export function esParcerlaMultiple(datos: any): { multiple: boolean } {
  let multiple = false;
  if (datos?.es_multiple !== undefined) {
    multiple = datos.es_multiple;
  } else {
    const raw = datos?.raw_response ?? datos;
    const root = raw?.consulta_dnprcResult ?? raw?.consulta_dnp ?? raw;
    multiple = !!(root?.lrcdnp && root?.lrcdnp?.rcdnp);
  }
  return { multiple };
}

/** 
 * Compatibility wrapper for legacy components.
 * Extracts details for the primary property in a unified way.
 */
export function extraerDatosInmuebleUnico(datos: any): any {
  if (!datos) return null;
  // If it's already a UI Model, return a shape compatible with old expectations
  if (datos.detalle_inmueble) {
    return {
      ...datos.detalle_inmueble,
      direccion: datos.direccion_certificador || datos.direccion_cruda || "",
      municipio: datos.municipio,
      provincia: datos.provincia,
      comunidad_autonoma: datos.comunidad_autonoma,
      codigo_postal: datos.codigo_postal,
      zona_climatica: datos.zona_climatica,
      altitud: datos.altitud,
    };
  }
  // Fallback map
  return mapCatastroResponseToUIModel(datos, "backend_legacy");
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

// export function esParcerlaMultiple() { ... } => Integrado en mapCatastroResponseToUIModel

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

function extraerConstrucciones(bico: any): ConstruccionData[] {
  const lcons = bico?.lcons ?? {};
  let consList = lcons?.cons ?? [];
  if (!Array.isArray(consList)) consList = consList ? [consList] : [];

  return consList.map((c: any) => {
    const loint = c?.loint ?? {};
    const esStr = (loint?.es ?? "").trim();
    const ptStr = (loint?.pt ?? "").trim();
    const puStr = (loint?.pu ?? "").trim();

    return {
      uso: c?.lcd ?? "N/D",
      tipo: c?.lpt ?? "N/D",
      planta: ptStr || "N/D",
      puerta: puStr || "N/D",
      escalera: esStr || "—",
      superficie: c?.sfc ?? "0",
      _semanticLabel: detectSemanticLabel(esStr, ptStr, puStr) || undefined,
    };
  });
}

// ─── Helplers adicionales ───────────────────────────────────────────

function limpiarLdtTerritorial(ldt: string): string {
  if (!ldt) return "";
  let clean = ldt.replace(/\s+/g, " ").trim();
  // Quitar "(TERRITORIAL)" o similares si aparecen
  clean = clean.replace(/\(TERRITORIAL\)/gi, "").trim();
  return clean;
}

function resolverComunidadAutonoma(provincia: string): { ccaa: string; warning?: string } {
  const p = provincia.trim().toUpperCase();
  const res = PROVINCIA_CCAA_MAP[p];
  if (res) return { ccaa: res };

  // Fallback para provincias vascas o navarras (fuera de competencia Catastro común)
  if (["VIZCAYA", "BIZKAIA", "ALAVA", "ARABA", "GUIPUZCOA", "GIPUZKOA", "NAVARRA"].includes(p)) {
    return {
      ccaa: p === "NAVARRA" ? "Comunidad Foral de Navarra" : "País Vasco",
      warning: "Provincia con régimen foral propio; los datos pueden ser limitados en esta API común.",
    };
  }

  return { ccaa: "España (Comunidad no identificada)" };
}

// ─── Tabla oficial provincia → comunidad autónoma (determinista) ──────
const PROVINCIA_CCAA_MAP: Record<string, string> = {
  // Andalucía
  ALMERIA: "Andalucía",
  CADIZ: "Andalucía",
  CORDOBA: "Andalucía",
  GRANADA: "Andalucía",
  HUELVA: "Andalucía",
  JAEN: "Andalucía",
  MALAGA: "Andalucía",
  SEVILLA: "Andalucía",
  // Aragón
  HUESCA: "Aragón",
  TERUEL: "Aragón",
  ZARAGOZA: "Aragón",
  // Asturias
  ASTURIAS: "Principado de Asturias",
  OVIEDO: "Principado de Asturias",
  // Baleares
  BALEARES: "Illes Balears",
  "ILLES BALEARS": "Illes Balears",
  "ISLAS BALEARES": "Illes Balears",
  // Canarias
  "LAS PALMAS": "Canarias",
  "SANTA CRUZ DE TENERIFE": "Canarias",
  "PALMAS, LAS": "Canarias",
  // Cantabria
  CANTABRIA: "Cantabria",
  SANTANDER: "Cantabria",
  // Castilla y León
  AVILA: "Castilla y León",
  BURGOS: "Castilla y León",
  LEON: "Castilla y León",
  PALENCIA: "Castilla y León",
  SALAMANCA: "Castilla y León",
  SEGOVIA: "Castilla y León",
  SORIA: "Castilla y León",
  VALLADOLID: "Castilla y León",
  ZAMORA: "Castilla y León",
  // Castilla-La Mancha
  ALBACETE: "Castilla-La Mancha",
  "CIUDAD REAL": "Castilla-La Mancha",
  CUENCA: "Castilla-La Mancha",
  GUADALAJARA: "Castilla-La Mancha",
  TOLEDO: "Castilla-La Mancha",
  // Cataluña
  BARCELONA: "Cataluña",
  GIRONA: "Cataluña",
  GERONA: "Cataluña",
  LLEIDA: "Cataluña",
  LERIDA: "Cataluña",
  TARRAGONA: "Cataluña",
  // Comunitat Valenciana
  ALICANTE: "Comunitat Valenciana",
  CASTELLON: "Comunitat Valenciana",
  VALENCIA: "Comunitat Valenciana",
  ALACANT: "Comunitat Valenciana",
  CASTELLO: "Comunitat Valenciana",
  // Extremadura
  BADAJOZ: "Extremadura",
  CACERES: "Extremadura",
  // Galicia
  "A CORUNA": "Galicia",
  "CORUNA, A": "Galicia",
  "LA CORUNA": "Galicia",
  LUGO: "Galicia",
  OURENSE: "Galicia",
  ORENSE: "Galicia",
  PONTEVEDRA: "Galicia",
  // Madrid
  MADRID: "Comunidad de Madrid",
  // Murcia
  MURCIA: "Región de Murcia",
  // Navarra
  NAVARRA: "Comunidad Foral de Navarra",
  PAMPLONA: "Comunidad Foral de Navarra",
  // País Vasco
  ALAVA: "País Vasco",
  ARABA: "País Vasco",
  BIZKAIA: "País Vasco",
  VIZCAYA: "País Vasco",
  GIPUZKOA: "País Vasco",
  GUIPUZCOA: "País Vasco",
  // La Rioja
  "LA RIOJA": "La Rioja",
  RIOJA: "La Rioja",
  LOGRONO: "La Rioja",
  // Ceuta y Melilla
  CEUTA: "Ceuta",
  MELILLA: "Melilla",
};
