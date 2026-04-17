import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import path from "node:path";
import { promises as fs } from "node:fs";

vi.mock("../supabase", () => ({
    supabase: null,
}));

vi.mock("../kyClient", () => ({
    kyClient: {
        get: vi.fn(),
    },
}));

import { extraerDatosInmuebleUnico, validarRC } from "../catastroService";

type RcQueryRow = {
    rc: string | null;
    consulted_at?: string | null;
    success?: boolean | null;
    error_message?: string | null;
};

type CacheRow = {
    rc: string;
    raw_json: unknown;
};

type FailureRow = {
    rc: string;
    source: "cache" | "live" | "none";
    reason: string;
    detail?: string;
};

type BatchSummary = {
    startedAt: string;
    finishedAt: string;
    requestedLimit: number;
    uniqueRcLoaded: number;
    rcFormatValid: number;
    processed: number;
    fromCache: number;
    fromLive: number;
    noPayload: number;
    catastroErrorPayload: number;
    parserBasicPass: number;
    parserStrictPass: number;
    cpRuleApplicable: number;
    cpRulePass: number;
    municipioLeakDetected: number;
    strictPassRate: number;
    cpRulePassRate: number;
    failures: FailureRow[];
};

const RUN_REAL_BATCH = process.env.RUN_REAL_CATASTRO_BATCH === "1";
const REAL_LIMIT = parseEnvInt("REAL_CATASTRO_LIMIT", 1000, 50, 2000);
const LIVE_TIMEOUT_MS = parseEnvInt("REAL_CATASTRO_LIVE_TIMEOUT_MS", 10000, 2000, 30000);
const MAX_LIVE_FETCH = parseEnvInt("REAL_CATASTRO_MAX_LIVE", 200, 0, 2000);
const CATASTRO_URL =
    "https://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero/COVCCallejero.svc/json/Consulta_DNPRC";

function parseEnvInt(name: string, fallback: number, min: number, max: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function parseTomlStringValue(content: string, key: string): string {
    const match = content.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"\\s*$`, "m"));
    return match?.[1]?.trim() ?? "";
}

async function resolveSupabaseCredentials(): Promise<{ url: string; key: string }> {
    const urlFromEnv = process.env.SUPABASE_URL?.trim() ?? "";
    const keyFromEnv = process.env.SUPABASE_SERVICE_KEY?.trim() ?? "";
    if (urlFromEnv && keyFromEnv) {
        return { url: urlFromEnv, key: keyFromEnv };
    }

    const secretsPath = path.resolve(process.cwd(), "../desktop/.streamlit/secrets.toml");
    const secretsContent = await fs.readFile(secretsPath, "utf-8");

    const url = urlFromEnv || parseTomlStringValue(secretsContent, "SUPABASE_URL");
    const key = keyFromEnv || parseTomlStringValue(secretsContent, "SUPABASE_SERVICE_KEY");

    if (!url || !key) {
        throw new Error("No se encontraron credenciales de Supabase (SUPABASE_URL/SUPABASE_SERVICE_KEY)");
    }

    return { url, key };
}

async function getLatestRcRows(limit: number): Promise<RcQueryRow[]> {
    const creds = await resolveSupabaseCredentials();
    const sb = createClient(creds.url, creds.key);

    const withSuccessFilter = await sb
        .from("rc_queries")
        .select("rc, consulted_at, success, error_message")
        .eq("success", true)
        .order("consulted_at", { ascending: false })
        .limit(limit);

    if (!withSuccessFilter.error) {
        return (withSuccessFilter.data ?? []) as RcQueryRow[];
    }

    const fallback = await sb
        .from("rc_queries")
        .select("rc, consulted_at, success, error_message")
        .order("consulted_at", { ascending: false })
        .limit(limit);

    if (fallback.error) {
        throw new Error(`No se pudieron leer RC desde rc_queries: ${fallback.error.message}`);
    }

    return (fallback.data ?? []) as RcQueryRow[];
}

function uniqueValidRc(rows: RcQueryRow[]): string[] {
    const set = new Set<string>();

    for (const row of rows) {
        const value = String(row.rc ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (!value) continue;

        const validation = validarRC(value);
        if (!validation.valido) continue;

        set.add(validation.resultado);
    }

    return Array.from(set.values());
}

async function getCachedPayloadMap(rcList: string[]): Promise<Map<string, unknown>> {
    if (!rcList.length) return new Map<string, unknown>();

    const creds = await resolveSupabaseCredentials();
    const sb = createClient(creds.url, creds.key);

    const map = new Map<string, unknown>();
    const chunkSize = 100;

    for (let i = 0; i < rcList.length; i += chunkSize) {
        const chunk = rcList.slice(i, i + chunkSize);
        const res = await sb
            .from("catastro_cache")
            .select("rc, raw_json")
            .in("rc", chunk);

        if (res.error) {
            throw new Error(`No se pudo leer catastro_cache: ${res.error.message}`);
        }

        for (const row of (res.data ?? []) as CacheRow[]) {
            if (!row?.rc) continue;
            map.set(String(row.rc).toUpperCase(), row.raw_json);
        }
    }

    return map;
}

function hasCatastroError(payload: any): boolean {
    const root = payload?.consulta_dnprcResult ?? payload?.consulta_dnp ?? payload;
    const raw = root?.control?.cuerr;
    const cuerr = Number.parseInt(String(raw ?? "0"), 10);
    return Number.isFinite(cuerr) && cuerr > 0;
}

async function fetchLivePayload(rc: string): Promise<unknown | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);

    try {
        const url = `${CATASTRO_URL}?RefCat=${encodeURIComponent(rc)}`;
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                Accept: "application/json",
            },
        });

        if (!response.ok) return null;

        const text = await response.text();
        try {
            return JSON.parse(text);
        } catch {
            return null;
        }
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

function safeRate(numerator: number, denominator: number): number {
    if (!denominator) return 0;
    return Number((numerator / denominator).toFixed(4));
}

function normalizeLeakToken(value: string): string {
    return value
        .toUpperCase()
        .replace(/[^A-Z0-9\u00C0-\u017F\- ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function includesTokenGroup(text: string, value: string): boolean {
    const normalizedText = normalizeLeakToken(text);
    const normalizedValue = normalizeLeakToken(value);

    if (!normalizedText || !normalizedValue) return false;
    return (` ${normalizedText} `).includes(` ${normalizedValue} `);
}

function detectMunicipioLeakAfterCp(direccion: string, cp: string, municipio: string): boolean {
    const cpToken = cp.trim();
    if (!/^\d{5}$/.test(cpToken)) return false;

    const direccionUp = String(direccion ?? "").toUpperCase();
    const cpIndex = direccionUp.lastIndexOf(cpToken);
    if (cpIndex < 0) return false;

    const tailAfterCp = direccionUp.slice(cpIndex + cpToken.length);
    return includesTokenGroup(tailAfterCp, municipio);
}

describe("catastroService real batch strict helpers", () => {
    it("does not flag municipio when it is part of the street name before CP", () => {
        const leak = detectMunicipioLeakAfterCp(
            "CARRETERA GUARDO M PE 11 34879",
            "34879",
            "GUARDO"
        );

        expect(leak).toBe(false);
    });

    it("flags municipio when it appears after CP", () => {
        const leak = detectMunicipioLeakAfterCp(
            "CALLE MAYOR 12 28013 MADRID",
            "28013",
            "MADRID"
        );

        expect(leak).toBe(true);
    });
});

function buildMarkdown(summary: BatchSummary): string {
    const lines: string[] = [];

    lines.push("# Validacion Real Catastro - Batch Supabase");
    lines.push("");
    lines.push(`Fecha inicio: ${summary.startedAt}`);
    lines.push(`Fecha fin: ${summary.finishedAt}`);
    lines.push(`RC solicitadas (limite): ${summary.requestedLimit}`);
    lines.push("");
    lines.push("## Resumen");
    lines.push("");
    lines.push("| Metrica | Valor |");
    lines.push("|---|---|");
    lines.push(`| RC unicas cargadas | ${summary.uniqueRcLoaded} |`);
    lines.push(`| RC con formato valido | ${summary.rcFormatValid} |`);
    lines.push(`| RC procesadas | ${summary.processed} |`);
    lines.push(`| Payload desde cache | ${summary.fromCache} |`);
    lines.push(`| Payload en vivo | ${summary.fromLive} |`);
    lines.push(`| Sin payload util | ${summary.noPayload} |`);
    lines.push(`| Payload con error Catastro | ${summary.catastroErrorPayload} |`);
    lines.push(`| Parser pass basico | ${summary.parserBasicPass} |`);
    lines.push(`| Parser pass estricto | ${summary.parserStrictPass} |`);
    lines.push(`| Regla CP aplicable | ${summary.cpRuleApplicable} |`);
    lines.push(`| Regla CP cumple | ${summary.cpRulePass} |`);
    lines.push(`| Fuga municipio detectada | ${summary.municipioLeakDetected} |`);
    lines.push(`| Tasa pass estricto | ${summary.strictPassRate} |`);
    lines.push(`| Tasa cumplimiento CP | ${summary.cpRulePassRate} |`);

    lines.push("");
    lines.push("## Muestra de fallos");
    lines.push("");

    if (!summary.failures.length) {
        lines.push("Sin fallos en la muestra evaluada.");
        return lines.join("\n");
    }

    lines.push("| RC | Fuente | Motivo | Detalle |");
    lines.push("|---|---|---|---|");
    for (const fail of summary.failures.slice(0, 25)) {
        lines.push(
            `| ${fail.rc} | ${fail.source} | ${fail.reason} | ${(fail.detail ?? "").replace(/\|/g, " ")} |`
        );
    }

    return lines.join("\n");
}

async function writeBatchArtifacts(summary: BatchSummary): Promise<void> {
    const dateTag = new Date().toISOString().slice(0, 10);
    const docsDir = path.resolve(process.cwd(), "../docs/COMERCIAL");
    const jsonPath = path.join(docsDir, `OMNICATASTRO_VALIDACION_REAL_CATASTRO_${dateTag}.json`);
    const mdPath = path.join(docsDir, `OMNICATASTRO_VALIDACION_REAL_CATASTRO_${dateTag}.md`);

    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(jsonPath, JSON.stringify(summary, null, 2), "utf-8");
    await fs.writeFile(mdPath, buildMarkdown(summary), "utf-8");

    console.info(`[real-batch] Artefacto JSON: ${jsonPath}`);
    console.info(`[real-batch] Artefacto MD: ${mdPath}`);
}

const describeReal = RUN_REAL_BATCH ? describe : describe.skip;

describeReal("catastroService real batch validation from Supabase", () => {
    it(
        "runs parser against real RC dataset and exports evidence report",
        async () => {
            const startedAt = new Date().toISOString();

            const rcRows = await getLatestRcRows(REAL_LIMIT);
            const rcList = uniqueValidRc(rcRows);
            const cacheMap = await getCachedPayloadMap(rcList);

            const failures: FailureRow[] = [];
            let processed = 0;
            let fromCache = 0;
            let fromLive = 0;
            let noPayload = 0;
            let catastroErrorPayload = 0;
            let parserBasicPass = 0;
            let parserStrictPass = 0;
            let cpRuleApplicable = 0;
            let cpRulePass = 0;
            let municipioLeakDetected = 0;
            let liveAttempts = 0;

            for (const rc of rcList) {
                let payload = cacheMap.get(rc) ?? null;
                let source: "cache" | "live" | "none" = "none";

                if (payload) {
                    source = "cache";
                    fromCache += 1;
                } else if (liveAttempts < MAX_LIVE_FETCH) {
                    payload = await fetchLivePayload(rc);
                    liveAttempts += 1;
                    if (payload) {
                        source = "live";
                        fromLive += 1;
                    }
                }

                if (!payload) {
                    noPayload += 1;
                    failures.push({
                        rc,
                        source,
                        reason: "no_payload",
                        detail: "Sin raw_json en cache y sin respuesta util en vivo",
                    });
                    continue;
                }

                if (hasCatastroError(payload)) {
                    catastroErrorPayload += 1;
                    failures.push({
                        rc,
                        source,
                        reason: "catastro_error_payload",
                    });
                    continue;
                }

                processed += 1;

                const parsed = extraerDatosInmuebleUnico(payload as any);
                const direccion = String(parsed.direccion ?? "").trim();
                const direccionUp = direccion.toUpperCase();
                const cp = String(parsed.codigoPostal ?? "").trim();
                const municipio = String(parsed.municipio ?? "").trim();

                const hasDoubleSpaces = /\s{2,}/.test(direccion);
                const basicPass = direccion.length > 0 && !hasDoubleSpaces;
                if (basicPass) {
                    parserBasicPass += 1;
                }

                const cpApplicable = /^\d{5}$/.test(cp);
                let cpPass = true;
                if (cpApplicable) {
                    cpRuleApplicable += 1;
                    cpPass = direccionUp.endsWith(cp);
                    if (cpPass) {
                        cpRulePass += 1;
                    }
                }

                const municipioLeak = detectMunicipioLeakAfterCp(direccion, cp, municipio);
                if (municipioLeak) {
                    municipioLeakDetected += 1;
                }

                const strictPass = basicPass && cpPass && !municipioLeak;
                if (strictPass) {
                    parserStrictPass += 1;
                } else {
                    const reason = !basicPass
                        ? "basic_parser_rule_failed"
                        : !cpPass
                            ? "cp_rule_failed"
                            : "municipio_leak";

                    failures.push({
                        rc,
                        source,
                        reason,
                        detail: `direccion=${direccion} | cp=${cp} | municipio=${parsed.municipio ?? ""}`,
                    });
                }
            }

            const summary: BatchSummary = {
                startedAt,
                finishedAt: new Date().toISOString(),
                requestedLimit: REAL_LIMIT,
                uniqueRcLoaded: rcList.length,
                rcFormatValid: rcList.length,
                processed,
                fromCache,
                fromLive,
                noPayload,
                catastroErrorPayload,
                parserBasicPass,
                parserStrictPass,
                cpRuleApplicable,
                cpRulePass,
                municipioLeakDetected,
                strictPassRate: safeRate(parserStrictPass, processed),
                cpRulePassRate: safeRate(cpRulePass, cpRuleApplicable),
                failures,
            };

            await writeBatchArtifacts(summary);

            console.info("[real-batch] Resumen:", summary);

            expect(summary.uniqueRcLoaded).toBeGreaterThan(0);
            expect(summary.processed).toBeGreaterThan(0);
        },
        10 * 60_000
    );
});
