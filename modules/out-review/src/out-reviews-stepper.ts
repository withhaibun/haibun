import path from "path";
import { fileURLToPath } from "url";

import { AStepper, CAPTURE, IHasOptions, IRequireDomains, TFeatureResult, TNamed, TWorld } from '@haibun/core/build/lib/defs.js';
import { STORAGE_ITEM, STORAGE_LOCATION, } from '@haibun/domain-storage';
import { actionNotOK, actionOK, findStepperFromOption, getStepperOption, stringOrError } from '@haibun/core/build/lib/util/index.js';
import { AStorage } from '@haibun/domain-storage/build/AStorage.js';
import { TLogHistory } from '@haibun/core/build/lib/interfaces/logger.js';
import { EMediaTypes, IFile, ITrackResults, TLocationOptions, guessMediaExt } from '@haibun/domain-storage/build/domain-storage.js';
import StorageFS from '@haibun/storage-fs/build/storage-fs.js';
import { TFoundHistories, THistoryWithMeta, TNamedHistories, findArtifacts } from "./lib.js";

export const TRACKS_FILE = `tracks.json`;
export const TRACKSHISTORY_SUFFIX = '-tracksHistory.json';

export const STORAGE = 'STORAGE';
export const TRACKS_STORAGE = 'TRACKS_STORAGE';
export const PUBLISH_STORAGE = 'PUBLISH_STORAGE';
export const PUBLISH_ROOT = 'PUBLISH_ROOT';

type TArtifactMap = { [name: string]: string };

const OutReviews = class OutReviews extends AStepper implements IHasOptions, IRequireDomains, ITrackResults {
  tracksStorage: AStorage;
  publishStorage: AStorage;
  // used for publishing dashboard
  localFS: StorageFS;
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

  async setWorld(world: TWorld, steppers: AStepper[]) {
    await super.setWorld(world, steppers);
    this.localFS = new StorageFS();
    this.tracksStorage = findStepperFromOption(steppers, this, world.extraOptions, TRACKS_STORAGE, STORAGE);
    this.publishStorage = findStepperFromOption(steppers, this, world.extraOptions, PUBLISH_STORAGE, STORAGE);
    this.publishRoot = getStepperOption(this, PUBLISH_ROOT, this.getWorld().extraOptions) || './published';
  }

  steps = {
    /**
     * Create history
     * Creates tracksHistory.json files from any found tracks.json. files.
     */
    createHistory: {
      // create a review from current world only
      exact: `create review`,
      action: async () => {
        return actionNotOK('todo');
      },
    },
    createHistoryFrom: {
      gwta: `create reviews from {where}`,
      action: async ({ where }: TNamed) => {
        return actionNotOK('todo');
      },
    },
    createFoundHistory: {
      exact: `create found history`,
      action: async () => {
        const location = await this.createFoundHistory();
        return actionOK({ tree: { summary: 'wrote history', details: { location } } });
      },
    },

    /**
     * Create indexes
     * Creates a main index for found reviews.
     * This will normally be done after creating reviews.
     */
    createIndex: {
      exact: `create history`,
      action: async () => {
        return actionNotOK('todo');
      },
    },
    createIndexesFrom: {
      gwta: `create history from {where}`,
      action: async ({ where }: TNamed) => {
        return actionNotOK('todo');
      },
    },

    /**
     * Create web
     *
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
        return actionOK({ tree: { summary: 'wrote files', details: await this.publishStorage.readTree(this.publishRoot) } })
      }
    },
  };

  async createFoundHistory(where = CAPTURE) {
    const key = this.getWorld().tag.key;
    const ps = this.publishStorage;
    const { foundHistories, artifactMap } = await this.transformTracksAndArtifacts(where);
    await this.publishStorage.ensureDirExists(ps.fromLocation(EMediaTypes.json, this.publishRoot, 'tracks'));
    const dest = ps.fromLocation(EMediaTypes.json, this.publishRoot, 'tracks', `${key}${TRACKSHISTORY_SUFFIX}`);
    await this.publishStorage.writeFile(dest, JSON.stringify(foundHistories, null, 2), EMediaTypes.json);
    const artifacts = Object.values(foundHistories.histories).reduce((a, h) => [...a, ...findArtifacts(h)], []);
    // TODO copy artifactMap
    for (const [path, shortPath] of Object.entries(artifactMap)) {
      await this.copyPublishFile(path, '', 'artifacts');
    }
    console.log('\nfoundArtifacts', artifacts.map((a: TLogHistory) => a.messageContext.artifact.path));
    return dest;
  }

  async transformTracksAndArtifacts(where: string): Promise<{ foundHistories: TFoundHistories, artifactMap: TArtifactMap }> {
    const artifactMap = {};
    const tracksJsonFiles = await this.findTracksJson(where);

    let ok = 0;
    let fail = 0;
    const histories: TNamedHistories = tracksJsonFiles.reduce((a, leaf, i) => {
      const foundHistory: THistoryWithMeta = JSON.parse(this.publishStorage.readFile(leaf, 'utf-8'));
      // map files to relative path for later copying
      const history = {
        meta: foundHistory.meta,
        logHistory: foundHistory.logHistory.map(h => {
          const path = h.messageContext?.artifact?.path;
          if (path) {
            artifactMap[path] = `${i}-${path.replace(/.*\/$/, '')}`;
            return {
              ...h,
              messageContext: {
                ...h.messageContext,
                artifact: {
                  ...h.messageContext.artifact,
                  path: artifactMap[path]
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
      foundHistories: { meta: { date: Date.now(), ok, fail }, histories },
      artifactMap
    }
  }

  async findTracksJson(startPath: string): Promise<string[]> {
    let result: string[] = [];
    const files = await this.publishStorage.readdirStat(startPath);

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
        await this.copyPublishFile(fileName, trimFolder, toFolder);
      }
    }
  }
  private async copyPublishFile(fileName: string, trimFolder: string, toFolder: string) {
    const content = await this.localFS.readFile(fileName);
    const ext = <EMediaTypes>guessMediaExt(fileName);

    const trimmed = trimFolder ? fileName.replace(trimFolder, '') : fileName;
    const dest = this.publishStorage.pathed(ext, toFolder ? `${toFolder}/${trimmed}`.replace(/\/\//, '/') : trimmed);
    await this.publishStorage.mkdirp(path.dirname(dest));
    await this.publishStorage.writeFile(dest, content, ext);
  }

  // implements ITrackResults
  async writeTracksFile(loc: TLocationOptions, title: string, result: TFeatureResult, startTime: Date, startOffset: number, logHistory: TLogHistory[]) {
    const dir = await this.tracksStorage.ensureCaptureLocation(loc, 'tracks', TRACKS_FILE);
    const history: THistoryWithMeta = { meta: { startTime: startTime.toISOString(), title, startOffset, ok: result.ok }, logHistory };
    await this.tracksStorage.writeFile(dir, JSON.stringify(history, null, 2), loc.mediaType);
  }
}

export default OutReviews;
