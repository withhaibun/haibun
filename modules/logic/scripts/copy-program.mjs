// Copies the engine's Prolog program beside its adapter in the build, since the TypeScript build copies only TypeScript.
import { copyFileSync } from "node:fs";
copyFileSync(new URL("../src/adapters/haibun.pl", import.meta.url), new URL("../build/adapters/haibun.pl", import.meta.url));
