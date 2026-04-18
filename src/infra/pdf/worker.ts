import * as pdfjsLib from "pdfjs-dist";

// Vite worker url import strategy
// Esto asegura la sincronía exacta entre la versión de pdfjs-dist importada
// y el worker generado, previniendo errores "fake worker failed" y bloqueos de UI.
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjsLib };
