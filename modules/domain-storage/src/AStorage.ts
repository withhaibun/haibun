import { resolve, relative } from 'path';

import { CAPTURE, OK, TStepArgs } from '@haibun/core/schema/protocol.js';
import { captureLocator } from '@haibun/core/lib/capture-locator.js';
import { actionNotOK } from '@haibun/core/lib/util/index.js';
import { IFile, TLocationOptions } from './domain-storage.js';
import { EMediaTypes, TMediaType } from './media-types.js';
import { AStepper, StepperKinds, } from "@haibun/core/lib/astepper.js";
import { TAnyFixme } from '@haibun/core/lib/fixme.js';

/**
 * Result from saveArtifact with paths for different consumption contexts.
 */
export interface TSavedArtifact {
	/** Absolute path where file was saved */
	absolutePath: string;
	/** Path relative to feature dir for serialized HTML: ./subpath/file.png or ./file.html */
	featureRelativePath: string;
	/** Path relative to base capture dir for live server: seq-0/featn-1/subpath/file.png */
	baseRelativePath: string;
}

export abstract class AStorage extends AStepper {
	kind = StepperKinds.STORAGE;
	abstract readFile(path: string, coding?: string): TAnyFixme;
	abstract rm(path: string);
	abstract readdir(dir: string): Promise<string[]>;
	abstract lstatToIFile(file: string): Promise<IFile>;
	abstract writeFileBuffer(file: string, contents: Buffer, mediaType: TMediaType): void;

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

	abstract mkdir(dir: string);
	abstract mkdirp(dir: string);
	abstract exists(ntt: string);

	/**
	 * Returns a storage specific resolved path for a given media type.
	 * Overload this where slash directory conventions aren't used.
	 */
	fromLocation(mediaType: TMediaType, ...where: string[]) {
		return where.map((w) => w.replace(/\/$/, '')).join('/');
	}

	locator = captureLocator;

	// biome-ignore lint/suspicious/useAwait: may be async in some implementations
	async getCaptureLocation(loc: TLocationOptions, app?: string) {
		const { tag } = loc;
		const location = this.locator(loc.options, tag, app);
		return Promise.resolve(location);
	}

	/**
	 * Get base artifact path (capture/DEST/key) without seq/featn.
	 * Used for HTTP servers that serve artifacts from all features.
	 */
	getArtifactBasePath(): string {
		const { tag, options } = this.world;
		return `./capture/${options.DEST || 'default'}/${tag.key}`;
	}

	/**
	 * Save an artifact and return paths for different consumption contexts.
	 * Uses this.world for tag/options - caller must ensure storage world is in sync.
	 * @param filename - The filename to save as
	 * @param contents - File contents (Buffer or string)
	 * @param mediaType - Media type for proper handling
	 * @param subpath - Optional subdirectory (e.g., 'image', 'video')
	 */
	async saveArtifact(filename: string, contents: string | Buffer, mediaType: TMediaType, subpath?: string): Promise<TSavedArtifact> {
		const loc = { ...this.world, mediaType };
		const dir = await this.ensureCaptureLocation(loc, subpath);
		const absolutePath = resolve(dir, filename);
		await this.writeFile(absolutePath, contents, mediaType);

		// Feature-relative path for serialized HTML
		const featureRelativePath = subpath ? `./${subpath}/${filename}` : `./${filename}`;

		// Base-relative path for live server (includes featn-N)
		const basePath = this.getArtifactBasePath();
		const baseRelativePath = relative(resolve(basePath), absolutePath);

		return { absolutePath, featureRelativePath, baseRelativePath };
	}

	async ensureCaptureLocation(loc: TLocationOptions, app?: string | undefined, fn = '') {
		const dir = await this.getCaptureLocation(loc, app);
		await this.ensureDirExists(dir);
		return fn ? `${dir}/${fn}` : dir;
	}
	// biome-ignore lint/suspicious/useAwait: may be async in some implementations
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
				this.getWorld().eventLogger.info(text);
				return OK;
			},
		},
		listFiles: {
			gwta: `list files from {where}`,
			action: async ({ where }: TStepArgs) => {
				const files = await this.readdir(String(where));
				this.getWorld().eventLogger.info(`files from ${where}: ${files.join(', ')}`);
				return OK;
			},
		},
		fileExists: {
			gwta: `storage entry {what} exists`,
			action: ({ what }: TStepArgs) => {
				const exists = this.exists(String(what));
				return Promise.resolve(exists ? OK : actionNotOK(`file ${what} does not exist`));
			},
		},
		isTheSame: {
			gwta: `{what} is the same as {where}`,
			action: ({ what, where }: TStepArgs) => {
				const c1 = this.readFile(String(what), 'binary');
				const c2 = this.readFile(String(where), 'binary');
				return Buffer.from(c1)?.equals(Buffer.from(c2)) ? OK : actionNotOK(`contents are not the same ${what} ${where}`);
			},
		},
	};
}
