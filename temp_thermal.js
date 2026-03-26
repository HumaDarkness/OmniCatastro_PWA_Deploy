"use strict";
/**
 * Thermal Calculator — Motor de Cálculos E1-3-5 (CAE)
 *
 * Réplica EXACTA de la lógica de Python (thermal_e135_calc.py).
 *
 * Fórmulas CTE DB-HE:
 *   Rt = ΣR + Rsi + Rse
 *   Up = 1 / Rt
 *   U  = Up × b
 *   AE = Fp × (Ui − Uf) × s × G
 *
 * Donde Fp = 1 (Factor de paso, hardcodeado).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VALORES_G = void 0;
exports.getB = getB;
exports.calcularAhorroCAE = calcularAhorroCAE;
exports.generarInformeTexto = generarInformeTexto;
// ---------------------------------------------------------------------------
// Constantes CTE
// ---------------------------------------------------------------------------
/** Resistencias superficiales (m²K/W) — Particiones horizontales, flujo ascendente */
var Rsi = 0.10;
var Rse = 0.10;
/** Factor de paso de energía primaria — siempre 1 */
var FP = 1;
// ---------------------------------------------------------------------------
// VALORES G — Severidad climática por zona (mirror de Python zona_climatica.py)
// ---------------------------------------------------------------------------
exports.VALORES_G = {
    alpha3: 13, A2: 24, A3: 25, A4: 26,
    B2: 36, B3: 32, B4: 33,
    C1: 44, C2: 45, C3: 46, C4: 46,
    D1: 60, D2: 60, D3: 61,
    E1: 74, E2: 74, E3: 74,
};
// ---------------------------------------------------------------------------
// TABLA 7 CTE DB-HE — Coeficiente b de reducción de temperatura
// ---------------------------------------------------------------------------
//
// Contexto físico:
//   El calor sube desde el piso, atraviesa la PARTICIÓN (suelo del ático),
//   se queda en la buhardilla/cámara, y se escapa por la CUBIERTA (tejado).
//   "b" es un factor de descuento (0 a 1) que reduce la transmitancia
//   porque la buhardilla frena parte del calor.
//
// Clave = Ratio (Superficie Partición / Superficie Cubierta)
//   Se usa lookup TECHO: menor clave >= ratio real.
//
// Columnas por índice (6 por fila):
//   0: Partición AISLADA + Cubierta SIN → Estanco (DESPUÉS nuestro trabajo)
//   1: Partición AISLADA + Cubierta SIN → Ventilado
//   2: NADA aislado → Estanco (ANTES, estado original)
//   3: NADA aislado → Ventilado
//   4: Cubierta YA AISLADA + Partición SIN → Estanco (caso especial)
//   5: Cubierta YA AISLADA + Partición SIN → Ventilado
var B_TABLE = [
    // Ratio  Part.Aisl.Est  Part.Aisl.Vent  NadaEst  NadaVent  Cub.Aisl.Est  Cub.Aisl.Vent
    /* 0.25 */ [0.99, 1.00, 0.94, 0.97, 0.91, 0.96],
    /* 0.50 */ [0.97, 0.99, 0.85, 0.92, 0.77, 0.90],
    /* 0.75 */ [0.96, 0.98, 0.77, 0.87, 0.67, 0.84],
    /* 1.00 */ [0.94, 0.97, 0.70, 0.83, 0.59, 0.79],
    /* 1.25 */ [0.92, 0.96, 0.65, 0.79, 0.53, 0.74],
    /* 2.00 */ [0.89, 0.95, 0.56, 0.73, 0.44, 0.67],
    /* 2.50 */ [0.86, 0.93, 0.48, 0.66, 0.36, 0.59],
    /* 3.00 */ [0.83, 0.91, 0.43, 0.61, 0.32, 0.54],
    /* 5.00 */ [0.81, 0.90, 0.39, 0.57, 0.28, 0.50],
];
/** Claves ordenadas para lookup TECHO: menor clave >= ratio real */
var B_KEYS = [0.25, 0.50, 0.75, 1.00, 1.25, 2.00, 2.50, 3.00, 5.00];
// ---------------------------------------------------------------------------
// Funciones puras de cálculo
// ---------------------------------------------------------------------------
/** Redondeo bancario estándar */
function round(v, d) {
    var f = Math.pow(10, d);
    return Math.floor(v * f + 0.5) / f;
}
/**
 * Obtiene el coeficiente b de la Tabla 7 CTE DB-HE.
 *
 * ¿Qué es b? → Un "descuento" en la pérdida de calor porque entre
 * el piso y el cielo hay una buhardilla/cámara que frena el calor.
 * Cuanto más cerca de 1.0, más calor se escapa (peor).
 *
 * Lookup TECHO: busca la menor clave >= ratio real.
 * Ejemplo: ratio 0.82 → cae en (0.75, 1.00] → usa fila 1.00
 *
 * @param ratio   - m² Partición / m² Cubierta
 * @param scenario - particion_aislada | nada_aislado | cubierta_aislada
 * @param caso    - estanco | ventilado
 */
function getB(ratio, scenario, caso) {
    // Lookup TECHO: menor clave >= ratio
    var fila = B_KEYS.length - 1; // Fallback a la última fila
    for (var i = 0; i < B_KEYS.length; i++) {
        if (B_KEYS[i] >= ratio) {
            fila = i;
            break;
        }
    }
    // Seleccionar par de columnas según escenario
    var colOffset = {
        particion_aislada: 0, // Cols 0,1 — DESPUÉS (nuestro trabajo)
        nada_aislado: 2, // Cols 2,3 — ANTES (estado original)
        cubierta_aislada: 4, // Cols 4,5 — Cubierta ya tenía aislante
    };
    var col = colOffset[scenario] + (caso === 'ventilado' ? 1 : 0);
    return B_TABLE[fila][col];
}
/** Calcula R de una capa (por R directo o por e/λ) */
function calcularR(capa) {
    if (capa.r_valor > 0)
        return capa.r_valor;
    if (capa.espesor > 0 && capa.lambda_val > 0)
        return capa.espesor / capa.lambda_val;
    return 0;
}
// ---------------------------------------------------------------------------
// Cálculo principal
// ---------------------------------------------------------------------------
function calcularAhorroCAE(params) {
    var capas = params.capas, area_h_nh = params.area_h_nh, area_nh_e = params.area_nh_e, superficie_actuacion = params.superficie_actuacion, g = params.g, sup_envolvente_total = params.sup_envolvente_total, scenario_i = params.scenario_i, scenario_f = params.scenario_f, case_i = params.case_i, case_f = params.case_f, modoCE3X = params.modoCE3X;
    var UP_DEC = modoCE3X ? 2 : 3;
    // Separar capas existentes y todas (con mejora)
    var existentes = capas.filter(function (c) { return !c.es_nueva; });
    // Resistencia de materiales
    var r_mat_inicial = existentes.reduce(function (sum, c) { return sum + calcularR(c); }, 0);
    var r_mat_final = capas.reduce(function (sum, c) { return sum + calcularR(c); }, 0);
    // Resistencia total: Rt = Rsi + ΣR + Rse
    var rt_inicial = Rsi + r_mat_inicial + Rse;
    var rt_final = Rsi + r_mat_final + Rse;
    // Transmitancia: Up = 1 / Rt (redondeado según modo)
    var up_inicial = rt_inicial > 0 ? round(1 / rt_inicial, UP_DEC) : 0;
    var up_final = rt_final > 0 ? round(1 / rt_final, UP_DEC) : 0;
    // Ratio de superficies (para lookup en Tabla B)
    var ratio = area_nh_e > 0 ? area_h_nh / area_nh_e : 1;
    // Factor b (Tabla 7 CTE)
    var b_inicial = getB(ratio, scenario_i, case_i);
    var b_final = getB(ratio, scenario_f, case_f);
    // Transmitancia corregida: U = Up × b (siempre 2 decimales)
    var ui_final = round(up_inicial * b_inicial, 2);
    var uf_final = round(up_final * b_final, 2);
    // % de envolvente afectada
    var pct_envolvente = sup_envolvente_total > 0
        ? (superficie_actuacion / sup_envolvente_total) * 100
        : 0;
    // Ahorro energético: AE = Fp × (Ui - Uf) × s × G
    var delta_u = ui_final - uf_final;
    var ahorro = delta_u > 0 ? Math.round(FP * delta_u * superficie_actuacion * g) : 0;
    return {
        rt_inicial: rt_inicial,
        rt_final: rt_final,
        up_inicial: up_inicial,
        up_final: up_final,
        b_inicial: b_inicial,
        b_final: b_final,
        ui_final: ui_final,
        uf_final: uf_final,
        ahorro: ahorro,
        pct_envolvente: pct_envolvente,
        ratio: ratio,
        r_mat_inicial: r_mat_inicial,
        r_mat_final: r_mat_final,
    };
}
// ---------------------------------------------------------------------------
// Generación de informe textual
// ---------------------------------------------------------------------------
function generarInformeTexto(params) {
    var capas = params.capas, resultado = params.resultado, sup_actuacion = params.sup_actuacion, sup_envolvente_total = params.sup_envolvente_total, g = params.g, area_h_nh = params.area_h_nh, area_nh_e = params.area_nh_e;
    var fmt = function (v, d) {
        if (d === void 0) { d = 3; }
        return Number(v).toFixed(d);
    };
    var lineas = [
        '📊 INFORME CERTIFICADO AHORRO ENERGÉTICO (CAE)',
        '══════════════════════════════════════════',
        '',
        "Superficie de actuaci\u00F3n: ".concat(fmt(sup_actuacion, 2), " m\u00B2"),
        "Superficie envolvente total: ".concat(fmt(sup_envolvente_total, 2), " m\u00B2"),
        "Factor G: ".concat(fmt(g, 2), " h\u00B7K"),
        "Superficie Partici\u00F3n: ".concat(fmt(area_h_nh, 2), " m\u00B2  |  Superficie Cubierta: ").concat(fmt(area_nh_e, 2), " m\u00B2"),
        "Ratio: ".concat(fmt(area_h_nh, 2), " / ").concat(fmt(area_nh_e, 2), " = ").concat(fmt(resultado.ratio, 2)),
        '',
        '── Capas del cerramiento ──',
    ];
    capas.forEach(function (c, i) {
        var tipo = c.es_nueva ? '[NUEVA]' : '[EXIST]';
        var r = calcularR(c);
        lineas.push("  ".concat(i + 1, ". ").concat(tipo, " ").concat(c.nombre || 'Sin nombre', " \u2014 e=").concat(c.espesor, "m, \u03BB=").concat(c.lambda_val, ", R=").concat(fmt(r), " m\u00B2K/W"));
    });
    lineas.push('');
    lineas.push('── ANTES ──');
    lineas.push("\u03A3R materiales (i): ".concat(fmt(resultado.r_mat_inicial), " m\u00B2K/W"));
    lineas.push("RT inicial: ".concat(fmt(resultado.rt_inicial), " m\u00B2K/W"));
    lineas.push("Up inicial: ".concat(fmt(resultado.up_inicial), " W/m\u00B2K"));
    lineas.push("bi = ".concat(resultado.b_inicial, " \u2192 Ui = ").concat(fmt(resultado.up_inicial), " \u00D7 ").concat(resultado.b_inicial, " = ").concat(fmt(resultado.ui_final, 2), " W/m\u00B2K"));
    lineas.push('');
    lineas.push('── DESPUÉS ──');
    lineas.push("\u03A3R materiales (f): ".concat(fmt(resultado.r_mat_final), " m\u00B2K/W"));
    lineas.push("RT final: ".concat(fmt(resultado.rt_final), " m\u00B2K/W"));
    lineas.push("Up final: ".concat(fmt(resultado.up_final), " W/m\u00B2K"));
    lineas.push("bf = ".concat(resultado.b_final, " \u2192 Uf = ").concat(fmt(resultado.up_final), " \u00D7 ").concat(resultado.b_final, " = ").concat(fmt(resultado.uf_final, 2), " W/m\u00B2K"));
    lineas.push('');
    lineas.push('── AHORRO ENERGÉTICO ──');
    lineas.push("AE = Fp \u00D7 (Ui \u2212 Uf) \u00D7 s \u00D7 G");
    lineas.push("AE = ".concat(FP, " \u00D7 (").concat(fmt(resultado.ui_final, 2), " \u2212 ").concat(fmt(resultado.uf_final, 2), ") \u00D7 ").concat(fmt(sup_actuacion, 2), " \u00D7 ").concat(fmt(g, 2), " = ").concat(resultado.ahorro.toLocaleString(), " kWh"));
    lineas.push('');
    lineas.push(">>> RESULTADO FINAL: ".concat(resultado.ahorro.toLocaleString(), " kWh <<<"));
    lineas.push('');
    lineas.push('Generado por OmniCatastro Suite PWA');
    return lineas.join('\n');
}
