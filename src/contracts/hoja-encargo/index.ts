// =========================================================================
// Contratos Tipados y DTOs Compartidos
// Dominio: Hoja de Encargo
// =========================================================================

/**
 * Representa los datos extraídos de un PDF procesado.
 */
export interface PdfExtractionResult {
  fullText: string;
  dates: string[];
  pagesScanned: number;
  source: "text-layer" | "ocr" | "unknown";
  metadata?: Record<string, unknown>;
}

/**
 * Cliente persistido en el Quick-Fill (Historial local)
 */
export interface QuickFillClientDTO {
  id?: number;
  nif: string;
  nombre: string;
  domicilio: string;
  lastUsedAt: number; // Para ordenar vía política LRU
}

/**
 * Datos almacenados en el store de Assets Offline.
 * Usado para persistir la firma del Técnico por dispositivo.
 */
export interface AssetDTO {
  id?: number;
  alias: string; // e.g. "firma_tecnico_default"
  type: string; // e.g. "image/png"
  blobData: Blob;
  createdAt: number;
}

/**
 * Errores de Dominio Específicos
 */
export class PdfWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfWorkerError";
  }
}

export class XmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlParseError";
  }
}

export class SignatureProcessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignatureProcessError";
  }
}
