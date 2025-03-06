#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';

const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));

const dependencies = Object.keys(pkg.dependencies || {});
const devDependencies = Object.keys(pkg.devDependencies || {});

const hai = [...dependencies, ...devDependencies]
  .filter(d => d.startsWith('@haibun'))
  .join(' ');

console.log(`Linking ${hai}`);
const res = execSync(`npm link ${hai}`).toString();
console.log(`>> ${res}`);
