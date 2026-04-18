import { XMLParser, XMLValidator } from "fast-xml-parser";
import { XmlParseError } from "../../contracts/hoja-encargo";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: true,
  trimValues: true,
  // Evita que fast-xml-parser colapte arrays de un solo elemento
  isArray: () => false,
});

/**
 * Rutas XPath conocidas de FechaVisita en distintas versiones de CE3X.
 * Orden de precedencia: más específico → más genérico.
 */
const FECHA_VISITA_PATHS: ReadonlyArray<(obj: any) => string | undefined> = [
  // CE3X v2.3+ (esquema DatosAdministrativos)
  (o) => o?.DatosEnvelope?.DatosAdministrativos?.FechaVisita,
  (o) => o?.Datos?.DatosAdministrativos?.FechaVisita,
  // CE3X v2.0-v2.2 (esquema InformeCE3X — tu lógica original)
  (o) => o?.InformeCE3X?.DatosGenerales?.FechaVisita,
  (o) => o?.InformeCE3X?.DatosVisita?.FechaVisita,
  // Variantes de exportación con namespace aplanado
  (o) => o?.InformacionAdministrativa?.FechaVisita,
  (o) => o?.CertificadoEnergetico?.DatosAdministrativos?.FechaVisita,
];

export async function parseCe3xFechaVisita(xmlString: string): Promise<string | null> {
  const isValid = XMLValidator.validate(xmlString);
  if (isValid !== true) {
    throw new XmlParseError(
      `XML CE3X malformado: ${(isValid as any).err?.msg ?? "Error desconocido"}`
    );
  }

  const obj = parser.parse(xmlString);

  // 1. Barrido por rutas conocidas (O(1) por ruta, zero-alloc)
  for (const getter of FECHA_VISITA_PATHS) {
    const val = getter(obj);
    if (typeof val === "string" && val.trim() !== "") {
      return _normalizeCe3xDateString(val.trim());
    }
    // fast-xml-parser puede parsear fechas como números si son solo dígitos
    if (typeof val === "number") {
      return String(val);
    }
  }

  // 2. Fallback: wildcard DOM — cubre cualquier versión futura
  const domFecha = _extractFechaVisitaDOM(xmlString);
  if (domFecha) return _normalizeCe3xDateString(domFecha);

  return null;
}

/** Búsqueda wildcard con DOMParser — namespace-safe, versión-agnostic */
function _extractFechaVisitaDOM(xmlString: string): string | null {
  try {
    const doc = new DOMParser().parseFromString(xmlString, "application/xml");
    if (doc.querySelector("parsererror")) return null;

    // XPath wildcard: encuentra FechaVisita en cualquier profundidad
    const result = doc.evaluate(
      '//*[local-name()="FechaVisita"]',
      doc,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    const node = result.singleNodeValue;
    return node?.textContent?.trim() ?? null;
  } catch {
    return null;
  }
}

/** Normaliza DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD → DD/MM/YYYY */
function _normalizeCe3xDateString(raw: string): string {
  // ISO format: 2024-03-15 → 15/03/2024
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  // Guiones → barras: 15-03-2024 → 15/03/2024
  return raw.replace(/-/g, "/");
}
