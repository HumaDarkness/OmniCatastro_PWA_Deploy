import { describe, it, expect } from "vitest";
import { getB, calcularAhorroCAE } from "./thermalCalculator";

describe("thermalCalculator - Coeficiente b", () => {
  it("Fixture 1: Partición aislada, Estanco", () => {
    expect(getB(0.82, "particion_aislada", "estanco")).toBe(0.94);
  });

  it("Fixture 2: NADA aislado, Estanco", () => {
    expect(getB(0.82, "nada_aislado", "estanco")).toBe(0.7);
  });

  it("Fixture 3: Cubierta aislada, Ventilado", () => {
    expect(getB(0.82, "cubierta_aislada", "ventilado")).toBe(0.79);
  });

  it("Fixture 4: Partición aislada, Estanco (ratio alto)", () => {
    expect(getB(1.5, "particion_aislada", "estanco")).toBe(0.89);
  });

  it("Fixture 5: NADA aislado, Ventilado (ratio límite)", () => {
    expect(getB(3.5, "nada_aislado", "ventilado")).toBe(0.57);
  });

  it("Edge Case: ratio exacto 0.25", () => {
    expect(getB(0.25, "particion_aislada", "estanco")).toBe(0.99);
  });

  it("Edge Case: ratio exacto 5.00", () => {
    expect(getB(5.0, "particion_aislada", "estanco")).toBe(0.81);
  });

  it("Edge Case: ratio mayor a 5.00", () => {
    expect(getB(10.0, "particion_aislada", "estanco")).toBe(0.81);
  });

  it("Edge Case: ratio <= 0", () => {
    expect(getB(0, "particion_aislada", "estanco")).toBe(0.99);
  });
});

describe("thermalCalculator - Caso Real Madrid D3", () => {
  it("Coincidencia con Python (AE ≈ 28,870 kWh)", () => {
    const res = calcularAhorroCAE({
      capas: [
        { nombre: "Hormigón", espesor: 0.1, lambda_val: 2.5, r_valor: 0, es_nueva: false },
        { nombre: "Insuflado", espesor: 0.06, lambda_val: 0.046, r_valor: 0, es_nueva: true },
      ],
      area_h_nh: 205,
      area_nh_e: 250,
      superficie_actuacion: 205,
      g: 61,
      sup_envolvente_total: 1000,
      scenario_i: "nada_aislado",
      scenario_f: "particion_aislada",
      case_i: "estanco",
      case_f: "estanco",
      modoCE3X: false,
    });
    // b_inicial
    expect(res.b_inicial).toBe(0.7);
    // b_final
    expect(res.b_final).toBe(0.94);
    // up_inicial (Rt = 0.10 + 0.040 + 0.10 = 0.24 -> 1/0.24 = 4.167)
    expect(res.up_inicial).toBe(4.167);
    // up_final (Rt = 0.24 + 1.3043 = 1.5443 -> 1/1.5443 = 0.6475 -> 0.648)
    expect(res.up_final).toBe(0.648);
    // Ahorro
    expect(Math.abs(res.ahorro - 28886)).toBeLessThanOrEqual(20);
  });
});
