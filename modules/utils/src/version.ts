import { existsSync, readFileSync, writeFileSync } from 'fs';
import { spawn } from './util/index.js';

const [, me, version, ...extra] = process.argv;

class Versioner {
  toPublish: string[] = [];
  version: string;
  haibun: { [dep: string]: string } = {};
  constructor(version: string) {
    this.version = version;
  }
  doVersion() {
    try {
      const hpkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
      if (hpkg.name !== 'haibun') {
        throw Error('not in haibun root');
      }
      for (const [dep, version] of Object.entries({
        ...hpkg.dependencies,
        ...hpkg.devDependencies,
      })) {
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

    for (const [dest, ext] of Object.entries({ src: 'ts', build: 'js' })) {
      writeFileSync(`./modules/core/${dest}/currentVersion.${ext}`, `export const currentVersion = '${this.version}';\n`);
    }

    const modules = JSON.parse(readFileSync(`./modules/tsconfig.json`, 'utf-8'))
      .references
      .map(f => `./modules/${f.path}`)
      .concat(extra);

    for (const module of modules) {
      const name = module.replace(/\/$/, '').replace(/.*\//, '');
      if (this.verifyShouldPublishStructureAndUpdateVersion(name, module)) {
        this.toPublish.push(module);
      }
    }
    this.verifyShouldPublishStructureAndUpdateVersion('haibun', '.');
    this.publishAll();
    const packageJson = JSON.parse(readFileSync('./package.json', 'utf-8'));
    packageJson.version = this.version;
    writeFileSync('./package.json', JSON.stringify(packageJson, null, 2));
    spawn(['git', 'commit', '-m', `'update haibun to version ${this.version}'`, 'package.json', 'modules/core/src/currentVersion.ts'], '.');
  }

  publishAll() {
    for (const module of this.toPublish) {
      console.info('\n\n*** publishing', module);
      spawn(['npm', 'publish'], module);
      spawn(['git', 'push'], module);
    }
  }

  verifyShouldPublishStructureAndUpdateVersion(name: string, location: string) {
    if (location !== '.') {
      const pkgFile = `${location}/package.json`;
      const pkg = JSON.parse(readFileSync(pkgFile, 'utf-8'));
      if (!pkg.publsh && pkg.publish !== undefined) {
        return false;
      }
      console.info('updating', name);
      const { main } = pkg;
      if (main && !main.includes('*') && !existsSync(`${location}/${main}`)) {
        throw Error(`main file ${main} does not exist in ${location}`);
      }
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
        // spawn(['npm', 'run', 'test'], location, { env: { NODE_OPTIONS: '--experimental-vm-modules' } });
      } catch (e) {
        console.error(`npm test failed for ${name}: ${e}`);
        throw e;
      }

      try {
        spawn(['git', 'commit', '-m', `'update ${name} to version ${this.version}'`, 'package.json',], location);
      } catch (e) {
        console.error(`git commit failed for ${name}: ${e}`);
        throw e;
      }
    }
    return true;
  }
}

new Versioner(version).doVersion();
