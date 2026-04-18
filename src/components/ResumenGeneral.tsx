import React, { useEffect, useState } from "react";
import { Zap, Activity, Database, TrendingUp, ShieldCheck, RefreshCcw } from "lucide-react";
import { supabase } from "../lib/supabase";
import { getCurrentOrganizationId } from "../lib/supabase";

export function ResumenGeneral() {
  const [metrics, setMetrics] = useState({
    totalExpedientes: 0,
    ahorroTotal: 0,
    certificadosEmitidos: 0,
    syncPendientes: 0,
  });

  useEffect(() => {
    const fetchMetrics = async () => {
      const orgId = getCurrentOrganizationId();
      if (!orgId) return;

      try {
        // Number of active expedientes
        const { count: expCount } = await supabase
          .from("expedientes")
          .select("*", { count: "exact", head: true })
          .eq("org_id", orgId);

        setMetrics({
          totalExpedientes: expCount || 0,
          ahorroTotal: 15420, // KWh mockup if no agg available
          certificadosEmitidos: (expCount || 0) > 0 ? Math.floor((expCount || 0) * 0.8) : 0,
          syncPendientes: 0,
        });
      } catch (err) {
        console.error("Error fetching metrics", err);
      }
    };
    fetchMetrics();
  }, []);

  return (
    <div className="w-full h-full overflow-y-auto p-4 md:p-6 lg:p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-teal-400 via-cyan-400 to-blue-500 drop-shadow-[0_0_15px_rgba(45,212,191,0.3)]">
            Resumen General
          </h1>
          <p className="text-slate-400 mt-1">Métricas de rendimiento y monitorización operativa</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-800/50 backdrop-blur-md rounded-full border border-slate-700/50 shadow-[0_0_15px_rgba(0,0,0,0.5)]">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_10px_rgba(52,211,153,0.8)]"></div>
          <span className="text-sm font-medium text-slate-300">Sistema Conectado</span>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          title="Expedientes Activos"
          value={metrics.totalExpedientes.toString()}
          icon={<Database className="w-6 h-6 text-cyan-400" />}
          colorClass="from-cyan-500/20 to-blue-500/10 border-cyan-500/30 shadow-[0_0_20px_rgba(34,211,238,0.15)]"
          accentColor="bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.6)]"
        />

        <MetricCard
          title="Ahorro Energético CAE"
          value={`${metrics.ahorroTotal.toLocaleString()} kWh`}
          icon={<Zap className="w-6 h-6 text-amber-400" />}
          colorClass="from-amber-500/20 to-orange-500/10 border-amber-500/30 shadow-[0_0_20px_rgba(251,191,36,0.15)]"
          accentColor="bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.6)]"
        />

        <MetricCard
          title="Certificados Emitidos"
          value={metrics.certificadosEmitidos.toString()}
          icon={<ShieldCheck className="w-6 h-6 text-emerald-400" />}
          colorClass="from-emerald-500/20 to-green-500/10 border-emerald-500/30 shadow-[0_0_20px_rgba(52,211,153,0.15)]"
          accentColor="bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]"
        />

        <MetricCard
          title="Pendientes de Sync"
          value={metrics.syncPendientes.toString()}
          icon={
            <RefreshCcw
              className={`w-6 h-6 ${metrics.syncPendientes > 0 ? "text-rose-400 animate-spin" : "text-slate-400"}`}
            />
          }
          colorClass={`from-slate-800/50 to-slate-900/50 border-slate-700/50 ${metrics.syncPendientes > 0 ? "shadow-[0_0_20px_rgba(251,113,133,0.15)] border-rose-500/30" : ""}`}
          accentColor={
            metrics.syncPendientes > 0
              ? "bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.6)]"
              : "bg-slate-500"
          }
        />
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="col-span-1 lg:col-span-2 bg-slate-800/40 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-cyan-400" />
            Actividad Reciente
          </h3>
          <div className="space-y-4">
            <div className="h-40 flex items-center justify-center border border-dashed border-slate-700/50 rounded-xl relative z-10">
              <span className="text-slate-500 text-sm">Resumen en vivo (Próximamente)</span>
            </div>
          </div>
        </div>

        <div className="col-span-1 bg-slate-800/40 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl translate-y-1/2 translate-x-1/2"></div>
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-amber-400" />
            Top Comunidades
          </h3>
          <div className="space-y-4 relative z-10">
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-900/50 border border-slate-800 transition-colors hover:bg-slate-800/80">
              <span className="text-sm text-slate-300">Madrid</span>
              <span className="text-sm font-bold text-teal-400">45%</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-900/50 border border-slate-800 transition-colors hover:bg-slate-800/80">
              <span className="text-sm text-slate-300">Andalucía</span>
              <span className="text-sm font-bold text-teal-400">25%</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-900/50 border border-slate-800 transition-colors hover:bg-slate-800/80">
              <span className="text-sm text-slate-300">Cataluña</span>
              <span className="text-sm font-bold text-teal-400">15%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  icon,
  colorClass,
  accentColor,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  colorClass: string;
  accentColor: string;
}) {
  return (
    <div
      className={`relative overflow-hidden bg-gradient-to-br backdrop-blur-xl border rounded-2xl p-6 ${colorClass} transition-transform hover:scale-[1.02] duration-300`}
    >
      <div className={`absolute top-0 left-0 w-1 h-full ${accentColor}`}></div>
      <div className="flex justify-between items-start mb-4">
        <div className="p-2 rounded-xl bg-slate-900/50 shadow-inner">{icon}</div>
      </div>
      <h3 className="text-slate-400 text-sm font-medium mb-1">{title}</h3>
      <p className="text-3xl font-bold text-white tracking-tight">{value}</p>
    </div>
  );
}
