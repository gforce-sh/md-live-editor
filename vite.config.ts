import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";
import { resolve } from "path";

// The lib build compiles src/solid.tsx (Solid JSX) → needs vite-plugin-solid.
// The dev server serves the React sandbox (sandbox/main.tsx) → needs the React
// plugin. The two JSX dialects can't share one plugin set, so switch on command.
// (src/react.ts is JSX-free createElement, so the lib build needs no React plugin.)
export default defineConfig(({ command }) => ({
  plugins:
    command === "build"
      ? [solidPlugin(), dts({ include: ["src"] })]
      : [react()],
  build: {
    lib: {
      entry: {
        core: resolve(__dirname, "src/core.ts"),
        solid: resolve(__dirname, "src/solid.tsx"),
        react: resolve(__dirname, "src/react.ts"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: [
        "solid-js",
        "solid-js/web",
        "react",
        "react-dom",
        "react/jsx-runtime",
      ],
    },
    cssCodeSplit: false,
  },
}));
