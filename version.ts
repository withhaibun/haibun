import { readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { spawn } from './modules/core/src/lib/util/';
import ChildProcess from "child_process";

const [, me, version, ...extra] = process.argv;

class Versioner {
    toPublish: string[] = [];
    version: string;
    haibun: { [dep: string]: string } = {};
    constructor(version: string) {
        this.version = version;
    }
    async doVersion() {
        try {
            const hpkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
            if (hpkg.name !== 'haibun') {
                throw Error('not in haibun root');
            }
            for (const [dep, version] of Object.entries({ ...hpkg.dependencies, ...hpkg.devDependencies })) {
                this.haibun[dep] = <string>version;
            }
        } catch (e) {
            console.error(e);
            process.exit(1);
        }

        if (!this.version) {
            console.error(`usage: ${me}: <version> <extra modules>`);
            process.exit(1);
        }

        const modules = readdirSync(`./modules/`).map(f => `./modules/${f}`).filter(f => statSync(f).isDirectory()).concat(extra);
        for (const module of modules) {
            const name = module.replace(/\/$/, '').replace(/.*\//, '');
            await this.updateVersion(name, module);
            this.toPublish.push(module);
        }

        this.updateVersion('haibun', '.');
        await this.publishAll();
    }

    async publishAll() {
        for (const module of this.toPublish) {
            console.log('publishing', module);

            await spawn(['npm', 'publish'], module);
            spawn(['git', 'push'], module);
        }
    }

    async updateVersion(name: string, location: string) {
        console.log('updating', name);

        const pkgFile = `${location}/package.json`;
        const pkg = JSON.parse(readFileSync(pkgFile, 'utf-8'));
        pkg.version = this.version;
        for (const d in pkg.dependencies) {
            if (d.startsWith('@haibun/')) {
                pkg.dependencies[d] = this.version;
            }
            if (this.haibun[d]) {
                pkg.dependencies[d] = this.haibun[d];
            }
        }
        for (const d in pkg.devDependencies) {
            if (d.startsWith('@haibun/')) {
                pkg.devDependencies[d] = this.version;
            }
            if (this.haibun[d]) {
                pkg.devDependencies[d] = this.haibun[d];
            }
        }

        writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
        try {
            spawn(['npm', 'run', 'test'], location);
        } catch (e: any) {
            console.error(`\nnpm test failed for ${name}: ${e}`);
            throw (e)
        }

        try {
            spawn(['git', 'commit', '-m', `'update ${name} to version ${this.version}'`, 'package.json'], location);
        } catch (e: any) {
            console.error(`\/*  */ngit commit failed for ${name}: ${e}`);
            throw (e)
        }
    }


}

new Versioner(version).doVersion();