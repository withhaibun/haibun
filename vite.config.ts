import { defineConfig, UserConfig as ViteUserConfig } from "vite";
import type { UserConfig as VitestUserConfig } from "vitest/config";

interface Config extends ViteUserConfig {
	test?: VitestUserConfig["test"];
}

const config: Config = {
	test: {
		globals: true,
		environment: "node",
		include: ["modules/**/*.test.{ts,tsx}"],
		exclude: ["**/node_modules/**", "**/dist/**", "**/build/**"],
	},
};

export default defineConfig(config);
