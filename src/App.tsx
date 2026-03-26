import { useState } from 'react';
import { Shield, Sparkles, Database, Layers, ArrowLeft, Loader2 } from 'lucide-react';
import { loginWithEmail, logoutUser, validateUserLicense } from './lib/supabase';
import type { LicenseTier } from './lib/supabase';
import { LandingPage } from './LandingPage';
import { DashboardLayout } from './components/DashboardLayout';

type AppView = 'landing' | 'login' | 'dashboard';

function App() {
  const showDemoMode = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO_MODE === 'true';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [view, setView] = useState<AppView>('landing');
  const [isValidating, setIsValidating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sessionTier, setSessionTier] = useState<LicenseTier>('pwa_only');
  const [sessionKey, setSessionKey] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      // Intentar fallback con token (Legacy desktop) si el formato parece key
      if (email.trim().startsWith('OMNI-') && !password) {
        setIsValidating(true);
        setErrorMsg(null);
        try {
          const result = await validateUserLicense(email.trim());
          if (result.valid) {
            setSessionTier(result.tier || 'pwa_only');
            setSessionKey(email.trim());
            setView('dashboard');
          } else {
            setErrorMsg(result.message || 'Licencia inválida.');
          }
        } catch (err) { setErrorMsg('Error de conexión.'); }
        finally { setIsValidating(false); }
        return;
      }
      return;
    }

    setIsValidating(true);
    setErrorMsg(null);

    try {
      const result = await loginWithEmail(email.trim(), password);
      if (result.valid) {
        setSessionTier(result.tier || 'pwa_only');
        setSessionKey(result.licenseKey || '');
        setView('dashboard');
      } else {
        setErrorMsg(result.message || 'Credenciales inválidas.');
      }
    } catch (err) {
      setErrorMsg('Error de conexión durante validación.');
    } finally {
      setIsValidating(false);
    }
  };

  const handleLogout = async () => {
    await logoutUser();
    setView('landing');
    setEmail('');
    setPassword('');
    setSessionKey('');
    setErrorMsg(null);
  };

  // --- LANDING PAGE ---
  if (view === 'landing') {
    return <LandingPage onLoginClick={() => setView('login')} />;
  }

  // --- DASHBOARD (RUTA PROTEGIDA) ---
  if (view === 'dashboard') {
    return (
      <DashboardLayout
        licenseKey={sessionKey}
        tier={sessionTier}
        onLogout={handleLogout}
      />
    );
  }

  // --- LOGIN ---
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden bg-[#0A0A0A]">
      {/* Back button */}
      <button
        onClick={() => setView('landing')}
        className="absolute top-6 left-6 flex items-center gap-2 text-gray-400 hover:text-white transition-colors z-50 group"
      >
        <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
        Volver
      </button>

      {/* Background decorations */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/20 rounded-full blur-[120px] pointer-events-none" />

      <main className="w-full max-w-md relative z-10">
        <div className="text-center mb-10 animate-float">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 mb-6 shadow-2xl shadow-blue-500/20">
            <Layers className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight mb-3 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
            OmniCatastro Web
          </h1>
          <p className="text-muted-foreground text-lg">
            Plataforma Profesional PWA
          </p>
        </div>

        <div className="glass-panel p-8 mb-8 relative">
          <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent rounded-2xl pointer-events-none" />

          <form className="relative z-10" onSubmit={handleSubmit}>
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/80 ml-1">
                  Correo Electrónico
                </label>
                <div className="relative">
                  <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input
                    type="email"
                    placeholder="tecnico@empresa.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-black/20 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/80 ml-1">
                  Contraseña
                </label>
                <div className="relative">
                  <Shield className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-black/20 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-mono"
                  />
                </div>
              </div>

              {errorMsg && (
                <div className="text-red-400 text-sm font-medium bg-red-500/10 p-3 rounded-lg border border-red-500/20 text-center animate-in fade-in zoom-in duration-300">
                  {errorMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={isValidating || !email.trim() || !password.trim()}
                className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-semibold rounded-xl py-3.5 shadow-lg shadow-blue-500/25 transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
              >
                {isValidating ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Shield className="w-5 h-5" />
                )}
                {isValidating ? 'Validando...' : 'Ingresar al Dashboard'}
              </button>
            </div>
          </form>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="glass-panel p-4 flex flex-col items-center justify-center text-center gap-2 hover:bg-white/10 transition-colors cursor-default">
            <Database className="w-6 h-6 text-blue-400" />
            <span className="text-sm font-medium text-muted-foreground">Conexión Sync</span>
          </div>
          <div className="glass-panel p-4 flex flex-col items-center justify-center text-center gap-2 hover:bg-white/10 transition-colors cursor-default">
            <Sparkles className="w-6 h-6 text-purple-400" />
            <span className="text-sm font-medium text-muted-foreground">IA Integrada</span>
          </div>
        </div>

        {showDemoMode && (
          <button
            onClick={() => {
              setSessionTier('suite_pro');
              setSessionKey('DEMO-MODE');
              setView('dashboard');
            }}
            className="mt-4 w-full text-xs text-slate-600 hover:text-slate-400 transition-colors py-2 border border-dashed border-slate-800 rounded-lg"
          >
            Modo Demo (solo desarrollo)
          </button>
        )}
      </main>
    </div>
  );
}

export default App;
