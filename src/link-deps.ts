import { readdirSync, readFileSync, statSync } from 'fs';
import { DepGraph } from 'dependency-graph';

import { spawn } from '../modules/core/src/lib/util/index.js';

const graph = new DepGraph();
spawn(['pwd'], '/tmp')


const modules = readdirSync('./modules/').map(f => `./modules/${f}`)
  .filter(f => statSync(f).isDirectory()).map(m => m.replace(/\/$/, '').replace(/.*\//, ''));
modules.forEach(m => graph.addNode(`@haibun/${m}`));

for (const module of modules) {
  const pkg = JSON.parse(readFileSync(`./modules/${module}/package.json`, 'utf-8'));
  const hd = [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})].filter(d => d.startsWith('@haibun/'));
  hd.forEach(dep => graph.addDependency(`@haibun/${module}`, dep));
}

for (const module of graph.overallOrder()) {
  console.log('setting up', module, graph.dependenciesOf(module).length, 'deps');
  const dest = `./modules/${module.replace(/^@haibun\//, '')}`;

  spawn(['npm', 'run', 'build'], dest);
  if (graph.dependenciesOf(module).length) {
    spawn(['npm', 'link', ...graph.dependenciesOf(module)], dest);
  }
  spawn(['npm', 'link'], dest);
}


