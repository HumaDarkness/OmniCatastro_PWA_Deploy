/**
 * kyClient.ts — Cliente HTTP blindado (Ky v2)
 *
 * Intercepta automáticamente:
 * - Inyección de JWT de Supabase en cada petición (beforeRequest)
 * - Refresh silencioso de token expirado en 401 (afterResponse)
 * - Reintentos con backoff exponencial para errores de red (502/503/504)
 */

import ky from 'ky';
import type { BeforeRequestHook, AfterResponseHook, BeforeRetryHook } from 'ky';
import { supabase } from './supabase';

const CLOUD_API_FALLBACK = 'https://omnicatastro-api.onrender.com';
const DEFAULT_API_PREFIX = import.meta.env.DEV ? 'http://localhost:8000' : CLOUD_API_FALLBACK;
const API_PREFIX = (import.meta.env.VITE_API_URL || DEFAULT_API_PREFIX).trim().replace(/\/+$/, '');

const injectAuth: BeforeRequestHook = async ({ request }) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    request.headers.set('Authorization', `Bearer ${session.access_token}`);
  }
};

const refreshOn401: AfterResponseHook = async ({ request, response }) => {
  if (response.status === 401) {
    const { data: { session } } = await supabase.auth.refreshSession();
    if (session?.access_token) {
      request.headers.set('Authorization', `Bearer ${session.access_token}`);
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
    methods: ['get', 'post', 'put', 'delete'],
    statusCodes: [502, 503, 504],
    backoffLimit: 5000,
  },
  hooks: {
    beforeRequest: [injectAuth],
    afterResponse: [refreshOn401],
    beforeRetry: [logRetry],
  },
});
