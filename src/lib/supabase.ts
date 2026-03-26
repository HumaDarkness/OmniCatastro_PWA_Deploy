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

// ---------------------------------------------------------------------------
// Cliente Supabase (singleton)
// ---------------------------------------------------------------------------
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

export const supabase: SupabaseClient =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : (null as unknown as SupabaseClient);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Comprueba si una fecha de expiración ya pasó */
function isExpired(expirationDate: string | null | undefined): boolean {
  if (!expirationDate) return false; // sin fecha = no caduca
  return new Date(expirationDate) < new Date();
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Inicia sesión con email/password y valida la licencia del usuario.
 */
export async function loginWithEmail(
  email: string,
  password: string
): Promise<LoginResult> {
  if (!supabase)
    return { valid: false, message: "Supabase no configurado." };

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
 * Cierra la sesión del usuario.
 */
export async function logoutUser(): Promise<void> {
  if (supabase) {
    await supabase.auth.signOut();
  }
}

/**
 * Valida una license key directamente.
 * Requiere sesión activa (authenticated) para que la RLS policy
 * `auth.uid() = user_id` permita la lectura. Sin sesión, la query
 * devuelve 0 rows por diseño (no hay policy anon en 'licenses').
 */
export async function validateUserLicense(
  licenseKey: string
): Promise<LoginResult> {
  if (!supabase)
    return { valid: false, message: "Supabase no configurado." };

  // Verificar que hay sesión activa — sin auth, RLS bloquea lectura
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) {
    return { valid: false, message: "Debes iniciar sesión primero." };
  }

  const { data, error } = await supabase
    .from("licenses")
    .select("license_key, tier, status, expiration_date")
    .eq("license_key", licenseKey)
    .eq("user_id", userData.user.id)  // defensa explícita + RLS
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

  const pickOrgId = (rows: Array<{ organization_id?: unknown }> | null | undefined): string | null => {
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
      const orgFromEmailLicenses = pickOrgId(licensesByEmail as Array<{ organization_id?: unknown }> | null);
      if (orgFromEmailLicenses) return orgFromEmailLicenses;
    }
  }

  // Fallback operativo: si el usuario ya tiene proyectos, heredar su organization_id
  const { data: projects, error: projError } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("created_by", userData.user.id)
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
