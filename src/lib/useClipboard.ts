import { useState, useCallback } from "react";

export const useClipboard = ({ delay = 2500 } = {}) => {
  const [state, setState] = useState<"READY" | "SUCCESS" | Error>("READY");
  
  const copy = useCallback((value: string) => {
    navigator.clipboard.writeText(value)
      .then(() => { 
        setState("SUCCESS"); 
        setTimeout(() => setState("READY"), delay);
      })
      .catch(err => {
        setState(err instanceof Error ? err : new Error(String(err)));
        setTimeout(() => setState("READY"), delay);
      });
  }, [delay]);
  
  return { copy, state };
};
