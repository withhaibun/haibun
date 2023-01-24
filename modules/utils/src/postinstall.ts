#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'fs';
import { DepGraph } from 'dependency-graph';
import { spawn } from './util/index.js';

console.log('linking packages');

const graph = new DepGraph();

const modules = readdirSync('./modules/').map(f => `./modules/${f}`)
  .filter(f => statSync(f).isDirectory()).map(m => m.replace(/\/$/, '').replace(/.*\//, ''));
modules.forEach(m => graph.addNode(`@haibun/${m}`));

for (const module of [...modules]) {
  const pkg = JSON.parse(readFileSync(`./modules/${module}/package.json`, 'utf-8'));
  const hd = [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})].filter(d => d.startsWith('@haibun/'));
  hd.forEach(dep => graph.addDependency(`@haibun/${module}`, dep));
}

try {
  doWork();
} catch (e) {
  console.error('caught an exception:', e);
  process.exit(1);
}

function doWork() {
  for (const module of graph.overallOrder()) {
    console.info('setting up', module, graph.dependenciesOf(module).length, 'deps');
    const dest = `./modules/${module.replace(/^@haibun\//, '')}`;

    spawn(['tsc', '-b', '.'], dest);
    if (graph.dependenciesOf(module).length) {
      spawn(['npm', 'link', ...graph.dependenciesOf(module)], dest);
    }
    spawn(['npm', 'link'], dest);
  }
}

