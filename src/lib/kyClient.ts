/**
 * kyClient.ts — Cliente HTTP blindado (Ky v2)
 *
 * Intercepta automáticamente:
 * - Inyección de JWT de Supabase en cada petición (beforeRequest)
 * - Refresh silencioso de token expirado en 401 (afterResponse)
 * - Reintentos con backoff exponencial para errores de red (502/503/504)
 */

import ky from "ky";
import type { BeforeRequestHook, AfterResponseHook, BeforeRetryHook } from "ky";
import { supabase } from "./supabase";

export const CLOUD_API_FALLBACK = "https://omnicatastro-api.onrender.com";

const normalizePrefix = (value: string): string => value.trim().replace(/\/+$/, "");

const DEFAULT_API_PREFIX = import.meta.env.DEV ? "http://localhost:8000" : CLOUD_API_FALLBACK;
const ENV_API_PREFIX = normalizePrefix(import.meta.env.VITE_API_URL || "");
const API_PREFIX = ENV_API_PREFIX || DEFAULT_API_PREFIX;
const API_FALLBACK_PREFIX = normalizePrefix(CLOUD_API_FALLBACK);
const TOKEN_REFRESH_SKEW_MS = 45_000;

async function resolveAccessTokenForRequest(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const token = session?.access_token ?? null;
  const expiresAtMs = typeof session?.expires_at === "number" ? session.expires_at * 1000 : null;

  // Refresh defensively when token is missing or very close to expiry.
  if (!token || (expiresAtMs !== null && expiresAtMs - Date.now() <= TOKEN_REFRESH_SKEW_MS)) {
    const {
      data: { session: refreshed },
    } = await supabase.auth.refreshSession();
    return refreshed?.access_token ?? token;
  }

  return token;
}

const injectAuth: BeforeRequestHook = async ({ request }) => {
  const accessToken = await resolveAccessTokenForRequest();
  if (accessToken) {
    request.headers.set("Authorization", `Bearer ${accessToken}`);
  }
};

const refreshOn401: AfterResponseHook = async ({ request, response }) => {
  // Retry at most once per request to avoid infinite loops.
  if (response.status === 401 && request.headers.get("x-oc-auth-retry") !== "1") {
    const {
      data: { session },
    } = await supabase.auth.refreshSession();
    if (session?.access_token) {
      request.headers.set("Authorization", `Bearer ${session.access_token}`);
      request.headers.set("x-oc-auth-retry", "1");
      return ky(request);
    }
  }
};

const logRetry: BeforeRetryHook = async ({ request, retryCount }) => {
  if (retryCount >= 2) {
    console.warn(`[kyClient] Reintento ${retryCount + 1}/3 para ${request.url}`);
  }
};

export const kyClient = ky.create({
  prefix: API_PREFIX,
  timeout: 10000,
  retry: {
    limit: 3,
    methods: ["get", "post", "put", "delete"],
    statusCodes: [502, 503, 504],
    backoffLimit: 5000,
  },
  hooks: {
    beforeRequest: [injectAuth],
    afterResponse: [refreshOn401],
    beforeRetry: [logRetry],
  },
});

export const hasKyFallbackClient = API_PREFIX !== API_FALLBACK_PREFIX;

export const kyFallbackClient = hasKyFallbackClient
  ? ky.create({
      prefix: API_FALLBACK_PREFIX,
      timeout: 10000,
      retry: {
        limit: 3,
        methods: ["get", "post", "put", "delete"],
        statusCodes: [502, 503, 504],
        backoffLimit: 5000,
      },
      hooks: {
        beforeRequest: [injectAuth],
        afterResponse: [refreshOn401],
        beforeRetry: [logRetry],
      },
    })
  : kyClient;
