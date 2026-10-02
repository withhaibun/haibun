import { defaultClientConditions, defineConfig, UserConfig as ViteUserConfig } from "vite";
import type { UserConfig as VitestUserConfig } from "vitest/config";

interface Config extends ViteUserConfig {
	test?: VitestUserConfig["test"];
}

// `*.integration.test.ts` is the convention for a test that boots a real dependency: here each launches a browser and
// serves a built bundle to it. Run beside 270 other files they contend for the machine and time out without a fault
// in the code; run in their own capped group they pass. A new browser test needs only that name.
const INTEGRATION_TESTS = "modules/**/*.integration.test.{ts,tsx}";
const EXCLUDE = ["**/node_modules/**", "**/dist/**", "**/build/**"];

/** haibun's packages export their TypeScript source under this condition, so a test reads a module as its source stands. */
const HAIBUN_SOURCE = "haibun-source";
/** The conditions a test run in Node resolves a package by, as Vitest's own are: without `module`, since a package's
 *  `module` build may import paths without the extension Node requires (@opentelemetry/api). */
const SERVER_CONDITIONS = ["node", "development|production"];

const config: Config = {
	resolve: { conditions: [HAIBUN_SOURCE, ...defaultClientConditions] },
	ssr: { resolve: { conditions: [HAIBUN_SOURCE, ...SERVER_CONDITIONS] } },
	test: {
		globals: true,
		environment: "node",
		// The projects below say what runs; a root `include` beside them would be a third project running everything again.
		projects: [
			{
				extends: true,
				test: { name: "integration", include: [INTEGRATION_TESTS], exclude: EXCLUDE, maxWorkers: 2, minWorkers: 1, sequence: { groupOrder: 0 } },
			},
			{
				extends: true,
				test: { name: "unit", include: ["modules/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"], exclude: [...EXCLUDE, INTEGRATION_TESTS], sequence: { groupOrder: 1 } },
			},
		],
	},
};

export default defineConfig(config);
