#!/usr/bin/env node

import * as readline from 'node:readline/promises';  // This uses the promise-based APIs
import { stdin as input, stdout as output } from 'node:process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import validate from 'validate-npm-package-name';

type Tkv = { [name: string]: string }

const refDir = path.join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function scaffoldHaibun(dest: string, opts?: { out?: typeof console.info, addDeps?: Tkv, addDevDeps?: Tkv, addDirs?: string[], noPrompt?: boolean }): Promise<void> {
    const { noPrompt, out: outIn } = opts || {};
    const out = outIn || console.info;

    const refHaibunPackage = JSON.parse(readFileSync(path.join(refDir, 'ref.package.json'), 'utf-8'));
    const what: { dirs: string[], [name: string]: Tkv | string[] } = {
        dependencies: {
            '@haibun/core': `${refHaibunPackage.version}`
        },
        devDependencies: ["@types/jest", "@types/node", "@typescript-eslint/eslint-plugin", "@typescript-eslint/parser", "eslint", "eslint-config-airbnb-typescript"
            , "eslint-config-prettier", "eslint-plugin-import", "eslint-plugin-prefer-arrow", "eslint-plugin-prettier", "jest"
            , "prettier", "typescript"]
            .reduce((a, i) => ({ ...a, [i]: refHaibunPackage.devDependencies[i] }), {} as Tkv),
        scripts: {
            test: 'NODE_OPTIONS=--experimental-vm-modules jest',
            "test-watch": 'NODE_OPTIONS=--experimental-vm-modules jest',
            "build": "tsc",
            lint: 'lint --ext .ts ./src/',
        },
        dirs: [
            'src',
            'src/lib',
        ]
    }
    let localDest;
    let pName;
    const localPackageJson = path.join(dest, 'package.json');
    try {
        const localPackage = readFileSync(localPackageJson, 'utf-8');
        localDest = JSON.parse(localPackage);
        pName = localDest.name.replace(/.*\//, '').replace(/[@]/, '_', 'g').replace(/-./g, (x: string) => x[1].toUpperCase());
    } catch (e) {
        if (!noPrompt) {
            const name = await readPackageName();
            localDest = { name };
        }
    }

    const error: string[] = [];
    if (localDest?.type && localDest.type !== 'module') {
        error.push('package.json type must be "module"');
    }
    if (!validate(localDest?.name).validForNewPackages) {
        error.push(`${localDest?.name} is not a valid npm package name`);
    }
    if (error.length > 0) {
        throw Error(error.join('\n'));
    }

    localDest.type = 'module';

    for (const t of ['devDependencies', 'dependencies', 'scripts']) {
        if (!localDest[t]) {
            localDest[t] = {};
        }
        for (const [k, v] of Object.entries(what[t])) {
            if (!localDest[t][k]) {
                if (v === undefined) {
                    throw Error(`${t} ${k} is undefined`);
                }
                localDest[t][k] = v;
            }
        }
    }

    writeFileSync(localPackageJson, JSON.stringify(localDest, null, 2));

    for (const f of ['tsconfig.json', 'jest.config.js', '.eslintrc', '.prettierrc']) {
        writeIfMissing(f);
    }

    for (const d of what.dirs) {
        const ddest = path.join(dest, d);
        if (!existsSync(ddest)) {
            out('mkdir', ddest);

            mkdirSync(ddest);
        }
    }

    for (const f of ['stepper.ts', 'stepper.test.ts']) {
        writeIfMissing(`src/${f}`, `src/${pName}-${f}`, 'WTW', pName);
    }

    for (const f of ['ts', 'test.ts']) {
        writeIfMissing(`src/lib/${f}`, `src/lib/${pName}.${f}`, 'WTW', pName);
    }

    function writeIfMissing(from: string, to?: string, replace?: string, instead?: string) {
        to = path.join(dest, to || from);
        from = `${from}.in`;

        if (existsSync(to)) {
            out(`not copying ${to} because it already exists`);
        } else {
            let contents = readFileSync(path.join(refDir, 'scaffold', from), 'utf-8');
            if (replace) {
                contents = contents.replaceAll(replace, `${instead}`);
            }
            writeFileSync(to, contents);
            out(`copied ${to}`);
        }
    }

    out(`\n${localDest.name} scaffolded for Haibun.\nNext you should these commands:\n\nnpm i\nnpm run build\nnpm test\n`);
    return;

    async function readPackageName() {
        const rl = readline.createInterface({ input, output });
        const def = process.cwd().replace(/.*\//, '');
        out(`\nA package.json file is not found.`);
        out(`Please hit enter for a default package name ${def},\nenter a package name (e.g. my-great-package)\nor press control-C to exit`);
        const answer = await rl.question('> ');
        rl.close();
        return answer || def;
    }
}

