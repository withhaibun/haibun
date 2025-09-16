import { resolve } from 'path';
import { pathToFileURL } from 'url';

import { CAPTURE, OK, TStepArgs, TWorld } from '@haibun/core/lib/defs.js';
import { captureLocator } from '@haibun/core/lib/capture-locator.js';
import { actionNotOK } from '@haibun/core/lib/util/index.js';
import { guessMediaType, IFile, TLocationOptions } from './domain-storage.js';
import { EMediaTypes, TMediaType } from './media-types.js';
import { AStepper } from '@haibun/core/lib/astepper.js';
import { TAnyFixme } from '@haibun/core/lib/fixme.js';

export type TTree = Array<IFile | IFileWithEntries>;

interface IFileWithEntries extends IFile {
	entries: TTree;
}
export abstract class AStorage extends AStepper {
	abstract readFile(path: string, coding?: string): TAnyFixme;
	abstract rm(path: string);
	abstract readdir(dir: string): Promise<string[]>;
	abstract lstatToIFile(file: string): Promise<IFile>;
	abstract writeFileBuffer(file: string, contents: Buffer, mediaType: TMediaType): void;

	async readFlat(dir: string, filter?: string): Promise<IFile[]> {
		const entries = await this.readdirStat(dir);
		const tree: IFile[] = [];
		for (const e of entries) {
			if (e.isDirectory) {
				const sub = await this.readFlat(e.name.replace(/^\/\//, '/'), filter);
				tree.push(...sub);
			} else if (!filter || e.name.match(filter)) {
				tree.push(e);
			}
		}
		return tree;
	}

	async readTree(dir: string, filter?: string): Promise<TTree> {
		const entries = await this.readdirStat(dir);
		const tree: TTree = [];
		for (const e of entries) {
			if (e.isDirectory) {
				const sub = await this.readTree(e.name.replace(/^\/\//, '/'), filter);
				tree.push({ ...e, entries: sub });
			} else if (!filter || e.name.match(filter)) {
				tree.push(e);
			}
		}
		return tree;
	}

	async readdirStat(dir: string): Promise<IFile[]> {
		const files = await this.readdir(dir);
		const mapped: IFile[] = [];
		for (const file of files) {
			const f = await this.lstatToIFile(`${dir}/${file}`);
			mapped.push(f);
		}
		return mapped;
	}
	async writeFile(file: string, contents: string | Buffer, mediaType: TMediaType) {
		if (typeof contents === 'string') {
			await this.writeFileBuffer(file, Buffer.from(contents), mediaType);
		} else {
			await this.writeFileBuffer(file, contents as Buffer, mediaType);
		}
	}

	async latestFrom(dir: string) {
		const orderReccentFiles = async (dir: string) =>
			(await this.readdirStat(dir)).filter((f) => f.isFile).sort((a, b) => b.created - a.created);
		return Promise.resolve(orderReccentFiles(dir)[0]);
	}

	abstract mkdir(dir: string);
	abstract mkdirp(dir: string);
	abstract exists(ntt: string);

	// eslint-disable-next-line @typescript-eslint/require-await
	async rmrf(dir: string) {
		throw Error(`rmrf not implemented at ${dir}`);
	}

	fromCaptureLocation(mediaType: TMediaType, ...where: string[]) {
		return this.fromLocation(mediaType, ...[`./${CAPTURE}`, ...where]);
	}

	/**
	 * Returns a storage specific resolved path for a given media type.
	 * Overload this where slash directory conventions aren't used.
	 */
	fromLocation(mediaType: TMediaType, ...where: string[]) {
		return where.map((w) => w.replace(/\/$/, '')).join('/');
	}

	locator = captureLocator;

	async getRelativePath(pathIn: string | undefined) {
		if (!pathIn) {
			return undefined;
		}
		const mediaType = guessMediaType(pathIn);
		const loc = resolve(await this.getCaptureLocation({ ...this.world, mediaType }));
		return pathIn.replace(loc, '.');
	}

	async getCaptureLocation(loc: TLocationOptions, app?: string) {
		const { tag } = loc;
		const location = this.locator(loc.options, tag, app);
		return Promise.resolve(location);
	}
	async runtimePath(world?: TWorld): Promise<string> {
		return pathToFileURL(await this.getCaptureLocation({ ...(world || this.world), mediaType: EMediaTypes.html })).pathname;
	}

	async ensureCaptureLocation(loc: TLocationOptions, app?: string | undefined, fn = '') {
		if (loc.tag.sequence < 0) {
			return;
		}
		const dir = await this.getCaptureLocation(loc, app);
		await this.ensureDirExists(dir);
		return `${dir}/${fn}`;
	}
	async ensureDirExists(dir: string) {
		if (!this.exists(dir)) {
			try {
				this.mkdirp(dir);
			} catch (e) {
				throw Error(`creating ${dir}: ${e}`);
			}
		}
		return Promise.resolve();
	}

	steps = {
		createSizedFile: {
			gwta: `create {x}MB file at {where} with {what}`,
				action: async ({ where, what }: TStepArgs) => {
				await this.writeFile(String(where), String(what), EMediaTypes.html);
				return OK;
			},
		},
		createFile: {
			gwta: `create file at {where} with {what}`,
				action: async ({ where, what }: TStepArgs) => {
				await this.writeFile(String(where), String(what), EMediaTypes.html);
				return OK;
			},
		},
		createDirectory: {
			gwta: `create directory at {where}`,
				action: async ({ where }: TStepArgs) => {
				await this.mkdirp(String(where));
				return OK;
			},
		},
		filesCount: {
			gwta: `directory {where} has {count} files`,
				action: async ({ where, count }: TStepArgs) => {
				const files = await this.readdir(String(where));
				return files.length === parseInt(String(count)) ? OK : actionNotOK(`directory ${where} has ${files.length} files`);
			},
		},
		testIs: {
			gwta: `text at {where} is {what}`,
				action: async ({ where, what }: TStepArgs) => {
				const text = await this.readFile(String(where), 'utf-8');
				return text === String(what) ? OK : actionNotOK(`text at ${where} is not ${what}; it's ${text}`);
			},
		},
		testContains: {
			gwta: `text at {where} contains {what}`,
				action: async ({ where, what }: TStepArgs) => {
				const text = await this.readFile(String(where), 'utf-8');
				return text.toString().indexOf(String(what)) > -1 ? OK : actionNotOK(`text at ${where} does not contain ${what}; it's ${text}`);
			},
		},
		readText: {
			gwta: `read text from {where}`,
				action: async ({ where }: TStepArgs) => {
				const text = await this.readFile(String(where), 'utf-8');
				this.getWorld().logger.info(text);
				return OK;
			},
		},
		listFiles: {
			gwta: `list files from {where}`,
				action: async ({ where }: TStepArgs) => {
				const files = await this.readdir(String(where));
				this.getWorld().logger.info(`files from ${where}: ${files.join(', ')}`);
				return OK;
			},
		},
		clearFiles: {
			gwta: `clear files matching {where}`,
				action: async ({ where }: TStepArgs) => {
				const dirs = String(where).split(',').map((d) => d.trim());
				for (const dir of dirs) {
					await this.rmrf(dir);
				}
				return OK;
			},
		},
		fileExists: {
			gwta: `storage entry {what} exists`,
				action: async ({ what }: TStepArgs) => {
				const exists = this.exists(String(what));
				return Promise.resolve(exists ? OK : actionNotOK(`file ${what} does not exist`));
			},
		},
		clearAllFiles: {
			exact: `clear files`,
			action: async () => {
				await this.rmrf('');
				return OK;
			},
		},
		isTheSame: {
			gwta: `{what} is the same as {where}`,
				action: async ({ what, where }: TStepArgs) => {
				const c1 = this.readFile(String(what), 'binary');
				const c2 = this.readFile(String(where), 'binary');
				return Promise.resolve(Buffer.from(c1)?.equals(Buffer.from(c2)) ? OK : actionNotOK(`contents are not the same ${what} ${where}`));
			},
		},
	};
}
