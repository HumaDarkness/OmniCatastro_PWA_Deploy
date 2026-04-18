import { type CapaMaterial, type ResultadoTermico } from "./thermalCalculator";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

/**
 * Generador PDF Anexo E.1 del CTE (Fase 21).
 * Renderiza un documento PDF profesional con el resumen justificativo del cálculo
 * térmico y ahorro anual del Certificado de Ahorro Energético (CAE).
 */

export interface GeneratedPdfFile {
  fileName: string;
  blob: Blob;
}

export function generarPDFAnexoE1(
  capas: CapaMaterial[],
  resultado: ResultadoTermico,
  fileName = "Anexo_E1_Transmitancia.pdf"
): GeneratedPdfFile | null {
  if (!resultado) return null;

  const doc = new jsPDF();

  // Configuración de metadatos
  doc.setProperties({
    title: "Anexo E.1 - Justificación Transmitancia Térmica",
    subject: "Cálculo DB-HE",
    author: "OmniCatastro Suite v9.0",
    creator: "OmniCatastro PWA",
  });

  // 1. Cabecera "Anexo E.1 Justificación Transmitancia Térmica"
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Anexo E.1 - Justificación de Transmitancia Térmica", 14, 20);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("Documento Básico de Ahorro de Energía (CTE DB-HE)", 14, 26);

  doc.setDrawColor(59, 130, 246); // Color Azul Omni
  doc.setLineWidth(0.5);
  doc.line(14, 30, 196, 30);

  let yPos = 40;

  // 2. Tabla de capas existentes vs capas de mejora
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 0, 0);
  doc.text("1. Composición del Cerramiento", 14, yPos);
  yPos += 5;

  const tableData = capas.map((c) => [
    c.nombre || "Sin especificar",
    Number(c.espesor) > 0 ? Number(c.espesor).toFixed(3) : "-",
    Number(c.lambda_val) > 0 ? Number(c.lambda_val).toFixed(3) : "-",
    Number(c.r_valor) > 0 ? Number(c.r_valor).toFixed(3) : "-",
    c.es_nueva ? "MEJORA" : "EXISTENTE",
  ]);

  autoTable(doc, {
    startY: yPos,
    head: [["Capa / Material", "Espesor (m)", "λ (W/mK)", "R (m²K/W)", "Tipo"]],
    body: tableData,
    theme: "grid",
    headStyles: { fillColor: [15, 23, 42], textColor: 255 }, // Slate-900
    alternateRowStyles: { fillColor: [248, 250, 252] }, // Slate-50
    styles: { fontSize: 9, cellPadding: 3 },
  });

  yPos = (doc as any).lastAutoTable.finalY + 15;

  // 3 y 4. Resultados del Cálculo con U inicial y final
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("2. Resultados del Cálculo (DB-HE)", 14, yPos);

  yPos += 10;
  doc.setFontSize(10);

  // Bloque Estado Inicial
  doc.setFont("helvetica", "bold");
  doc.text("Estado Inicial", 14, yPos);
  doc.setFont("helvetica", "normal");
  yPos += 7;
  doc.text(`Resistencia Térmica Inicial (R_T): ${resultado.rt_inicial.toFixed(3)} m²K/W`, 14, yPos);
  yPos += 6;
  doc.text(
    `Transmitancia Térmica Parcial Inicial (U_p): ${resultado.up_inicial.toFixed(3)} W/m²K`,
    14,
    yPos
  );
  yPos += 6;
  doc.text(`Factor de reducción de temperatura (b): ${resultado.b_inicial.toFixed(2)}`, 14, yPos);
  yPos += 6;
  doc.setFont("helvetica", "bold");
  doc.text(`Transmitancia Térmica Inicial (U_i): ${resultado.ui_final.toFixed(3)} W/m²K`, 14, yPos);

  yPos += 12;

  // Bloque Estado Reformado
  doc.setFont("helvetica", "bold");
  doc.text("Estado Reformado (Mejora)", 14, yPos);
  doc.setFont("helvetica", "normal");
  yPos += 7;
  doc.text(`Resistencia Térmica Final (R_T): ${resultado.rt_final.toFixed(3)} m²K/W`, 14, yPos);
  yPos += 6;
  doc.text(
    `Transmitancia Térmica Parcial Final (U_p): ${resultado.up_final.toFixed(3)} W/m²K`,
    14,
    yPos
  );
  yPos += 6;
  doc.text(`Factor de reducción de temperatura (b): ${resultado.b_final.toFixed(2)}`, 14, yPos);
  yPos += 6;

  doc.setFont("helvetica", "bold");
  doc.setTextColor(16, 185, 129); // emerald-500
  doc.text(
    `Transmitancia Térmica Final Mejorada (U_f): ${resultado.uf_final.toFixed(3)} W/m²K`,
    14,
    yPos
  );
  doc.setTextColor(0, 0, 0); // reset negro

  yPos += 15;

  // Ahorro Energético
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("3. Estimación de Ahorro para CAE", 14, yPos);
  yPos += 8;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(
    `Reducción de Transmitancia (ΔU): ${(resultado.ui_final - resultado.uf_final).toFixed(3)} W/m²K`,
    14,
    yPos
  );
  yPos += 6;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(245, 158, 11); // amber-500
  doc.text(`Ahorro Energético Calculado: ${resultado.ahorro.toLocaleString()} kWh/año`, 14, yPos);
  doc.setTextColor(0, 0, 0);

  // 6. Firma y fecha
  yPos += 35;
  if (yPos > 270) {
    doc.addPage();
    yPos = 30;
  }

  doc.setDrawColor(15, 23, 42);
  doc.line(14, yPos, 80, yPos); // Línea para firmar
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Firma del Técnico Competente / Emitido por OmniCatastro", 14, yPos + 5);
  const dateStr = new Date().toLocaleDateString("es-ES");
  doc.text(`Fecha de generación: ${dateStr}`, 14, yPos + 10);

  const blob = doc.output("blob") as Blob;
  doc.save(fileName);
  return { fileName, blob };
}
