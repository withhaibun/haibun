import { execSync } from "child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "fs";

const [, me, version, ...extra] = process.argv;

if (!version) {
    console.error(`usage: ${me}: <version> <extra modules>`);
    process.exit(1);
}

const modules = readdirSync(`./modules/`).map(f => `./modules/${f}`).filter(f => statSync(f).isDirectory()).concat(extra);
for (const module of modules) {
    const eh = (what: string) => execSync(what, { encoding: 'utf8', cwd: module });
    const res = eh('pwd');
    const pkgFile = `${module}/package.json`;
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf-8'));
    pkg.version = version;
    writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
    eh(`git commit -m 'update ${module.replace(/\/$/, '').replace(/.*\//, '')} to version ${version}' package.json`);
    eh(`npm publish`);
}

