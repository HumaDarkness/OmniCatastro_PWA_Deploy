import { useState } from "react";
import { processSignatureWithAutoCrop } from "../../../infra/image/signaturePipeline";
import { db } from "../../../infra/db/OmniCatastroDB";

interface UseSignatureProcessingResult {
  processAndSaveTechnicalSignature: (file: File | Blob) => Promise<Blob | null>;
  processSignature: (file: File | Blob) => Promise<Blob | null>;
  isProcessing: boolean;
  error: Error | null;
}

export function useSignatureProcessing(): UseSignatureProcessingResult {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const processSignature = async (file: File | Blob): Promise<Blob | null> => {
    setIsProcessing(true);
    setError(null);
    try {
      return await processSignatureWithAutoCrop(file);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown signature error"));
      return null;
    } finally {
      setIsProcessing(false);
    }
  };

  const processAndSaveTechnicalSignature = async (file: File | Blob): Promise<Blob | null> => {
    const processedBlob = await processSignature(file);
    if (processedBlob) {
      // Guardar para persistencia (Asset técnico local)
      // Sobreescribimos la "firma_tecnico" buscando su identificador o añadiéndolo
      await db.transaction("rw", db.assets, async () => {
        const existing = await db.assets.where("alias").equals("firma_tecnico").first();
        await db.assets.put({
          id: existing?.id,
          alias: "firma_tecnico",
          type: processedBlob.type,
          blobData: processedBlob,
          createdAt: Date.now(),
        });
      });
    }
    return processedBlob;
  };

  return { processSignature, processAndSaveTechnicalSignature, isProcessing, error };
}
