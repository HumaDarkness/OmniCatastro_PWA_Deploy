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

const CLOUD_CALC_TIMEOUT_MS = 15000;
const CLOUD_WARMUP_TTL_MS = 8 * 60 * 1000;
const CLOUD_WARMUP_TIMEOUT_MS = 45000;
const CLOUD_RECOVERY_WARMUP_TIMEOUT_MS = 6000;
const CLOUD_STATUS_TIMEOUT_MS = 7000;
const CLOUD_HIGH_LATENCY_MS = 2500;
const CLOUD_STARTING_RETRY_LIMIT = 3;
const CLOUD_STARTING_GRACE_MS = 2 * 60 * 1000;
const NETWORK_ERROR_PATTERN = /(network error|failed to fetch|load failed|timed out|timeout)/i;

let lastCloudWarmupAt = 0;
let warmupInFlight: Promise<boolean> | null = null;
let cloudTransientFailureCount = 0;

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

export type CloudAvailabilityState = "active" | "starting" | "offline";

export interface CloudAvailabilitySnapshot {
    state: CloudAvailabilityState;
    checkedAt: number;
    latencyMs: number | null;
    fromCache: boolean;
    message: string;
}

function mapRemoteResponse(params: ParamsCAE, data: Record<string, any>): RemoteCalculoResponse {
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

function isRetryableNetworkFailure(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }
    return NETWORK_ERROR_PATTERN.test(error.message);
}

function nowMs(): number {
    return Date.now();
}

function buildOfflineSnapshot(message: string): CloudAvailabilitySnapshot {
    return {
        state: "offline",
        checkedAt: nowMs(),
        latencyMs: null,
        fromCache: false,
        message,
    };
}

export async function getCloudAvailabilitySnapshot(options?: {
    force?: boolean;
    timeoutMs?: number;
}): Promise<CloudAvailabilitySnapshot> {
    const force = options?.force ?? false;
    const timeoutMs = options?.timeoutMs ?? CLOUD_STATUS_TIMEOUT_MS;
    const checkedAt = nowMs();

    if (!force && checkedAt - lastCloudWarmupAt < CLOUD_WARMUP_TTL_MS) {
        return {
            state: "active",
            checkedAt,
            latencyMs: null,
            fromCache: true,
            message: "Cloud activa (cache caliente)",
        };
    }

    const startedAt = nowMs();

    try {
        await kyClient
            .get("health", {
                timeout: timeoutMs,
                retry: { limit: 0 },
            })
            .json<Record<string, any>>();

        const finishedAt = nowMs();
        const latencyMs = Math.max(finishedAt - startedAt, 0);
        lastCloudWarmupAt = finishedAt;
        cloudTransientFailureCount = 0;

        return {
            state: "active",
            checkedAt: finishedAt,
            latencyMs,
            fromCache: false,
            message: latencyMs > CLOUD_HIGH_LATENCY_MS
                ? "Cloud activa con latencia elevada"
                : "Cloud activa",
        };
    } catch (error) {
        const rawMessage = error instanceof Error ? error.message : "error desconocido";
        const normalized = rawMessage.toLowerCase();

        if (NETWORK_ERROR_PATTERN.test(rawMessage) || normalized.includes("503") || normalized.includes("504")) {
            cloudTransientFailureCount += 1;
            const elapsedSinceLastSuccess = nowMs() - lastCloudWarmupAt;
            const shouldMarkOffline =
                cloudTransientFailureCount >= CLOUD_STARTING_RETRY_LIMIT
                && elapsedSinceLastSuccess > CLOUD_STARTING_GRACE_MS;

            if (shouldMarkOffline) {
                return buildOfflineSnapshot("Cloud no disponible temporalmente (reintentos agotados)");
            }

            return {
                state: "starting",
                checkedAt: nowMs(),
                latencyMs: null,
                fromCache: false,
                message: "Cloud iniciando o red inestable",
            };
        }

        if (normalized.includes("403") || normalized.includes("origin")) {
            return buildOfflineSnapshot("Cloud bloqueada por origen/CORS");
        }

        return buildOfflineSnapshot(`Cloud no disponible (${rawMessage})`);
    }
}

export async function warmUpCloudApi(options?: { force?: boolean; timeoutMs?: number }): Promise<boolean> {
    const force = options?.force ?? false;
    const timeoutMs = options?.timeoutMs ?? CLOUD_WARMUP_TIMEOUT_MS;
    const now = Date.now();

    if (!force && now - lastCloudWarmupAt < CLOUD_WARMUP_TTL_MS) {
        return true;
    }

    if (warmupInFlight) {
        return warmupInFlight;
    }

    warmupInFlight = (async () => {
        try {
            await kyClient
                .get("health", {
                    timeout: timeoutMs,
                    retry: { limit: 0 },
                })
                .json<Record<string, any>>();
            lastCloudWarmupAt = Date.now();
            cloudTransientFailureCount = 0;
            return true;
        } catch {
            cloudTransientFailureCount += 1;
            return false;
        } finally {
            warmupInFlight = null;
        }
    })();

    return warmupInFlight;
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
    const buildRequest = () =>
        kyClient
            .post("api/v1/calcular-db-he", {
                json: payload,
                timeout: CLOUD_CALC_TIMEOUT_MS,
            })
            .json<Record<string, any>>();

    try {
        const data = await buildRequest();
        return mapRemoteResponse(params, data);
    } catch (error) {
        if (!isRetryableNetworkFailure(error)) {
            throw error;
        }

        await warmUpCloudApi({ force: true, timeoutMs: CLOUD_RECOVERY_WARMUP_TIMEOUT_MS });
        const data = await buildRequest();
        return mapRemoteResponse(params, data);
    }
}
