import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { XmlParseError } from '../../contracts/hoja-encargo';

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
});

/**
 * Valida un string XML y extrae la Fecha de Visita del nodo DatosGenerales.
 * Lanza excepción si el XML está malformado.
 */
export async function parseCe3xFechaVisita(xmlString: string): Promise<string | null> {
    const isValid = XMLValidator.validate(xmlString);
    if (isValid !== true) {
        throw new XmlParseError(`XML malformado: ${(isValid as any).err?.msg || 'Error desconocido'}`);
    }

    const obj = parser.parse(xmlString);

    // Barrido resiliente en base al esquema real de CE3X
    const fecha =
        obj?.InformeCE3X?.DatosGenerales?.FechaVisita ??
        obj?.InformeCE3X?.DatosVisita?.FechaVisita ??
        null;

    if (typeof fecha === "string" && fecha.trim() !== "") {
        return _normalizeCe3xDateString(fecha);
    }
    
    return null;
}

/**
 * Asegura formato estándar si el XML lo trae raro.
 */
function _normalizeCe3xDateString(rawDate: string): string {
    return rawDate.replace(/-/g, '/');
}
