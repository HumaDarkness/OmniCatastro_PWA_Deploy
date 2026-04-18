import { pdfjsLib } from "./worker";
import type { PdfExtractionResult } from "../../contracts/hoja-encargo";
import { PdfWorkerError } from "../../contracts/hoja-encargo";

/**
 * Extrae todo el texto de las capas de texto de un PDF en Client-Side de forma headless.
 * @param file Objeto File del CEE o documento
 * @returns PdfExtractionResult conteniendo el texto extraído y fechas candidatas.
 */
export async function extractPdfText(file: File | Blob): Promise<PdfExtractionResult> {
  try {
    const arrayBuffer = await file.arrayBuffer();

    // El loadDocument parsea el PDF completo en el Worker thread sin bloquear Main
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    const texts: string[] = [];
    let pagesScanned = 0;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pageText = content.items.map((item: any) => item.str).join(" ");
      texts.push(pageText);
      pagesScanned++;
    }

    const fullText = texts.join("\n");
    const dates = _extractDatesFromPdfText(fullText);

    return {
      fullText,
      dates,
      pagesScanned,
      source: "text-layer",
    };
  } catch (e) {
    throw new PdfWorkerError(
      `Fallo al leer capa de texto: ${e instanceof Error ? e.message : "Unknown"}`
    );
  }
}

/**
 * Función interna para aislar fechas DD/MM/YYYY o similares.
 */
function _extractDatesFromPdfText(text: string): string[] {
  const re = /\b(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})\b/g;
  const matches = Array.from(text.matchAll(re), (m) => m[1]);
  return matches;
}
