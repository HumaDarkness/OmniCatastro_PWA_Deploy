import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Clipboard, ClipboardPaste, Copy, ImagePlus, Trash2, Check } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

export type SlotKey =
    | "ce3x_antes"
    | "ce3x_despues"
    | "materiales_antes"
    | "materiales_despues"
    | "cee_inicial"
    | "ficha_tecnica"
    | "dni_cliente";

interface SlotConfig {
    key: SlotKey;
    label: string;
    hint: string;
}

export interface CapturaData {
    fileName: string;
    mimeType: string;
    dataUrl: string;
}

export type CapturasState = Record<SlotKey, CapturaData | null>;

export const SLOT_CONFIG: SlotConfig[] = [
    { key: "ce3x_antes", label: "CE3X ANTES", hint: "Pantalla con datos iniciales del CE3X" },
    { key: "ce3x_despues", label: "CE3X DESPUES", hint: "Pantalla final del CE3X tras mejora" },
    { key: "materiales_antes", label: "MATERIALES ANTES", hint: "Listado de materiales iniciales" },
    { key: "materiales_despues", label: "MATERIALES DESPUES", hint: "Listado de materiales finales" },
    { key: "cee_inicial", label: "CEE INICIAL", hint: "Captura del certificado inicial" },
    { key: "ficha_tecnica", label: "FICHA TECNICA", hint: "Imagen de ficha del fabricante" },
    { key: "dni_cliente", label: "DNI CLIENTE", hint: "Foto del DNI para transcripcion segura" },
];

const HIGH_DETAIL_PREVIEW_SLOTS: SlotKey[] = [
    "materiales_antes",
    "materiales_despues",
    "cee_inicial",
    "ficha_tecnica",
];

function isHighDetailPreviewSlot(slot: SlotKey): boolean {
    return HIGH_DETAIL_PREVIEW_SLOTS.includes(slot);
}

function getSlotLabel(slot: SlotKey): string {
    return SLOT_CONFIG.find((cfg) => cfg.key === slot)?.label ?? slot;
}

function confirmReplaceCapture(slot: SlotKey, sourceLabel: "archivo" | "portapapeles"): boolean {
    return window.confirm(
        `Ya hay una captura en "${getSlotLabel(slot)}". ¿Quieres reemplazarla con la imagen de ${sourceLabel}?`,
    );
}

export function createEmptyCapturasState(): CapturasState {
    return {
        ce3x_antes: null,
        ce3x_despues: null,
        materiales_antes: null,
        materiales_despues: null,
        cee_inicial: null,
        ficha_tecnica: null,
        dni_cliente: null,
    };
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
        reader.readAsDataURL(blob);
    });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
    const response = await fetch(dataUrl);
    return response.blob();
}

/**
 * Convierte cualquier Blob de imagen a PNG para asegurar compatibilidad con el Portapapeles
 */
async function convertToPngBlob(blob: Blob): Promise<Blob> {
    if (blob.type === "image/png") return blob;

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
                reject(new Error("No se pudo obtener el contexto del canvas"));
                return;
            }
            ctx.drawImage(img, 0, 0);
            canvas.toBlob((result) => {
                if (result) resolve(result);
                else reject(new Error("Error al exportar PNG"));
            }, "image/png");
        };
        img.onerror = () => reject(new Error("Error al cargar imagen para conversion"));
        img.src = URL.createObjectURL(blob);
    });
}

export function CertificadoCapturasPanel() {
    const [capturas, setCapturas] = useState<CapturasState>(createEmptyCapturasState());
    const [copiedSlot, setCopiedSlot] = useState<SlotKey | null>(null);
    const [statusMsg, setStatusMsg] = useState<string | null>(null);

    const totalCargadas = useMemo(
        () => Object.values(capturas).filter(Boolean).length,
        [capturas]
    );

    const setStatus = (msg: string) => {
        setStatusMsg(msg);
        window.setTimeout(() => setStatusMsg(null), 2500);
    };

    const saveImageInSlot = async (slot: SlotKey, blob: Blob, fileName: string) => {
        if (!blob.type.startsWith("image/")) {
            setStatus("El archivo no es una imagen valida.");
            return;
        }

        const dataUrl = await blobToDataUrl(blob);
        setCapturas((prev) => ({
            ...prev,
            [slot]: {
                fileName,
                mimeType: blob.type || "image/png",
                dataUrl,
            },
        }));
    };

    const onFileChange = async (slot: SlotKey, file?: File) => {
        if (!file) return;
        if (capturas[slot] && !confirmReplaceCapture(slot, "archivo")) {
            setStatus(`Se mantuvo la captura existente en ${getSlotLabel(slot)}.`);
            return;
        }
        try {
            await saveImageInSlot(slot, file, file.name);
        } catch {
            setStatus("No se pudo cargar la imagen.");
        }
    };

    const clearSlot = (slot: SlotKey) => {
        setCapturas((prev) => ({ ...prev, [slot]: null }));
    };

    const copyImage = async (slot: SlotKey) => {
        const data = capturas[slot];
        if (!data) {
            setStatus("Primero carga una imagen.");
            return;
        }

        if (!("ClipboardItem" in window) || !navigator.clipboard?.write) {
            setStatus("Tu navegador no permite copiar imagen al portapapeles.");
            return;
        }

        try {
            let blob = await dataUrlToBlob(data.dataUrl);
            
            // Forzamos conversion a PNG si no lo es, para maxima compatibilidad con ClipboardItem
            if (blob.type !== "image/png") {
                blob = await convertToPngBlob(blob);
            }

            const item = new ClipboardItem({ "image/png": blob });
            await navigator.clipboard.write([item]);
            
            setCopiedSlot(slot);
            window.setTimeout(() => setCopiedSlot(null), 1800);
            setStatus(`Imagen copiada (PNG): ${data.fileName}`);
        } catch (err) {
            console.error("Clipboard Error:", err);
            setStatus("No se pudo copiar la imagen al portapapeles.");
        }
    };

    const pasteFromClipboard = async (slot: SlotKey) => {
        if (!navigator.clipboard?.read) {
            setStatus("Tu navegador no permite pegar imagen desde el portapapeles.");
            return;
        }

        if (capturas[slot] && !confirmReplaceCapture(slot, "portapapeles")) {
            setStatus(`Se mantuvo la captura existente en ${getSlotLabel(slot)}.`);
            return;
        }

        try {
            const items = await navigator.clipboard.read();
            for (const item of items) {
                const imageType = item.types.find((t) => t.startsWith("image/"));
                if (!imageType) continue;

                const blob = await item.getType(imageType);
                await saveImageInSlot(slot, blob, `${slot}.png`);
                setStatus("Imagen pegada desde portapapeles.");
                return;
            }
            setStatus("No hay imagen en el portapapeles.");
        } catch {
            setStatus("No se pudo leer el portapapeles.");
        }
    };

    return (
        <Card className="bg-slate-900/40 border-slate-800">
            <CardHeader className="pb-3">
                <CardTitle className="text-lg text-slate-200 flex items-center gap-2">
                    <ImagePlus className="h-5 w-5 text-cyan-400" />
                    Capturas para Certificado Tecnico
                </CardTitle>
                <CardDescription className="text-slate-500">
                    Carga capturas clave y copia la imagen directamente para pegar en Adobe Acrobat.
                    {" "}
                    ({totalCargadas}/7 cargadas)
                </CardDescription>
            </CardHeader>

            <CardContent className="space-y-3">
                {statusMsg && (
                    <div className="text-xs text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 px-3 py-2 rounded-md">
                        {statusMsg}
                    </div>
                )}

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                    {SLOT_CONFIG.map((slot) => {
                        const data = capturas[slot.key];
                        const isCopied = copiedSlot === slot.key;
                        const isHighDetail = isHighDetailPreviewSlot(slot.key);
                        const previewHeightClass = isHighDetail ? "h-44" : "h-32";
                        const previewClass = `w-full ${previewHeightClass} ${isHighDetail ? "object-contain bg-slate-950/40" : "object-cover"} rounded-md border border-slate-700`;

                        return (
                            <div key={slot.key} className="border border-slate-800 rounded-lg p-3 bg-slate-900/30 space-y-2">
                                <div>
                                    <p className="text-xs font-bold text-slate-300 tracking-wide">{slot.label}</p>
                                    <p className="text-[10px] text-slate-500">{slot.hint}</p>
                                </div>

                                {data ? (
                                    <img
                                        src={data.dataUrl}
                                        alt={slot.label}
                                        className={previewClass}
                                    />
                                ) : (
                                    <div className={`w-full ${previewHeightClass} rounded-md border border-dashed border-slate-700 bg-slate-900/40 flex items-center justify-center text-[11px] text-slate-600`}>
                                        Sin imagen
                                    </div>
                                )}

                                <div className="text-[10px] text-slate-500 truncate min-h-[14px]">
                                    {data ? data.fileName : "No cargada"}
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    <label className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 cursor-pointer">
                                        <ImagePlus className="h-3.5 w-3.5" />
                                        Subir
                                        <input
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={(e) => onFileChange(slot.key, e.target.files?.[0])}
                                        />
                                    </label>

                                    <button
                                        onClick={() => pasteFromClipboard(slot.key)}
                                        className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-indigo-900/30 border border-indigo-700/50 hover:bg-indigo-800/40 text-xs text-indigo-300"
                                    >
                                        <ClipboardPaste className="h-3.5 w-3.5" />
                                        Pegar
                                    </button>

                                    <button
                                        onClick={() => copyImage(slot.key)}
                                        className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-emerald-900/25 border border-emerald-700/40 hover:bg-emerald-800/35 text-xs text-emerald-300 disabled:opacity-40"
                                        disabled={!data}
                                    >
                                        {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                                        {isCopied ? "Copiada" : "Copiar imagen"}
                                    </button>

                                    <button
                                        onClick={() => clearSlot(slot.key)}
                                        className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-red-900/20 border border-red-700/40 hover:bg-red-800/30 text-xs text-red-300 disabled:opacity-40"
                                        disabled={!data}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        Limpiar
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="text-[10px] text-slate-500 flex items-center gap-2">
                    <Clipboard className="h-3.5 w-3.5" />
                    Recomendado: pega desde Recortes de Windows con el boton Pegar o arrastra archivo al slot.
                </div>
            </CardContent>
        </Card>
    );
}

interface ControlledPanelProps {
    capturas: CapturasState;
    onCapturasChange: Dispatch<SetStateAction<CapturasState>>;
    onlySlots?: SlotKey[];
    title?: string;
    description?: string;
}

export function CertificadoCapturasPanelControlado({
    capturas,
    onCapturasChange,
    onlySlots,
    title = "Capturas para Certificado Tecnico",
    description = "Carga capturas clave y copia la imagen directamente para pegar en Adobe Acrobat.",
}: ControlledPanelProps) {
    const [copiedSlot, setCopiedSlot] = useState<SlotKey | null>(null);
    const [statusMsg, setStatusMsg] = useState<string | null>(null);

    const visibleSlots = useMemo(
        () => (onlySlots ? SLOT_CONFIG.filter((slot) => onlySlots.includes(slot.key)) : SLOT_CONFIG),
        [onlySlots]
    );

    const totalCargadas = useMemo(
        () => visibleSlots.filter((slot) => Boolean(capturas[slot.key])).length,
        [capturas, visibleSlots]
    );

    const setStatus = (msg: string) => {
        setStatusMsg(msg);
        window.setTimeout(() => setStatusMsg(null), 2500);
    };

    const saveImageInSlot = async (slot: SlotKey, blob: Blob, fileName: string) => {
        if (!blob.type.startsWith("image/")) {
            setStatus("El archivo no es una imagen valida.");
            return;
        }

        const dataUrl = await blobToDataUrl(blob);
        onCapturasChange((prev) => ({
            ...prev,
            [slot]: {
                fileName,
                mimeType: blob.type || "image/png",
                dataUrl,
            },
        }));
    };

    const onFileChange = async (slot: SlotKey, file?: File) => {
        if (!file) return;
        if (capturas[slot] && !confirmReplaceCapture(slot, "archivo")) {
            setStatus(`Se mantuvo la captura existente en ${getSlotLabel(slot)}.`);
            return;
        }
        try {
            await saveImageInSlot(slot, file, file.name);
        } catch {
            setStatus("No se pudo cargar la imagen.");
        }
    };

    const clearSlot = (slot: SlotKey) => {
        onCapturasChange((prev) => ({ ...prev, [slot]: null }));
    };

    const copyImage = async (slot: SlotKey) => {
        const data = capturas[slot];
        if (!data) {
            setStatus("Primero carga una imagen.");
            return;
        }

        if (!("ClipboardItem" in window) || !navigator.clipboard?.write) {
            setStatus("Tu navegador no permite copiar imagen al portapapeles.");
            return;
        }

        try {
            let blob = await dataUrlToBlob(data.dataUrl);
            
            // Forzamos conversion a PNG si no lo es, para maxima compatibilidad con ClipboardItem
            if (blob.type !== "image/png") {
                blob = await convertToPngBlob(blob);
            }

            const item = new ClipboardItem({ "image/png": blob });
            await navigator.clipboard.write([item]);
            
            setCopiedSlot(slot);
            window.setTimeout(() => setCopiedSlot(null), 1800);
            setStatus(`Imagen copiada (PNG): ${data.fileName}`);
        } catch (err) {
            console.error("Clipboard Error:", err);
            setStatus("No se pudo copiar la imagen al portapapeles.");
        }
    };

    const pasteFromClipboard = async (slot: SlotKey) => {
        if (!navigator.clipboard?.read) {
            setStatus("Tu navegador no permite pegar imagen desde el portapapeles.");
            return;
        }

        if (capturas[slot] && !confirmReplaceCapture(slot, "portapapeles")) {
            setStatus(`Se mantuvo la captura existente en ${getSlotLabel(slot)}.`);
            return;
        }

        try {
            const items = await navigator.clipboard.read();
            for (const item of items) {
                const imageType = item.types.find((t) => t.startsWith("image/"));
                if (!imageType) continue;

                const blob = await item.getType(imageType);
                await saveImageInSlot(slot, blob, `${slot}.png`);
                setStatus("Imagen pegada desde portapapeles.");
                return;
            }
            setStatus("No hay imagen en el portapapeles.");
        } catch {
            setStatus("No se pudo leer el portapapeles.");
        }
    };

    return (
        <Card className="bg-slate-900/40 border-slate-800">
            <CardHeader className="pb-3">
                <CardTitle className="text-lg text-slate-200 flex items-center gap-2">
                    <ImagePlus className="h-5 w-5 text-cyan-400" />
                    {title}
                </CardTitle>
                <CardDescription className="text-slate-500">
                    {description} ({totalCargadas}/{visibleSlots.length} cargadas)
                </CardDescription>
            </CardHeader>

            <CardContent className="space-y-3">
                {statusMsg && (
                    <div className="text-xs text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 px-3 py-2 rounded-md">
                        {statusMsg}
                    </div>
                )}

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                    {visibleSlots.map((slot) => {
                        const data = capturas[slot.key];
                        const isCopied = copiedSlot === slot.key;
                        const isHighDetail = isHighDetailPreviewSlot(slot.key);
                        const previewHeightClass = isHighDetail ? "h-44" : "h-32";
                        const previewClass = `w-full ${previewHeightClass} ${isHighDetail ? "object-contain bg-slate-950/40" : "object-cover"} rounded-md border border-slate-700`;

                        return (
                            <div key={slot.key} className="border border-slate-800 rounded-lg p-3 bg-slate-900/30 space-y-2">
                                <div>
                                    <p className="text-xs font-bold text-slate-300 tracking-wide">{slot.label}</p>
                                    <p className="text-[10px] text-slate-500">{slot.hint}</p>
                                </div>

                                {data ? (
                                    <img
                                        src={data.dataUrl}
                                        alt={slot.label}
                                        className={previewClass}
                                    />
                                ) : (
                                    <div className={`w-full ${previewHeightClass} rounded-md border border-dashed border-slate-700 bg-slate-900/40 flex items-center justify-center text-[11px] text-slate-600`}>
                                        Sin imagen
                                    </div>
                                )}

                                <div className="text-[10px] text-slate-500 truncate min-h-[14px]">
                                    {data ? data.fileName : "No cargada"}
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    <label className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 cursor-pointer">
                                        <ImagePlus className="h-3.5 w-3.5" />
                                        Subir
                                        <input
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={(e) => onFileChange(slot.key, e.target.files?.[0])}
                                        />
                                    </label>

                                    <button
                                        onClick={() => pasteFromClipboard(slot.key)}
                                        className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-indigo-900/30 border border-indigo-700/50 hover:bg-indigo-800/40 text-xs text-indigo-300"
                                    >
                                        <ClipboardPaste className="h-3.5 w-3.5" />
                                        Pegar
                                    </button>

                                    <button
                                        onClick={() => copyImage(slot.key)}
                                        className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-emerald-900/25 border border-emerald-700/40 hover:bg-emerald-800/35 text-xs text-emerald-300 disabled:opacity-40"
                                        disabled={!data}
                                    >
                                        {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                                        {isCopied ? "Copiada" : "Copiar imagen"}
                                    </button>

                                    <button
                                        onClick={() => clearSlot(slot.key)}
                                        className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-red-900/20 border border-red-700/40 hover:bg-red-800/30 text-xs text-red-300 disabled:opacity-40"
                                        disabled={!data}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        Limpiar
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="text-[10px] text-slate-500 flex items-center gap-2">
                    <Clipboard className="h-3.5 w-3.5" />
                    Recomendado: pega desde Recortes de Windows con el boton Pegar o arrastra archivo al slot.
                </div>
            </CardContent>
        </Card>
    );
}
