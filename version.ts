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
    }
    async publishAll() {
        for (const module in this.toPublish) {
            await this.spawn('npm', ['publish'], { cwd: module });
            // await spawn('git', ['push'], { encoding: 'utf8', cwd: location }).catch((e: any) => { throw (e) });
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
        await this.spawn('npm', ['run', 'test'], { encoding: 'utf8', cwd: location }).catch((e: any) => {
            console.error(`\nnpm test failed for ${name}: ${e}`);
            throw (e)
        });

        await this.spawn('git', ['commit', '-m', `'update ${name} to version ${this.version}'`, 'package.json'], { encoding: 'utf8', cwd: location }).catch((e: any) => {
            console.error(`\/*  */ngit commit failed for ${name}: ${e}`);
            throw (e)
        });
    }

    // https://stackoverflow.com/questions/63796633/spawnsync-bin-sh-enobufs
    spawn(command: string, args: string[], spawnOpts: any = {}, silenceOutput = false) {
        console.info(`$ ${command} ${args.join(' ')}`);
        return new Promise((resolve, reject) => {
            let errorData = "";

            const spawnedProcess = ChildProcess.spawn(command, args, spawnOpts);

            let data = "";

            // spawnedProcess.on("message", console.info);

            spawnedProcess.stdout.on("data", chunk => {
                if (!silenceOutput) {
                    // console.info(chunk.toString());
                }

                data += chunk.toString();
            });

            spawnedProcess.stderr.on("data", chunk => {
                errorData += chunk.toString();
            });

            spawnedProcess.on("close", function (code) {
                // added errorData.length check to example
                if (code && code > 0 && errorData.length > 0) {
                    return reject(new Error(`${errorData} ${JSON.stringify(spawnOpts)} ${code} ${command} ${args}`));
                }
                return resolve(data);
            });

            spawnedProcess.on("error", function (err) {
                reject(err);
            });
        });
    }
}

new Versioner(version).doVersion();