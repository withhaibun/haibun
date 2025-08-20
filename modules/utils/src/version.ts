#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'fs';
import prettier from 'prettier';
import { spawnCommand } from './util/index.js';
import { createVitest } from 'vitest/node';

const [, me, version, ...extra] = process.argv;

async function format(contents: object) {
	return await prettier.format(JSON.stringify(contents), { parser: 'json' });
}
class Versioner {
	localAndExtraModules: { [name: string]: string } = {};
	private noTest = false;
	noPublish = false;

	haibunPackageVersions: { [dep: string]: string } = {};

	constructor(private version: string) {
		if (!version) {
			console.error(`usage: ${me}: <version> <extra modules> [--notest]`);
			process.exit(1);
		}
		extra.forEach((e, i) => {
			if (e === '--notest') {
				this.noTest = true;
				extra.splice(i, 1);
			} else if (e === '--nopublish') {
				this.noPublish = true;
				extra.splice(i, 1);
			} else if (e.startsWith('-')) {
				throw Error(`unknown option ${e}; use --notest or --nopublish`);
			}
		});
	}

	async doVersion() {
		const haibunPackageJson = this.updateHaibunPackageVersions();
		haibunPackageJson.version = this.version;
		writeFileSync('./package.json', await format(haibunPackageJson));

		this.setLocalAndExtraModules();

		await this.forLocalAndExtraModules(this.updateModule as (name: string, location: string) => Promise<void>);
		this.updateSourceCurrentVersion();
		await this.gitCommit('haibun', '.', ['./modules/core/src/currentVersion.ts']);
		await this.forLocalAndExtraModules(this.npmInstall);
		// eslint-disable-next-line @typescript-eslint/no-misused-promises
		await this.forLocalAndExtraModules(this.runTest);
		await this.forLocalAndExtraModules(this.gitCommit);
		await this.forLocalAndExtraModules(this.npmPublish);
		await this.forLocalAndExtraModules(this.gitPush);
	}


	async forLocalAndExtraModules(someFunction: (name: string, location: string) => Promise<void>) {
		console.info(`\n## ${someFunction.name}`);
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

	async npmPublish(name: string, module: string) {
		if (this.noPublish) {
			return;
		}
		await spawnCommand(['npm', 'publish'], module).catch((e) => {
			console.error(`npm publish failed for ${name}: ${e}`);
		});
	}

	async gitPush(name: string, module: string) {
		await spawnCommand(['git', 'push'], module).catch((e) => {
			console.error(`git push failed for ${name}: ${e}`);
		});
	}

	async updateModule(name: string, location: string): Promise<void> {
		const pkgFile = `${location}/package.json`;
		const pkg = JSON.parse(readFileSync(pkgFile, 'utf-8'));
		if (!pkg.publish && pkg.publish !== undefined) {
			return;
		}
		const { main } = pkg;
		if (main && !main.includes('*') && !existsSync(`${location}/${main}`)) {
			throw Error(`main file ${main} does not exist in ${location}`);
		}
		pkg.version = this.version;
		this.updateDependencies(pkg.dependencies);
		this.updateDependencies(pkg.devDependencies);

		writeFileSync(pkgFile, await format(pkg));
		return;
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

	async gitCommit(name: string, location: string, extraPackages = []) {
		const packages = [...extraPackages, 'package.json'];
		await spawnCommand(['git', 'commit', '-m', `'update ${name} to version ${this.version}'`, ...packages], location).catch((e) => {
			console.error(`git commit failed for ${name}: ${e}`);
		});
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

	async npmInstall(name: string, location: string) {
		await spawnCommand(['npm', 'install'], location).catch((e) => {
			console.error(`npm install failed for ${name}: ${e}`);
		});
	}
}

void (await new Versioner(version).doVersion());
