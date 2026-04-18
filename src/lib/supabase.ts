/**
 * Supabase Client — OmniCatastro PWA
 *
 * Inicializa el cliente de Supabase y expone helpers de autenticación
 * y validación de licencia para la app web.
 *
 * Las variables de entorno VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
 * deben estar definidas en el entorno de Vite (.env o build-time).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
export type LicenseTier = "desktop_only" | "pwa_only" | "suite_pro";

interface LoginResult {
  valid: boolean;
  message?: string;
  tier?: LicenseTier;
  licenseKey?: string;
}

export interface UxRecoverySnapshot {
  isAuthenticated: boolean;
  userEmail: string | null;
  organizationId: string | null;
  clientsCount: number | null;
  projectsCount: number | null;
  issues: string[];
}

export type ExpedienteStatus = "en_progreso" | "completado" | "archivado";

export interface UpsertExpedienteParams {
  expedienteId?: string | null;
  rc?: string | null;
  datos?: Record<string, unknown> | null;
  versionActual?: string | null;
  status?: ExpedienteStatus;
  projectId?: string | null;
}

export type ResolveExpedienteConflictMode = "local_wins" | "remote_wins";

export interface ResolveExpedienteConflictParams {
  expedienteId: string;
  localDatos?: Record<string, unknown> | null;
  mode: ResolveExpedienteConflictMode;
  expectedVersion?: string | null;
}

export type UpsertExpedienteResult =
  | {
      ok: true;
      id: string;
      organizationId: string;
      rc: string;
      status: ExpedienteStatus;
      versionToken: string;
      updatedAt: string;
      lastSyncedAt: string | null;
    }
  | {
      ok: false;
      error: string;
      hint?: string;
    };

export type ResolveExpedienteConflictResult =
  | {
      ok: true;
      action: ResolveExpedienteConflictMode;
      id: string;
      versionToken: string;
      updatedAt: string;
    }
  | {
      ok: false;
      error: string;
      hint?: string;
    };

export interface ExpedienteMvpRecord {
  id: string;
  rc: string;
  status: ExpedienteStatus;
  versionToken: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Cliente Supabase (singleton)
// ---------------------------------------------------------------------------
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
const SUPABASE_STORAGE_KEY = "omnicatastro.auth.token";
const AUTH_STORAGE_MODE = String(import.meta.env.VITE_AUTH_STORAGE_MODE ?? "session").toLowerCase();

function isStorageWritable(storage: Storage): boolean {
  try {
    const probeKey = "__oc_auth_probe__";
    storage.setItem(probeKey, "1");
    storage.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
}

function resolveAuthStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;

  const preferred =
    AUTH_STORAGE_MODE === "local"
      ? [window.localStorage, window.sessionStorage]
      : [window.sessionStorage, window.localStorage];

  for (const candidate of preferred) {
    if (isStorageWritable(candidate)) return candidate;
  }

  return undefined;
}

const authStorage = resolveAuthStorage();

export const supabase: SupabaseClient =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          autoRefreshToken: true,
          persistSession: Boolean(authStorage),
          storage: authStorage,
          storageKey: SUPABASE_STORAGE_KEY,
        },
      })
    : (null as unknown as SupabaseClient);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Comprueba si una fecha de expiración ya pasó */
function isExpired(expirationDate: string | null | undefined): boolean {
  if (!expirationDate) return false; // sin fecha = no caduca
  return new Date(expirationDate) < new Date();
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeRcKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Inicia sesión con email/password y valida la licencia del usuario.
 */
export async function loginWithEmail(email: string, password: string): Promise<LoginResult> {
  if (!supabase) return { valid: false, message: "Supabase no configurado." };

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return { valid: false, message: error?.message ?? "Credenciales inválidas." };
  }

  // Buscar licencia asociada al user_id
  const { data: licenses } = await supabase
    .from("licenses")
    .select("license_key, tier, status, expiration_date")
    .eq("user_id", data.user.id)
    .eq("status", "active")
    .limit(1);

  if (!licenses || licenses.length === 0) {
    return { valid: false, message: "No hay licencia activa asociada a este usuario." };
  }

  const lic = licenses[0];

  // Validar expiración (status puede ser 'active' pero fecha pasada)
  if (isExpired(lic.expiration_date)) {
    return { valid: false, message: "Tu licencia ha caducado." };
  }

  return {
    valid: true,
    tier: lic.tier as LicenseTier,
    licenseKey: lic.license_key,
  };
}

/**
 * Restaura sesión existente tras recarga (F5) usando el token auth persistido.
 */
export async function restoreSessionFromAuth(): Promise<LoginResult> {
  if (!supabase) return { valid: false, message: "Supabase no configurado." };

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) {
    // Si el token local está corrupto/forjado, limpiar estado local evita bucles de sesión inválida.
    if (/jwt|token|session/i.test(userError.message)) {
      await supabase.auth.signOut({ scope: "local" });
    }
    return { valid: false, message: "Sesion no detectada." };
  }

  if (!userData?.user) {
    return { valid: false, message: "Sesion no detectada." };
  }

  const { data: licenses, error: licensesError } = await supabase
    .from("licenses")
    .select("license_key, tier, status, expiration_date")
    .eq("user_id", userData.user.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(25);

  if (licensesError || !licenses || licenses.length === 0) {
    return { valid: false, message: "No hay licencia activa asociada a este usuario." };
  }

  const lic = licenses.find((row) => !isExpired(row.expiration_date));
  if (!lic) {
    return { valid: false, message: "Tu licencia ha caducado." };
  }

  const tier = lic.tier as LicenseTier;
  if (tier === "desktop_only") {
    return { valid: false, message: "Esta licencia es exclusiva Desktop." };
  }

  return {
    valid: true,
    tier,
    licenseKey: lic.license_key,
  };
}

/**
 * Cierra la sesión del usuario.
 */
export async function logoutUser(): Promise<void> {
  if (!supabase) return;

  const { error } = await supabase.auth.signOut({ scope: "global" });
  if (!error) return;

  // Fallback defensivo: cerrar al menos en este dispositivo si falla la revocación remota.
  await supabase.auth.signOut({ scope: "local" });
}

/**
 * Valida una license key directamente.
 * Requiere sesión activa (authenticated) para que la RLS policy
 * `auth.uid() = user_id` permita la lectura. Sin sesión, la query
 * devuelve 0 rows por diseño (no hay policy anon en 'licenses').
 */
export async function validateUserLicense(licenseKey: string): Promise<LoginResult> {
  if (!supabase) return { valid: false, message: "Supabase no configurado." };

  // Verificar que hay sesión activa — sin auth, RLS bloquea lectura
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) {
    return { valid: false, message: "Debes iniciar sesión primero." };
  }

  const { data, error } = await supabase
    .from("licenses")
    .select("license_key, tier, status, expiration_date")
    .eq("license_key", licenseKey)
    .eq("user_id", userData.user.id) // defensa explícita + RLS
    .eq("status", "active")
    .limit(1);

  if (error || !data || data.length === 0) {
    return { valid: false, message: "Licencia no encontrada o inactiva." };
  }

  const lic = data[0];

  // Validar expiración
  if (isExpired(lic.expiration_date)) {
    return { valid: false, message: "Tu licencia ha caducado." };
  }

  const tier = lic.tier as LicenseTier;

  if (tier === "desktop_only") {
    return { valid: false, message: "Esta licencia es exclusiva Desktop." };
  }

  return { valid: true, tier, licenseKey: lic.license_key };
}

/**
 * Resuelve organization_id del usuario autenticado.
 * Prioridad:
 * 1) JWT app_metadata (org_id / organization_id)
 * 2) Licencia activa del propio usuario (fallback)
 */
export async function getCurrentOrganizationId(): Promise<string | null> {
  if (!supabase) return null;

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) return null;

  const appMeta = (userData.user.app_metadata ?? {}) as Record<string, unknown>;
  const fromJwt = appMeta.org_id ?? appMeta.organization_id;
  if (typeof fromJwt === "string" && fromJwt.trim()) {
    return fromJwt;
  }

  const pickOrgId = (
    rows: Array<{ organization_id?: unknown }> | null | undefined
  ): string | null => {
    if (!rows || rows.length === 0) return null;
    for (const row of rows) {
      const orgId = row?.organization_id;
      if (typeof orgId === "string" && orgId.trim()) {
        return orgId;
      }
    }
    return null;
  };

  const { data: licenses, error: licError } = await supabase
    .from("licenses")
    .select("organization_id")
    .eq("user_id", userData.user.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(25);

  if (!licError) {
    const orgFromUserLicenses = pickOrgId(licenses as Array<{ organization_id?: unknown }> | null);
    if (orgFromUserLicenses) return orgFromUserLicenses;
  }

  // Fallback legacy: algunos asientos antiguos pueden tener user_email sin user_id
  const userEmail = userData.user.email?.trim().toLowerCase() ?? "";
  if (userEmail) {
    const { data: licensesByEmail, error: emailLicError } = await supabase
      .from("licenses")
      .select("organization_id")
      .eq("user_email", userEmail)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(25);

    if (!emailLicError) {
      const orgFromEmailLicenses = pickOrgId(
        licensesByEmail as Array<{ organization_id?: unknown }> | null
      );
      if (orgFromEmailLicenses) return orgFromEmailLicenses;
    }
  }

  // Fallback operativo: si el usuario ya tiene proyectos, heredar su organization_id
  const { data: projects, error: projError } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("license_user_id", userData.user.id)
    .order("created_at", { ascending: false })
    .limit(25);

  if (!projError) {
    const orgFromProjects = pickOrgId(projects as Array<{ organization_id?: unknown }> | null);
    if (orgFromProjects) return orgFromProjects;
  }

  return null;
}

/**
 * Snapshot de salud UX para guiar al usuario cuando queda atascado.
 * No lanza errores: devuelve issues legibles para mostrar en UI.
 */
export async function getUxRecoverySnapshot(): Promise<UxRecoverySnapshot> {
  const snapshot: UxRecoverySnapshot = {
    isAuthenticated: false,
    userEmail: null,
    organizationId: null,
    clientsCount: null,
    projectsCount: null,
    issues: [],
  };

  if (!supabase) {
    snapshot.issues.push("Supabase no esta configurado en este entorno.");
    return snapshot;
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    snapshot.issues.push("Sesion no detectada. Vuelve a iniciar sesion.");
    return snapshot;
  }

  snapshot.isAuthenticated = true;
  snapshot.userEmail = userData.user.email ?? null;

  const orgId = await getCurrentOrganizationId();
  snapshot.organizationId = orgId;
  if (!orgId) {
    snapshot.issues.push("No se encontro empresa activa para esta sesion.");
  }

  const { count: clientsCount, error: clientsErr } = await supabase
    .from("clients")
    .select("id", { count: "exact", head: true });

  if (clientsErr) {
    snapshot.issues.push("No se pudo leer clientes para este usuario.");
  } else {
    snapshot.clientsCount = clientsCount ?? 0;
  }

  const { count: projectsCount, error: projectsErr } = await supabase
    .from("projects")
    .select("id", { count: "exact", head: true });

  if (projectsErr) {
    snapshot.issues.push("No se pudo leer proyectos para este usuario.");
  } else {
    snapshot.projectsCount = projectsCount ?? 0;
  }

  return snapshot;
}

/**
 * MVP anti-loss RPC wrapper.
 * No reemplaza el guardado actual de borradores: habilita integracion gradual.
 */
export async function upsertExpedienteMvp(
  params: UpsertExpedienteParams
): Promise<UpsertExpedienteResult> {
  if (!supabase) {
    return { ok: false, error: "SUPABASE_NOT_CONFIGURED", hint: "Supabase no configurado." };
  }

  const { data, error } = await supabase.rpc("upsert_expediente", {
    p_expediente_id: params.expedienteId ?? null,
    p_rc: params.rc ?? null,
    p_datos: params.datos ?? null,
    p_version_actual: params.versionActual ?? null,
    p_status: params.status ?? "en_progreso",
    p_project_id: params.projectId ?? null,
  });

  if (error) {
    return {
      ok: false,
      error: error.code ?? "RPC_ERROR",
      hint: error.message,
    };
  }

  const payload = asRecord(data);
  if (!payload) {
    return {
      ok: false,
      error: "INVALID_RPC_RESPONSE",
      hint: "Respuesta RPC no valida.",
    };
  }

  if (payload.ok !== true) {
    return {
      ok: false,
      error: asStringOrNull(payload.error) ?? "UNKNOWN_ERROR",
      hint: asStringOrNull(payload.hint) ?? undefined,
    };
  }

  return {
    ok: true,
    id: asStringOrNull(payload.id) ?? "",
    organizationId: asStringOrNull(payload.organization_id) ?? "",
    rc: asStringOrNull(payload.rc) ?? "",
    status: (asStringOrNull(payload.status) as ExpedienteStatus | null) ?? "en_progreso",
    versionToken: asStringOrNull(payload.version_token) ?? "",
    updatedAt: asStringOrNull(payload.updated_at) ?? "",
    lastSyncedAt: asStringOrNull(payload.last_synced_at),
  };
}

/**
 * Busca un expediente MVP por RC para recuperar id/version_token.
 * Devuelve null si no existe o si la tabla aún no está desplegada.
 */
export async function getExpedienteMvpByRc(rc: string): Promise<ExpedienteMvpRecord | null> {
  if (!supabase) return null;

  const rcNormalized = normalizeRcKey(rc);
  if (!rcNormalized) return null;

  const { data, error } = await supabase
    .from("expedientes")
    .select("id, rc, status, version_token, updated_at")
    .eq("rc", rcNormalized)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: asStringOrNull(data.id) ?? "",
    rc: asStringOrNull(data.rc) ?? rcNormalized,
    status: (asStringOrNull(data.status) as ExpedienteStatus | null) ?? "en_progreso",
    versionToken: asStringOrNull(data.version_token) ?? "",
    updatedAt: asStringOrNull(data.updated_at) ?? "",
  };
}

/**
 * Resuelve conflictos de forma atómica en servidor para evitar race client-side
 * entre fetch de contexto y escritura final.
 */
export async function resolveExpedienteMvpConflict(
  params: ResolveExpedienteConflictParams
): Promise<ResolveExpedienteConflictResult> {
  if (!supabase) {
    return { ok: false, error: "SUPABASE_NOT_CONFIGURED", hint: "Supabase no configurado." };
  }

  const nextCall = await supabase.rpc("resolve_expediente_conflict", {
    p_expediente_id: params.expedienteId,
    p_local_datos: params.localDatos ?? null,
    p_resolution: params.mode,
    p_expected_version: params.expectedVersion ?? null,
  });

  let data = nextCall.data;
  let error = nextCall.error;

  const hintPreview = error?.message ?? "";
  const codePreview = error?.code ?? "";
  const maybeLegacyRpc =
    codePreview === "PGRST202" ||
    /resolve_expediente_conflict\(p_expediente_id, p_local_datos, p_resolution, p_expected_version\)|could not find the function/i.test(
      hintPreview
    );

  if (error && maybeLegacyRpc) {
    const fallbackCall = await supabase.rpc("resolve_expediente_conflict", {
      p_expediente_id: params.expedienteId,
      p_local_datos: params.localDatos ?? null,
      p_resolution: params.mode,
    });

    data = fallbackCall.data;
    error = fallbackCall.error;
  }

  if (error) {
    const hint = error.message ?? "RPC error";
    const code = error.code ?? "RPC_ERROR";
    const notAvailable =
      code === "PGRST202" || /could not find the function|resolve_expediente_conflict/i.test(hint);
    if (notAvailable) {
      return {
        ok: false,
        error: "RPC_NOT_AVAILABLE",
        hint,
      };
    }

    return {
      ok: false,
      error: code,
      hint,
    };
  }

  const payload = asRecord(data);
  if (!payload) {
    return {
      ok: false,
      error: "INVALID_RPC_RESPONSE",
      hint: "Respuesta RPC no valida.",
    };
  }

  if (payload.ok !== true) {
    return {
      ok: false,
      error: asStringOrNull(payload.error) ?? "UNKNOWN_ERROR",
      hint: asStringOrNull(payload.hint) ?? undefined,
    };
  }

  return {
    ok: true,
    action: (asStringOrNull(payload.action) as ResolveExpedienteConflictMode | null) ?? params.mode,
    id: asStringOrNull(payload.id) ?? params.expedienteId,
    versionToken: asStringOrNull(payload.version_token) ?? "",
    updatedAt: asStringOrNull(payload.updated_at) ?? "",
  };
}
