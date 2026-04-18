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

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type Scenario = "particion_aislada" | "nada_aislado" | "cubierta_aislada";
export type Caso = "estanco" | "ventilado";

export interface CapaMaterial {
  nombre: string;
  espesor: number | string; // metros
  lambda_val: number | string; // W/(m·K)
  r_valor: number | string; // m²K/W (si se proporciona directamente)
  es_nueva: boolean;
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
  ahorro: number;
  pct_envolvente: number;
  ratio: number;
  r_mat_inicial: number;
  r_mat_final: number;
}

export interface ParamsCAE {
  capas: CapaMaterial[];
  area_h_nh: number; // m² — Superficie partición (lo que se aísla)
  area_nh_e: number; // m² — Superficie cubierta (límite para b)
  superficie_actuacion: number; // m²
  g: number; // Factor G directo de VALORES_G (ej: 61)
  sup_envolvente_total: number; // m²
  scenario_i: Scenario; // Escenario ANTES
  scenario_f: Scenario; // Escenario DESPUÉS
  case_i: Caso; // Ventilación ANTES
  case_f: Caso; // Ventilación DESPUÉS
  modoCE3X: boolean; // true = Up a 2 dec, false = Up a 3 dec
}

interface ParamsInforme {
  capas: CapaMaterial[];
  resultado: ResultadoTermico;
  sup_actuacion: number;
  sup_envolvente_total: number;
  sup_huecos?: number;
  g: number;
  area_h_nh: number;
  area_nh_e: number;
  zonaKey: string;
}

// ---------------------------------------------------------------------------
// Constantes CTE
// ---------------------------------------------------------------------------

/** Resistencias superficiales (m²K/W) — Particiones horizontales, flujo ascendente */
const Rsi = 0.1;
const Rse = 0.1;

/** Factor de paso de energía primaria — siempre 1 */
const FP = 1;

// ---------------------------------------------------------------------------
// VALORES G — Severidad climática por zona (mirror de Python zona_climatica.py)
// ---------------------------------------------------------------------------

export const VALORES_G: Record<string, number> = {
  alpha3: 13,
  A2: 24,
  A3: 25,
  A4: 26,
  B2: 36,
  B3: 32,
  B4: 33,
  C1: 44,
  C2: 45,
  C3: 46,
  C4: 46,
  D1: 60,
  D2: 60,
  D3: 61,
  E1: 74,
  E2: 74,
  E3: 74,
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

const B_TABLE: number[][] = [
  // Ratio  Part.Aisl.Est  Part.Aisl.Vent  NadaEst  NadaVent  Cub.Aisl.Est  Cub.Aisl.Vent
  /* 0.25 */ [0.99, 1.0, 0.94, 0.97, 0.91, 0.96],
  /* 0.50 */ [0.97, 0.99, 0.85, 0.92, 0.77, 0.9],
  /* 0.75 */ [0.96, 0.98, 0.77, 0.87, 0.67, 0.84],
  /* 1.00 */ [0.94, 0.97, 0.7, 0.83, 0.59, 0.79],
  /* 1.25 */ [0.92, 0.96, 0.65, 0.79, 0.53, 0.74],
  /* 2.00 */ [0.89, 0.95, 0.56, 0.73, 0.44, 0.67],
  /* 2.50 */ [0.86, 0.93, 0.48, 0.66, 0.36, 0.59],
  /* 3.00 */ [0.83, 0.91, 0.43, 0.61, 0.32, 0.54],
  /* 5.00 */ [0.81, 0.9, 0.39, 0.57, 0.28, 0.5],
];

/** Claves ordenadas para lookup TECHO: menor clave >= ratio real */
const B_KEYS = [0.25, 0.5, 0.75, 1.0, 1.25, 2.0, 2.5, 3.0, 5.0];

// ---------------------------------------------------------------------------
// Funciones puras de cálculo
// ---------------------------------------------------------------------------

/** Redondeo bancario estándar */
function round(v: number, d: number): number {
  const f = Math.pow(10, d);
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
export function getB(ratio: number, scenario: Scenario, caso: Caso): number {
  // Lookup TECHO: menor clave >= ratio
  let fila = B_KEYS.length - 1; // Fallback a la última fila
  for (let i = 0; i < B_KEYS.length; i++) {
    if (B_KEYS[i] >= ratio) {
      fila = i;
      break;
    }
  }

  // Seleccionar par de columnas según escenario
  const colOffset: Record<Scenario, number> = {
    particion_aislada: 0, // Cols 0,1 — DESPUÉS (nuestro trabajo)
    nada_aislado: 2, // Cols 2,3 — ANTES (estado original)
    cubierta_aislada: 4, // Cols 4,5 — Cubierta ya tenía aislante
  };

  const col = colOffset[scenario] + (caso === "ventilado" ? 1 : 0);
  return B_TABLE[fila][col];
}

/** Calcula R de una capa (por R directo o por e/λ) */
function calcularR(capa: CapaMaterial): number {
  const rVal = Number(capa.r_valor);
  const esp = Number(capa.espesor);
  const lam = Number(capa.lambda_val);

  if (rVal > 0) return rVal;
  if (esp > 0 && lam > 0) return esp / lam;
  return 0;
}

// ---------------------------------------------------------------------------
// Cálculo principal
// ---------------------------------------------------------------------------

export function calcularAhorroCAE(params: ParamsCAE): ResultadoTermico {
  const {
    capas,
    area_h_nh,
    area_nh_e,
    superficie_actuacion,
    g,
    sup_envolvente_total,
    scenario_i,
    scenario_f,
    case_i,
    case_f,
    modoCE3X,
  } = params;

  const UP_DEC = modoCE3X ? 2 : 3;

  // Separar capas existentes y todas (con mejora)
  const existentes = capas.filter((c) => !c.es_nueva);

  // Resistencia de materiales
  const r_mat_inicial = existentes.reduce((sum, c) => sum + calcularR(c), 0);
  const r_mat_final = capas.reduce((sum, c) => sum + calcularR(c), 0);

  // Resistencia total: Rt = Rsi + ΣR + Rse
  const rt_inicial = Rsi + r_mat_inicial + Rse;
  const rt_final = Rsi + r_mat_final + Rse;

  // Transmitancia: Up = 1 / Rt (redondeado según modo)
  const up_inicial = rt_inicial > 0 ? round(1 / rt_inicial, UP_DEC) : 0;
  const up_final = rt_final > 0 ? round(1 / rt_final, UP_DEC) : 0;

  // Ratio de superficies (para lookup en Tabla B)
  const ratio = area_nh_e > 0 ? area_h_nh / area_nh_e : 1;

  // Factor b (Tabla 7 CTE)
  const b_inicial = getB(ratio, scenario_i, case_i);
  const b_final = getB(ratio, scenario_f, case_f);

  // Transmitancia corregida: U = Up × b (siempre 2 decimales)
  const ui_final = round(up_inicial * b_inicial, 2);
  const uf_final = round(up_final * b_final, 2);

  // % de envolvente afectada
  const pct_envolvente =
    sup_envolvente_total > 0 ? (superficie_actuacion / sup_envolvente_total) * 100 : 0;

  // Ahorro energético: AE = Fp × (Ui - Uf) × s × G
  const delta_u = ui_final - uf_final;
  const ahorro = delta_u > 0 ? Math.round(FP * delta_u * superficie_actuacion * g) : 0;

  return {
    rt_inicial,
    rt_final,
    up_inicial,
    up_final,
    b_inicial,
    b_final,
    ui_final,
    uf_final,
    ahorro,
    pct_envolvente,
    ratio,
    r_mat_inicial,
    r_mat_final,
  };
}

// ---------------------------------------------------------------------------
// Generación de informe textual
// ---------------------------------------------------------------------------

export function generarInformeTexto(params: ParamsInforme): string {
  const {
    capas,
    resultado,
    sup_actuacion,
    sup_envolvente_total,
    sup_huecos = 0,
    g,
    area_h_nh,
    area_nh_e,
    zonaKey,
  } = params;

  const fmt = (v: number, d = 3) => Number(v).toFixed(d);
  const fmt2 = (v: number) => Number(v).toFixed(2);

  const capasExistentes = capas.filter((c) => !c.es_nueva);
  const todasCapas = capas;
  const pct_afectado = sup_envolvente_total > 0 ? (sup_actuacion / sup_envolvente_total) * 100 : 0;
  const huecos = Math.max(Number(sup_huecos) || 0, 0);
  const opacosNetosEstimados = Math.max(sup_envolvente_total - huecos, 0);

  const lineas: string[] = [];

  lineas.push("1. SUPERFICIE Y PORCENTAJE AFECTADO");
  lineas.push("────────────────────────────────────");
  lineas.push(`Superficie envolvente total (S): ${fmt2(sup_envolvente_total)} m²`);
  if (huecos > 0 && sup_envolvente_total >= huecos) {
    lineas.push(
      `Desglose S (opacos netos + huecos): ${fmt2(opacosNetosEstimados)} + ${fmt2(huecos)} = ${fmt2(sup_envolvente_total)} m²`
    );
  }
  lineas.push(`Superficie actuación (s = Ah-nh): ${fmt2(sup_actuacion)} m²`);
  lineas.push(
    `Porcentaje afectado: ${fmt2(sup_actuacion)} / ${fmt2(sup_envolvente_total)} = ${fmt2(pct_afectado)} %`
  );
  lineas.push("");
  lineas.push(`Ah-nh / Anh-e = ${fmt2(area_h_nh)} / ${fmt2(area_nh_e)} = ${fmt2(resultado.ratio)}`);
  lineas.push("");

  const rIndividualesI = capasExistentes.map((c) => calcularR(c));
  const sumaRTextoI = rIndividualesI.map((v) => fmt(v)).join(" + ");

  lineas.push("2. RESISTENCIA TOTAL Y TRANSMITANCIA INICIAL (ANTES)");
  lineas.push("──────────────────────────────────────────────────────");
  lineas.push("Capas existentes:");
  capasExistentes.forEach((c) => {
    lineas.push(`  - ${c.nombre || "Sin nombre"}: ${fmt(calcularR(c))} m²K/W`);
  });
  lineas.push(`ΣR materiales (i) = ${sumaRTextoI} = ${fmt(resultado.r_mat_inicial)} m²K/W`);
  lineas.push(
    `RTi = ${fmt(resultado.r_mat_inicial)} + ${Rse} + ${Rsi} = ${fmt(resultado.rt_inicial)} m²K/W`
  );
  lineas.push(`Upi = 1 / ${fmt(resultado.rt_inicial)} = ${fmt(resultado.up_inicial)} W/m²K`);
  lineas.push(
    `bi = ${resultado.b_inicial} → Ui = ${fmt(resultado.up_inicial)} * ${resultado.b_inicial} = ${fmt2(resultado.ui_final)} W/m²K`
  );
  lineas.push("");
  lineas.push("");

  const rIndividualesF = todasCapas.map((c) => calcularR(c));
  const sumaRTextoF = rIndividualesF.map((v) => fmt(v)).join(" + ");

  lineas.push("3. RESISTENCIA TOTAL Y TRANSMITANCIA FINAL (DESPUÉS)");
  lineas.push("──────────────────────────────────────────────────────");
  lineas.push("Capas con mejora:");
  todasCapas.forEach((c) => {
    const estado = c.es_nueva ? "[NUEVA]" : "[EXISTENTE]";
    lineas.push(`  - ${c.nombre || "Sin nombre"} ${estado}: ${fmt(calcularR(c))} m²K/W`);
  });
  lineas.push(`ΣR materiales (f) = ${sumaRTextoF} = ${fmt(resultado.r_mat_final)} m²K/W`);
  lineas.push(
    `RTf = ${fmt(resultado.r_mat_final)} + ${Rse} + ${Rsi} = ${fmt(resultado.rt_final)} m²K/W`
  );
  lineas.push(`Upf = 1 / ${fmt(resultado.rt_final)} = ${fmt(resultado.up_final)} W/m²K`);
  lineas.push(
    `bf = ${resultado.b_final} → Uf = ${fmt(resultado.up_final)} * ${resultado.b_final} = ${fmt2(resultado.uf_final)} W/m²K`
  );
  lineas.push("");
  lineas.push("");

  lineas.push("4. CÁLCULO AHORRO ENERGÉTICO");
  lineas.push("─────────────────────────────");
  lineas.push(`Zona Climática: ${zonaKey}   G = ${fmt2(g)} h·K`);
  lineas.push(`AE = Fp * (Ui − Uf) * s * G`);
  lineas.push(
    `AE = ${FP} * (${fmt2(resultado.ui_final)} − ${fmt2(resultado.uf_final)}) * ${fmt2(sup_actuacion)} * ${fmt2(g)} = ${Math.round(resultado.ahorro)} kWh`
  );
  lineas.push("");
  lineas.push(`RESULTADO FINAL: ${Math.round(resultado.ahorro)} kWh`);

  return lineas.join("\n");
}
