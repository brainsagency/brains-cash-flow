import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Mirror the tsconfig path aliases so tests can value-import via @engine / @.
const engineDir = fileURLToPath(new URL("./src/lib/engine", import.meta.url));
const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@engine\//, replacement: `${engineDir}/` },
      { find: /^@\//, replacement: `${srcDir}/` },
    ],
  },
  test: {
    include: ["src/**/*.{test,spec}.ts"],
    environment: "node",
    globals: false,
  },
});
