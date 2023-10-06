import { AStepper, CAPTURE, IHasOptions, IRequireDomains, OK, TFeatureResult, TNamed, TWorld } from '@haibun/core/build/lib/defs.js';
import { IReviewResult, STORAGE_ITEM, STORAGE_LOCATION, TLocationOptions } from '@haibun/domain-storage';
import { actionNotOK, actionOK, findStepperFromOption, getStepperOption, stringOrError } from '@haibun/core/build/lib/util/index.js';
import { AStorage } from '@haibun/domain-storage/build/AStorage.js';
import { TIndexSummaryResult } from './html-generator.js';
import { ITrackResults } from '@haibun/domain-storage';
import { ReviewsUtils } from './lib/ReviewsUtils.js';
import { TLogHistory } from '@haibun/core/build/lib/interfaces/logger.js';
import { EMediaTypes } from '@haibun/domain-storage/build/domain-storage.js';

export const TRACKS_FILE = `tracks.json`;
export const REVIEW_FILE = 'review.html';
export const REVIEWS_INDEX_FILE = 'reviews.html';
export const REVIEW_LINKER_FILE = 'reviews.json';

export const STORAGE = 'STORAGE';
export const TRACKS_STORAGE = 'TRACKS_STORAGE';
export const REVIEWS_STORAGE = 'REVIEWS_STORAGE';
export const PUBLISH_STORAGE = 'PUBLISH_STORAGE';
export const INDEX_STORAGE = 'INDEX_STORAGE';
export const PUBLISH_ROOT = 'PUBLISH_ROOT';
const URI_ARGS = 'URI_ARGS';

export const MISSING_TRACKS: TIndexSummaryResult = { ok: false, sourcePath: 'missing', memDir: undefined, featureTitle: 'Missing tracks file', startTime: new Date().toString() };
export const MISSING_TRACKS_FILE = 'Missing tracks file';
export const INDEXED = 'indexed';

export type THistoryWithMeta = {
  meta: {
    startTime: string;
    title: string;
    startOffset: number;
  };
  logHistory: TLogHistory[];
};

type FoundHistories = {
  [name: string]: TLogHistory[];
};

const OutReviews = class OutReviews extends AStepper implements IHasOptions, IRequireDomains, ITrackResults, IReviewResult {
  tracksStorage: AStorage;
  reviewsStorage: AStorage;
  publishStorage: AStorage;
  indexStorage: AStorage;
  utils: ReviewsUtils;
  title = 'Feature Result Index';
  publishRoot: string;
  uriArgs: string;

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
    [REVIEWS_STORAGE]: {
      required: true,
      altSource: 'STORAGE',
      desc: 'Storage type used for reviews',
      parse: (input: string) => stringOrError(input),
    },
    [PUBLISH_STORAGE]: {
      desc: 'Storage type used for publishing',
      parse: (input: string) => stringOrError(input),
    },
    [INDEX_STORAGE]: {
      desc: 'Storage type used for indexes',
      parse: (input: string) => stringOrError(input),
    },
    [URI_ARGS]: {
      desc: 'Extra arguments for html assets',
      parse: (input: string) => stringOrError(input),
    },
    [PUBLISH_ROOT]: {
      desc: 'Root path for publishing',
      parse: (input: string) => stringOrError(input),
    },
  };

  async setWorld(world: TWorld, steppers: AStepper[]) {
    await super.setWorld(world, steppers);
    this.uriArgs = getStepperOption(this, URI_ARGS, this.getWorld().extraOptions) || '';
    this.tracksStorage = findStepperFromOption(steppers, this, world.extraOptions, TRACKS_STORAGE, STORAGE);
    this.reviewsStorage = findStepperFromOption(steppers, this, world.extraOptions, REVIEWS_STORAGE, STORAGE);
    this.indexStorage = findStepperFromOption(steppers, this, world.extraOptions, INDEX_STORAGE, STORAGE);
    this.publishStorage = findStepperFromOption(steppers, this, world.extraOptions, PUBLISH_STORAGE, STORAGE);
    this.publishRoot = getStepperOption(this, PUBLISH_ROOT, this.getWorld().extraOptions) || './published';
    this.utils = new ReviewsUtils(this.getWorld().logger, this.tracksStorage, this.reviewsStorage, this.publishStorage, this.indexStorage, this.uriArgs);
  }

  steps = {
    /**
     * Create reviews
     * Creates review.html files from any found tracks.json. files.
     */
    createReview: {
      // create a review from current world only
      exact: `create review`,
      action: async () => {
        return actionNotOK('todo');
      },
    },
    createReviewsFrom: {
      gwta: `create reviews from {where}`,
      action: async ({ where }: TNamed) => {
        return actionNotOK('todo');
      },
    },
    createFoundReviews: {
      exact: `create found reviews`,
      action: async () => {
        const location = await this.createReviewsFromTracks();
        return actionOK();
      },
    },

    /**
     * Create indexes
     * Creates a main index for found reviews.
     * This will normally be done after creating reviews.
     */
    createIndex: {
      exact: `create index`,
      action: async () => {
        return actionNotOK('todo');
      },
    },
    createIndexesFrom: {
      gwta: `create indexes from {where}`,
      action: async ({ where }: TNamed) => {
        return actionNotOK('todo');
      },
    },
    createFoundIndex: {
      exact: `create found index`,
      action: async () => {
        return actionNotOK('todo');
      },
    },

    /**
     * Publish reviews
     * Copies reviews, indexes and assets to a publish location.
     * This will normally be done after creating reviews and indexes.
     */
    publishReviews: {
      exact: `publish reviews`,
      action: async () => {
        return actionNotOK('todo');
      },
    },
    publishReviewsFrom: {
      gwta: `publish reviews from {where}`,
      action: async ({ where }: TNamed) => {
        return actionNotOK('todo');
      },
    },
    publishFoundReviews: {
      exact: `publish found reviews`,
      action: async () => {
        const histories = await this.findTracks();
        JSON.stringify(histories, null, 2);
        return actionNotOK('todo');
      },
    },

    /**
     * Publish review dashboard links
     * Creates a link in the publish directory for the reviews index
     * This is used by the dashboard page to link to the reviews index.
     */
    publishReviewDashboardLink: {
      exact: `publish reviews dashboard link`,
      action: async () => {
        return actionNotOK('todo');
      },
    },

    /**
     * Create dashboard
     *
     * Creates a dashboard page that links published review indexes.
     *
     */
    createDashboardPage: {
      exact: `create dashboard page`,
      action: async () => {
        return actionNotOK('todo');
      },
    },
  };

  async writeTracksFile(loc: TLocationOptions, title: string, result: TFeatureResult, startTime: Date, startOffset: number, logHistory: TLogHistory[]) {
    const dir = await this.reviewsStorage.ensureCaptureLocation(loc, 'tracks', TRACKS_FILE);
    const historyWithMeta: THistoryWithMeta = { meta: { startTime: startTime.toISOString(), title, startOffset }, logHistory };
    await this.reviewsStorage.writeFile(dir, JSON.stringify(historyWithMeta, null, 2), loc.mediaType);
  }

  async findTracksJson(startPath: string): Promise<string[]> {
    let result: string[] = [];
    const files = await this.tracksStorage.readdirStat(startPath);

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

  async createReviewsFromTracks() {
    const histories = await this.findTracks();
    const locs = [];
    let output = '';
    for (const [name, history] of Object.entries(histories)) {
      console.log('xx', name, JSON.stringify(history, null, 2));

      const dest = this.reviewsStorage.fromCaptureLocation(EMediaTypes.html, `${CAPTURE}/reviews/review-${name}.html`);
      locs.push(dest);
      console.log('wtw', dest);
      await this.reviewsStorage.writeFile(dest, output, EMediaTypes.html);
    }
    return locs;
  }
  async findTracks(): Promise<FoundHistories> {
    const tracksJsonFiles = await this.findTracksJson(`/${CAPTURE}`);

    return tracksJsonFiles.reduce<FoundHistories>((a, leaf) => {
      return { ...a, [leaf]: JSON.parse(this.tracksStorage.readFile(leaf, 'utf-8')) };
    }, {});
  }
};

export default OutReviews;
