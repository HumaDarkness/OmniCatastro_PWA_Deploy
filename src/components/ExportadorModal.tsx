import { useState } from "react";
import { Download, X, Calendar } from "lucide-react";

interface ExportadorModalProps {
  onClose: () => void;
  onExport: (fecha: string) => void;
  defaultFecha?: string;
  isGenerating?: boolean;
}

export function ExportadorModal({
  onClose,
  onExport,
  defaultFecha,
  isGenerating,
}: ExportadorModalProps) {
  const formatDateDdMmYyyy = (date: Date): string => {
    return date.toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  const parseSpanishLongDate = (value: string): string | null => {
    const months: Record<string, number> = {
      enero: 0,
      febrero: 1,
      marzo: 2,
      abril: 3,
      mayo: 4,
      junio: 5,
      julio: 6,
      agosto: 7,
      septiembre: 8,
      setiembre: 8,
      octubre: 9,
      noviembre: 10,
      diciembre: 11,
    };

    const match = value
      .trim()
      .toLowerCase()
      .match(/^(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})$/i);

    if (!match) return null;

    const day = Number.parseInt(match[1], 10);
    const monthIndex = months[match[2].normalize("NFD").replace(/[\u0300-\u036f]/g, "")];
    const year = Number.parseInt(match[3], 10);

    if (!Number.isFinite(day) || !Number.isFinite(year) || monthIndex === undefined) {
      return null;
    }

    const date = new Date(year, monthIndex, day);
    if (Number.isNaN(date.getTime())) return null;

    return `${String(year)}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };

  // Si defaultFecha es un DD/MM/YYYY, habría que transformarlo a YYYY-MM-DD para el input type="date".
  // Si no es válido, se usa hoy.
  const getInitialDate = () => {
    if (defaultFecha) {
      const parts = defaultFecha.split("/");
      if (parts.length === 3) {
        // Asumiendo DD/MM/YYYY
        return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
      }
      if (defaultFecha.includes("-")) {
        return defaultFecha;
      }

      const parsedLongDate = parseSpanishLongDate(defaultFecha);
      if (parsedLongDate) {
        return parsedLongDate;
      }
    }
    return new Date().toISOString().split("T")[0];
  };

  const [fechaInput, setFechaInput] = useState(getInitialDate());

  const handleGenerar = () => {
    // Forzar salida estable DD/MM/YYYY para mantener formato contractual del certificado.
    const d = new Date(fechaInput);
    let exportFecha = defaultFecha || "";
    if (!isNaN(d.getTime())) {
      exportFecha = formatDateDdMmYyyy(d);
    }
    onExport(exportFecha);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-[#0a0a1a] border border-indigo-500/20 rounded-xl max-w-md w-full shadow-2xl overflow-hidden shadow-indigo-500/10 animate-in fade-in zoom-in-95">
        <div className="px-6 py-4 border-b border-white/5 flex justify-between items-center bg-indigo-500/5">
          <h3 className="text-lg font-bold text-slate-200">Ajustar Certificado</h3>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-md hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          <p className="text-sm text-slate-400 mb-6 relative">
            La ciudad ya se ha preajustado a <strong>MADRID</strong>. Revisa o edita la fecha del
            certificado antes de generarlo.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 ml-1">
                Fecha Emisión
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                <input
                  type="date"
                  value={fechaInput}
                  onChange={(e) => setFechaInput(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-black/20 border border-slate-700/50 focus:border-indigo-500/50 rounded-lg text-slate-200 transition-colors outline-none focus:ring-1 focus:ring-indigo-500/50 [color-scheme:dark]"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-white/5 bg-black/20 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleGenerar}
            disabled={isGenerating}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 transition-colors disabled:opacity-50"
          >
            {isGenerating ? (
              <>Generando...</>
            ) : (
              <>
                <Download className="w-4 h-4" /> Generar DOCX
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
