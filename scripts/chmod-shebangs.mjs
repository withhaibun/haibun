#!/usr/bin/env node
// Find every .js under modules/*/build/ whose first line begins with '#!' and mark it executable.
// tsc drops the executable bit; this restores it after every build.

import { readdirSync, readFileSync, statSync, chmodSync } from "node:fs";
import { join } from "node:path";

const MODULES = "modules";

function walk(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		const s = statSync(p);
		if (s.isDirectory()) out.push(...walk(p));
		else if (p.endsWith(".js")) out.push(p);
	}
	return out;
}

let modules;
try {
	modules = readdirSync(MODULES).map((m) => join(MODULES, m, "build")).filter((d) => {
		try { return statSync(d).isDirectory(); } catch { return false; }
	});
} catch {
	process.exit(0);
}

let marked = 0;
for (const buildDir of modules) {
	for (const file of walk(buildDir)) {
		const buf = readFileSync(file, { encoding: "utf-8" });
		if (!buf.startsWith("#!")) continue;
		const mode = statSync(file).mode;
		const withExec = mode | 0o111;
		if (mode !== withExec) {
			chmodSync(file, withExec);
			marked++;
		}
	}
}
if (marked) console.log(`postbuild: chmod +x on ${marked} shebang file(s)`);
