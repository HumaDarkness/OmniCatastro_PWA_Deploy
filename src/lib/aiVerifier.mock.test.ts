/**
 * AI Verifier Mock Test (Proof of Concept)
 *
 * Este archivo demuestra CÓMO funcionaría el sistema de auditoría con IA
 * sin realizar llamadas reales a la red, para validar la lógica de prompts
 * y manejo de errores.
 */

interface MockDraft {
  id: string;
  capas: Array<{ nombre: string; r_valor: number }>;
}

/**
 * Función simuladora de auditoría IA.
 * En producción, esto llamará a 'proxy-groq'.
 */
const simulateAiAudit = async (draft: MockDraft, imageUrls: string[]) => {
  // Escenario de prueba: El usuario puso R=4.0 en el programa,
  // pero en la captura de CE3X que envió (SUPAFIL 23) pone R=5.111.

  console.log("--- SIMULACIÓN DE AUDITORÍA IA ---");
  console.log("Contexto: " + JSON.stringify(draft));
  console.log("Escaneando imágenes de CE3X enviadas...");

  const supafilLayer = draft.capas.find((c) => c.nombre.toUpperCase().includes("SUPAFIL"));

  // Simulación de OCR/Vision detectando el valor real de la imagen
  const valueInImage = 5.111;

  if (supafilLayer && Math.abs(supafilLayer.r_valor - valueInImage) > 0.001) {
    return {
      status: "WARNING",
      alerts: [
        {
          type: "DISCREPANCY",
          message: `Discrepancia detectada en '${supafilLayer.nombre}': En el programa has puesto R=${supafilLayer.r_valor}, pero en la captura de CE3X se lee claramente R=5.111.`,
          priority: "HIGH",
        },
      ],
      suggestion:
        "Actualiza el valor de R a 5.111 para que coincida con la captura de la librería de cerramientos de CE3X.",
    };
  }

  return { status: "OK", alerts: [], message: "Los datos coinciden con las capturas." };
};

// --- RUN TEST POCCASE ---
(async () => {
  // 1. Datos que el usuario introdujo en la PWA (con un error a propósito para el test)
  const mockUserDraft: MockDraft = {
    id: "EXP-2026-001",
    capas: [
      { nombre: "Yeso", r_valor: 0.023 },
      { nombre: "SUPAFIL 23", r_valor: 4.0 }, // <- El usuario se equivocó aquí vs la imagen
    ],
  };

  // 2. Simulamos las imágenes que el usuario subió (las que me acabas de mandar por el chat)
  const mockScreenshots = ["https://supabase.../captura_ce3x_supafil.png"];

  // 3. Ejecutamos la auditoría simulada
  const result = await simulateAiAudit(mockUserDraft, mockScreenshots);

  // 4. Verificamos el resultado
  if (result.status === "WARNING") {
    console.warn("\n⚠️ ALERTA IA:");
    console.warn(result.alerts[0].message);
    console.log("💡 SUGERENCIA:", result.suggestion);
  } else {
    console.log("\n✅ Verificación exitosa.");
  }
})();
