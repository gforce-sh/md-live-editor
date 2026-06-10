import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import dts from "vite-plugin-dts";
import { resolve } from "path";

export default defineConfig({
  plugins: [solidPlugin(), dts({ include: ["src"] })],
  build: {
    lib: {
      entry: {
        core: resolve(__dirname, "src/core.ts"),
        solid: resolve(__dirname, "src/solid.tsx"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: ["solid-js", "solid-js/web"],
    },
    cssCodeSplit: false,
  },
});
