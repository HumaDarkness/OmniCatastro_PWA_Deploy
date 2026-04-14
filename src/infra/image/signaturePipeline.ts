import { SignatureProcessError } from '../../contracts/hoja-encargo';
import type { SignatureWorkerInput, SignatureWorkerOutput } from './signatureCleaner.worker';

// Instancia única del worker — se reutiliza entre llamadas
let _worker: Worker | null = null;

function getWorker(): Worker {
  if (!_worker) {
    // Vite: ?worker&url hace que el import sea la URL del bundle del worker
    _worker = new Worker(
      new URL('./signatureCleaner.worker.ts', import.meta.url),
      { type: 'module' }
    );
  }
  return _worker;
}

/** Termina el worker si ya no se necesita (ej: al desmontar AjustesView) */
export function disposeSignatureWorker(): void {
  _worker?.terminate();
  _worker = null;
}

/**
 * Pipeline completo: File/Blob → Worker Sauvola → auto-crop → PNG Blob
 * No bloquea el hilo principal. Zero-copy via Transferable.
 */
export async function processSignatureWithAutoCrop(
  file: File | Blob,
  options?: { windowSize?: number; k?: number }
): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const offscreen = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = offscreen.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();

    const imageData = ctx.getImageData(0, 0, bmp.width, bmp.height);

    const payload: SignatureWorkerInput = {
      imageData,
      width: bmp.width,
      height: bmp.height,
      windowSize: options?.windowSize ?? 31,
      k: options?.k ?? 0.25,
    };

    // Despachar al Worker — transferir buffer (zero-copy)
    const result = await _dispatchToWorker(payload, [imageData.data.buffer]);

    if ('error' in result) {
      throw new SignatureProcessError(result.error as string);
    }

    const { imageData: cleanedData, bbox } = result as SignatureWorkerOutput;

    // Validar que la firma no esté vacía
    if (bbox.maxX < bbox.minX || bbox.maxY < bbox.minY) {
      throw new SignatureProcessError('La firma detectada está vacía o es completamente del color del fondo.');
    }

    // Auto-crop al bounding box
    const cropW = bbox.maxX - bbox.minX + 1;
    const cropH = bbox.maxY - bbox.minY + 1;

    const cropCanvas = new OffscreenCanvas(cropW, cropH);
    const cropCtx = cropCanvas.getContext('2d')!;
    cropCtx.putImageData(cleanedData, -bbox.minX, -bbox.minY);

    return cropCanvas.convertToBlob({ type: 'image/png' });
  } catch (err) {
    if (err instanceof SignatureProcessError) throw err;
    throw new SignatureProcessError(
      `Error en el pipeline de la firma: ${err instanceof Error ? err.message : 'Unknown'}`
    );
  }
}

function _dispatchToWorker(
  payload: SignatureWorkerInput,
  transfer: Transferable[]
): Promise<SignatureWorkerOutput | { error: string }> {
  return new Promise((resolve, reject) => {
    const worker = getWorker();
    const handler = (e: MessageEvent) => {
      worker.removeEventListener('message', handler);
      resolve(e.data);
    };
    worker.addEventListener('message', handler);
    worker.addEventListener('error', (e) => reject(new Error(e.message)), { once: true });
    worker.postMessage(payload, transfer);
  });
}
