// @ts-ignore
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
// @ts-ignore
import ImageModule from "docxtemplater-image-module-free";
import { saveAs } from "file-saver";
import { VALORES_G, type ResultadoTermico, type CapaMaterial } from "./thermalCalculator";
import type { CapturasState } from "../components/CertificadoCapturasPanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Payload que recibe el generador desde CalculadoraTermica */
export interface DocxE135Payload {
    resultado: ResultadoTermico;
    clienteNombre?: string;
    direccionInmueble?: string;
    municipioInmueble?: string;
    cpInmueble?: string;
    provinciaInmueble?: string;
    supEnvolvente?: number | string;
    supActuacion?: number | string;
    zonaKey?: string;
    alturaMsnm?: number | string;
    areaNHE?: number;
    tipoElemento?: string;
    ciudadFirma?: string;
    capas?: CapaMaterial[];
    capturas?: CapturasState;
    // Campos ignorados pero presentes del payload general
    [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Image helpers
// ---------------------------------------------------------------------------

// Transparent 1x1 PNG to prevent docxtemplater "reading 'part'" crash on empty image slots
const TRANSPARENT_1X1_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function getTransparentPixel(): ArrayBuffer {
    const binary = atob(TRANSPARENT_1X1_PNG_B64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

function dataURLToArrayBuffer(dataUrl: string): ArrayBuffer {
    if (!dataUrl || typeof dataUrl !== "string") {
        console.warn("⚠️ [DOCX Image] dataUrl vacía o tipo incorrecto, usando pixel.");
        return getTransparentPixel();
    }

    const commaIdx = dataUrl.indexOf(",");
    if (commaIdx === -1) {
        console.warn("⚠️ [DOCX Image] Formato inválido (sin coma), usando pixel.");
        return getTransparentPixel();
    }

    const header = dataUrl.substring(0, Math.min(commaIdx, 200));
    const payload = dataUrl.substring(commaIdx + 1);
    // Remover espacios en blanco o saltos de línea basura que rompen atob
    const cleanPayload = payload.replace(/\s+/g, "");
    
    const isBase64 = header.toLowerCase().includes("base64");

    let binary: string;
    try {
        binary = isBase64 ? atob(cleanPayload) : decodeURIComponent(cleanPayload);
    } catch (e: unknown) {
        console.error("⚠️ [DOCX Image] Falla al decodificar (atob/URI). Usando pixel.", e);
        return getTransparentPixel();
    }

    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Formatea un número con coma decimal al estilo español */
function formatES(value: number | undefined | null, decimals: number): string {
    return (Number(value) || 0).toFixed(decimals).replace(".", ",");
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/** Tamaños en pt (ancho, alto) por slot de imagen en la plantilla Word */
const IMG_SIZES: Record<string, [number, number]> = {
    // Tags que usa la plantilla .docx actualmente
    capturaSuperficiales: [362, 297],      // pág 1 – CEE inicial
    capturaLibreriaAntes: [316, 249],      // pág 2 – materiales antes
    capturaLibreriaDespues: [405, 319],    // pág 4 – materiales después
    imgFichaTecnica: [480, 679],           // pág 6 – ficha técnica (ocupa toda la hoja)
    capturaCE3X_1: [470, 340],             // pág 7 – CE3X antes
    capturaCE3X_2: [470, 340],             // pág 7 – CE3X después
};

export async function generarCertificadoE1_3_5_DOCX(payload: DocxE135Payload) {
    if (!payload.resultado) {
        throw new Error("No hay resultados térmicos calculados para generar el DOCX.");
    }

    // 1. Fetch template from public folder
    const res = await fetch("/templates/E1-3-5_TEMPLATE.docx");
    if (!res.ok) throw new Error("No se pudo cargar la plantilla E1-3-5_TEMPLATE.docx");

    const blob = await res.blob();
    const arrayBuffer = await blob.arrayBuffer();

    // 2. Setup PizZip and ImageModule
    const zip = new PizZip(arrayBuffer);

    const imageOptions = {
        centered: false,
        getImage: (tagValue: unknown, _tagName: string) => {
            if (typeof tagValue === "string") {
                return dataURLToArrayBuffer(tagValue);
            }
            if (tagValue instanceof ArrayBuffer) {
                return tagValue;
            }
            return getTransparentPixel();
        },
        getSize: (_img: unknown, _tagValue: string, tagName: string) => {
            return IMG_SIZES[tagName] || [400, 280];
        },
    };

    const imageModule = new ImageModule(imageOptions);

    const doc = new Docxtemplater(zip, {
        modules: [imageModule],
        paragraphLoop: true,
        linebreaks: true,
    });

    // 3. Extract data from payload
    const r: ResultadoTermico = payload.resultado;
    const c: Partial<CapturasState> = payload.capturas || {};

    // --- Find the applied insulation material ---
    let espesorMM = 0;
    let materialNombre = "N/A";
    const nuevaCapa = payload.capas?.find((capa) => capa.es_nueva);
    if (nuevaCapa) {
        // CapaMaterial.espesor is in meters; convert to mm
        const espesorM = Number(nuevaCapa.espesor) || 0;
        espesorMM = espesorM * 1000;
        materialNombre = nuevaCapa.nombre || "N/A";
    }

    // --- Build full address string ---
    const dirArr = [
        payload.direccionInmueble,
        payload.cpInmueble,
        payload.municipioInmueble,
        payload.provinciaInmueble,
    ].filter(Boolean);
    const direccionFull = dirArr.length > 0 ? dirArr.join(", ") : "Dirección no especificada";

    // --- Numeric helpers ---
    const factorGNum = VALORES_G[payload.zonaKey || ""] || 0;
    const supEnvolvente = Number(payload.supEnvolvente) || 0;
    const supActuacion = Number(payload.supActuacion) || 0;
    const pctAfectado = supEnvolvente > 0 ? (supActuacion / supEnvolvente) * 100 : 0;

    // --- Image DataURLs (strings — the ImageModule converts them internally) ---
    const imgCE3XAntes = c.ce3x_antes?.dataUrl || "";
    const imgCE3XDespues = c.ce3x_despues?.dataUrl || "";
    const imgLibAntes = c.materiales_antes?.dataUrl || "";
    const imgLibDespues = c.materiales_despues?.dataUrl || "";
    const imgCEEInicial = c.cee_inicial?.dataUrl || "";
    const imgFicha = c.ficha_tecnica?.dataUrl || "";

    // --- Build the data object for docxtemplater ---
    const dataDocx: Record<string, unknown> = {
        // ─── COMMON / NEW VARIABLES ────────────────────────────────────
        clienteNombre: (payload.clienteNombre || "").toUpperCase(),
        direccionInmueble: direccionFull,
        supEnvolvente: formatES(supEnvolvente, 2),
        tipoElemento: payload.tipoElemento || "partición",
        supActuacion: formatES(supActuacion, 2),
        porcentajeAfectado: formatES(pctAfectado, 2),

        areaNHE: formatES(payload.areaNHE, 2),
        espesorMM: String(Math.round(espesorMM)),
        materialNombre,

        alturaMsnm: String(Number(payload.alturaMsnm) || 0),
        zonaClimatica: payload.zonaKey || "-",
        factorG: formatES(factorGNum, 2),
        formulaAE: `1 × (${formatES(r.ui_final, 2)} − ${formatES(r.uf_final, 2)}) × ${formatES(supActuacion, 2)} × ${formatES(factorGNum, 2)}`,
        ahorroKwh: String(Math.round(r.ahorro || 0)),
        ciudadFirma: payload.ciudadFirma || "Madrid",
        fechaFirma: new Date().toLocaleDateString("es-ES", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
        }),

        // ─── THERMAL VALUES ────────────────────────────────────────────
        rCapasIniciales: formatES(r.r_mat_inicial, 3),
        RTi: formatES(r.rt_inicial, 3),
        Upi: formatES(r.up_inicial, 3),
        ratioB: formatES(r.ratio, 2),
        bInicial: formatES(r.b_inicial, 2),
        Ui: formatES(r.ui_final, 2),
        rCapasFinales: formatES(r.r_mat_final, 3),
        RTf: formatES(r.rt_final, 3),
        Upf: formatES(r.up_final, 3),
        bFinal: formatES(r.b_final, 2),
        Uf: formatES(r.uf_final, 2),

        // ─── LEGACY VARIABLES (for current Word template) ──────────────
        RBase: formatES(r.r_mat_inicial, 3),
        RtBaseVal: formatES(r.rt_inicial, 3),
        RtBase: formatES(r.rt_inicial, 3),
        UpBase: formatES(r.up_inicial, 3),
        areaNhe: formatES(payload.areaNHE, 2),
        factorHnhNhe: formatES(r.ratio, 2),
        bBase: formatES(r.b_inicial, 2),
        UiBase: formatES(r.ui_final, 2),
        RtMaterial: formatES(r.r_mat_final, 3),
        RtFinal: formatES(r.rt_final, 3),
        UpFinal: formatES(r.up_final, 3),
        UiFinal: formatES(r.uf_final, 2),

        // ─── IMAGES (tags must match {%tagName} in the Word template) ──
        capturaSuperficiales: imgCEEInicial,       // pág 1 – CEE Inicial
        capturaLibreriaAntes: imgLibAntes,          // pág 2 – Materiales antes
        capturaLibreriaDespues: imgLibDespues,      // pág 4 – Materiales después
        imgFichaTecnica: imgFicha,                  // pág 6 – Ficha técnica
        capturaCE3X_1: imgCE3XAntes,                // pág 7 – CE3X antes
        capturaCE3X_2: imgCE3XDespues,              // pág 7 – CE3X después
    };

    // 4. Render and save
    try {
        doc.render(dataDocx);
    } catch (error: unknown) {
        console.error("Error al renderizar DOCX:", error);
        if (error instanceof Error) {
            throw new Error(`No se pudo estructurar el documento Word: ${error.message}`);
        }
        throw new Error("No se pudo estructurar el documento Word. Revisa que todos los campos y capturas estén completos.");
    }

    const outputBlob = doc.getZip().generate({
        type: "blob",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    const safeFilename = (payload.clienteNombre || "Certificado")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "_");
    saveAs(outputBlob, `CERTIFICADO_E1-3-5_${safeFilename}.docx`);
}
