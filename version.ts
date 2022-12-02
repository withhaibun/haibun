import { execSync } from "child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { resolve } from "path";

const [, me, version, ...extra] = process.argv;

if (!version) {
    console.error(`usage: ${me}: <version> <extra modules>`);
    process.exit(1);
}

const modules = readdirSync(`./modules/`).map(f => `./modules/${f}`).filter(f => statSync(f).isDirectory()).concat(extra);
for (const module of modules) {
    const eh = (what: string) => {
        return new Promise((resolve, reject) => {
            console.log(`$ ${what}`);
            try {
                const res = execSync(what, { encoding: 'utf8', cwd: module });
                console.log(res);
                resolve(res);
            } catch (e) {
                reject(e);
            }
        });
    }
    eh('pwd');
    updateVersion(module);
    eh(`git commit -m 'update ${module.replace(/\/$/, '').replace(/.*\//, '')} to version ${version}' package.json`).catch((e: any) => console.error(`${module} failed with ${e}`));
    eh(`npm publish`);
}
updateVersion('.');

function updateVersion(module: string) {
    const pkgFile = `${module}/package.json`;
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf-8'));
    pkg.version = version;
    writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
}

