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

    const modules = JSON.parse(readFileSync(`./modules/tsconfig.json`, 'utf-8'))
      .references
      .map(f => `./modules/${f.path}`)
      .concat(extra);

    for (const module of modules) {
      const name = module.replace(/\/$/, '').replace(/.*\//, '');
      this.verifyStructureAndUpdateVersion(name, module);
      this.toPublish.push(module);
    }

    this.verifyStructureAndUpdateVersion('haibun', '.');
    this.publishAll();
  }

  publishAll() {
    for (const module of this.toPublish) {
      console.info('publishing', module);
      spawn(['npm', 'publish'], module);
      spawn(['git', 'push'], module);
    }
  }

  verifyStructureAndUpdateVersion(name: string, location: string) {
    console.info('updating', name);
    if (location !== '.') {
      const pkgFile = `${location}/package.json`;
      const pkg = JSON.parse(readFileSync(pkgFile, 'utf-8'));
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
  }
}

new Versioner(version).doVersion();
