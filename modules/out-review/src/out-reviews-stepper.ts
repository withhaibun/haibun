import path from "path";
import { fileURLToPath } from "url";

import { AStepper, CAPTURE, IHasOptions, IRequireDomains, OK, TFeatureResult, TWorld } from '@haibun/core/build/lib/defs.js';
import { STORAGE_ITEM, STORAGE_LOCATION, } from '@haibun/domain-storage';
import { actionOK, findStepperFromOption, getStepperOption, stringOrError } from '@haibun/core/build/lib/util/index.js';
import { AStorage } from '@haibun/domain-storage/build/AStorage.js';
import { TLogHistory } from '@haibun/core/build/lib/interfaces/logger.js';
import { EMediaTypes, IGetPublishedReviews, ITrackResults, TLocationOptions, TPathed, actualPath, guessMediaExt } from '@haibun/domain-storage/build/domain-storage.js';
import StorageFS from '@haibun/storage-fs/build/storage-fs.js';
import { TFoundHistories, THistoryWithMeta, TNamedHistories, asArtifact } from "./lib.js";

export const TRACKS_FILE = `tracks.json`;
const TRACKS_DIR = 'tracks';
export const TRACKSHISTORY_SUFFIX = '-tracksHistory.json';

export const STORAGE = 'STORAGE';
export const TRACKS_STORAGE = 'TRACKS_STORAGE';
export const PUBLISH_STORAGE = 'PUBLISH_STORAGE';
export const PUBLISH_ROOT = 'PUBLISH_ROOT';

type TArtifactMap = { [name: string]: TPathed };

const OutReviews = class OutReviews extends AStepper implements IHasOptions, IRequireDomains, ITrackResults {
  tracksStorage: AStorage;
  publishStorage: AStorage;
  // used for publishing dashboard
  localFS: AStorage;
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
      desc: 'Storage type used for input',
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
  reviewEndpoint?: IGetPublishedReviews;

  async setWorld(world: TWorld, steppers: AStepper[]) {
    await super.setWorld(world, steppers);
    this.localFS = new StorageFS();
    this.tracksStorage = findStepperFromOption(steppers, this, world.extraOptions, TRACKS_STORAGE, STORAGE);
    this.publishStorage = findStepperFromOption(steppers, this, world.extraOptions, PUBLISH_STORAGE, STORAGE);
    this.publishRoot = getStepperOption(this, PUBLISH_ROOT, this.getWorld().extraOptions) || './published';
    const ps = (this.publishStorage as unknown as IGetPublishedReviews);
    if (ps.getPublishedReviews) {
      this.reviewEndpoint = ps;
    }
  }

  steps = {
    /**
     * Create history
     * Creates tracksHistory.json files from any found tracks.json. files.
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
        await this.createIndexer();
        return OK;
      },
    },
    /**
     * Create web
     * Create web pages that link and display published review indexes.
     *
     */
    createReviewsPages: {
      exact: `create reviews pages`,
      action: async () => {
        const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dashboard', 'web');
        await this.publishStorage.ensureDirExists(this.publishRoot);
        await this.recurseCopy({ src: `${web}/public`, fromFS: this.localFS, toFS: this.publishStorage, toFolder: this.publishRoot, trimFolder: `${web}/public` });
        await this.recurseCopy({ src: `${web}/built`, fromFS: this.localFS, toFS: this.publishStorage, toFolder: `${this.publishRoot}/built`, trimFolder: `${web}/built` });
        await this.createIndexer();

        return actionOK({ tree: { summary: 'wrote files', details: await this.publishStorage.readTree(this.publishRoot) } })
      }
    },
  };

  async createIndexer() {
    if (this.reviewEndpoint) {
      const indexer = `const resolvedEndpoint = "${this.reviewEndpoint.endpoint(TRACKS_DIR)}";\n${this.reviewEndpoint.getPublishedReviews.toString().replace('async', 'export async function')}`;
      await this.publishStorage.writeFile(`${this.publishRoot}/built/dashboard/indexer.js`, indexer, EMediaTypes.javascript);
      this.getWorld().logger.log(`indexer-endpoint.json written for ${this.publishStorage.constructor.name}`);
    }
  }

  async createFoundHistory(where = CAPTURE) {
    const key = this.getWorld().tag.key;
    const ps = this.publishStorage;
    const { foundHistories, artifactMap } = await this.transformTracksAndArtifacts(where);
    await this.publishStorage.ensureDirExists(ps.fromLocation(EMediaTypes.json, this.publishRoot, TRACKS_DIR));
    const dest = ps.fromLocation(EMediaTypes.json, this.publishRoot, TRACKS_DIR, `${key}${TRACKSHISTORY_SUFFIX}`);
    await this.publishStorage.writeFile(dest, JSON.stringify(foundHistories, null, 2), EMediaTypes.json);
    for (const [path, destPathed] of Object.entries(artifactMap)) {
      // copying pages to strict location
      await this.copyFile(path, destPathed);
    }
    return dest;
  }

  async transformTracksAndArtifacts(where: string): Promise<{ foundHistories: TFoundHistories, artifactMap: TArtifactMap }> {
    const artifactMap = {};
    const tracksJsonFiles = await this.findTracksJson(where);

    let ok = 0;
    let fail = 0;
    const histories: TNamedHistories = tracksJsonFiles.reduce((a, leaf) => {
      const foundHistory: THistoryWithMeta = JSON.parse(this.localFS.readFile(leaf, 'utf-8'));
      const endpoint = this.reviewEndpoint?.endpoint(TRACKS_DIR) || TRACKS_DIR;
      // map files to relative path for later copying
      const history = {
        '$schema': foundHistory['$schema'],
        meta: foundHistory.meta,
        logHistory: foundHistory.logHistory.map(h => {
          if (!asArtifact(h)) return h;
          const path = asArtifact(h)?.messageContext?.artifact?.path;
          if (path) {
            const dest = this.artifactLocation(path, 'artifacts');
            artifactMap[path] = dest;
            return {
              ...h,
              messageContext: {
                ...h.messageContext,
                artifact: {
                  ...asArtifact(h).messageContext.artifact,
                  path: [endpoint, actualPath(dest)].join('')
                }
              }
            }
          }
          return h;
        })
      }

      ok += history.meta.ok ? 1 : 0;
      fail += history.meta.ok ? 0 : 1;
      return { ...a, [leaf]: history };
    }, {});
    return {
      foundHistories: { '$schema': 'FoundHistories/1.0', meta: { date: Date.now(), ok, fail }, histories },
      artifactMap
    }
  }

  async findTracksJson(startPath: string): Promise<string[]> {
    let result: string[] = [];
    const files = await this.localFS.readdirStat(startPath);

    for (const file of files) {
      const filePath = file.name;

      if (file.isDirectory) {
        result = result.concat(await this.findTracksJson(filePath));
      } else if (file.name.endsWith('tracks.json')) {
        result.push(filePath);
      }
    }

    return result;
  }

  async recurseCopy({ src, fromFS, toFS, toFolder, trimFolder }: { src: string, fromFS: AStorage, toFS: AStorage, toFolder?: string, trimFolder?: string }) {
    const entries = await fromFS.readdirStat(src);

    for (const entry of entries) {
      const fileName = entry.name;
      if (entry.isDirectory) {
        await this.recurseCopy({ src: fileName, fromFS, toFS, toFolder, trimFolder });
      } else {
        const dest = this.artifactLocation(fileName, toFolder, trimFolder);
        await this.copyFile(fileName, dest);
      }
    }
  }

  artifactLocation(fileName: string, toFolder: string, trimFolder?: string): TPathed {
    const ext = <EMediaTypes>guessMediaExt(fileName);
    const trimmed = trimFolder ? fileName.replace(trimFolder, '') : fileName;
    const dest = this.publishStorage.pathed(ext, toFolder ? `${toFolder}/${trimmed}`.replace(/\/\//, '/') : trimmed);
    return { pathed: dest };
  }

  async copyFile(source: string, pathedDest: TPathed) {
    const ext = <EMediaTypes>guessMediaExt(source);
    const content = await this.localFS.readFile(source);
    await this.publishStorage.mkdirp(path.dirname(pathedDest.pathed));
    await this.publishStorage.writeFile(pathedDest, content, ext);
  }

  // implements ITrackResults
  async writeTracksFile(loc: TLocationOptions, title: string, result: TFeatureResult, startTime: Date, startOffset: number, logHistory: TLogHistory[]) {
    const dir = await this.tracksStorage.ensureCaptureLocation(loc, 'tracks', TRACKS_FILE);
    const history: THistoryWithMeta = { '$schema': 'THistoryWithMeta/1.0', meta: { startTime: startTime.toISOString(), title, startOffset, ok: result.ok }, logHistory };
    await this.tracksStorage.writeFile(dir, JSON.stringify(history, null, 2), loc.mediaType);
  }
}

export default OutReviews;
