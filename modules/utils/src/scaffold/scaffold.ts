#!/usr/bin/env node

import * as readline from 'node:readline/promises';  // This uses the promise-based APIs
import { stdin as input, stdout as output } from 'node:process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

import { currentVersion } from '@haibun/core/build/currentVersion.js';

type Tkv = { [name: string]: string }

const refDir = path.join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function scaffoldHaibun(dest: string, opts?: { out?: typeof console.info, addDeps?: Tkv, addDevDeps?: Tkv, addDirs?: string[], noPrompt?: boolean }): Promise<void> {
    const { noPrompt, out: outIn } = opts || {};
    const out = outIn || console.info;

    const refPackage = JSON.parse(readFileSync(path.join(refDir, 'ref.package.json'), 'utf-8'));
    const what: { dirs: string[], [name: string]: Tkv | string[] } = {
        dependencies: {
            '@haibun/core': currentVersion,
            '@haibun/cli': currentVersion,
        },
        devDependencies: ["@types/node", "@typescript-eslint/eslint-plugin", "@typescript-eslint/parser", "eslint", "eslint-config-airbnb-typescript"
            , "eslint-config-prettier", "eslint-plugin-import", "eslint-plugin-prefer-arrow", "eslint-plugin-prettier", "vitest"
            , "prettier", "typescript"]
            .reduce((a, i) => ({ ...a, [i]: refPackage.devDependencies[i] }), {} as Tkv),
        scripts: {
            test: 'vitest run',
            "test-watch": 'vitest',
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
            pName = await readPackageName();
            localDest = { name: pName };
        }
    }

    const error: string[] = [];
    if (localDest?.type && localDest.type !== 'module') {
        error.push('package.json type must be "module"');
    }
    const validateError = validate(localDest?.name);
    if (validateError) {
        error.push(`${localDest?.name} is not a valid npm package name: ${validateError}`);
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

    const cName = pName.replace(/-./g, (x) => x[1].toUpperCase());
    for (const f of ['stepper.ts', 'stepper.test.ts']) {
        writeIfMissing(`src/${f}`, `src/${cName}-${f}`, 'WTW', cName);
    }

    for (const f of ['ts', 'test.ts']) {
        writeIfMissing(`src/lib/${f}`, `src/lib/${cName}.${f}`, 'WTW', cName);
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

function validate(name: string) {
    if (name === undefined || name.length < 1 || name.length > 214) {
        return "Package name must be between one and 214 characters long.";
    }

    if (name.startsWith('.') || name.startsWith('_')) {
        return "Package name cannot start with a dot or an underscore.";
    }

    if (/[~'!()*]/.test(name)) {
        return "Package name contains non-URL-safe characters.";
    }

    if (name.trim() !== name || name.includes('--')) {
        return "Package name cannot contain leading or trailing spaces, or multiple consecutive hyphens.";
    }

    if (name !== name.toLowerCase()) {
        return "Package name cannot contain uppercase letters.";
    }

    const reservedNames = ['node_modules', 'favicon.ico'];
    if (reservedNames.includes(name)) {
        return `Package name cannot be a reserved name like '${name}'.`;
    }

    // This is a simplistic check and does not cover all cases.
    const coreModules = ['http', 'fs', 'path', 'util'];
    if (coreModules.includes(name)) {
        return `Package name cannot be the same as a Node.js core module name like '${name}'.`;
    }

    if (encodeURIComponent(name) !== name) {
        return "Package name must be URL-safe.";
    }

    return undefined;
}