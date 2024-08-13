import { existsSync, readFileSync, writeFileSync } from 'fs';
import prettier from 'prettier';
import { spawn } from './util/index.js';

const [, me, version, ...extra] = process.argv;

class Versioner {
	localAndExtraModules: { [name: string]: string } = {}; // Changed to an object

	haibunPackageVersions: { [dep: string]: string } = {};

	constructor(private version: string) {
		if (!version) {
			console.error(`usage: ${me}: <version> <extra modules>`);
			process.exit(1);
		}
	}

	doVersion() {
		const haibunPackageJson = this.updateHaibunPackageVersions();
		haibunPackageJson.version = this.version;
		writeFileSync('./package.json', this.format(haibunPackageJson));

		this.setLocalAndExtraModules();

		this.forLocalAndExtraModules(this.updateModule);
		// this.forLocalAndExtraModules(this.npmInstall);
		this.forLocalAndExtraModules(this.npmTest);
		this.forLocalAndExtraModules(this.gitCommit);
		this.forLocalAndExtraModules(this.npmPublish);
		this.forLocalAndExtraModules(this.gitPush);

		this.updateSourceCurrentVersion();
		this.gitCommit('haibun', '.', ['modules/core/src/currentVersion.ts']);
	}

	format(contents: object) {
		return prettier.format(JSON.stringify(contents), { parser: 'json' });
	}

	forLocalAndExtraModules(someFunction: (name: string, location: string) => void) {
		for (const [name, module] of Object.entries(this.localAndExtraModules)) {
			console.info('running', someFunction.name, 'for', name, module);
			someFunction.call(this, name, module); // Bind `this` to each action
		}
	}

	updateHaibunPackageVersions() {
		const hpkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
		if (hpkg.name !== 'haibun') {
			throw Error('not in haibun root');
		}
		for (const [dep, version] of Object.entries({ ...hpkg.dependencies, ...hpkg.devDependencies })) {
			this.haibunPackageVersions[dep] = <string>version;
		}
		return hpkg;
	}

	private updateSourceCurrentVersion() {
		for (const [dest, ext] of Object.entries({ src: 'ts', build: 'js' })) {
			writeFileSync(`./modules/core/${dest}/currentVersion.${ext}`, `export const currentVersion = '${this.version}';\n`);
		}
	}

	setLocalAndExtraModules() {
		const modules = JSON.parse(readFileSync(`./modules/tsconfig.json`, 'utf-8'))
			.references.map((f) => `./modules/${f.path}`)
			.concat(extra);
		for (const module of modules) {
			const name = module.replace(/\/$/, '').replace(/.*\//, '');
			this.localAndExtraModules[name] = module;
		}
	}

	testAll() {
		for (const [name, module] of Object.entries(this.localAndExtraModules)) {
			this.npmTest(name, module);
		}
	}

	npmPublish(name: string, module: string) {
		spawn(['npm', 'publish'], module);
	}

	gitPush(name: string, module: string) {
		spawn(['git', 'push'], module);
	}

	updateModule(name: string, location: string) {
		const pkgFile = `${location}/package.json`;
		const pkg = JSON.parse(readFileSync(pkgFile, 'utf-8'));
		if (!pkg.publish && pkg.publish !== undefined) {
			return false;
		}
		const { main } = pkg;
		if (main && !main.includes('*') && !existsSync(`${location}/${main}`)) {
			throw Error(`main file ${main} does not exist in ${location}`);
		}
		pkg.version = this.version;
		this.updateDependencies(pkg.dependencies);
		this.updateDependencies(pkg.devDependencies);

		writeFileSync(pkgFile, this.format(pkg));
	}

	updateDependencies(dependencies: { [key: string]: string }) {
		for (const d in dependencies) {
			if (Object.prototype.hasOwnProperty.call(dependencies, d)) {
				if (d.startsWith('@haibun/')) {
					dependencies[d] = this.version;
				}
				if (this.haibunPackageVersions[d]) {
					dependencies[d] = this.haibunPackageVersions[d];
				}
			}
		}
	}

	gitCommit(name: string, location: string, extraPackages = []) {
		const packages = [...extraPackages, 'package.json'];
		try {
			spawn(['git', 'commit', '-m', `'update ${name} to version ${this.version}'`, packages.join(' ')], location);
		} catch (e) {
			console.error(`git commit failed for ${name}: ${e}`);
			throw e;
		}
	}

	npmTest(name: string, location: string) {
		try {
			spawn(['npm', 'run', 'test'], location);
		} catch (e) {
			console.error(`npm test failed for ${name}: ${e}`);
			throw e;
		}
	}

	npmInstall(name: string, location: string) {
		try {
			spawn(['npm', 'install'], location);
		} catch (e) {
			console.error(`npm install failed for ${name}: ${e}`);
			throw e;
		}
	}
}

new Versioner(version).doVersion();
