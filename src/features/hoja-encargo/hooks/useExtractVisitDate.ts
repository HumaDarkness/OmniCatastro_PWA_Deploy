import { useState } from "react";
import { extractPdfText } from "../../../infra/pdf/pdfExtractor";
import { parseCe3xFechaVisita } from "../../../infra/xml/ce3xParser";

interface UseExtractVisitDateResult {
  extract: (file: File) => Promise<string | null>;
  isExtracting: boolean;
  error: Error | null;
}

/**
 * Orquestador React para delegar la extracción al Infra adecuado (PDF vs XML).
 */
export function useExtractVisitDate(): UseExtractVisitDateResult {
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const extract = async (file: File): Promise<string | null> => {
    setIsExtracting(true);
    setError(null);

    try {
      if (file.name.toLowerCase().endsWith(".xml")) {
        const xmlString = await file.text();
        return await parseCe3xFechaVisita(xmlString);
      } else if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        const result = await extractPdfText(file);
        // Si encontramos fechas, devolvemos la última o la primera (normalmente la del certificado)
        if (result.dates && result.dates.length > 0) {
          return result.dates[0];
        }
        return null;
      }
      throw new Error("Formato no soportado. Debe ser PDF o XML (CE3X).");
    } catch (err) {
      const e = err instanceof Error ? err : new Error("Unknown error");
      setError(e);
      return null;
    } finally {
      setIsExtracting(false);
    }
  };

  return { extract, isExtracting, error };
}
