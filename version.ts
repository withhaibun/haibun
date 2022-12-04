import { readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import ChildProcess from "child_process";

const [, me, version, ...extra] = process.argv;


doVersion();

async function doVersion() {
    if (!version) {
        console.error(`usage: ${me}: <version> <extra modules>`);
        process.exit(1);
    }

    const modules = readdirSync(`./modules/`).map(f => `./modules/${f}`).filter(f => statSync(f).isDirectory()).concat(extra);
    for (const module of modules) {
        const name = module.replace(/\/$/, '').replace(/.*\//, '');
        await spawn('pwd', [], { cwd: module });
        await updateVersion(name, module);
       await spawn('npm', ['publish'], { cwd: module });
    }

    updateVersion('haibun', '.');
}

async function updateVersion(name: string, location: string) {
    const pkgFile = `${location}/package.json`;
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf-8'));
    pkg.version = version;
    writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
    await spawn('git', ['commit', '-m', `'update ${name} to version ${version}'`, 'package.json'], { encoding: 'utf8', cwd: location }).catch((e: any) => { throw (e) });
    await spawn('git', ['push'], { encoding: 'utf8', cwd: location }).catch((e: any) => { throw (e) });
}

// https://stackoverflow.com/questions/63796633/spawnsync-bin-sh-enobufs
function spawn(command: string, args: string[], spawnOpts: any = {}, silenceOutput = false) {
    console.info(`$ ${command} ${args.join(' ')}`);
    return new Promise((resolve, reject) => {
        let errorData = "";

        const spawnedProcess = ChildProcess.spawn(command, args, spawnOpts);

        let data = "";

        spawnedProcess.on("message", console.info);

        spawnedProcess.stdout.on("data", chunk => {
            if (!silenceOutput) {
                console.info(chunk.toString());
            }

            data += chunk.toString();
        });

        spawnedProcess.stderr.on("data", chunk => {
            errorData += chunk.toString();
        });

        spawnedProcess.on("close", function (code) {
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
