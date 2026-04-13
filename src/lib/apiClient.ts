/**
 * apiClient.ts — Migrado a Ky (abril 2026)
 *
 * Este módulo mantiene la misma API pública (`calcularDbHeRemoto`) para
 * compatibilidad con CalculadoraTermica.tsx, pero internamente delega
 * toda la comunicación HTTP al kyClient blindado (con auto-retry,
 * token refresh silencioso y backoff exponencial).
 *
 * El viejo `fetch` crudo ha sido eliminado.
 */

import { kyClient } from "./kyClient";
import type { ParamsCAE, ResultadoTermico, Scenario, Caso } from "./thermalCalculator";

// ─── Mapeos PWA → Backend ────────────────────────────────────────────

function mapScenario(s: Scenario): string {
    switch (s) {
        case "particion_aislada": return "despues";
        case "nada_aislado": return "antes_normal";
        case "cubierta_aislada": return "antes_aislado";
        default: return "antes_normal";
    }
}

function mapCaso(c: Caso): number {
    // 1 = estanco/lig_ventilado, 2 = muy_ventilado
    return c === "estanco" ? 1 : 2;
}

// ─── Tipos públicos ──────────────────────────────────────────────────

export interface RemoteCalculoResponse {
    resultado: ResultadoTermico;
    informe: string;
}

// ─── Función pública (firma intacta) ─────────────────────────────────

export async function calcularDbHeRemoto(params: ParamsCAE): Promise<RemoteCalculoResponse> {
    // 1. Construir payload (la autenticación la inyecta kyClient.beforeRequest)
    const payload = {
        capas: params.capas.map(c => ({
            nombre: c.nombre,
            espesor: Number(c.espesor) || 0,
            lambda_val: Number(c.lambda_val) || 0,
            r_valor: Number(c.r_valor) || 0,
            es_nueva: c.es_nueva
        })),
        area_h_nh: params.area_h_nh,
        area_nh_e: params.area_nh_e,
        superficie_actuacion: params.superficie_actuacion,
        zona_climatica_g: params.g,
        sup_envolvente_total: params.sup_envolvente_total,
        escenario_i: mapScenario(params.scenario_i),
        caso_i: mapCaso(params.case_i),
        escenario_f: mapScenario(params.scenario_f),
        caso_f: mapCaso(params.case_f),
    };

    // 2. Ejecutar llamada vía Ky (retry automático + token refresh transparente)
    const data = await kyClient
        .post("api/v1/calcular-db-he", { json: payload })
        .json<Record<string, any>>();

    // 3. Mapear respuesta backend → ResultadoTermico de la PWA
    const resultado: ResultadoTermico = {
        rt_inicial: data.rt_inicial,
        rt_final: data.rt_final,
        up_inicial: data.up_inicial,
        up_final: data.up_final,
        b_inicial: data.b_inicial,
        b_final: data.b_final,
        ui_final: data.ui_final,
        uf_final: data.uf_final,
        ratio: data.ratio,
        ahorro: data.ahorro_kwh, // backend: ahorro_kwh → PWA: ahorro
        pct_envolvente: data.pct_envolvente,
        r_mat_inicial: params.capas
            .filter(c => !c.es_nueva)
            .reduce((s, c) => s + (Number(c.r_valor) || ((Number(c.espesor) || 0) / (Number(c.lambda_val) || 1))), 0),
        r_mat_final: params.capas
            .reduce((s, c) => s + (Number(c.r_valor) || ((Number(c.espesor) || 0) / (Number(c.lambda_val) || 1))), 0),
    };

    return {
        resultado,
        informe: data.informe_texto,
    };
}
