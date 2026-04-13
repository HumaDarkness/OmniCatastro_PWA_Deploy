import { useEffect } from "react";
import confetti from "canvas-confetti";
import { CheckCircle2, Copy, Download, HardDrive } from "lucide-react";
import { useClipboard } from "../lib/useClipboard";
import { Button } from "./ui/button";

interface CertificadoSuccessStateProps {
  referencia: string;
  fecha: string;
  textoPDF: string;
  onDescargarPDF: () => void;
  modoExperto: boolean;
  onCrearOtro: () => void;
}

export function CertificadoSuccessState({
  referencia,
  fecha,
  textoPDF,
  onDescargarPDF,
  modoExperto,
  onCrearOtro
}: CertificadoSuccessStateProps) {
  const { copy, state: copyState } = useClipboard({ delay: 2500 });

  useEffect(() => {
    // Fire confetti on mount
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    
    if (!prefersReducedMotion) {
      const duration = 2000;
      const end = Date.now() + duration;

      const frame = () => {
        confetti({
          particleCount: 3,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
          colors: ['#01696f', '#4f98a3', '#ffffff']
        });
        confetti({
          particleCount: 3,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
          colors: ['#01696f', '#4f98a3', '#ffffff']
        });

        if (Date.now() < end) {
          requestAnimationFrame(frame);
        }
      };
      
      frame();
    }
    
    return () => {
      // cleanup confetti if unmounted quickly
      confetti.reset();
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center p-8 space-y-6 bg-card text-card-foreground rounded-lg border shadow-sm max-w-2xl mx-auto mt-12 animate-in fade-in zoom-in duration-500">
      <div className="rounded-full bg-green-100 p-3 text-green-600 dark:bg-green-900/30 dark:text-green-500">
        <CheckCircle2 className="w-12 h-12" />
      </div>
      
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">Certificado Finalizado</h2>
        <p className="text-muted-foreground">
          Ref: {referencia || "Sin referencia"} · {fecha}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-4 pt-4 w-full justify-center">
        <Button 
          variant="default" 
          size="lg" 
          className="w-full sm:w-auto text-base h-12 px-8"
          onClick={() => copy(textoPDF)}
        >
          {copyState === "SUCCESS" ? (
            <>
              <CheckCircle2 className="mr-2 h-5 w-5 text-green-500" />
              <span>¡Copiado!</span>
            </>
          ) : (
            <>
              <Copy className="mr-2 h-5 w-5" />
              <span>Copiar Datos PDF</span>
            </>
          )}
        </Button>
        <Button 
          variant="outline" 
          size="lg"
          className="w-full sm:w-auto text-base h-12 px-8"
          onClick={onDescargarPDF}
        >
          <Download className="mr-2 h-5 w-5" />
          Descargar PDF
        </Button>
      </div>

      <div className="w-full border-t border-border mt-6 pt-4 flex flex-col items-center gap-4">
        {modoExperto ? (
          <p className="text-sm text-muted-foreground font-medium flex items-center">
            <HardDrive className="w-4 h-4 mr-2" />
            Este certificado se ha guardado en el lote activo.
          </p>
        ) : null}
        
        <Button variant="ghost" onClick={onCrearOtro}>
          + Crear Otro Certificado
        </Button>
      </div>
    </div>
  );
}
