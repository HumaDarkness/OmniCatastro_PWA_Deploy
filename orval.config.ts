import { defineConfig } from "orval";

export default defineConfig({
  omnicatastro: {
    input: {
      target: "./openapi.json", // Extracted from FastAPI via: cd api && python -c "from main import app; ..."
    },
    output: {
      mode: "tags-split",
      target: "src/api/generated",
      client: "react-query", // Genera hooks de TanStack Query
      httpClient: "ky", // Vincula con Ky
      override: {
        mutator: {
          path: "src/lib/kyClient.ts",
          name: "kyClient",
        },
      },
    },
  },
});
