import { supabase } from "./supabase";

const CACHE_TTL_MS = 60_000;

type CacheEntry = {
    expiresAt: number;
    value: unknown;
};

const cache = new Map<string, CacheEntry>();

function hasSupabaseClient(): boolean {
    const client = supabase as unknown as { from?: unknown } | null;
    return Boolean(client && typeof client.from === "function");
}

function coerceTextAppConfigValue(value: string): unknown {
    const trimmed = value.trim();
    if (!trimmed) return "";

    try {
        return JSON.parse(trimmed);
    } catch {
        // Fall through to scalar parsing.
    }

    const lower = trimmed.toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;

    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        const asNumber = Number(trimmed);
        if (!Number.isNaN(asNumber)) return asNumber;
    }

    if (trimmed.includes(",")) {
        return trimmed
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
    }

    return trimmed;
}

function normalizeRawAppConfigValue(value: unknown): unknown {
    if (typeof value !== "string") return value;
    return coerceTextAppConfigValue(value);
}

function normalizeRolloutPct(value: unknown): number | null {
    const asNumber =
        typeof value === "number"
            ? value
            : typeof value === "string"
                ? Number(value)
                : Number.NaN;

    if (Number.isNaN(asNumber)) return null;
    if (asNumber < 0) return 0;
    if (asNumber > 100) return 100;
    return asNumber;
}

function toBoolean(value: unknown): boolean | null {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
        const lower = value.trim().toLowerCase();
        if (lower === "true") return true;
        if (lower === "false") return false;
    }
    return null;
}

function toStringArray(value: unknown): string[] {
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return [];
        return trimmed
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
    }

    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === "string");
}

function cacheKeyForFlag(key: string): string {
    return `app_config:${key}`;
}

async function getAppConfigValue(key: string): Promise<unknown> {
    const cacheKey = cacheKeyForFlag(key);
    const now = Date.now();
    const cached = cache.get(cacheKey);

    if (cached && cached.expiresAt > now) {
        return cached.value;
    }

    if (!hasSupabaseClient()) {
        return null;
    }

    try {
        const { data, error } = await supabase
            .from("app_config")
            .select("value")
            .eq("key", key)
            .maybeSingle();

        if (error || !data) {
            cache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, value: null });
            return null;
        }

        const value = normalizeRawAppConfigValue((data as { value?: unknown }).value ?? null);
        cache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, value });
        return value;
    } catch {
        cache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, value: null });
        return null;
    }
}

export function deterministicRolloutBucket(userId: string): number {
    let hash = 0;

    for (let index = 0; index < userId.length; index += 1) {
        hash = (hash * 31 + userId.charCodeAt(index)) | 0;
    }

    return Math.abs(hash) % 100;
}

export async function isConflictV2Enabled(userId: string): Promise<boolean> {
    const allowList = [
        ...toStringArray(await getAppConfigValue("conflict_v2_users")),
        ...toStringArray(await getAppConfigValue("conflict_v2_canary_users")),
    ];
    if (new Set(allowList).has(userId)) return true;

    const blockList = toStringArray(await getAppConfigValue("conflict_v2_blocklist"));
    if (blockList.includes(userId)) return false;

    const rolloutPct = normalizeRolloutPct(await getAppConfigValue("conflict_v2_rollout_pct"));
    if (rolloutPct !== null) {
        return deterministicRolloutBucket(userId) < rolloutPct;
    }

    const globalEnabled = toBoolean(await getAppConfigValue("conflict_v2_enabled"));
    if (globalEnabled !== null) {
        return globalEnabled;
    }

    return false;
}

/**
 * Gate 6 — Feature flag for the normalized Catastro endpoint.
 * Controls whether the PWA calls /api/v1/catastro/normalizar/{rc}
 * instead of the legacy /api/v1/catastro/consultar/{rc}.
 *
 * Supabase app_config keys:
 *   - catastro_normalizar_canary_users  (comma-separated user IDs)
 *   - catastro_normalizar_rollout_pct   (0-100)
 *   - catastro_normalizar_enabled       (true/false)
 */
export async function isCatastroNormalizarEnabled(userId: string): Promise<boolean> {
    const allowList = toStringArray(await getAppConfigValue("catastro_normalizar_canary_users"));
    if (new Set(allowList).has(userId)) return true;

    const rolloutPct = normalizeRolloutPct(await getAppConfigValue("catastro_normalizar_rollout_pct"));
    if (rolloutPct !== null) {
        return deterministicRolloutBucket(userId) < rolloutPct;
    }

    const globalEnabled = toBoolean(await getAppConfigValue("catastro_normalizar_enabled"));
    if (globalEnabled !== null) {
        return globalEnabled;
    }

    return false;
}

export function invalidateFeatureFlagCache(): void {
    cache.clear();
}
