import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from 'node:fs';
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, createLogger, type PluginOption } from "vite";
import { viteSingleFile } from 'vite-plugin-singlefile';
import { visualizer } from 'rollup-plugin-visualizer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 1. Setup Custom Logger with a "one-time" warning
const logger = createLogger();
const originalError = logger.error;
let hasWarned = false;

logger.error = (msg, options) => {
  if (msg.includes("http proxy error") || msg.includes("ECONNREFUSED")) {
    if (!hasWarned) {
      console.warn("\x1b[33m%s\x1b[0m", " [vite] Proxy targets not found (ECONNREFUSED). Silencing further proxy errors...");
      hasWarned = true;
    }
    return;
  }
  originalError(msg, options);
};

// 2. Helper to get ports
export const getPorts = (mode: string = process.env.NODE_ENV || 'development') => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    clientPort: Number.parseInt(env.HAIBUN_O_MONITOR_CLIENT_PORT || '3465', 10),
    proxiedPort: Number.parseInt(env.HAIBUN_O_MONITOR_SERVER_PORT || '3459', 10)
  };
};

export default defineConfig(({ mode }) => {
  const { clientPort, proxiedPort: serverPort } = getPorts(mode);
  const tsconfigContent = readFileSync(path.join(__dirname, 'tsconfig.client.json'), 'utf-8');

  return {
    customLogger: logger,
    plugins: [
      react() as PluginOption,
      viteSingleFile({
        useRecommendedBuildConfig: true,
        removeViteModuleLoader: true,
      }),
      visualizer({
        filename: 'dist/client/stats.html',
        gzipSize: true,
        brotliSize: true,
      }) as unknown as PluginOption,
    ],
    server: {
      host: '0.0.0.0',
      port: clientPort,
      watch: {
        ignored: [path.resolve(__dirname, 'capture/**')],
      },
      fs: {
        deny: [path.resolve(__dirname, 'capture')],
      },
      proxy: {
        '/sse': {
          target: `http://localhost:${serverPort}`,
          changeOrigin: true,
          ws: true,
        },
        '/artifacts': {
          target: `http://localhost:${serverPort}`,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/artifacts/, ''),
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
      minify: 'esbuild',
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        }
      }
    },
    esbuild: {
      tsconfigRaw: JSON.parse(tsconfigContent)
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: [path.resolve(__dirname, '../../vitest.setup.ts')],
    }
  };
});