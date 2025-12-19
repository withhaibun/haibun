import path from "path"
import { fileURLToPath } from "url"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { readFileSync } from 'fs';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { visualizer } from 'rollup-plugin-visualizer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsconfigRaw = JSON.parse(readFileSync(path.join(__dirname, 'tsconfig.client.json'), 'utf-8'));


export default defineConfig({
  plugins: [
    react() as any,
    viteSingleFile({
      useRecommendedBuildConfig: true,
      removeViteModuleLoader: true,
    }),
    visualizer({
      filename: 'dist/client/stats.html',
      gzipSize: true,
      brotliSize: true,
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 3458,
    proxy: {
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
        changeOrigin: true,
        rewriteWsOrigin: true,
      },
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
      "@haibun/core/monitor/index.js": path.resolve(__dirname, "../core/src/monitor/index.ts"),
      "@haibun/core/monitor": path.resolve(__dirname, "../core/src/monitor/index.ts"),
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
      mangle: true,
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      }
    }
  },
  esbuild: {
    tsconfigRaw
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [path.resolve(__dirname, '../../vitest.setup.ts')],
  }
})
