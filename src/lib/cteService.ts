/**
 * cteService.ts — Cliente para evaluación CTE de rehabilitación
 *
 * Llama al endpoint /api/v1/rehabilitacion/{rc} para obtener la
 * evaluación de cumplimiento CTE de un inmueble.
 */

import { kyClient } from "./kyClient";

export interface ElementoEvaluacionCTE {
  elemento: string;
  elemento_label: string;
  u_max_cte: number;
  u_tipico_pre_cte: number;
  excede_limite: boolean;
  mejora_necesaria_pct: number;
  recomendacion: string;
}

export interface EvaluacionCTEResponse {
  cumplimiento: "compliant" | "partial" | "non_compliant" | "unknown";
  zona_climatica: string;
  zona_label: string;
  zona_descripcion: string;
  year_construccion: number | null;
  year_cte_obligatorio: number;
  year_cte_actualizado: number;
  normativa_aplicable: string;
  resumen: string;
  elementos: ElementoEvaluacionCTE[];
  prioridad_rehabilitacion: string;
  ahorro_estimado_pct: number | null;
  ref_catastral: string;
  direccion: string;
  warnings: string[];
}

export async function evaluarRehabilitacionCTE(
  rc: string
): Promise<{ data: EvaluacionCTEResponse | null; error: string | null }> {
  try {
    const res = await kyClient.get(
      `api/v1/rehabilitacion/${encodeURIComponent(rc)}`
    );
    const data = await res.json<EvaluacionCTEResponse>();
    return { data, error: null };
  } catch (e: any) {
    const status = e?.response?.status;
    if (status === 402) {
      return { data: null, error: "Licencia activa requerida para evaluación CTE." };
    }
    if (status === 400) {
      return { data: null, error: "Referencia catastral inválida." };
    }
    console.warn("[CTE Service] Error:", e.message);
    return {
      data: null,
      error: "No se pudo obtener la evaluación CTE. Reintente más tarde.",
    };
  }
}
