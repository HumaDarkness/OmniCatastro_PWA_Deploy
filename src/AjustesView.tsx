import { useState, useRef, useEffect } from 'react';
import { db, type IngenieroLocal } from './infra/db/OmniCatastroDB';
import { processSignatureWithAutoCrop } from './infra/image/signaturePipeline';
import { useIngeniero } from './contexts/IngenieroContext';
import { Plus, Save, Trash2, Check, ImagePlus } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';

export function AjustesView() {
  const ingenieros = useLiveQuery(() => db.ingenieros.toArray()) || [];
  const { ingeniero: activo, setActivo } = useIngeniero();
  const [formData, setFormData] = useState<Partial<IngenieroLocal>>({ nombre: '', apellidos: '', nif: '', colegiado: '', email: '' });
  const [firmaBlob, setFirmaBlob] = useState<Blob | null>(null);
  const [firmaPreview, setFirmaPreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Limpiar el preview de la firma temporal si se desmonta
  useEffect(() => {
    return () => {
      if (firmaPreview) URL.revokeObjectURL(firmaPreview);
    };
  }, [firmaPreview]);

  const handleGuardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nombre || !formData.apellidos || !formData.nif) return;
    
    const now = Date.now();
    const id = await db.ingenieros.add({
      nombre: formData.nombre,
      apellidos: formData.apellidos,
      nif: formData.nif,
      colegiado: formData.colegiado,
      email: formData.email,
      firmaBlob: firmaBlob || undefined,
      isActive: ingenieros.length === 0 ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    });
    
    if (ingenieros.length === 0) {
      await setActivo(id);
    }
    
    // Reset
    setFormData({ nombre: '', apellidos: '', nif: '', colegiado: '', email: '' });
    setFirmaBlob(null);
    if (firmaPreview) { URL.revokeObjectURL(firmaPreview); setFirmaPreview(null); }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      setIsProcessing(true);
      // Usar nuestro nuevo Web Worker (Sauvola)
      const cleanedBlob = await processSignatureWithAutoCrop(file);
      setFirmaBlob(cleanedBlob);
      if (firmaPreview) URL.revokeObjectURL(firmaPreview);
      setFirmaPreview(URL.createObjectURL(cleanedBlob));
    } catch (err) {
      alert("Error procesando la firma. Utilice una imagen de buena calidad.");
      console.error(err);
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleBorrar = async (id: number) => {
    if (confirm("¿Estás seguro de borrar a este ingeniero?")) {
      await db.ingenieros.delete(id);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#060612] p-6 overflow-y-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white tracking-tight">Ajustes & Componentes</h2>
        <p className="text-slate-400 mt-1">Configuración Multi-Tenant y Perfiles Locales</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lista de Ingenieros */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
          <h3 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
            Perfiles de Ingenieros Locales
          </h3>
          
          <div className="space-y-3">
            {ingenieros.map(ing => (
              <div 
                key={ing.id} 
                className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-lg border transition-all ${
                  activo?.id === ing.id ? "bg-indigo-900/20 border-indigo-500/50" : "bg-black/20 border-slate-700/50 hover:bg-slate-800/80"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-slate-700 to-slate-600 flex items-center justify-center text-slate-300 font-bold">
                    {ing.nombre[0]}{ing.apellidos[0]}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-200">{ing.nombre} {ing.apellidos}</p>
                    <p className="text-xs text-slate-500">NIF: {ing.nif} {ing.colegiado ? `| Col: ${ing.colegiado}` : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3 sm:mt-0">
                  {activo?.id !== ing.id && (
                    <button 
                      onClick={() => ing.id && setActivo(ing.id)}
                      className="px-3 py-1.5 rounded-md text-xs font-medium bg-slate-800 text-slate-300 hover:bg-indigo-600 hover:text-white transition-colors"
                    >
                      Establecer como Activo
                    </button>
                  )}
                  {activo?.id === ing.id && (
                    <span className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                      <Check className="w-3.5 h-3.5" /> Activo
                    </span>
                  )}
                  <button 
                    onClick={() => ing.id && handleBorrar(ing.id)}
                    className="p-1.5 rounded-md hover:bg-red-900/30 text-slate-400 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}

            {ingenieros.length === 0 && (
              <div className="text-center py-8 text-slate-500 text-sm border border-dashed border-slate-700 rounded-lg">
                No hay ingenieros registrados en este dispositivo.
              </div>
            )}
          </div>
        </div>

        {/* Formulario Añadir */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
          <h3 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <Plus className="w-5 h-5 text-indigo-400" />
            Añadir Nuevo Perfil
          </h3>
          
          <form className="space-y-4" onSubmit={handleGuardar}>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">Nombre *</label>
                <input 
                  type="text" required
                  className="w-full bg-black/30 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                  value={formData.nombre} onChange={e => setFormData({...formData, nombre: e.target.value})}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">Apellidos *</label>
                <input 
                  type="text" required
                  className="w-full bg-black/30 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                  value={formData.apellidos} onChange={e => setFormData({...formData, apellidos: e.target.value})}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">NIF *</label>
                <input 
                  type="text" required
                  className="w-full bg-black/30 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                  value={formData.nif} onChange={e => setFormData({...formData, nif: e.target.value})}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">Nº Colegiado</label>
                <input 
                  type="text" 
                  className="w-full bg-black/30 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
                  value={formData.colegiado} onChange={e => setFormData({...formData, colegiado: e.target.value})}
                />
              </div>
            </div>
            
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400">Escaneo de Firma (Auto-Crop y limpieza de blancos activo)</label>
              <div className="flex gap-4 items-start">
                {firmaPreview ? (
                  <div className="relative group">
                    <img src={firmaPreview} alt="Preview firma" className="h-20 w-auto bg-white rounded border border-slate-600 object-contain p-2" />
                    <button type="button" onClick={() => { setFirmaPreview(null); setFirmaBlob(null); }} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <button 
                    type="button" 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isProcessing}
                    className="h-20 flex-1 border-2 border-dashed border-slate-700 hover:border-indigo-500 hover:bg-indigo-500/5 rounded-lg flex flex-col items-center justify-center text-slate-500 transition-colors"
                  >
                    {isProcessing ? <span className="animate-pulse">Limpiando...</span> : <><ImagePlus className="w-6 h-6 mb-1 opacity-50" /><span className="text-xs">Subir o tomar foto</span></>}
                  </button>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              </div>
            </div>

            <button 
              type="submit"
              disabled={!formData.nombre || !formData.apellidos || !formData.nif || isProcessing}
              className="w-full mt-4 flex justify-center items-center gap-2 py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm disabled:opacity-50 disabled:pointer-events-none transition-colors"
            >
              <Save className="w-4 h-4" />
              Guardar Perfil
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
