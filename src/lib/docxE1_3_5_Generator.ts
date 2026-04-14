// @ts-ignore
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
// @ts-ignore
import ImageModule from "docxtemplater-image-module-free";
import { saveAs } from "file-saver";
import { VALORES_G } from "./thermalCalculator";

// Transparent 1x1 PNG to prevent docxtemplater "reading 'part'" crash on empty loops/tags
const TRANSPARENT_1X1_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function getTransparentPixel(): ArrayBuffer {
    const binary = atob(TRANSPARENT_1X1_PNG_B64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

function dataURLToArrayBuffer(dataUrl: string): ArrayBuffer {
    if (!dataUrl) return getTransparentPixel();

    const match = dataUrl.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/i);
    if (!match) return getTransparentPixel(); // Fallback
    
    const isBase64 = Boolean(match[2]);
    const payload = match[3] || "";
    
    let binary: string;
    try {
        if (isBase64) {
            binary = atob(payload);
        } else {
            binary = decodeURIComponent(payload);
        }
    } catch {
        return getTransparentPixel();
    }
    
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

function formatES(value: number, decimals: number): string {
    return (value || 0).toFixed(decimals).replace(".", ",");
}

export async function generarCertificadoE1_3_5_DOCX(payload: any) {
    if (!payload.resultado) {
        throw new Error("No hay resultados termicos calculados para generar el DOCX.");
    }

    // 1. Fetch template from public folder
    const res = await fetch("/templates/E1-3-5_TEMPLATE.docx");
    if (!res.ok) throw new Error("No se pudo cargar la plantilla E1-3-5_TEMPLATE.docx");
    
    const blob = await res.blob();
    const arrayBuffer = await blob.arrayBuffer();

    // 2. Setup Pizzip and ImageModule
    const zip = new PizZip(arrayBuffer);
    
    const IMG_SIZES: Record<string, [number, number]> = {
        imgCerramientosEnvolvente: [470, 394],
        imgLibreriaAntes:          [316, 249],
        imgLibreriaDespues:        [405, 319],
        imgFichaTecnica:           [480, 679],
        imgCEEAntes:               [362, 297],
        imgCEEDespues:             [389, 319],
    };

    const imageOptions = {
        centered: false,
        getImage: (tagValue: any, _tagName: string) => {
            if (typeof tagValue === "string") {
                return dataURLToArrayBuffer(tagValue);
            }
            if (tagValue instanceof ArrayBuffer) {
                return tagValue;
            }
            return getTransparentPixel();
        },
        getSize: (_img: any, _tagValue: string, tagName: string) => {
            return IMG_SIZES[tagName] || [400, 280]; 
        }
    };

    const imageModule = new ImageModule(imageOptions);

    const doc = new Docxtemplater(zip, {
        modules: [imageModule],
        paragraphLoop: true,
        linebreaks: true,
    });

    // 3. Prepare data map
    const r = payload.resultado;
    const c = payload.capturas || {};
    
    // Find applied material
    let espesorMM = 0;
    let materialNombre = "N/A";
    const nuevaCapa = payload.capas?.find((capa: any) => capa.esNueva) || payload.capas?.find((capa: any) => capa.es_nueva);
    if (nuevaCapa) {
        if (nuevaCapa.material) {
            espesorMM = nuevaCapa.espesorMetros * 1000;
            materialNombre = nuevaCapa.material.nombre;
        } else {
            espesorMM = Number(nuevaCapa.espesor) * 1000;
            materialNombre = nuevaCapa.nombre;
        }
    }

    // Prepare address string
    const dirArr = [
        payload.direccionInmueble,
        payload.cpInmueble,
        payload.municipioInmueble,
        payload.provinciaInmueble
    ].filter(Boolean);
    const direccionFull = dirArr.length > 0 ? dirArr.join(", ") : "Dirección no especificada";

    const factorGNum = VALORES_G[payload.zonaKey] || 0;

    const supEnvolvente = Number(payload.supEnvolvente) || 0;
    const supActuacion = Number(payload.supActuacion) || 0;
    const pctAfectado = supEnvolvente > 0 ? (supActuacion / supEnvolvente) * 100 : 0;

    // We pass STRINGS to the dataDocx so the ImageModule doesn't confuse ArrayBuffers with pre-rendered tags.
    const imgCerramientosEnBuffer = c.ce3x_antes?.dataUrl || "";
    const imgLibreriaAntesBuffer = c.materiales_antes?.dataUrl || "";
    const imgCEEAntesBuffer = c.cee_inicial?.dataUrl || "";
    const imgLibreriaDespuesBuffer = c.materiales_despues?.dataUrl || "";
    const imgCEEDespuesBuffer = c.ce3x_despues?.dataUrl || "";
    const imgFichaTecnicaBuffer = c.ficha_tecnica?.dataUrl || "";

    const dataDocx = {
        // --- VARIABLES NUEVAS ---
        clienteNombre: (payload.clienteNombre || "").toUpperCase(),
        direccionInmueble: direccionFull,
        supEnvolvente: formatES(supEnvolvente, 2),
        tipoElemento: payload.tipoElemento || "partición",
        supActuacion: formatES(supActuacion, 2),
        porcentajeAfectado: formatES(pctAfectado, 2),
        rCapasIniciales: formatES(r.r_capas_iniciales || 0, 3),
        RTi: formatES(r.rt_inicial || 0, 3),
        Upi: formatES(r.up_inicial || 0, 3),
        areaNHE: formatES(payload.areaNHE || 0, 2),
        ratioB: formatES(r.ratio_b || 0, 2),
        bInicial: formatES(r.b_inicial || 0, 2),
        Ui: formatES(r.ui || 0, 2),
        espesorMM: String(Math.round(espesorMM)),
        materialNombre: materialNombre,
        rCapasFinales: formatES(r.r_capas_finales || 0, 3),
        RTf: formatES(r.rt_final || 0, 3),
        Upf: formatES(r.up_final || 0, 3),
        bFinal: formatES(r.b_final || 0, 2),
        Uf: formatES(r.uf || 0, 2),
        alturaMsnm: String(payload.alturaMsnm || 0),
        zonaClimatica: payload.zonaKey || "-",
        factorG: formatES(factorGNum, 2),
        formulaAE: `1 × (${formatES(r.ui || 0, 2)} − ${formatES(r.uf || 0, 2)}) × ${formatES(supActuacion, 2)} × ${formatES(factorGNum, 2)}`,
        ahorroKwh: String(Math.round(r.ahorro_kwh || 0)),
        ciudadFirma: payload.ciudadFirma || "Madrid",
        fechaFirma: new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }),
        imgCerramientosEnvolvente: imgCerramientosEnBuffer,
        imgLibreriaAntes:          imgLibreriaAntesBuffer,
        imgLibreriaDespues:        imgLibreriaDespuesBuffer,
        imgFichaTecnica:           imgFichaTecnicaBuffer,
        imgCEEAntes:               imgCEEAntesBuffer,
        imgCEEDespues:             imgCEEDespuesBuffer,

        // --- VARIABLES LEGACY (Para compatibilidad con la plantilla Word actual) ---
        RBase: formatES(r.r_capas_iniciales || 0, 3),
        RtBaseVal: formatES(r.rt_inicial || 0, 3),
        RtBase: formatES(r.rt_inicial || 0, 3),
        UpBase: formatES(r.up_inicial || 0, 3),
        areaNhe: formatES(payload.areaNHE || 0, 2),
        factorHnhNhe: formatES(r.ratio_b || 0, 2),
        bBase: formatES(r.b_inicial || 0, 2),
        UiBase: formatES(r.ui || 0, 2),
        RtMaterial: formatES((espesorMM/1000) / 0.035, 3), // aprox si no hay
        RtFinal: formatES(r.rt_final || 0, 3),
        UpFinal: formatES(r.up_final || 0, 3),
        UiFinal: formatES(r.uf || 0, 2),

        // --- IMÁGENES LEGACY ---
        capturaCE3X_1: imgCerramientosEnBuffer,
        capturaLibreriaAntes: imgLibreriaAntesBuffer,
        capturaSuperficiales: imgCEEAntesBuffer,
        capturaLibreriaDespues: imgLibreriaDespuesBuffer,
        capturaCE3X_2: imgCEEDespuesBuffer
    };

    try {
        doc.render(dataDocx);
    } catch (error: any) {
        console.error("Error al renderizar DOCX:", error);
        throw new Error("No se pudo estructurar el documento Word. Revisa que todos los campos y capturas estén completos.");
    }

    const outputObj = doc.getZip().generate({
        type: "blob",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    const safeFilename = (payload.clienteNombre || "Certificado").trim().toUpperCase().replace(/\s+/g, "_");
    saveAs(outputObj, `CERTIFICADO_E1-3-5_${safeFilename}.docx`);
}
