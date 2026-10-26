import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The version of haibun's modules, which release together at one version: core's, as its package.json states it. */
export const currentVersion: string = (JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../package.json"), "utf-8")) as { version: string }).version;
