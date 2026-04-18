import { useEffect, useRef, useState } from "react";
import {
  FileText,
  LayoutDashboard,
  Settings,
  LogOut,
  Layers,
  ChevronLeft,
  ChevronRight,
  Calculator,
  Building2,
  Users,
  RefreshCw,
  CircleAlert,
  CircleCheck,
  ArrowRight,
  Cloud,
  CloudOff,
  Loader2,
} from "lucide-react";
import { CentralDocumental } from "../CentralDocumental";
import { ConsultaCatastral } from "../ConsultaCatastral";
import { CalculadoraTermica } from "../CalculadoraTermica";
import { ClientesView } from "../ClientesView";
import { HojaEncargoStandaloneView } from "../HojaEncargoStandaloneView";
import { AjustesView } from "../AjustesView";
import { ResumenGeneral } from "./ResumenGeneral";
import { getUxRecoverySnapshot, type LicenseTier, type UxRecoverySnapshot } from "../lib/supabase";
import { getCloudAvailabilitySnapshot, type CloudAvailabilitySnapshot } from "../lib/apiClient";
import {
  getCatastroAvailabilitySnapshot,
  type CatastroAvailabilitySnapshot,
} from "../lib/catastroService";
import { clientSyncService } from "../lib/clientSyncService";
import { db } from "../infra/db/OmniCatastroDB";
import { useLiveQuery } from "dexie-react-hooks";

type DashboardView =
  | "resumen"
  | "central-documental"
  | "calculadora"
  | "consulta-catastral"
  | "clientes"
  | "hojas-encargo"
  | "ajustes";

const HASH_VIEWS: DashboardView[] = [
  "resumen",
  "central-documental",
  "consulta-catastral",
  "calculadora",
  "clientes",
  "hojas-encargo",
  "ajustes",
];

function parseDashboardViewFromHash(): DashboardView {
  if (typeof window === "undefined") return "resumen";
  const hashValue = window.location.hash.replace(/^#/, "") as DashboardView;
  return HASH_VIEWS.includes(hashValue) ? hashValue : "resumen";
}

interface DashboardLayoutProps {
  licenseKey: string;
  tier: LicenseTier;
  onLogout: () => void;
}

interface NavItem {
  id: DashboardView;
  label: string;
  icon: React.ReactNode;
  badge?: string;
  disabled?: boolean;
}

export function DashboardLayout({ tier, onLogout }: DashboardLayoutProps) {
  const [activeView, setActiveView] = useState<DashboardView>(() => parseDashboardViewFromHash());
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [uxSnapshot, setUxSnapshot] = useState<UxRecoverySnapshot | null>(null);
  const [uxLoading, setUxLoading] = useState(true);
  const [cloudStatus, setCloudStatus] = useState<CloudAvailabilitySnapshot>({
    state: "starting",
    checkedAt: Date.now(),
    latencyMs: null,
    fromCache: false,
    message: "Inicializando cloud...",
  });
  const [cloudChecking, setCloudChecking] = useState(false);
  const [catastroStatus, setCatastroStatus] = useState<CatastroAvailabilitySnapshot>({
    state: "offline",
    checkedAt: Date.now(),
    latencyMs: null,
    message: "Comprobando Catastro...",
    maintenanceUntil: null,
    details: null,
  });
  const [catastroChecking, setCatastroChecking] = useState(false);
  const [showServiceInfo, setShowServiceInfo] = useState(false);

  const deadLetterCount =
    useLiveQuery(() => db.sync_jobs.where("status").equals("dead_letter").count()) ?? 0;

  const navItems: NavItem[] = [
    { id: "resumen", label: "Resumen General", icon: <LayoutDashboard className="w-5 h-5" /> },
    {
      id: "central-documental",
      label: "Central Documental",
      icon: <FileText className="w-5 h-5" />,
    },
    {
      id: "consulta-catastral",
      label: "Consulta Catastral",
      icon: <Building2 className="w-5 h-5" />,
    },
    { id: "calculadora", label: "Calculadora Térmica", icon: <Calculator className="w-5 h-5" /> },
    { id: "clientes", label: "Clientes", icon: <Users className="w-5 h-5" /> },
    { id: "hojas-encargo", label: "Hojas de Encargo", icon: <FileText className="w-5 h-5" /> },
    {
      id: "ajustes",
      label: "Ajustes",
      icon: <Settings className="w-5 h-5" />,
      badge: deadLetterCount > 0 ? `${deadLetterCount} err` : undefined,
    },
  ];

  const tierLabels: Record<LicenseTier, string> = {
    desktop_only: "Desktop",
    pwa_only: "PWA Standard",
    suite_pro: "Suite Pro",
  };

  const refreshUxSnapshot = async () => {
    setUxLoading(true);
    const snapshot = await getUxRecoverySnapshot();
    setUxSnapshot(snapshot);
    setUxLoading(false);
  };

  const refreshCloudStatus = async (force = true) => {
    setCloudChecking(true);
    const snapshot = await getCloudAvailabilitySnapshot({ force });
    setCloudStatus(snapshot);
    setCloudChecking(false);
  };

  const refreshCatastroStatus = async () => {
    setCatastroChecking(true);
    const snapshot = await getCatastroAvailabilitySnapshot();
    setCatastroStatus(snapshot);
    setCatastroChecking(false);
  };

  useEffect(() => {
    let isMounted = true;

    async function loadNow() {
      const snapshot = await getUxRecoverySnapshot();
      if (!isMounted) return;
      setUxSnapshot(snapshot);
      setUxLoading(false);
    }

    loadNow();
    const timer = window.setInterval(loadNow, 45000);

    return () => {
      isMounted = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const poll = async () => {
      const snapshot = await getCatastroAvailabilitySnapshot();
      if (!isMounted) return;
      setCatastroStatus(snapshot);
      setCatastroChecking(false);
    };

    setCatastroChecking(true);
    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 90000);

    return () => {
      isMounted = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const poll = async (force = false) => {
      const snapshot = await getCloudAvailabilitySnapshot({ force });
      if (!isMounted) return;
      setCloudStatus(snapshot);
      setCloudChecking(false);
    };

    setCloudChecking(true);
    void poll(true);
    const timer = window.setInterval(() => {
      void poll(false);
    }, 60000);

    return () => {
      isMounted = false;
      window.clearInterval(timer);
    };
  }, []);

  // ── Sync Outbox Coordinator ──────────────────────────────────────────────
  const syncRunningRef = useRef(false);

  useEffect(() => {
    const drainQueue = async () => {
      if (syncRunningRef.current) return; // anti-reentry guard
      if (document.visibilityState !== "visible") return;
      syncRunningRef.current = true;
      try {
        await clientSyncService.enqueueUnsyncedClientes(100);
        await clientSyncService.recoverStaleLocks();
        await clientSyncService.processBatch({
          lockToken: crypto.randomUUID(),
          limit: 5,
          leaseMs: 30_000,
        });
      } catch (e) {
        console.warn("[SyncOutbox] drain error:", e);
      } finally {
        syncRunningRef.current = false;
      }
    };

    // Trigger 1: app-ready
    void drainQueue();

    // Trigger 2: online event
    const onOnline = () => void drainQueue();
    window.addEventListener("online", onOnline);

    // Trigger 3: periodic poll (45s)
    const timer = window.setInterval(drainQueue, 45_000);

    return () => {
      window.removeEventListener("online", onOnline);
      window.clearInterval(timer);
    };
  }, []);

  const cloudBadge = (() => {
    if (cloudChecking) {
      return {
        label: "Cloud comprobando...",
        meta: "",
        className: "border-slate-700 text-slate-300 bg-slate-900/40",
        icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
      };
    }

    if (cloudStatus.state === "active") {
      return {
        label: "Cloud activa",
        meta:
          cloudStatus.latencyMs !== null
            ? `${cloudStatus.latencyMs} ms`
            : cloudStatus.fromCache
              ? "cache"
              : "lista",
        className: "border-emerald-700/40 text-emerald-300 bg-emerald-900/20",
        icon: <Cloud className="w-3.5 h-3.5" />,
      };
    }

    if (cloudStatus.state === "starting") {
      return {
        label: "Cloud iniciando",
        meta: "reintentando",
        className: "border-amber-700/40 text-amber-300 bg-amber-900/20",
        icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
      };
    }

    return {
      label: "Cloud no disponible",
      meta: "local activo",
      className: "border-rose-700/40 text-rose-300 bg-rose-900/20",
      icon: <CloudOff className="w-3.5 h-3.5" />,
    };
  })();

  const catastroBadge = (() => {
    if (catastroChecking) {
      return {
        label: "Catastro comprobando...",
        meta: "",
        className: "border-slate-700 text-slate-300 bg-slate-900/40",
        icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
      };
    }

    if (catastroStatus.state === "active") {
      return {
        label: "Catastro activo",
        meta: catastroStatus.latencyMs !== null ? `${catastroStatus.latencyMs} ms` : "operativo",
        className: "border-emerald-700/40 text-emerald-300 bg-emerald-900/20",
        icon: <Building2 className="w-3.5 h-3.5" />,
      };
    }

    if (catastroStatus.state === "maintenance") {
      return {
        label: "Catastro mantenimiento",
        meta: catastroStatus.maintenanceUntil
          ? `hasta ${catastroStatus.maintenanceUntil}`
          : "en curso",
        className: "border-amber-700/40 text-amber-300 bg-amber-900/20",
        icon: <CircleAlert className="w-3.5 h-3.5" />,
      };
    }

    return {
      label: "Catastro no disponible",
      meta: "reintento",
      className: "border-rose-700/40 text-rose-300 bg-rose-900/20",
      icon: <CloudOff className="w-3.5 h-3.5" />,
    };
  })();

  const formatCheckedAt = (timestamp: number): string =>
    new Date(timestamp).toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextHash = `#${activeView}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", nextHash);
    }
  }, [activeView]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onHashChange = () => {
      const nextView = parseDashboardViewFromHash();
      setActiveView((current) => (current === nextView ? current : nextView));
    };

    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const suggestedAction = (() => {
    if (!uxSnapshot) return null;
    if (!uxSnapshot.isAuthenticated) {
      return { label: "Cerrar sesion y volver a entrar", onClick: onLogout };
    }
    if (!uxSnapshot.organizationId) {
      return {
        label: "Abrir Clientes para comprobar flujo",
        onClick: () => setActiveView("clientes"),
      };
    }
    if ((uxSnapshot.clientsCount ?? 0) === 0) {
      return { label: "Crear primer cliente", onClick: () => setActiveView("clientes") };
    }
    if (activeView !== "calculadora") {
      return { label: "Continuar en Calculadora", onClick: () => setActiveView("calculadora") };
    }
    return null;
  })();

  const renderNonCalculatorView = () => {
    switch (activeView) {
      case "resumen":
        return <ResumenGeneral />;
      case "central-documental":
        return <CentralDocumental />;
      case "consulta-catastral":
        return <ConsultaCatastral />;
      case "clientes":
        return <ClientesView />;
      case "hojas-encargo":
        return <HojaEncargoStandaloneView />;
      case "ajustes":
        return <AjustesView />;
      default:
        return (
          <div className="flex items-center justify-center h-full text-slate-500">
            <div className="text-center space-y-4">
              <div className="text-6xl opacity-20">🚧</div>
              <h3 className="text-xl font-semibold text-slate-300">Módulo en Desarrollo</h3>
              <p>Este módulo estará disponible pronto.</p>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="flex h-screen bg-[#060612] text-slate-200 overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`relative flex flex-col border-r border-slate-800/50 bg-[#0A0A1A] transition-all duration-300 ease-in-out ${
          sidebarOpen ? "w-64" : "w-[72px]"
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 h-16 border-b border-slate-800/50 shrink-0">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-blue-500/20 shrink-0">
            <Layers className="w-5 h-5 text-white" />
          </div>
          {sidebarOpen && (
            <div className="animate-in fade-in slide-in-from-left-2 duration-200">
              <h1 className="font-bold text-sm text-white tracking-tight">OmniCatastro</h1>
              <p className="text-[10px] text-slate-500 font-medium uppercase tracking-widest">
                {tierLabels[tier]}
              </p>
            </div>
          )}
        </div>

        {/* Toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="absolute -right-3 top-20 z-50 flex items-center justify-center w-6 h-6 rounded-full bg-slate-800 border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
        >
          {sidebarOpen ? <ChevronLeft className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => !item.disabled && setActiveView(item.id)}
                disabled={item.disabled}
                title={!sidebarOpen ? item.label : undefined}
                className={`
                  w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all
                  ${
                    isActive
                      ? "bg-indigo-500/15 text-indigo-400 ring-1 ring-inset ring-indigo-500/20"
                      : item.disabled
                        ? "text-slate-600 cursor-not-allowed opacity-50"
                        : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                  }
                `}
              >
                <span className={`shrink-0 ${isActive ? "text-indigo-400" : ""}`}>{item.icon}</span>
                {sidebarOpen && (
                  <span className="truncate animate-in fade-in slide-in-from-left-2 duration-200">
                    {item.label}
                  </span>
                )}
                {sidebarOpen && item.badge && (
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-500 font-medium animate-in fade-in duration-200">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Logout footer */}
        <div className="border-t border-slate-800/50 p-2 shrink-0">
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-red-400/70 hover:bg-red-500/10 hover:text-red-400 transition-all"
            title={!sidebarOpen ? "Cerrar sesión" : undefined}
          >
            <LogOut className="w-5 h-5 shrink-0" />
            {sidebarOpen && <span className="animate-in fade-in duration-200">Cerrar Sesión</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        <div className="h-full flex flex-col">
          <div className="border-b border-indigo-500/10 bg-[#0a0a1a] px-4 md:px-6 py-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-2 text-sm">
                {uxLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 mt-0.5 animate-spin text-slate-500" />
                    <p className="text-slate-400">Analizando bloqueos UX y estado de sesion...</p>
                  </>
                ) : uxSnapshot?.issues.length ? (
                  <>
                    <CircleAlert className="w-4 h-4 mt-0.5 text-amber-400" />
                    <div className="text-slate-300">
                      <p className="font-medium">Modo rescate UX activo</p>
                      <p className="text-xs text-slate-400">{uxSnapshot.issues.join(" | ")}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <CircleCheck className="w-4 h-4 mt-0.5 text-emerald-400" />
                    <p className="text-slate-300">
                      Sesion y contexto listos.
                      {(uxSnapshot?.clientsCount ?? 0) > 0
                        ? ` Clientes: ${uxSnapshot?.clientsCount}`
                        : " Sin clientes"}
                    </p>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap justify-end">
                <div
                  className={`h-8 px-3 rounded-md border text-xs inline-flex items-center gap-1 ${cloudBadge.className}`}
                  title={cloudStatus.message}
                >
                  {cloudBadge.icon}
                  <span>{cloudBadge.label}</span>
                  {cloudBadge.meta ? <span className="opacity-80">· {cloudBadge.meta}</span> : null}
                </div>
                <div
                  className={`h-8 px-3 rounded-md border text-xs inline-flex items-center gap-1 ${catastroBadge.className}`}
                  title={catastroStatus.message}
                >
                  {catastroBadge.icon}
                  <span>{catastroBadge.label}</span>
                  {catastroBadge.meta ? (
                    <span className="opacity-80">· {catastroBadge.meta}</span>
                  ) : null}
                </div>
                <button
                  onClick={() => setShowServiceInfo((prev) => !prev)}
                  className="h-8 px-3 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 text-xs"
                >
                  {showServiceInfo ? "Ocultar info" : "Más información"}
                </button>
                {suggestedAction && (
                  <button
                    onClick={suggestedAction.onClick}
                    className="h-8 px-3 rounded-md border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/10 text-xs inline-flex items-center gap-1"
                  >
                    {suggestedAction.label}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => {
                    void refreshUxSnapshot();
                    void refreshCloudStatus(true);
                    void refreshCatastroStatus();
                  }}
                  className="h-8 px-3 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 text-xs inline-flex items-center gap-1"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Revalidar
                </button>
              </div>
            </div>

            {showServiceInfo && (
              <div className="mt-2 rounded-md border border-slate-800 bg-slate-900/40 p-3 text-xs text-slate-300 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <p className="text-slate-200 font-semibold">Cloud</p>
                  <p>Estado: {cloudStatus.message}</p>
                  <p>Última comprobación: {formatCheckedAt(cloudStatus.checkedAt)}</p>
                  {cloudStatus.latencyMs !== null && <p>Latencia: {cloudStatus.latencyMs} ms</p>}
                </div>
                <div className="space-y-1">
                  <p className="text-slate-200 font-semibold">Catastro</p>
                  <p>Estado: {catastroStatus.message}</p>
                  <p>Última comprobación: {formatCheckedAt(catastroStatus.checkedAt)}</p>
                  {catastroStatus.latencyMs !== null && (
                    <p>Latencia: {catastroStatus.latencyMs} ms</p>
                  )}
                  {catastroStatus.maintenanceUntil && (
                    <p>Mantenimiento estimado hasta: {catastroStatus.maintenanceUntil}</p>
                  )}
                  {catastroStatus.details && (
                    <p className="text-slate-400">Detalle: {catastroStatus.details}</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-hidden">
            <div className={activeView === "calculadora" ? "h-full" : "hidden"}>
              <CalculadoraTermica />
            </div>
            <div className={activeView === "calculadora" ? "hidden" : "h-full"}>
              {renderNonCalculatorView()}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
