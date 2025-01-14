import { existsSync, readFileSync, writeFileSync } from 'fs';
import prettier from 'prettier';
import { spawn } from './util/index.js';
import { createVitest } from 'vitest/node';

const [, me, version, ...extra] = process.argv;

class Versioner {
	localAndExtraModules: { [name: string]: string } = {}; // Changed to an object
	private noTest = false;

	haibunPackageVersions: { [dep: string]: string } = {};

	constructor(private version: string) {
		if (!version) {
			console.error(`usage: ${me}: <version> <extra modules> [--notest]`);
			process.exit(1);
		}
		// check for --notest in extra, if it exist, set a notest flag on class and remove it from extra
		if (extra.includes('--notest')) {
			this.noTest = true;
			extra.splice(extra.indexOf('--notest'), 1);
		}
	}

	async doVersion() {
		const haibunPackageJson = this.updateHaibunPackageVersions();
		haibunPackageJson.version = this.version;
		writeFileSync('./package.json', this.format(haibunPackageJson));

		this.setLocalAndExtraModules();

		await this.forLocalAndExtraModules(this.updateModule);
		this.updateSourceCurrentVersion();
		this.gitCommit('haibun', '.', ['./modules/core/src/currentVersion.ts']);
		await this.forLocalAndExtraModules(this.npmInstall);
		await this.forLocalAndExtraModules(this.runTest);
		await this.forLocalAndExtraModules(this.gitCommit);
		await this.forLocalAndExtraModules(this.npmPublish);
		await this.forLocalAndExtraModules(this.gitPush);
	}

	format(contents: object) {
		return prettier.format(JSON.stringify(contents), { parser: 'json' });
	}

	async forLocalAndExtraModules(someFunction: (name: string, location: string) => void) {
		for (const [name, module] of Object.entries(this.localAndExtraModules)) {
			console.info('running', someFunction.name, 'for', name, module);
			await someFunction.call(this, name, module); // Bind `this` to each action
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
			console.info('updated currentVersion', dest);
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
			spawn(['git', 'commit', '-m', `'update ${name} to version ${this.version}'`, ...packages], location);
		} catch (e) {
			console.error(`git commit failed for ${name}: ${e}`);
			throw e;
		}
	}

	async runTest(name: string, location: string) {
		if (this.noTest) {
			return;
		}
		const originalDir = process.cwd();
		try {
			process.chdir(location);

			const vitest = await createVitest('test', { watch: false });
			await vitest.start();
			await vitest?.close();
		} catch (error) {
			console.error(`npm test failed for ${name}: ${error}`);
			throw error;
		} finally {
			process.chdir(originalDir);
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

void (await new Versioner(version).doVersion());
