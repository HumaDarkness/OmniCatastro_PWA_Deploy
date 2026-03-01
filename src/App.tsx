import React, { useState, useEffect } from 'react';
import { loginWithEmail, logoutUser, LicenseValidationResult, supabase } from './lib/supabase';
import { DashboardLayout } from './components/DashboardLayout';
import { LayoutDashboard, LogIn, Mail, Lock, ShieldCheck, ArrowRight, Layers, Smartphone, Sparkles, Globe } from 'lucide-react';
import './App.css';

function App() {
  const [session, setSession] = useState<any>(null);
  const [license, setLicense] = useState<LicenseValidationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [view, setView] = useState<'landing' | 'login'>('landing');

  useEffect(() => {
    // Escuchar cambios de sesión
    if (supabase) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        setSession(session);
        if (session) checkLicense(session.user.id);
        else setLoading(false);
      });

      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        setSession(session);
        if (session) checkLicense(session.user.id);
        else {
          setLicense(null);
          setLoading(false);
        }
      });

      return () => subscription.unsubscribe();
    } else {
      setLoading(false);
    }
  }, []);

  async function checkLicense(userId: string) {
    try {
      const { data, error } = await supabase!
        .from('licenses')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .eq('seat_type', 'pwa')
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setLicense({
          valid: true,
          tier: data.tier,
          expires_at: data.expiration_date,
          licenseKey: data.license_key
        });
      }
    } catch (err) {
      console.error('Error checking license:', err);
    } finally {
      setLoading(false);
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const result = await loginWithEmail(email, password);
    if (result.valid) {
      setLicense(result);
    } else {
      setError(result.message || 'Error de autenticación');
    }
  };

  const handleLogout = async () => {
    await logoutUser();
    setSession(null);
    setLicense(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#060612] flex items-center justify-center">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin"></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <Layers className="w-6 h-6 text-indigo-400" />
          </div>
        </div>
      </div>
    );
  }

  // Si hay sesión y licencia (o si estamos testeando y forzamos)
  if (session && license?.valid) {
    return <DashboardLayout
      licenseKey={license.licenseKey || ''}
      tier={license.tier || 'pwa_only'}
      onLogout={handleLogout}
    />;
  }

  // Vista de Login
  if (view === 'login') {
    return (
      <div className="min-h-screen bg-[#060612] flex items-center justify-center p-4">
        <div className="w-full max-w-md animate-in fade-in zoom-in duration-300">
          <div className="bg-[#0A0A1A] border border-slate-800 rounded-2xl p-8 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-600/10 blur-3xl -z-10"></div>

            <div className="flex flex-col items-center mb-8">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 mb-4 transition-transform hover:scale-105">
                <ShieldCheck className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold text-white">Bienvenido</h2>
              <p className="text-slate-400 text-sm mt-1">Acceso Profesional OmniCatastro</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-300 ml-1">Correo Electrónico</label>
                <div className="relative group">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within:text-indigo-400 transition-colors" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-[#060612]/50 border border-slate-800/80 rounded-xl py-3 pl-11 pr-4 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 transition-all hover:bg-[#060612]/80"
                    placeholder="ejemplo@empresa.com"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center ml-1">
                  <label className="text-sm font-medium text-slate-300">Contraseña</label>
                  <button type="button" className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">¿Olvidaste tu contraseña?</button>
                </div>
                <div className="relative group">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within:text-indigo-400 transition-colors" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-[#060612]/50 border border-slate-800/80 rounded-xl py-3 pl-11 pr-4 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50 transition-all hover:bg-[#060612]/80"
                    placeholder="••••••••"
                    required
                  />
                </div>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-red-400 text-sm animate-in shake">
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-indigo-600/20 active:scale-[0.98] flex items-center justify-center gap-2 mt-4"
              >
                Entrar al Sistema
                <ArrowRight className="w-5 h-5" />
              </button>
            </form>

            <button
              onClick={() => setView('landing')}
              className="w-full mt-6 text-slate-500 hover:text-white text-sm py-2 transition-colors"
            >
              ← Volver a la página principal
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Landing Page (Hermosa y Moderna)
  return (
    <div className="min-h-screen bg-[#060612] text-white selection:bg-indigo-500/30 selection:text-indigo-200 overflow-x-hidden">
      {/* Background Orbs */}
      <div className="fixed top-0 left-0 w-full h-full -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/10 rounded-full blur-[120px] animate-pulse"></div>
        <div className="absolute bottom-[10%] right-[-5%] w-[30%] h-[30%] bg-purple-600/10 rounded-full blur-[100px] animate-pulse"></div>
      </div>

      {/* Nav */}
      <nav className="container mx-auto px-6 py-8 flex items-center justify-between relative z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight">OmniCatastro <span className="text-indigo-400">PWA</span></span>
        </div>
        <button
          onClick={() => setView('login')}
          className="bg-white/5 hover:bg-white/10 backdrop-blur-md border border-white/10 px-6 py-2.5 rounded-full font-semibold transition-all hover:scale-105 active:scale-95"
        >
          Iniciar Sesión
        </button>
      </nav>

      {/* Hero Section */}
      <main className="container mx-auto px-6 pt-12 pb-24 relative z-10">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div className="space-y-8 animate-in slide-in-from-left duration-700">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-bold uppercase tracking-wider">
              <Sparkles className="w-3 h-3" /> v9.0 Pro Edition
            </div>

            <h1 className="text-5xl lg:text-7xl font-extrabold leading-[1.1] tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white via-white to-slate-500">
              La oficina técnica en tu <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-blue-400">dispositivo</span>.
            </h1>

            <p className="text-lg text-slate-400 max-w-lg leading-relaxed">
              Consulta el catastro, calcula eficiencias energéticas y gestiona certificados CAE desde cualquier lugar con nuestra solución web progresiva.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <button
                onClick={() => setView('login')}
                className="bg-indigo-600 hover:bg-indigo-500 px-8 py-4 rounded-2xl font-bold text-lg transition-all shadow-xl shadow-indigo-600/30 flex items-center justify-center gap-3 group"
              >
                Comenzar ahora
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </button>
              <button className="bg-white/5 hover:bg-white/10 border border-white/10 px-8 py-4 rounded-2xl font-bold text-lg transition-all flex items-center justify-center gap-3">
                <Smartphone className="w-5 h-5 text-indigo-400" />
                Instalar App
              </button>
            </div>

            <div className="flex items-center gap-6 pt-8 text-slate-500">
              <div className="flex flex-col">
                <span className="text-2xl font-bold text-white">100%</span>
                <span className="text-xs uppercase tracking-widest mt-1">Sincronizado</span>
              </div>
              <div className="w-px h-10 bg-slate-800"></div>
              <div className="flex flex-col">
                <span className="text-2xl font-bold text-white">CAE</span>
                <span className="text-xs uppercase tracking-widest mt-1">Homologado</span>
              </div>
              <div className="w-px h-10 bg-slate-800"></div>
              <div className="flex flex-col">
                <span className="text-2xl font-bold text-white">Offline</span>
                <span className="text-xs uppercase tracking-widest mt-1">Disponible</span>
              </div>
            </div>
          </div>

          {/* Visual Showcase */}
          <div className="relative animate-in slide-in-from-right duration-1000">
            <div className="absolute inset-0 bg-indigo-500/20 blur-[100px] rounded-full scale-75 animate-pulse"></div>
            <div className="relative bg-[#0A0A1A] border border-slate-800 rounded-3xl p-4 shadow-3xl overflow-hidden group">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-indigo-500 to-transparent"></div>
              <div className="rounded-2xl overflow-hidden aspect-[4/3] bg-slate-900 flex items-center justify-center relative">
                <img
                  src="/hero_b2b.png"
                  alt="App Interface"
                  className="w-full h-full object-cover opacity-80 group-hover:scale-110 transition-transform duration-1000"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <div className="px-6 py-3 bg-white/10 backdrop-blur-md rounded-full border border-white/20 text-white font-semibold">
                    Vista previa de Dashboard
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="container mx-auto px-6 py-12 border-t border-slate-900 mt-12 flex flex-col md:row items-center justify-between text-slate-500 text-sm gap-6">
        <p>© 2026 OmniCatastro Suite. Todos los derechos reservados.</p>
        <div className="flex items-center gap-8">
          <a href="#" className="hover:text-indigo-400 transition-colors">Aviso Legal</a>
          <a href="#" className="hover:text-indigo-400 transition-colors">Privacidad</a>
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4" />
            <span>ES</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
