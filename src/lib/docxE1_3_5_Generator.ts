// @ts-ignore
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
// @ts-ignore
import ImageModule from "open-docxtemplater-image-module";
import { saveAs } from "file-saver";

// We import the payload interface, but since we just need the structure, any is fine or we explicitly define it.
// Assuming CertificateDraftPayload is passed directly.

function dataURLToArrayBuffer(dataUrl: string): ArrayBuffer {
    const match = dataUrl.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/i);
    if (!match) throw new Error("Invalid dataUrl");
    
    const isBase64 = Boolean(match[2]);
    const payload = match[3] || "";
    
    let binary: string;
    if (isBase64) {
        binary = atob(payload);
    } else {
        binary = decodeURIComponent(payload);
    }
    
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
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
    
    const imageOptions = {
        centered: false,
        getImage: (tagValue: string, _tagName: string) => {
            if (!tagValue) return new ArrayBuffer(0);
            return dataURLToArrayBuffer(tagValue);
        },
        getSize: (_img: any, _tagValue: string, _tagName: string) => {
            // Static size for now (approx 16cm wide = ~600px width). 
            // Better to constrain width and let height be proportional, but setting fixed width helps layout
            // Format: [width, height] in pixels
            return [600, 350]; 
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
    
    // Find applied material
    let espesorMM = "0";
    let materialNombre = "Aislamiento";
    let RtMaterial = "0.000";
    const nuevaCapa = payload.capas.find((c: any) => c.esNueva);
    if (nuevaCapa && nuevaCapa.material) {
        espesorMM = (nuevaCapa.espesorMetros * 1000).toFixed(0);
        materialNombre = nuevaCapa.material.nombre;
        RtMaterial = nuevaCapa.resistencia.toFixed(3);
    }

    // Prepare address string
    const dirArr = [
        payload.direccionInmueble,
        payload.cpInmueble,
        payload.municipioInmueble,
        payload.provinciaInmueble
    ].filter(Boolean);
    const direccionFull = dirArr.length > 0 ? dirArr.join(", ") : "Dirección no especificada";

    // Mapear capturas al tag esperado en el docx
    // "ce3x_antes", "ce3x_despues", "materiales_antes", "materiales_despues", "cee_inicial", "ficha_tecnica"
    const c = payload.capturas || {};
    
    const dataDocx = {
        clienteNombre: payload.clienteNombre || "CLIENTE NO ESPECIFICADO",
        direccionInmueble: direccionFull,
        supEnvolvente: (payload.supEnvolvente || 0).toFixed(2),
        supActuacion: (payload.supActuacion || 0).toFixed(2),
        porcentajeAfectado: r.porcentajeAfectado.toFixed(2),
        RtBaseVal: r.RtBase.toFixed(3), // The python script replaces 0.130 to {RtBaseVal}
        RBase: r.RBase.toFixed(2),
        RtBase: r.RtBase.toFixed(3),
        UpBase: r.UpBase.toFixed(3),
        areaNhe: (payload.areaNHE || 0).toFixed(2),
        factorHnhNhe: r.bBase.toFixed(2), // We used bBase directly for the ratio in DOCX
        bBase: r.bBase.toFixed(2),
        UiBase: r.UiBase.toFixed(2),
        espesorMM: espesorMM,
        materialNombre: materialNombre,
        RtMaterial: RtMaterial,
        RtFinal: r.RtFinal.toFixed(3),
        bFinal: r.bFinal.toFixed(2),
        UpFinal: r.UpFinal.toFixed(3),
        UiFinal: r.UiFinal.toFixed(2),
        alturaMsnm: payload.alturaMsnm || 0,
        zonaClimatica: payload.zonaKey || "E1",
        factorG: r.factorG.toFixed(2),
        ahorroKwh: Math.round(payload.ahorroKwh || 0),
        fechaFirma: new Date().toLocaleDateString("es-ES"),

        // Imágenes en base64 de las capturas (el DOCX recibe el string, y el ImageModule lo convierte)
        capturaCE3X_1: c.ce3x_antes?.dataUrl || "",
        capturaLibreriaAntes: c.materiales_antes?.dataUrl || "",
        capturaSuperficiales: c.materiales_despues?.dataUrl || "", // Reutilizamos según el mapa
        capturaLibreriaDespues: c.materiales_despues?.dataUrl || "",
        capturaCE3X_2: c.ce3x_despues?.dataUrl || "",
    };

    doc.renderAsync ? await doc.renderAsync(dataDocx) : doc.render(dataDocx);

    // 4. Output DOCX
    const out = doc.getZip().generate({
        type: "blob",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    const filename = `CERTIFICADO_E1_3_5_${payload.clienteNombre || "CLIENTE"}.docx`;
    saveAs(out, filename);
}
