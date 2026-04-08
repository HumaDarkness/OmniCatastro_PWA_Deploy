import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

let supabase: SupabaseClient | null = null;

if (supabaseUrl && supabaseAnonKey) {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
} else {
    console.warn("[OmniCatastro] Supabase no configurado. La Landing Page funcionará sin conexión a BD.");
}

export { supabase };

export type LicenseTier = 'desktop_only' | 'pwa_only' | 'suite_pro';

export interface LicenseValidationResult {
    valid: boolean;
    message?: string;
    tier?: LicenseTier;
    expires_at?: string;
    licenseKey?: string;
}

/**
 * Iniciar sesión con Email y Contraseña (Flujo PWA).
 * Devuelve el token Auth y busca la licencia asignada al usuario.
 */
export async function loginWithEmail(email: string, password: string): Promise<LicenseValidationResult> {
    if (!supabase) {
        return { valid: false, message: 'Servidor Supabase no configurado.' };
    }

    try {
        // 1. Iniciar sesión en Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (authError) throw authError;
        if (!authData.user) throw new Error('Usuario no encontrado tras login.');

        // 2. Buscar licencia activa ('pwa') asociada al User ID
        const { data: license, error: licenseError } = await supabase
            .from('licenses')
            .select('*')
            .eq('user_id', authData.user.id)
            .eq('status', 'active')
            .eq('seat_type', 'pwa')
            .maybeSingle();

        if (licenseError) throw licenseError;
        if (!license) {
            // Si no tiene licencia válida, cerrar sesion
            await supabase.auth.signOut();
            return { valid: false, message: 'No tienes una licencia PWA activa asignada.' };
        }

        return {
            valid: true,
            tier: license.tier as LicenseTier,
            expires_at: license.expiration_date,
            licenseKey: license.license_key,
        };
    } catch (error: any) {
        console.error('Error loginWithEmail:', error);
        return { valid: false, message: error.message || 'Credenciales incorrectas o error de conexión.' };
    }
}

/**
 * Cerrar sesión del usuario actual
 */
export async function logoutUser(): Promise<void> {
    if (supabase) {
        await supabase.auth.signOut();
    }
}

/**
 * Validar licencia del usuario invocando el RPC validate_license de Supabase (Legacy Desktop/Fallback)
 */
export async function validateUserLicense(
    licenseKey: string,
    hardwareId: string = 'pwa-browser-client'
): Promise<LicenseValidationResult> {
    if (!supabase) {
        return { valid: false, message: 'Servidor no configurado. Contacte al administrador.' };
    }

    try {
        const { data, error } = await supabase.rpc('validate_license', {
            p_license_key: licenseKey,
            p_hardware_id: hardwareId,
        });

        if (error) throw error;

        if (data === false) {
            return { valid: false, message: 'Licencia inválida, expirada o en uso por otro dispositivo.' };
        }

        // Normalizar: si es string, parsear; si es objeto, usar directamente
        let parsed: any;
        if (typeof data === 'string') {
            try {
                parsed = JSON.parse(data);
            } catch (e) {
                console.error('Error parseando validate_license:', e);
                return { valid: false, message: 'Respuesta inválida del servidor.' };
            }
        } else if (typeof data === 'object' && data !== null) {
            parsed = data;
        } else {
            return { valid: false, message: 'Respuesta inesperada del servidor.' };
        }

        // Verificar campo "success" (formato alternativo) o "valid"
        const isValid = parsed.valid === true || parsed.success === true;
        if (!isValid) {
            return { valid: false, message: parsed.message || parsed.status || 'Licencia rechazada por el servidor.' };
        }

        const tier = (parsed.tier as LicenseTier) || 'pwa_only';
        if (tier === 'desktop_only') {
            return { valid: false, message: 'Licencia exclusiva Desktop. No válida para Web (PWA).' };
        }

        return {
            valid: true,
            tier: tier,
            expires_at: parsed.expires_at || parsed.exp_date,
            message: parsed.message,
        };
    } catch (error: any) {
        console.error('Error validando licencia:', error);
        return { valid: false, message: error.message || 'Error de conexión con el servidor.' };
    }
}
