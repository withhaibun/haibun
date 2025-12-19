import { defineConfig, UserConfig as ViteUserConfig } from 'vite';
import type { UserConfig as VitestUserConfig } from 'vitest/config';

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
	}
};

export default defineConfig(config);
