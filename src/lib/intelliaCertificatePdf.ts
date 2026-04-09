import jsPDF from "jspdf";
import { type ResultadoTermico } from "./thermalCalculator";

export interface IntelliaCertificateTemplateInput {
    fullClientName: string;
    fullAddress: string;
    supEnvolvente: number;
    areaHNH: number;
    areaNHE: number;
    supActuacion: number;
    alturaMsnm: string;
    zonaKey: string;
    gValue: number;
    fechaEmision: string;
    upDecimals: number;
    espesorNuevaTotalMm: number;
    nombreAislante: string;
    resultado: ResultadoTermico;
}

export interface IntelliaGeneratedPdfFile {
    fileName: string;
    blob: Blob;
}

export function buildIntelliaCertificateText(input: IntelliaCertificateTemplateInput): string {
    const {
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
        resultado,
    } = input;

    const safeEnvolvente = supEnvolvente > 0 ? supEnvolvente : 1;
    const porcentajeEnvolvente = ((areaHNH / safeEnvolvente) * 100).toFixed(2);

    return [
        "CERTIFICADO TÉCNICO JUSTIFICANDO LOS VALORES DE LA FÓRMULA",
        "Datos generales:",
        "1. Identificación de la actuación:",
        `a. Nombre: ${fullClientName || "(completar nombre)"}`,
        `b. Dirección: ${fullAddress || "(completar dirección)"}`,
        "2. Justificación de la superficie total de la envolvente y del porcentaje afectado.",
        `A partir del Certificado de Eficiencia Energética (CEE), se obtiene un valor total de superficie de la envolvente del edificio de ${supEnvolvente.toFixed(2)} m².`,
        "Este valor resulta de la suma de las superficies de todos los conceptos, sin considerar la cubierta, de acuerdo con la ilustración 1.",
        `La actuación corresponde a la partición superior, con una superficie de ${areaHNH.toFixed(2)} m², de acuerdo con la ilustración 1.`,
        "En consecuencia, la superficie afectada resulta:",
        `m² partición superior / superficie de la envolvente del edificio ${areaHNH.toFixed(2)} m² / ${supEnvolvente.toFixed(2)} m² = ${porcentajeEnvolvente} %`,
        "Se trata de una superficie homogénea, sin puentes térmicos ni otros elementos que afecten a los valores de transmitancia térmica.",
        "Ilustración 1 Capturas de pantalla de todos los cerramientos y huecos de la vivienda en el certificado de eficiencia energética.",
        "",
        "Resistencia total (RT) y Transmitancia térmica de la partición (Up):",
        "En la situación anterior, las capas que componen la partición son las que se ven en la ilustración 2 (líneas abajo), siendo la resistencia total igual a la suma de valores R:",
        `ΣR materiales = ${resultado.r_mat_inicial.toFixed(3)} m²K/W`,
        "Ilustración 2 Captura de la librería de cerramientos de CE3X.",
        "A este valor se debe sumar el correspondiente a las resistencias superficiales interior y exterior, siendo ambas 0.1 (ver ilustración 3), de modo que:",
        `RT = ${resultado.r_mat_inicial.toFixed(3)} + 0.1 + 0.1 = ${resultado.rt_inicial.toFixed(3)} m²K/W`,
        "Ilustración 3 Resistencias superficiales interior y exterior.",
        `Up = 1 / RT = 1 / ${resultado.rt_inicial.toFixed(3)} = ${resultado.up_inicial.toFixed(upDecimals)} W/m²K`,
        "",
        "Coeficiente de reducción b y Ui:",
        "Al valor obtenido, se le aplica el coeficiente b de reducción de temperatura.",
        `Ah-nh / Anh-e = ${areaHNH.toFixed(2)} / ${areaNHE.toFixed(2)} = ${resultado.ratio.toFixed(2)}`,
        "Y tratándose de ambos espacios no aislados:",
        `b = ${resultado.b_inicial.toFixed(2)}`,
        "Tabla 7 Coeficiente de reducción de temperatura b.",
        `Ui = Up * b = ${resultado.up_inicial.toFixed(upDecimals)} * ${resultado.b_inicial.toFixed(2)} = ${resultado.ui_final.toFixed(2)} W/m²K`,
        "",
        "Cálculos tras medida de eficiencia:",
        `Se añaden ${espesorNuevaTotalMm > 0 ? espesorNuevaTotalMm : "[ESPESOR_MM]"} mm de ${nombreAislante}, cuyas características se recogen en el Anexo 1: Ficha técnica del material.`,
        "De modo que se actualiza el valor de la resistencia total (RT), considerando el valor de la ilustración 5, y adicionando las resistencias superficiales interior y exterior, de acuerdo a la ilustración 3.",
        `RT = ${resultado.r_mat_final.toFixed(3)} + 0.1 + 0.1 = ${resultado.rt_final.toFixed(3)} m²K/W`,
        "Ilustración 5 Captura de la librería de cerramientos del CE3X.",
        "Posteriormente, se actualiza el valor de b, de acuerdo a la ilustración 4:",
        `b = ${resultado.b_final.toFixed(2)}`,
        `Up = 1 / RT = 1 / ${resultado.rt_final.toFixed(3)} = ${resultado.up_final.toFixed(upDecimals)} W/m²K`,
        `Uf = Up * b = ${resultado.up_final.toFixed(upDecimals)} * ${resultado.b_final.toFixed(2)} = ${resultado.uf_final.toFixed(2)} W/m²K`,
        "",
        "Zona climática y cálculo final:",
        `La actuación se localiza en ${fullAddress || "(completar dirección)"}, cuya altitud es de ${alturaMsnm || "[ALTITUD]"} msnm, por lo que se trata de una zona climática ${zonaKey || "[ZONA]"}, de acuerdo a la tabla 1.`,
        `G = ${gValue.toFixed(2)}`,
        "AE = Fp (Ui-Uf)∙S∙G",
        `AE = 1 * (${resultado.ui_final.toFixed(2)} - ${resultado.uf_final.toFixed(2)}) * ${supActuacion.toFixed(2)} * ${gValue.toFixed(2)} = ${Math.round(resultado.ahorro)} kWh`,
        "Tabla 1 Zonas climáticas.",
        "Y para que así conste y surta los efectos oportunos, se emite el presente certificado.",
        `En Madrid, el ${fechaEmision}.`,
        "Responsable de Obra – Instalador Técnico",
        "Fdo.",
        "",
        "Anexo 1: Ficha técnica del material",
        "Anexo 2:",
        "Ilustración 6 Datos del CE3X antes de la actuación",
        "Anexo 3:",
        "Ilustración 7 Datos del CE3X después de la actuación",
        "",
        "intellia Trading SL CIF : B75691964 Adresse : 15, Calle Velázquez, 28001, Madrid, Madrid Téléphone : - Site Web : - Courrier : tradingintellia@gmail.com",
    ].join("\n");
}

function sanitizeForFilename(value: string): string {
    const cleaned = value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "");

    return cleaned || "SIN_RC";
}

export function buildIntelliaCertificateFilename(expedienteRc: string): string {
    const safeRc = sanitizeForFilename(expedienteRc.trim().toUpperCase());
    return `Certificado_INTELLIA_${safeRc}.pdf`;
}

export function generarPDFCertificadoIntellia(
    input: IntelliaCertificateTemplateInput,
    fileName: string,
): IntelliaGeneratedPdfFile {
    const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
    });

    const text = buildIntelliaCertificateText(input);
    const lines = text.split("\n");

    const marginLeft = 14;
    const marginTop = 16;
    const marginBottom = 16;
    const lineHeight = 5;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const maxLineWidth = pageWidth - marginLeft * 2;

    let cursorY = marginTop;

    doc.setProperties({
        title: "Certificado Tecnico INTELLIA",
        subject: "Justificacion de calculo termico",
        author: "OmniCatastro Suite",
        creator: "OmniCatastro PWA",
    });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("CERTIFICADO TECNICO INTELLIA", marginLeft, cursorY);
    cursorY += lineHeight + 1;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);

    const ensureSpace = (requiredHeight: number) => {
        if (cursorY + requiredHeight <= pageHeight - marginBottom) return;
        doc.addPage();
        cursorY = marginTop;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
    };

    for (const line of lines) {
        if (!line.trim()) {
            ensureSpace(lineHeight * 0.6);
            cursorY += lineHeight * 0.6;
            continue;
        }

        const wrapped = doc.splitTextToSize(line, maxLineWidth) as string[];
        for (const wrappedLine of wrapped) {
            ensureSpace(lineHeight);
            doc.text(wrappedLine, marginLeft, cursorY);
            cursorY += lineHeight;
        }
    }

    const blob = doc.output("blob") as Blob;
    doc.save(fileName);
    return { fileName, blob };
}
