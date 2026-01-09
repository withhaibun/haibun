
import path from "path"
import { fileURLToPath } from "url"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"
import { readFileSync } from 'fs';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { visualizer } from 'rollup-plugin-visualizer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsconfigRaw = JSON.parse(readFileSync(path.join(__dirname, 'tsconfig.client.json'), 'utf-8'));


// Helper to get ports (usable by backend)
export const getPorts = (mode: string = process.env.NODE_ENV || 'development') => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    clientPort: parseInt(env.HAIBUN_O_MONITOR_CLIENT_PORT || '3465', 10),
    proxiedPort: parseInt(env.HAIBUN_O_MONITOR_SERVER_PORT || '3459', 10)
  };
};

export default defineConfig(({ mode }) => {
  const { clientPort, proxiedPort: serverPort } = getPorts(mode);

  return {
    plugins: [
      // biome-ignore lint/suspicious/noExplicitAny: vite plugin types
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
      port: clientPort,
      proxy: {
        '/sse': {
          target: `http://localhost:${serverPort}`,
          changeOrigin: true,
        },
        '/artifacts': {
          target: `http://localhost:${serverPort}`,
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
  }
})
