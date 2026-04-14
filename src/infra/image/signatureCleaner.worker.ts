// Declaración para TypeScript en contexto Worker
/// <reference lib="webworker" />

export type SignatureWorkerInput = {
  imageData: ImageData;
  width: number;
  height: number;
  /** Tamaño ventana Sauvola (default 31, ~5% del ancho típico 600px) */
  windowSize?: number;
  /** Agresividad k (0.1=conservador, 0.35=estándar, 0.5=agresivo) */
  k?: number;
};

export type SignatureWorkerOutput = {
  imageData: ImageData;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
};

self.onmessage = function (e: MessageEvent<SignatureWorkerInput>) {
  const { imageData, width, height, windowSize = 31, k = 0.25 } = e.data;

  try {
    const result = processSignature(imageData, width, height, windowSize, k);
    // Transferir el buffer (zero-copy) para no bloquear el hilo principal
    self.postMessage(result, [result.imageData.data.buffer]);
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : 'Worker error' });
  }
};

function processSignature(
  imageData: ImageData,
  W: number,
  H: number,
  winSize: number,
  k: number
): SignatureWorkerOutput {
  const src = imageData.data;

  // ── 1. Escala de grises (luminancia perceptual Rec. 709) ──────────────────
  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    gray[i] = 0.2126 * src[i * 4] + 0.7152 * src[i * 4 + 1] + 0.0722 * src[i * 4 + 2];
  }

  // ── 2. Unsharp mask 3×3 (realza bordes de trazo antes de binarizar) ───────
  const SHARPEN = [-1, -1, -1, -1, 9, -1, -1, -1, -1];
  const sharpened = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      let v = 0;
      for (let ky = -1; ky <= 1; ky++)
        for (let kx = -1; kx <= 1; kx++)
          v += gray[(y + ky) * W + (x + kx)] * SHARPEN[(ky + 1) * 3 + (kx + 1)];
      sharpened[y * W + x] = Math.max(0, Math.min(255, v));
    }
  }
  // Bordes sin procesar → copiar gray directamente
  for (let x = 0; x < W; x++) { sharpened[x] = gray[x]; sharpened[(H - 1) * W + x] = gray[(H - 1) * W + x]; }
  for (let y = 0; y < H; y++) { sharpened[y * W] = gray[y * W]; sharpened[y * W + W - 1] = gray[y * W + W - 1]; }

  // ── 3. Integral images para Sauvola O(1) por píxel ────────────────────────
  const stride = W + 1;
  const intSum   = new Float64Array((W + 1) * (H + 1));
  const intSumSq = new Float64Array((W + 1) * (H + 1));

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = sharpened[y * W + x];
      const i = (y + 1) * stride + (x + 1);
      intSum[i]   = v     + intSum[y * stride + x + 1] + intSum[(y + 1) * stride + x] - intSum[y * stride + x];
      intSumSq[i] = v * v + intSumSq[y * stride + x + 1] + intSumSq[(y + 1) * stride + x] - intSumSq[y * stride + x];
    }
  }

  // ── 4. Sauvola binarization ───────────────────────────────────────────────
  const R = 128; // rango dinámico (constante estándar de Sauvola)
  const half = Math.floor(winSize / 2);
  const binary = new Uint8ClampedArray(W * H); // 0 = trazo, 255 = fondo

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - half), x1 = Math.min(W - 1, x + half);
      const y0 = Math.max(0, y - half), y1 = Math.min(H - 1, y + half);
      const N  = (x1 - x0 + 1) * (y1 - y0 + 1);

      const s  = intSum[(y1 + 1) * stride + (x1 + 1)]   - intSum[y0 * stride + (x1 + 1)]   - intSum[(y1 + 1) * stride + x0]   + intSum[y0 * stride + x0];
      const sq = intSumSq[(y1 + 1) * stride + (x1 + 1)] - intSumSq[y0 * stride + (x1 + 1)] - intSumSq[(y1 + 1) * stride + x0] + intSumSq[y0 * stride + x0];

      const mean = s / N;
      const std  = Math.sqrt(Math.max(0, sq / N - mean * mean));
      // Fórmula Sauvola: T = mean × (1 + k × (σ/R − 1))
      const threshold = mean * (1 + k * (std / R - 1));

      binary[y * W + x] = sharpened[y * W + x] < threshold ? 0 : 255;
    }
  }

  // ── 5. Construir ImageData + calcular bounding box ────────────────────────
  const out = new ImageData(W, H);
  let minX = W, minY = H, maxX = 0, maxY = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const isFg = binary[y * W + x] === 0;
      const idx  = (y * W + x) * 4;
      out.data[idx]     = 0;   // R: negro puro
      out.data[idx + 1] = 0;   // G
      out.data[idx + 2] = 0;   // B
      out.data[idx + 3] = isFg ? 255 : 0; // Alpha: trazo opaco, fondo 100% transparente
      if (isFg) {
        if (x < minX) minX = x; if (y < minY) minY = y;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      }
    }
  }

  return { imageData: out, bbox: { minX, minY, maxX, maxY } };
}
