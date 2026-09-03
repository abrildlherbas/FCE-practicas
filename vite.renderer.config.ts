import { defineConfig } from "vite";

export default defineConfig({
  root: "src/renderer",

  build: {
    outDir: "../../.vite/renderer",
    emptyOutDir: true,
  },
});