import React from 'react';
import { ArrowRight, FileText, Zap, ShieldCheck, CheckCircle2 } from 'lucide-react';
import heroImage from './assets/hero_b2b.png'; // Make sure to copy the image here

interface LandingPageProps {
    onLoginClick: () => void;
}

export function LandingPage({ onLoginClick }: LandingPageProps) {
    return (
        <div className="min-h-screen bg-[#0A0A0A] text-white selection:bg-blue-500/30 overflow-x-hidden">
            {/* Navbar */}
            <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-black/50 backdrop-blur-md">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                            <Zap className="w-5 h-5 text-white" />
                        </div>
                        <span className="font-bold text-xl tracking-tight">Omni<span className="text-blue-400">Catastro</span> B2B</span>
                    </div>
                    <div className="flex items-center gap-4">
                        <button className="text-sm font-medium text-gray-300 hover:text-white transition-colors">
                            Nuestra Solución
                        </button>
                        <button
                            onClick={onLoginClick}
                            className="text-sm font-semibold bg-white text-black px-4 py-2 rounded-full hover:bg-gray-200 transition-all active:scale-95"
                        >
                            Acceso Clientes
                        </button>
                    </div>
                </div>
            </nav>

            {/* Hero Section */}
            <section className="relative pt-32 pb-20 px-6 lg:pt-48 lg:pb-32 overflow-hidden">
                <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-blue-600/20 blur-[120px] rounded-full pointer-events-none" />

                <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center relative z-10">
                    <div className="space-y-8">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm font-medium">
                            <span className="flex h-2 w-2 rounded-full bg-blue-500 animate-pulse"></span>
                            La "Fábrica de Subvenciones" Definitiva
                        </div>

                        <h1 className="text-5xl lg:text-7xl font-extrabold tracking-tight leading-[1.1]">
                            Transforma el
                            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
                                Caos del CE3X
                            </span>
                            en Rentabilidad Automática.
                        </h1>

                        <p className="text-xl text-gray-400 leading-relaxed max-w-lg">
                            Diseñado exclusivamente para matrices instaladoras de aislamiento.
                            Deja de perder horas calculando coeficientes 'b' y lidiando con el Anexo E.1 del CTE DB-HE. Justifica tus CAEs en segundos.
                        </p>

                        <div className="flex flex-col sm:flex-row gap-4 pt-4">
                            <button className="flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-semibold px-8 py-4 rounded-xl shadow-lg shadow-blue-500/25 transition-all group">
                                Solicitar Demo B2B
                                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                            </button>
                            <button
                                onClick={onLoginClick}
                                className="flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 text-white font-medium px-8 py-4 rounded-xl border border-white/10 transition-colors"
                            >
                                Ya soy cliente
                            </button>
                        </div>
                    </div>

                    <div className="relative lg:ml-auto">
                        <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/20 to-purple-500/20 rounded-2xl blur-2xl" />
                        <div className="relative rounded-2xl border border-white/10 bg-black/50 p-2 overflow-hidden shadow-2xl">
                            <img
                                src={heroImage}
                                alt="Burocracia automatizada OmniCatastro"
                                className="rounded-xl w-full h-auto object-cover max-h-[500px]"
                            />
                            {/* Overlay Glass Badge */}
                            <div className="absolute bottom-6 left-6 right-6 glass-panel border border-white/10 bg-black/60 backdrop-blur-md p-4 rounded-xl flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-gray-400 font-medium">Lote Procesado</p>
                                    <p className="text-white font-bold">142 Expedientes (Supafil 045)</p>
                                </div>
                                <div className="h-10 w-10 rounded-full bg-green-500/20 flex items-center justify-center">
                                    <CheckCircle2 className="w-6 h-6 text-green-400" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Pain & Security Section */}
            <section className="py-24 bg-black relative border-t border-white/5">
                <div className="max-w-7xl mx-auto px-6">
                    <div className="text-center mb-16 max-w-3xl mx-auto">
                        <h2 className="text-3xl lg:text-5xl font-bold mb-6">El Dolor de la Burocracia Termina Aquí</h2>
                        <p className="text-gray-400 text-lg">Sabemos que el negocio no está en rellenar PDFs, está en el aislante y en los Certificados de Ahorro Energético (CAEs). OmniCatastro convierte meses de papeleo en clics.</p>
                    </div>

                    <div className="grid md:grid-cols-3 gap-8">
                        <div className="glass-panel p-8 rounded-2xl border border-white/5 bg-white/[0.02]">
                            <div className="w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center mb-6">
                                <FileText className="w-6 h-6 text-orange-400" />
                            </div>
                            <h3 className="text-xl font-bold mb-3">Extracción Masiva</h3>
                            <p className="text-gray-400">Arrastra 100 archivos CE3X. Nuestro motor lee las referencias catastrales, cruza datos climáticos y saca el certificado. Sin teclear nada.</p>
                        </div>

                        <div className="glass-panel p-8 rounded-2xl border border-white/5 bg-white/[0.02]">
                            <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center mb-6">
                                <Zap className="w-6 h-6 text-blue-400" />
                            </div>
                            <h3 className="text-xl font-bold mb-3">Materiales Pre-Cargados</h3>
                            <p className="text-gray-400">Usa URSA TERRA, SUPAFIL o el aislante de tu matriz. Los coeficientes U y 'b' se calculan solos usando el CTE DB-HE actualizado.</p>
                        </div>

                        <div className="glass-panel p-8 rounded-2xl border border-white/5 bg-white/[0.02] relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4 opacity-10">
                                <ShieldCheck className="w-32 h-32" />
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center mb-6 relative z-10">
                                <ShieldCheck className="w-6 h-6 text-green-400" />
                            </div>
                            <h3 className="text-xl font-bold mb-3 relative z-10">Seguridad & IP Protegida</h3>
                            <p className="text-gray-400 relative z-10">Tus datos y nuestro algoritmo están blindados. El Cloud computing ocurre en servidores Enterprise aislados. Tú decides quién tiene acceso (SSO/Google Login).</p>
                        </div>
                    </div>
                </div>
            </section>

        </div>
    );
}
