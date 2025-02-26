import nodePath from 'path';
import { fileURLToPath } from 'url';

import StorageFS from '@haibun/storage-fs/build/storage-fs.js';
import {
	AStepper,
	CAPTURE,
	IHasHandlers,
	IHasOptions,
	OK,
	TFeatureResult,
	TNamed,
	TWorld,
} from '@haibun/core/build/lib/defs.js';
import { STORAGE_ITEM, STORAGE_LOCATION } from '@haibun/domain-storage';
import {
	actionOK,
	constructorName,
	findStepperFromOption,
	getStepperOption,
	stringOrError,
} from '@haibun/core/build/lib/util/index.js';
import { AStorage } from '@haibun/domain-storage/build/AStorage.js';
import { THistoryWithMeta, TLogHistory, TLogHistoryWithArtifact } from '@haibun/core/build/lib/interfaces/logger.js';
import {
	HANDLE_RESULT_HISTORY,
	IFile,
	IGetPublishedReviews,
	TLocationOptions,
	TPathed,
	guessMediaExt,
} from '@haibun/domain-storage/build/domain-storage.js';
import {
	SCHEMA_FOUND_HISTORIES,
	TFoundHistories,
	TNamedHistories,
	TRACKS_DIR,
	TRACKS_FILE,
	asArtifact,
	asHistoryWithMeta,
	findArtifacts,
} from '@haibun/core/build/lib/LogHistory.js';
import { EMediaTypes, TMediaType } from '@haibun/domain-storage/build/media-types.js';

export const TRACKSHISTORY_SUFFIX = `-${TRACKS_FILE}`;

export const STORAGE = 'STORAGE';
export const TRACKS_STORAGE = 'TRACKS_STORAGE';
export const PUBLISH_STORAGE = 'PUBLISH_STORAGE';
export const PUBLISH_ROOT = 'PUBLISH_ROOT';

type TArtifactMap = { [name: string]: TPathed };

const OutReviews = class OutReviews extends AStepper implements IHasOptions, IHasHandlers {
	tracksStorage: AStorage;
	publishStorage: AStorage;
	// used for publishing dashboard
	title = 'Feature Result Index';
	publishRoot: string;

	requireDomains = [STORAGE_LOCATION, STORAGE_ITEM];
	options = {
		[STORAGE]: {
			desc: 'General storage type',
			parse: (input: string) => stringOrError(input),
		},
		[TRACKS_STORAGE]: {
			required: true,
			altSource: 'STORAGE',
			desc: 'Storage type used for histories',
			parse: (input: string) => stringOrError(input),
		},
		[PUBLISH_STORAGE]: {
			desc: 'Storage type used for publishing',
			parse: (input: string) => stringOrError(input),
		},
		[PUBLISH_ROOT]: {
			desc: 'Root path for publishing',
			parse: (input: string) => stringOrError(input),
		},
	};
	handlers = {
		[HANDLE_RESULT_HISTORY]: {
			handle: async (
				loc: TLocationOptions,
				description: string,
				result: TFeatureResult,
				startTime: Date,
				startOffset: number,
				logHistory: TLogHistory[]
			) => {
				const dir = await this.tracksStorage.ensureCaptureLocation(loc, 'tracks', TRACKS_FILE);
				const history: THistoryWithMeta = asHistoryWithMeta(logHistory, startTime, description, startOffset, result.ok);
				await this.tracksStorage.writeFile(dir, JSON.stringify(history, null, 2), loc.mediaType);
			},
		},
	};
	reviewEndpoint?: IGetPublishedReviews;

	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.tracksStorage = findStepperFromOption(steppers, this, world.moduleOptions, TRACKS_STORAGE, STORAGE);
		this.publishStorage = findStepperFromOption(steppers, this, world.moduleOptions, PUBLISH_STORAGE, STORAGE);
		this.publishRoot = getStepperOption(this, PUBLISH_ROOT, this.getWorld().moduleOptions) || './published';
		const ps = this.publishStorage as unknown as IGetPublishedReviews;
		if (ps.getPublishedReviews) {
			this.reviewEndpoint = ps;
		}
	}

	steps = {
		/**
		 * Create history
		 * Creates tracksHistory.json files from any found TRACKS_FILE. files.
		 */
		createFoundHistory: {
			exact: `create found history`,
			action: async () => {
				const location = await this.createFoundHistory();
				return actionOK({ tree: { summary: 'wrote history', details: { location } } });
			},
		},

		createIndexer: {
			exact: `create indexer`,
			action: async () => {
				await this.publishStorage.ensureDirExists(this.publishRoot);
				await this.createIndexer();
				return OK;
			},
		},
		createIndexFromTracks: {
			exact: `create indexer from tracks`,
			action: async () => {
				await this.publishStorage.ensureDirExists(this.publishRoot);
				const loc = this.publishStorage.fromLocation(EMediaTypes.directory, this.publishRoot, TRACKS_DIR);
				await this.createIndexerFromDirectory(loc);

				return OK;
			},
		},
		clearFilesMatchingOlderThan: {
			gwta: `clear files matching {match} older than {hours}h`,
			action: async ({ hours, match }: TNamed) => {
				const loc = this.publishStorage.fromLocation(EMediaTypes.directory, this.publishRoot, TRACKS_DIR);
				await this.clearFilesOlderThan(hours, loc, match);
				return OK;
			},
		},
		clearFilesOlderThan: {
			gwta: `clear files older than {hours}h`,
			action: async ({ hours }: TNamed) => {
				const loc = this.publishStorage.fromLocation(EMediaTypes.directory, this.publishRoot, TRACKS_DIR);
				await this.clearFilesOlderThan(hours, loc);
				return OK;
			},
		},
		clearReviewsPast: {
			gwta: `clear reviews past {num}`,
			action: async ({ num }: TNamed) => {
				const where = this.publishStorage.fromLocation(EMediaTypes.directory, this.publishRoot, TRACKS_DIR);
				await this.clearReviewsPast(where, num);
				return OK;
			},
		},
		/**
		 * Create web pages that link and display published review indexes.
		 *
		 */
		createReviewsPages: {
			exact: `create reviews pages`,
			action: async () => {
				const web = nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), '..', 'dashboard', 'web');
				const fromFS = new StorageFS();
				await this.publishStorage.ensureDirExists(this.publishRoot);
				await this.recurseCopy({
					src: `${web}/public`,
					fromFS,
					toFS: this.publishStorage,
					toFolder: this.publishRoot,
					trimFolder: `${web}/public`,
				});
				await this.recurseCopy({
					src: `${web}/build`,
					fromFS,
					toFS: this.publishStorage,
					toFolder: `${this.publishRoot}/build`,
					trimFolder: `${web}/build`,
				});
				await this.createIndexer();

				return actionOK({ tree: { summary: 'wrote files', details: await this.publishStorage.readTree(this.publishRoot) } });
			},
		},
	};

	async createIndexer() {
		if (this.reviewEndpoint) {
			const indexer = `export const endpoint = "${this.reviewEndpoint.endpoint(
				TRACKS_DIR
			)}";\n${this.reviewEndpoint.getPublishedReviews.toString().replace('async', 'export async function')}`;
			await this.publishStorage.writeFile(`${this.publishRoot}/build/dashboard/indexer.js`, indexer, EMediaTypes.javascript);
			this.getWorld().logger.log(`indexer-endpoint.json written for ${constructorName(this.publishStorage)}`);
		}
	}

	async clearReviewsPast(where: string, num: string) {
		const allFiles = await this.publishStorage.readFlat(where);
		const tracksJsonFiles = await this.findTracksJson(where);
		// keep num reviews
		const fileStats = await Promise.all(tracksJsonFiles.map(async (file) => await this.publishStorage.lstatToIFile(file)));
		const toKeep = keepLatest(fileStats, parseInt(num, 10));

		const artifactsToKeep = toKeep
			.map((f) => {
				const foundHistories: TFoundHistories = JSON.parse(this.publishStorage.readFile(f, 'utf-8'));
				return Object.values(foundHistories.histories).map(findArtifacts);
			})
			.flat(Infinity)
			.map((h: TLogHistoryWithArtifact) => h.messageContext.artifact.path)
			.filter((a) => !!a)
			.map((a) => relativePublishedPath(a, this.publishRoot));

		const toDeleteArtifacts = allFiles.filter((f) => {
			if (toKeep.includes(f.name) || artifactsToKeep.find((a) => a === f.name)) {
				return false;
			}
			return true;
		});

		this.getWorld().logger.log(
			`${where} keeping ${toKeep.length} reviews (${toKeep}) with ${
				artifactsToKeep.length
			} artifacts ${artifactsToKeep.toString()} | deleting ${tracksJsonFiles.length - toKeep.length} reviews`
		);

		for (const file of toDeleteArtifacts) {
			this.getWorld().logger.log(`deleting ${file.name}`);
			await this.publishStorage.rm(file.name);
		}
	}

	async clearFilesOlderThan(hoursIn: string, loc: string, match?: string) {
		const files = await this.publishStorage.readdirStat(loc);
		const now = Date.now();
		const hours = parseInt(hoursIn, 10);
		const cutoff = now - hours * 60 * 60 * 1000;
		const toDelete = files.filter((f) => {
			if (match && !f.name.match(match)) return false;
			return f.created < cutoff;
		});
		for (const file of toDelete) {
			await this.publishStorage.rm(file.name);
		}
	}

	async createIndexerFromDirectory(loc: string) {
		this.getWorld().logger.info(`indexer-endpoint.json written for ${loc}`);
		const ifiles = await this.publishStorage.readdirStat(loc);
		const files = ifiles.filter((i) => i.name.endsWith(TRACKS_FILE)).map((i) => i.name.replace(/.*\//, ''));
		const endpoint = this.reviewEndpoint?.endpoint(TRACKS_DIR) || `./${TRACKS_DIR}/`;
		const indexer = `export const endpoint = "${endpoint}";\nexport async function getPublishedReviews() { return ${JSON.stringify(
			files
		)}; }`;
		await this.publishStorage.writeFile(`${this.publishRoot}/build/dashboard/indexer.js`, indexer, EMediaTypes.javascript);
	}

	async createFoundHistory(where = CAPTURE) {
		const key = this.getWorld().tag.key;
		const ps = this.publishStorage;
		const { foundHistories, artifactMap } = await this.transformTracksAndArtifacts(where);
		await this.publishStorage.ensureDirExists(ps.fromLocation(EMediaTypes.json, this.publishRoot, TRACKS_DIR));
		const dest = ps.fromLocation(EMediaTypes.json, this.publishRoot, TRACKS_DIR, `${key}${TRACKSHISTORY_SUFFIX}`);
		await ps.writeFile(dest, JSON.stringify(foundHistories, null, 2), EMediaTypes.json);
		for (const [path, destPathed] of Object.entries(artifactMap)) {
			// copying pages to strict location
			this.getWorld().logger.debug(`copying ${path} to ${destPathed.pathed}`);
			await this.copyFile(this.tracksStorage, path, destPathed).catch(async (e) => {
				this.getWorld().logger.error(`error copying ${path} to ${destPathed.pathed}`);
				this.getWorld().logger.error(e);
				const files = await ps.readFlat(where);
				this.getWorld().logger.error(`Files in ${where}: ${files.map((f) => f.name).join(', ')}`);
				throw e;
			});
		}
		return dest;
	}

	async transformTracksAndArtifacts(where: string): Promise<{ foundHistories: TFoundHistories; artifactMap: TArtifactMap }> {
		const artifactMap = {};
		const tracksJsonFiles = await this.findTracksJson(where);

		let ok = 0;
		let fail = 0;
		const histories: TNamedHistories = tracksJsonFiles.reduce((a, leaf) => {
			const foundHistory: THistoryWithMeta = JSON.parse(this.tracksStorage.readFile(leaf, 'utf-8'));

			// map files to relative path for later copying
			const history = {
				$schema: foundHistory['$schema'],
				meta: foundHistory.meta,
				logHistory: foundHistory.logHistory.map((h) => {
					if (!asArtifact(h)) return h;
					const path = asArtifact(h)?.messageContext?.artifact?.path;
					if (path) {
						// replace leading CAPTURE with ./
						const dest = this.artifactLocation(
							nodePath.resolve(path),
							nodePath.join(this.publishRoot, TRACKS_DIR),
							nodePath.resolve(where)
						);
						const destPath = webPublishedPath(dest.pathed, this.publishRoot);
						artifactMap[path] = dest;
						return {
							...h,
							messageContext: {
								...h.messageContext,
								artifact: {
									...asArtifact(h).messageContext.artifact,
									path: destPath,
								},
							},
						};
					}
					return h;
				}),
			};

			ok += history.meta.ok ? 1 : 0;
			fail += history.meta.ok ? 0 : 1;
			return { ...a, [leaf]: history };
		}, {});
		return {
			foundHistories: { $schema: SCHEMA_FOUND_HISTORIES, meta: { date: Date.now(), ok, fail }, histories },
			artifactMap,
		};
	}

	artifactLocation(fileName: string, toFolder: string, trimFolder?: string): TPathed {
		const ext = <TMediaType>guessMediaExt(fileName);
		const trimmed = trimFolder ? fileName.replace(new RegExp(`^${trimFolder}`), '') : fileName;
		const finalPath = toFolder ? `${toFolder}/${trimmed}`.replace(/\/\//, '/') : trimmed;
		const pathed = this.publishStorage.pathed(ext, finalPath);
		return { pathed };
	}

	async findTracksJson(startPath: string): Promise<string[]> {
		let result: string[] = [];
		const files = await this.tracksStorage.readdirStat(startPath);

		for (const file of files) {
			const filePath = file.name;

			if (file.isDirectory) {
				result = result.concat(await this.findTracksJson(filePath));
			} else if (file.name.endsWith(TRACKS_FILE)) {
				result.push(filePath);
			}
		}

		return result;
	}

	async recurseCopy({
		src,
		fromFS,
		toFS,
		toFolder,
		trimFolder,
	}: {
		src: string;
		fromFS: AStorage;
		toFS: AStorage;
		toFolder?: string;
		trimFolder?: string;
	}) {
		const entries = await fromFS.readdirStat(src);

		for (const entry of entries) {
			const fileName = entry.name;
			if (entry.isDirectory) {
				await this.recurseCopy({ src: fileName, fromFS, toFS, toFolder, trimFolder });
			} else {
				const dest = this.artifactLocation(fileName, toFolder, trimFolder);
				await this.copyFile(fromFS, fileName, dest);
			}
		}
	}

	async copyFile(fs: AStorage, source: string, pathedDest: TPathed) {
		const ext = <TMediaType>guessMediaExt(source);
		const content = await fs.readFile(source);
		await this.publishStorage.mkdirp(nodePath.dirname(pathedDest.pathed));
		await this.publishStorage.writeFile(pathedDest, content, ext);
		this.getWorld().logger.log(`copied ${source} to ${pathedDest.pathed}`);
	}
};

export default OutReviews;

const noabs = (path: string) => path.replace(/[/.]+/, '');

// remove prefix publishRoot from pathed
export function webPublishedPath(pathed: string, publishRoot: string) {
	if (pathed.startsWith(publishRoot)) {
		return pathed.replace(publishRoot, '.');
	}
	const rootRegex = new RegExp(`^${noabs(publishRoot)}`);
	return noabs(pathed).replace(rootRegex, './');
}

// prefix publishRoot to path
export function relativePublishedPath(pathed: string, publishRoot: string) {
	return pathed.replace(/^\./, publishRoot);
}

export function keepLatest(fileStats: IFile[], num: number) {
	const itemsSorted = fileStats.sort((a, b) => a.created - b.created);
	return itemsSorted.slice(-num).map((n) => n.name);
}
