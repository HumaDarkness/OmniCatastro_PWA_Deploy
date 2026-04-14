import { SignatureProcessError } from '../../contracts/hoja-encargo';

/**
 * Recibe un File o Blob nativo, limpia el fondo aplicándole el umbral de transparecia,
 * y le hace un bounding box (Crop matemático) a los bordes visuales de la firma.
 * Prioriza OffscreenCanvas si el navegador lo soporta para no tocar el DOM.
 */
export async function processSignatureWithAutoCrop(file: File | Blob): Promise<Blob> {
    try {
        const bmp = await createImageBitmap(file);

        let canvas: HTMLCanvasElement | OffscreenCanvas;
        let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

        if (typeof OffscreenCanvas !== 'undefined') {
            canvas = new OffscreenCanvas(bmp.width, bmp.height);
            ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
        } else {
            canvas = document.createElement('canvas');
            canvas.width = bmp.width;
            canvas.height = bmp.height;
            ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        }

        ctx.drawImage(bmp, 0, 0);

        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;

        let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;

        // Limpieza de pixeles + Calculo de BBOX en pasada unificada
        for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
                const idx = (y * canvas.width + x) * 4;
                const r = data[idx], g = data[idx + 1], b = data[idx + 2];
                // Umbral estricto: > 170 -> Alpha 0
                if (r > 170 && g > 170 && b > 170) {
                    data[idx + 3] = 0; 
                } else {
                    // Update bbox si el píxel NO fue descartado
                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
                }
            }
        }

        // Si la imagen era completamente en blanco/transparente
        if (maxX < minX || maxY < minY) {
            throw new SignatureProcessError("La firma detectada está vacía o es íntegramENTE del color del fondo.");
        }

        const cropW = maxX - minX + 1;
        const cropH = maxY - minY + 1;
        
        const croppedImgData = ctx.getImageData(minX, minY, cropW, cropH);

        // Resize Canvas down to Bounding Box
        canvas.width = cropW;
        canvas.height = cropH;
        ctx.putImageData(croppedImgData, 0, 0);

        // Retornar en blob binario puro en alta calidad
        if (typeof OffscreenCanvas !== 'undefined') {
            return await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' });
        } else {
            return new Promise((resolve, reject) => {
                (canvas as HTMLCanvasElement).toBlob((b) => {
                    if (b) resolve(b);
                    else reject(new SignatureProcessError("Fallo final a Blob()"));
                }, 'image/png');
            });
        }
    } catch (err) {
        throw new SignatureProcessError(`Error en el pipeline de la firma: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
}
