import { useEffect, useState } from "react";
import {
    FileText,
    LayoutDashboard,
    Settings,
    LogOut,
    Layers,
    ChevronLeft,
    ChevronRight,
    Calculator,
    FileStack,
    Building2,
    Users,
    RefreshCw,
    CircleAlert,
    CircleCheck,
    ArrowRight,
} from "lucide-react";
import { CentralDocumental } from "../CentralDocumental";
import { ConsultaCatastral } from "../ConsultaCatastral";
import { CalculadoraTermica } from "../CalculadoraTermica";
import { ProyectosView } from "../ProyectosView";
import { ClientesView } from "../ClientesView";
import { getUxRecoverySnapshot, type LicenseTier, type UxRecoverySnapshot } from "../lib/supabase";

type DashboardView = "resumen" | "central-documental" | "calculadora" | "consulta-catastral" | "clientes" | "mis-proyectos" | "ajustes";

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
    const [activeView, setActiveView] = useState<DashboardView>("central-documental");
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [uxSnapshot, setUxSnapshot] = useState<UxRecoverySnapshot | null>(null);
    const [uxLoading, setUxLoading] = useState(true);

    const navItems: NavItem[] = [
        { id: "resumen", label: "Resumen General", icon: <LayoutDashboard className="w-5 h-5" />, badge: "Pronto", disabled: true },
        { id: "central-documental", label: "Central Documental", icon: <FileText className="w-5 h-5" /> },
        { id: "consulta-catastral", label: "Consulta Catastral", icon: <Building2 className="w-5 h-5" /> },
        { id: "calculadora", label: "Calculadora Térmica", icon: <Calculator className="w-5 h-5" /> },
        { id: "clientes", label: "Clientes", icon: <Users className="w-5 h-5" /> },
        { id: "mis-proyectos", label: "Mis Proyectos", icon: <FileStack className="w-5 h-5" /> },
        { id: "ajustes", label: "Ajustes", icon: <Settings className="w-5 h-5" />, badge: "Pronto", disabled: true },
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

    const suggestedAction = (() => {
        if (!uxSnapshot) return null;
        if (!uxSnapshot.isAuthenticated) {
            return { label: "Cerrar sesion y volver a entrar", onClick: onLogout };
        }
        if (!uxSnapshot.organizationId) {
            return { label: "Abrir Clientes para comprobar flujo", onClick: () => setActiveView("clientes") };
        }
        if ((uxSnapshot.clientsCount ?? 0) === 0) {
            return { label: "Crear primer cliente", onClick: () => setActiveView("clientes") };
        }
        if ((uxSnapshot.projectsCount ?? 0) === 0) {
            return { label: "Crear primer proyecto", onClick: () => setActiveView("mis-proyectos") };
        }
        if (activeView !== "calculadora") {
            return { label: "Continuar en Calculadora", onClick: () => setActiveView("calculadora") };
        }
        return null;
    })();

    const renderView = () => {
        switch (activeView) {
            case "central-documental":
                return <CentralDocumental />;
            case "consulta-catastral":
                return <ConsultaCatastral />;
            case "calculadora":
                return <CalculadoraTermica />;
            case "clientes":
                return <ClientesView />;
            case "mis-proyectos":
                return <ProyectosView />;
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
                className={`relative flex flex-col border-r border-slate-800/50 bg-[#0A0A1A] transition-all duration-300 ease-in-out ${sidebarOpen ? "w-64" : "w-[72px]"
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
                  ${isActive
                                        ? "bg-indigo-500/15 text-indigo-400 ring-1 ring-inset ring-indigo-500/20"
                                        : item.disabled
                                            ? "text-slate-600 cursor-not-allowed opacity-50"
                                            : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                                    }
                `}
                            >
                                <span className={`shrink-0 ${isActive ? "text-indigo-400" : ""}`}>
                                    {item.icon}
                                </span>
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
                                            {(uxSnapshot?.clientsCount ?? 0) > 0 ? ` Clientes: ${uxSnapshot?.clientsCount}` : " Sin clientes"}
                                            {(uxSnapshot?.projectsCount ?? 0) >= 0 ? ` | Proyectos: ${uxSnapshot?.projectsCount}` : ""}
                                        </p>
                                    </>
                                )}
                            </div>

                            <div className="flex items-center gap-2">
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
                                    onClick={refreshUxSnapshot}
                                    className="h-8 px-3 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 text-xs inline-flex items-center gap-1"
                                >
                                    <RefreshCw className="w-3.5 h-3.5" />
                                    Revalidar
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 overflow-hidden">
                        {renderView()}
                    </div>
                </div>
            </main>
        </div>
    );
}
