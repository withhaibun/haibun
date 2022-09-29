#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

const pkg = require(path.join(__dirname, '..', 'package.json'));
// inherited
const mpkg = {
    'ts-jest': '^26',
    jest: '^26'
}

let pPkg;
let pName;

try {
    const ppkg = readFileSync('./package.json', 'utf-8');
    pPkg = JSON.parse(ppkg);
    pName = pPkg.name.replace(/.*\//, '').replace(/[@]/, '_', 'g').replace(/-./g, (x: string) => x[1].toUpperCase());
} catch (e) {
    console.error(e);
    console.error('please run this command from a project folder that has a package.json file with at least a name field.')
    process.exit(1);
}

pPkg.dependencies['@haibun/core'] = `${pkg.version}`;

if (!pPkg.devDependencies) {
    pPkg.devDependencies = {};
}
for (const d of ['jest', 'ts-jest', 'ts-node', '@types/node', '@types/jest']) {
    if (pPkg.devDependencies[d] === undefined) {
        pPkg.devDependencies[d] = (mpkg as any)[d] || pkg.devDependencies[d];
        console.info(`added ${d} to devDependencies`)
    }
}

if (!pPkg.scripts) {
    pPkg.scripts = {};
}

if (!pPkg.scripts.test || pPkg.scripts?.test.startsWith('echo')) {
    pPkg.scripts.test = 'jest --config jest.config.ts';
    console.info('added test script');
}

writeFileSync('package.json', JSON.stringify(pPkg, null, 2));

for (const f of ['tsconfig.json', 'jest.config.ts']) {
    writeIfMissing(f);
}

if (!existsSync('src')) {
    mkdirSync('src');
}

if (!existsSync('src/lib')) {
    mkdirSync('src/lib');
}

for (const f of ['stepper.ts', 'stepper.test.ts']) {
    writeIfMissing(`src/${f}`, `src/${pName}-${f}`, 'WTW', pName);
}

for (const f of ['ts', 'test.ts']) {
    writeIfMissing(`src/lib/${f}`, `src/lib/${pName}.${f}`, 'WTW', pName);
}

function writeIfMissing(from: string, to?: string, replace?: string, instead?: string) {
    to = to || from;
    from = `${from}.in`;

    if (existsSync(to)) {
        console.info(`not copying ${to} because it already exists`);
    } else {
        let contents = readFileSync(path.join(__dirname, '..', 'scaffold', from), 'utf-8');
        if (replace) {
            contents = contents.replaceAll(replace, instead!);
        }
        writeFileSync(to, contents);
        console.info(`copied ${to}`);
    }
}
