import { existsSync, readFileSync, writeFileSync } from 'fs';
import { spawn } from './util/index.js';

const [, me, version, ...extra] = process.argv;

class Versioner {
	localAndExtraModules = new Set<{ [name: string]: string }>();

	version: string;
	haibunPackageVersions: { [dep: string]: string } = {};
	constructor(version: string) {
		if (!version) {
			console.error(`usage: ${me}: <version> <extra modules>`);
		}
		this.version = version;
	}
	doVersion() {
		const haibunPackageJson = this.updateHaibunPackageVersions();
		haibunPackageJson.version = this.version;
		writeFileSync('./package.json', JSON.stringify(haibunPackageJson, null, 2));

		this.setLocalAndExtraModules();

		this.forLocalAndExtraModules(this.updateModule);
		this.forLocalAndExtraModules(this.npmInstall);
		this.forLocalAndExtraModules(this.npmTest);
		this.forLocalAndExtraModules(this.gitCommit);
		this.forLocalAndExtraModules(this.npmPublish);
		this.forLocalAndExtraModules(this.gitPush);

		this.updateSourceCurrentVersion();

		this.gitCommit('haibun', '.', ['modules/core/src/currentVersion.ts']);
	}

	forLocalAndExtraModules(updateModule: (name: string, location: string) => void) {
		for (const { name, module } of this.localAndExtraModules) {
			updateModule(name, module);
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
		for (const module in modules) {
			const name = module.replace(/\/$/, '').replace(/.*\//, '');
			this.localAndExtraModules.add({ [name]: module });
		}
	}

	testAll() {
		for (const { name, module } of this.localAndExtraModules) {
			console.info('\n\n*** publishing', module);
			this.npmTest(name, module);
		}
	}

	npmPublish(name, module) {
		console.info('\n\n*** publishing', module);
		spawn(['npm', 'publish'], module);
	}
	gitPush(name, module) {
		console.info('\n\n*** publishing', module);
		spawn(['git', 'push'], module);
	}

	updateModule(name: string, location: string) {
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
			if (this.haibunPackageVersions[d]) {
				pkg.dependencies[d] = this.haibunPackageVersions[d];
			}
		}
		for (const d in pkg.devDependencies) {
			if (d.startsWith('@haibun/')) {
				pkg.devDependencies[d] = this.version;
			}
			if (this.haibunPackageVersions[d]) {
				pkg.devDependencies[d] = this.haibunPackageVersions[d];
			}
		}

		writeFileSync(pkgFile, JSON.stringify(pkg, null, 2));
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
