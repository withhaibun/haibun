/**
 * What every repository that tests haibun's modules shares in its Vitest config: the decorator plugin, the source condition for both
 * the browser's and Node's resolution, and Vitest's globals in Node. A repository's own config adds its projects, its timeouts and its
 * worker caps.
 */
import { defaultClientConditions, type UserConfig } from "vite";
import type { TestUserConfig } from "vitest/config";
import { standardDecorators } from "./adapters/standard-decorators.ts";
import { HAIBUN_SOURCE } from "./domains/bundle.ts";

/** A Vite config that holds Vitest's `test` key. */
export type THaibunConfig = UserConfig & { test?: TestUserConfig };

/** The conditions a test run in Node resolves a package by, as Vitest's own are: without `module`, since a package's
 *  `module` build may import paths without the extension Node requires (@opentelemetry/api). */
const SERVER_CONDITIONS = ["node", "development|production"];

/** The shared config, which a repository's vitest.config.ts spreads. */
export const haibunPreset: THaibunConfig = {
	plugins: [standardDecorators],
	resolve: { conditions: [HAIBUN_SOURCE, ...defaultClientConditions] },
	ssr: { resolve: { conditions: [HAIBUN_SOURCE, ...SERVER_CONDITIONS] } },
	test: { globals: true, environment: "node" },
};
