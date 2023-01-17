#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

type Tkv = { [name: string]: string }

const refDir = path.join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function scaffoldHaibun(dest: string, out: typeof console.info, add?: { addDeps?: Tkv, addDevDeps?: Tkv, addDirs: string[] }): void {
    const refHaibunPackage = JSON.parse(readFileSync(path.join(refDir, 'package.json'), 'utf-8'));
    console.log('hm', refDir, refHaibunPackage);

    const what: { dirs: string[], [name: string]: Tkv | string[] } = {
        dependencies: {
            '@haibun/core': `${refHaibunPackage.version}`
        },
        devDependencies: ["@types/jest", "@types/node", "@typescript-eslint/eslint-plugin", "@typescript-eslint/parser", "eslint", "eslint-config-airbnb-typescript"
            , "eslint-config-prettier", "eslint-plugin-import", "eslint-plugin-prefer-arrow", "eslint-plugin-prettier", "jest"
            , "prettier", "ts-jest", "typescript"]
            .reduce((a, i) => ({ ...a, [i]: refHaibunPackage.devDependencies[i] }), {} as Tkv),
        scripts: {
            test: 'jest --config jest.config.ts',
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
        throw Error('please run this command from a project folder that has a package.json file with at least a name field. {e}');
    }

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

    for (const f of ['tsconfig.json', 'jest.config.ts', '.eslintrc', '.prettierrc']) {
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
    return;
}

