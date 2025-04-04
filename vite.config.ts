import { defineConfig, UserConfig as ViteUserConfig } from 'vite';
import type { UserConfig as VitestUserConfig } from 'vitest/config';
import fs from 'fs';
import path from 'path';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { visualizer } from 'rollup-plugin-visualizer';

interface Config extends ViteUserConfig {
	test?: VitestUserConfig['test'];
}

const config: Config = {
	base: './',
	publicDir: false,
	build: {
		outDir: 'modules/web-playwright/web/',
		// sourcemap: true,
		emptyOutDir: true,
		rollupOptions: {
			input: ['modules/web-playwright/resources/monitor.in.html'],
		},
	},
	plugins: [
		viteSingleFile({
			useRecommendedBuildConfig: true,
			removeViteModuleLoader: true,
		}),
		visualizer({
			open: false,
			filename: 'modules/web-playwright/web/build-stats.html',
			gzipSize: true,
			brotliSize: true,
		}),
		{
			name: 'move-monitor-html',
			apply: 'build',
			// FIXME this should not be neccessary (move inlined html to web)
			writeBundle(options) {
				const outDir = options.dir;
				if (!outDir) {
					this.warn('Output directory (options.dir) not found.');
					return;
				}
				const incorrectInputRelative = 'modules/web-playwright/resources/monitor.in.html';
				const correctOutputRelative = 'monitor.html';

				const incorrectPath = path.join(outDir, incorrectInputRelative);
				const correctPath = path.join(outDir, correctOutputRelative);

				if (fs.existsSync(incorrectPath)) {
					fs.mkdirSync(path.dirname(correctPath), { recursive: true });
					fs.renameSync(incorrectPath, correctPath);
					console.log(`\nMoved ${incorrectPath} to ${correctPath}`);

					const intermediateDir = path.dirname(incorrectPath);
					const resourcesDir = path.dirname(intermediateDir);
					const playwrightDir = path.dirname(resourcesDir);
					const modulesDir = path.dirname(playwrightDir);

					try { if (fs.readdirSync(intermediateDir).length === 0) fs.rmdirSync(intermediateDir); } catch (e) { /* ignore */ }
					try { if (fs.readdirSync(resourcesDir).length === 0) fs.rmdirSync(resourcesDir); } catch (e) { /* ignore */ }
					try { if (fs.readdirSync(playwrightDir).length === 0) fs.rmdirSync(playwrightDir); } catch (e) { /* ignore */ }
					try { if (fs.readdirSync(modulesDir).length === 0) fs.rmdirSync(modulesDir); } catch (e) { /* ignore */ }
				} else {
					if (!fs.existsSync(correctPath)) {
						this.warn(`Expected file not found at ${incorrectPath} after build. Cannot move.`);
					}
				}
			}
		}
	],
	test: {
		globals: true,
		environment: 'node',
		include: ['**/*.{test,spec}.ts'],
		exclude: [
			'**/node_modules/**',
			'**/dist/**',
			'**/build/**',
		],
	}
};

export default defineConfig(config);
