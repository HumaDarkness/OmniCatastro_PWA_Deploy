import { supabase } from "./supabase";
import type { ParamsCAE, ResultadoTermico, Scenario, Caso } from "./thermalCalculator";

const API_URL = import.meta.env.VITE_API_URL || "";

// Mapeos de PWA -> Backend
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

export interface RemoteCalculoResponse {
    resultado: ResultadoTermico;
    informe: string;
}

export async function calcularDbHeRemoto(params: ParamsCAE): Promise<RemoteCalculoResponse> {
    if (!API_URL) {
        throw new Error("VITE_API_URL no está configurada.");
    }

    // 1. Obtener Token JWT de la sesión activa
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData?.session) {
        throw new Error("No hay sesión activa para realizar el cálculo remoto.");
    }
    const token = sessionData.session.access_token;

    // 2. Traducir ParamsCAE -> CalcularDbHeRequest
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
        // Si hay override (generalmente ui/uf no entran directamente en ParamsCAE pero por completitud si existieran)
        // ui_override: params.ui_override,
        // uf_override: params.uf_override
    };

    // 3. Ejecutar Llamada
    const response = await fetch(`${API_URL}/api/v1/calcular-db-he`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
            // Origin guard requiere que enviemos una petición legitima de un origin. Browsers lo hacen auto.
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        let errMessage = `Error API (${response.status})`;
        try {
            const errData = await response.json();
            errMessage = errData.detail || errMessage;
        } catch { }
        throw new Error(errMessage);
    }

    const data = await response.json();

    // 4. Mapear de vuelta a ResultadoTermico
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
        ahorro: data.ahorro_kwh, // backend lo llama ahorro_kwh, PWA lo llama ahorro
        pct_envolvente: data.pct_envolvente,
        // En PWA tenemos r_mat_inicial y r_mat_final que no vienen directamente pero se calculaban en la PWA
        // Igual la UI usa los otros valores, pero si es 100% necesario lo podemos meter en ceros, 
        // o mapearlo si no se utiliza estrictamente
        r_mat_inicial: params.capas.filter(c => !c.es_nueva).reduce((s, c) => s + (Number(c.r_valor) || ((Number(c.espesor) || 0) / (Number(c.lambda_val) || 1))), 0),
        r_mat_final: params.capas.reduce((s, c) => s + (Number(c.r_valor) || ((Number(c.espesor) || 0) / (Number(c.lambda_val) || 1))), 0)
    };

    return {
        resultado,
        informe: data.informe_texto
    };
}
