import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const PackageJsonSchema = z.object({ version: z.string().min(1) });

/** The version of haibun's modules, which release together at one version: core's, as its package.json states it. */
export const currentVersion: string = PackageJsonSchema.parse(JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../package.json"), "utf-8"))).version;
