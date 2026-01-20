import { defineConfig, UserConfig as ViteUserConfig } from 'vite';
import type { UserConfig as VitestUserConfig } from 'vitest/config';
import { readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const modulesDir = join(__dirname, 'modules');

const modules = readdirSync(modulesDir)
	.map((d) => join(modulesDir, d))
	.filter((f) => statSync(f).isDirectory());

interface Config extends ViteUserConfig {
	test?: VitestUserConfig['test'];
}

const config: Config = {
	test: {
		globals: true,
		environment: 'node',
		include: ['**/*.{test}.{ts,tsx}'],
		setupFiles: ['./vitest.setup.ts'],
		exclude: [
			'**/node_modules/**',
			'**/dist/**',
			'**/build/**',
		],
		projects: modules,
	}
};

export default defineConfig(config);
