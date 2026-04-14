import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { db, type IngenieroLocal } from '../infra/db/OmniCatastroDB';

interface IngenieroContextValue {
  ingeniero: IngenieroLocal | null;
  firmaUrl: string | null;       // Object URL efímero, listo para <img src>
  isLoading: boolean;
  setActivo: (id: number) => Promise<void>;
  refresh: () => Promise<void>;  // Forzar recarga tras guardar un nuevo ingeniero
}

const IngenieroCtx = createContext<IngenieroContextValue | null>(null);

export function IngenieroProvider({ children }: React.PropsWithChildren) {
  const [ingeniero, setIngeniero] = useState<IngenieroLocal | null>(null);
  const [firmaUrl, setFirmaUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Ref para revocar la URL anterior sin re-render
  const prevFirmaUrl = useRef<string | null>(null);

  const _applyIngeniero = useCallback((ing: IngenieroLocal | undefined) => {
    // Revocar URL anterior — evita memory leak
    if (prevFirmaUrl.current) {
      URL.revokeObjectURL(prevFirmaUrl.current);
      prevFirmaUrl.current = null;
    }
    if (!ing) { setIngeniero(null); setFirmaUrl(null); return; }

    setIngeniero(ing);
    if (ing.firmaBlob) {
      const url = URL.createObjectURL(ing.firmaBlob);
      prevFirmaUrl.current = url;
      setFirmaUrl(url);
    } else {
      setFirmaUrl(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    const ing = await db.getIngenieroActivo();
    _applyIngeniero(ing);
    setIsLoading(false);
  }, [_applyIngeniero]);

  // Carga inicial
  useEffect(() => {
    refresh();
    // Cleanup al desmontar el Provider (salida de la app)
    return () => {
      if (prevFirmaUrl.current) URL.revokeObjectURL(prevFirmaUrl.current);
    };
  }, [refresh]);

  const setActivo = useCallback(async (id: number) => {
    await db.setIngenieroActivo(id);
    const ing = await db.ingenieros.get(id);
    _applyIngeniero(ing);
  }, [_applyIngeniero]);

  return (
    <IngenieroCtx.Provider value={{ ingeniero, firmaUrl, isLoading, setActivo, refresh }}>
      {children}
    </IngenieroCtx.Provider>
  );
}

/** Hook de consumo — lanza error si se usa fuera del Provider */
export function useIngeniero(): IngenieroContextValue {
  const ctx = useContext(IngenieroCtx);
  if (!ctx) throw new Error('useIngeniero debe usarse dentro de <IngenieroProvider>');
  return ctx;
}
