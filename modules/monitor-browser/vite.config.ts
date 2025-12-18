
import path from "path"
import { fileURLToPath } from "url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { readFileSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsconfigRaw = JSON.parse(readFileSync(path.join(__dirname, 'tsconfig.client.json'), 'utf-8'));


export default defineConfig({
  plugins: [react() as any],
  server: {
    host: '0.0.0.0',
    port: 3458,
    proxy: {
      // Proxy WebSocket connections to the Haibun monitor server
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
        changeOrigin: true,
        rewriteWsOrigin: true,
      },
      // Proxy artifact requests (screenshots, videos, etc.) to the monitor server
      '/artifacts': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/artifacts/, ''),
      }
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src/client"),
      // Map to source for development - monitor module is browser-safe
      "@haibun/core/monitor/index.js": path.resolve(__dirname, "../core/src/monitor/index.ts"),
      "@haibun/core/monitor": path.resolve(__dirname, "../core/src/monitor/index.ts"),
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      }
    }
  },
  // Force vite to use client config
  esbuild: {
    tsconfigRaw
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [path.resolve(__dirname, '../../vitest.setup.ts')],
  }
})
