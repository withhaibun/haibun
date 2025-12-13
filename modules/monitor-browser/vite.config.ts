
import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { readFileSync } from 'fs';

const tsconfigRaw = JSON.parse(readFileSync('./tsconfig.client.json', 'utf-8'));

export default defineConfig({
  plugins: [react() as any],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src/client"),
      "@haibun/core": path.resolve(__dirname, "../core/src"),
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
  // Force vite to use client config
  esbuild: {
    tsconfigRaw
  }
})
