import { defaultClientConditions, type UserConfig } from "vite";
import type { UserConfig as VitestUserConfig } from "vitest/config";
import { standardDecorators } from "./vite-standard-decorators.js";

/** A Vite config that holds Vitest's `test` key. */
export type THaibunConfig = UserConfig & { test?: VitestUserConfig["test"] };

/** haibun's packages export their TypeScript source under this condition, so a test reads a module as its source stands. */
export const HAIBUN_SOURCE = "haibun-source";
/** The conditions a test run in Node resolves a package by, as Vitest's own are: without `module`, since a package's
 *  `module` build may import paths without the extension Node requires (@opentelemetry/api). */
const SERVER_CONDITIONS = ["node", "development|production"];

/** What every repository that tests haibun's modules shares: the decorator plugin, the source condition for both the browser's
 *  and Node's resolution, and Vitest's globals in Node. A repository's own config adds its projects, its timeouts and its worker caps. */
export const haibunPreset: THaibunConfig = {
	plugins: [standardDecorators],
	resolve: { conditions: [HAIBUN_SOURCE, ...defaultClientConditions] },
	ssr: { resolve: { conditions: [HAIBUN_SOURCE, ...SERVER_CONDITIONS] } },
	test: { globals: true, environment: "node" },
};
