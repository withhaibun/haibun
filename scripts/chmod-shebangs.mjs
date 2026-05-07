#!/usr/bin/env node
// Mark every .js under modules/*/build/ whose first bytes are `#!` as executable.
// tsc drops the exec bit; this restores it after every build.

import { openSync, readSync, closeSync, readdirSync, statSync, chmodSync } from "node:fs";
import { join } from "node:path";

const MODULES = "modules";
const SHEBANG = Buffer.from("#!");

function* walk(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name);
		if (entry.isDirectory()) yield* walk(p);
		else if (entry.isFile() && p.endsWith(".js")) yield p;
	}
}

function startsWithShebang(path) {
	const fd = openSync(path, "r");
	try {
		const buf = Buffer.alloc(2);
		const n = readSync(fd, buf, 0, 2, 0);
		return n === 2 && buf.equals(SHEBANG);
	} finally {
		closeSync(fd);
	}
}

let modules;
try {
	modules = readdirSync(MODULES, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => join(MODULES, e.name, "build"))
		.filter((d) => {
			try {
				return statSync(d).isDirectory();
			} catch {
				return false;
			}
		});
} catch {
	process.exit(0);
}

let marked = 0;
for (const buildDir of modules) {
	for (const file of walk(buildDir)) {
		if (!startsWithShebang(file)) continue;
		const mode = statSync(file).mode;
		const withExec = mode | 0o111;
		if (mode !== withExec) {
			chmodSync(file, withExec);
			marked++;
		}
	}
}
if (marked) console.log(`postbuild: chmod +x on ${marked} shebang file(s)`);
