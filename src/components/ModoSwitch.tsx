import { useEffect } from "react";
import { useLocalStorage } from "usehooks-ts";

export function useModoExperto() {
  const [isExperto, setIsExperto] = useLocalStorage("cae-modo-experto", false);

  useEffect(() => {
    // Inject attribute on document body for global CSS transitions
    if (isExperto) {
      document.body.setAttribute("data-modo", "experto");
    } else {
      document.body.setAttribute("data-modo", "basico");
    }
  }, [isExperto]);

  return { isExperto, setIsExperto };
}

export function ModoSwitch() {
  const { isExperto, setIsExperto } = useModoExperto();

  return (
    <div className="flex items-center space-x-2">
      <label
        htmlFor="modo-experto-toggle"
        className="text-xs font-medium text-muted-foreground cursor-pointer"
      >
        Lotes y Opciones Avanzadas
      </label>
      <button
        id="modo-experto-toggle"
        role="switch"
        aria-checked={isExperto}
        onClick={() => setIsExperto(!isExperto)}
        className={`relative inline-flex h-[20px] w-[36px] shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
          isExperto ? "bg-primary" : "bg-input"
        }`}
      >
        <span
          className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform duration-200 ease-in-out ${
            isExperto ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
