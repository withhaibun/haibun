import { readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import ChildProcess from "child_process";

const [, me, version, ...extra] = process.argv;

class Versioner {
    toPublish: string[] = [];
    version: string;
    constructor(version: string) {
        this.version = version;
    }
    async doVersion() {
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

            await this.spawn(['npm', 'publish'], module);
            this.spawn(['git', 'push'], module);
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
        }
        for (const d in pkg.devDependencies) {
            if (d.startsWith('@haibun/')) {
                pkg.devDependencies[d] = this.version;
            }
        }

        writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
        try {
            this.spawn(['npm', 'run', 'test'], location);
        } catch (e: any) {
            console.error(`\nnpm test failed for ${name}: ${e}`);
            throw (e)
        }

        try {
            this.spawn(['git', 'commit', '-m', `'update ${name} to version ${this.version}'`, 'package.json'], location);
        } catch (e: any) {
            console.error(`\/*  */ngit commit failed for ${name}: ${e}`);
            throw (e)
        }
    }

    spawn(command: string[], module: string, show: boolean = false) {
        console.info(`$ ${command.join(' ')}`);
        const [cmd, ...args] = command;
        const { output, stdout, stderr, status, error } = ChildProcess.spawnSync(cmd, args, { cwd: module, env: process.env });
        if (error) {
            console.error(`${module}: ${error}`);
            throw (error);
        }
        if (show) {
            console.log(`${module}: ${stdout}`);
        }
    }
}

new Versioner(version).doVersion();