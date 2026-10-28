/**
 * What every repository that tests haibun's modules shares in its Vitest config: the decorator plugin, the browser's and Node's
 * resolution, and Vitest's globals in Node. A repository's own config adds its projects, its timeouts and its worker caps. A repository
 * that depends on haibun resolves each package's build, as with any dependency; haibun's own workspace resolves its packages' source.
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

/** The shared config that resolves a package under `conditions` before the browser's and Node's own. */
const presetUnder = (conditions: readonly string[]): THaibunConfig => ({
	plugins: [standardDecorators],
	resolve: { conditions: [...conditions, ...defaultClientConditions] },
	ssr: { resolve: { conditions: [...conditions, ...SERVER_CONDITIONS] } },
	test: { globals: true, environment: "node" },
});

/** The shared config, which a repository's vitest.config.ts spreads: each package resolves to its build. */
export const haibunPreset = presetUnder([]);

/** haibun's own config: a module's tests read the source of the workspace modules it imports as edited, since Vitest compiles
 *  without the emit that would refresh their builds. */
export const workspacePreset = presetUnder([HAIBUN_SOURCE]);
