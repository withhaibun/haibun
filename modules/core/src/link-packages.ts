#!/usr/bin/env node

import { readFileSync } from "fs";
import { spawn } from "./lib/util/index.js";

let pkg;
try {
    pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
} catch (e) {
    console.error(`failed to read package.json ${e}`);
    process.exit(1);
}

for (const i in pkg.dependencies) {
    if (i.startsWith('@haibun/')) {
        spawn(['npm', 'link', i], process.cwd());
    }
}

for (const i in pkg.devDependencies) {
    if (i.startsWith('@haibun/')) {
        spawn(['npm', 'link', i], process.cwd());
    }
}