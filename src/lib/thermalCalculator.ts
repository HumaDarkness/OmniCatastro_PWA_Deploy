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
    return capa.lambda_val > 0 ? capa.espesor / capa.lambda_val : 0;
}

// ─── Factor b (TABLA_7) ──────────────────────────────────────────────

export function calcularB(ratio: number, escenario: string, caso: number): number {
    let fila: number;
    if (ratio < 0.25) fila = 0;
    else if (ratio <= 0.50) fila = 1;
    else if (ratio <= 0.75) fila = 2;
    else if (ratio <= 1.00) fila = 3;
    else if (ratio <= 1.25) fila = 4;
    else if (ratio <= 2.00) fila = 5;
    else if (ratio <= 2.50) fila = 6;
    else if (ratio <= 3.00) fila = 7;
    else fila = 8;

    const colBase = ESCENARIO_COL[escenario] ?? 2;
    return B_DATA[fila][colBase + (caso === 2 ? 1 : 0)];
}

// ─── Motor principal de cálculo ──────────────────────────────────────

export function calcularAhorroCAE({
    capas,
    area_h_nh,
    area_nh_e,
    superficie_actuacion,
    zona_climatica,
    sup_envolvente_total = 0,
    escenario_i = "antes_normal",
    caso_i = 1,
    escenario_f = "despues",
    caso_f = 1,
    ui_override,
    uf_override,
}: {
    capas: CapaMaterial[];
    area_h_nh: number;
    area_nh_e: number;
    superficie_actuacion: number;
    zona_climatica: number;
    sup_envolvente_total?: number;
    escenario_i?: string;
    caso_i?: number;
    escenario_f?: string;
    caso_f?: number;
    ui_override?: number;
    uf_override?: number;
}): ResultadoTermico {
    const r_mat_i = capas.filter((c) => !c.es_nueva).reduce((sum, c) => sum + getR(c), 0);
    const r_mat_f = capas.reduce((sum, c) => sum + getR(c), 0);

    // RT con Rsi + Rse = 0.10 + 0.10
    const rt_i = redondearValor(r_mat_i + 0.20, 3);
    const rt_f = redondearValor(r_mat_f + 0.20, 3);

    // Up con RT ya redondeado
    const up_i = rt_i > 0 ? redondearValor(1 / rt_i, 3) : 0;
    const up_f = rt_f > 0 ? redondearValor(1 / rt_f, 3) : 0;

    const ratio = area_nh_e > 0 ? area_h_nh / area_nh_e : 0;
    const bi = calcularB(ratio, escenario_i, caso_i);
    const bf = calcularB(ratio, escenario_f, caso_f);

    // Ui/Uf con Up ya redondeado
    const ui = ui_override ?? redondearValor(up_i * bi, 2);
    const uf = uf_override ?? redondearValor(up_f * bf, 2);

    // Ahorro kWh/año
    const val_bruto = (ui - uf) * superficie_actuacion * zona_climatica;
    const ahorro = Math.max(0, Math.round(val_bruto));

    const pct = sup_envolvente_total > 0 ? redondearValor((superficie_actuacion / sup_envolvente_total) * 100, 2) : 0;

    return {
        rt_inicial: rt_i,
        rt_final: rt_f,
        up_inicial: up_i,
        up_final: up_f,
        b_inicial: bi,
        b_final: bf,
        ui_final: ui,
        uf_final: uf,
        ratio,
        ahorro,
        pct_envolvente: pct,
    };
}

// ─── Generador de informe de texto ───────────────────────────────────

export function generarInformeTexto({
    capas,
    resultado,
    sup_actuacion,
    sup_envolvente_total,
    zona_climatica,
    area_h_nh,
    area_nh_e,
}: {
    capas: CapaMaterial[];
    resultado: ResultadoTermico;
    sup_actuacion: number;
    sup_envolvente_total: number;
    zona_climatica: number;
    area_h_nh: number;
    area_nh_e: number;
}): string {
    const capas_i = capas.filter((c) => !c.es_nueva);
    const capas_m = capas.filter((c) => c.es_nueva);

    const fmtCapa = (c: CapaMaterial, tag: string) => {
        const r = getR(c);
        if (c.r_valor > 0) return `  - ${c.nombre} [${tag}]: ${r.toFixed(3)} m²K/W`;
        return `  - ${c.nombre} [${tag}]: e=${c.espesor} m / λ=${c.lambda_val} W/mK = ${r.toFixed(3)} m²K/W`;
    };

    const r_mat_i = capas_i.reduce((s, c) => s + getR(c), 0);
    const r_mat_f = capas.reduce((s, c) => s + getR(c), 0);
    const delta_u = resultado.ui_final - resultado.uf_final;

    return [
        "📊 INFORME DE JUSTIFICACIÓN TÉRMICA (CAE)",
        "=".repeat(50),
        "",
        "1. CAPAS DE MATERIAL",
        "Existentes:",
        ...capas_i.map((c) => fmtCapa(c, "EXISTENTE")),
        "Mejora:",
        ...capas_m.map((c) => fmtCapa(c, "NUEVA")),
        "",
        "2. RESISTENCIAS TÉRMICAS",
        `ΣR materiales (i) = ${r_mat_i.toFixed(3)} m²K/W`,
        `RTi = ${r_mat_i.toFixed(3)} + 0.10 + 0.10 = ${resultado.rt_inicial.toFixed(3)} m²K/W`,
        `ΣR materiales (f) = ${r_mat_f.toFixed(3)} m²K/W`,
        `RTf = ${r_mat_f.toFixed(3)} + 0.10 + 0.10 = ${resultado.rt_final.toFixed(3)} m²K/W`,
        "",
        "3. TRANSMITANCIAS PROPIAS",
        `Upi = 1 / ${resultado.rt_inicial.toFixed(3)} = ${resultado.up_inicial.toFixed(3)} W/m²K`,
        `Upf = 1 / ${resultado.rt_final.toFixed(3)} = ${resultado.up_final.toFixed(3)} W/m²K`,
        "",
        "4. FACTOR b (TABLA 7 CAE)",
        `Ratio = Ah-nh / Anh-e = ${area_h_nh.toFixed(2)} / ${area_nh_e.toFixed(2)} = ${resultado.ratio.toFixed(2)}`,
        `bi = ${resultado.b_inicial.toFixed(2)}   bf = ${resultado.b_final.toFixed(2)}`,
        "",
        "5. TRANSMITANCIAS FINALES",
        `Ui = Upi × bi = ${resultado.up_inicial.toFixed(3)} × ${resultado.b_inicial.toFixed(2)} = ${resultado.ui_final.toFixed(2)} W/m²K`,
        `Uf = Upf × bf = ${resultado.up_final.toFixed(3)} × ${resultado.b_final.toFixed(2)} = ${resultado.uf_final.toFixed(2)} W/m²K`,
        "",
        "6. AHORRO ENERGÉTICO",
        `ΔU = ${resultado.ui_final.toFixed(2)} − ${resultado.uf_final.toFixed(2)} = ${delta_u.toFixed(2)} W/m²K`,
        `s = ${sup_actuacion.toFixed(2)} m²   S = ${sup_envolvente_total.toFixed(2)} m²   G = ${Math.round(zona_climatica)} h·K`,
        `Afectado = ${sup_actuacion.toFixed(2)} / ${sup_envolvente_total.toFixed(2)} = ${resultado.pct_envolvente.toFixed(2)}%`,
        `AE = ${delta_u.toFixed(2)} × ${sup_actuacion.toFixed(2)} × ${Math.round(zona_climatica)}`,
        `   = ${resultado.ahorro} kWh/año`,
        "",
        `RESULTADO FINAL: ${resultado.ahorro} kWh/año`,
    ].join("\n");
}
