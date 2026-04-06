#!/usr/bin/env node

import { execSync } from "child_process";
import fs from "fs";

const pkg = JSON.parse(fs.readFileSync("./package.json", "utf-8"));

const dependencies = Object.keys(pkg.dependencies || {});
const devDependencies = Object.keys(pkg.devDependencies || {});

const res = [];
for (const i of [...dependencies, ...devDependencies]) {
	console.log(`Linking ${i}`);
	res.push(execSync(`npm link ${i}`).toString());
}
console.log(`>> ${res}`);
