/**
 * thermalCalculator.ts
 * Port 1:1 de core/thermal_calculator.py
 *
 * Motor de cálculo térmico CAE (Certificados de Ahorro Energético).
 * TABLA_7 del Reglamento CAE para factor de reducción b.
 * Cadena de redondeo idéntica al Python:
 *   RT  → 3 decimales  (m²K/W)
 *   Up  → 3 decimales  (W/m²K) — con RT ya redondeado
 *   Ui/Uf → 2 decimales        — con Up ya redondeado
 *   Ahorro → entero             — con Ui/Uf ya redondeados
 *   pct → 2 decimales
 */

// ─── TABLA_7 del Reglamento CAE ──────────────────────────────────────
// Columnas: [b_despues_1, b_despues_2, b_antes_normal_1, b_antes_normal_2, b_antes_aislado_1, b_antes_aislado_2]
const B_DATA: number[][] = [
    [0.99, 1.0, 0.94, 0.97, 0.91, 0.96],  // ratio < 0.25
    [0.97, 0.99, 0.85, 0.92, 0.77, 0.90],  // 0.25–0.50
    [0.96, 0.98, 0.77, 0.87, 0.67, 0.84],  // 0.50–0.75
    [0.94, 0.97, 0.70, 0.83, 0.59, 0.79],  // 0.75–1.00
    [0.92, 0.96, 0.65, 0.79, 0.53, 0.74],  // 1.00–1.25
    [0.89, 0.95, 0.56, 0.73, 0.44, 0.67],  // 1.25–2.00
    [0.86, 0.93, 0.48, 0.66, 0.36, 0.59],  // 2.00–2.50
    [0.83, 0.91, 0.43, 0.61, 0.32, 0.54],  // 2.50–3.00
    [0.81, 0.90, 0.39, 0.57, 0.28, 0.50],  // > 3.00
];

const ESCENARIO_COL: Record<string, number> = {
    despues: 0,
    antes_normal: 2,
    antes_aislado: 4,
};

// ─── Tipos ───────────────────────────────────────────────────────────

export interface CapaMaterial {
    nombre: string;
    espesor: number;      // metros
    lambda_val: number;   // W/mK
    r_valor: number;      // m²K/W (alternativa directa)
    es_nueva: boolean;    // false = existente, true = mejora
}

export interface ResultadoTermico {
    rt_inicial: number;
    rt_final: number;
    up_inicial: number;
    up_final: number;
    b_inicial: number;
    b_final: number;
    ui_final: number;
    uf_final: number;
    ratio: number;
    ahorro: number;       // kWh/año
    pct_envolvente: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────

export function redondearValor(val: number, decimales: number): number {
    const factor = Math.pow(10, decimales);
    return Math.round((val + Number.EPSILON) * factor) / factor;
}

function getR(capa: CapaMaterial): number {
    if (capa.r_valor > 0) return capa.r_valor;
    return capa.lambda_val > 0 ? {espesor: capa.espesor, lambda_val: capa.lambda_val} : 0; // Fixed typo from viewed file if any, actually getR was:
    // return capa.lambda_val > 0 ? capa.espesor / capa.lambda_val : 0;
}
// wait, I should copy exactly from view_file.
// 66: function getR(capa: CapaMaterial): number {
// 67:     if (capa.r_valor > 0) return capa.r_valor;
// 68:     return capa.lambda_val > 0 ? capa.espesor / capa.lambda_val : 0;
// 69: }
// Let me use the exact code.
