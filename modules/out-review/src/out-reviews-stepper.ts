import path from "path";
import { fileURLToPath } from "url";

import { AStepper, CAPTURE, IHasOptions, IRequireDomains, OK, TFeatureResult, TNamed, TWorld, } from "@haibun/core/build/lib/defs.js";
import { EMediaTypes, IReviewResult, STORAGE_ITEM, STORAGE_LOCATION, TLocationOptions, TMissingTracks, TTrackResult } from '@haibun/domain-storage/build/domain-storage.js';
import { actionOK, findStepperFromOption, getStepperOption, stringOrError } from '@haibun/core/build/lib/util/index.js';
import { AStorage } from '@haibun/domain-storage/build/AStorage.js';
import HtmlGenerator, { TIndexSummary, TIndexSummaryResult } from "./html-generator.js";
import { ITrackResults } from '@haibun/domain-storage/build/domain-storage.js';
import { summary } from "./components/index/summary.js";
import { toc } from "./components/index/toc.js";
import StorageFS from "@haibun/storage-fs/build/storage-fs.js";
import { ReviewsUtils } from "./lib/ReviewsUtils.js";
import { Timer } from "@haibun/core/build/lib/Timer.js";

export const REVIEW_FILE = 'review.html';
export const REVIEWS_INDEX_FILE = 'reviews.html';
export const REVIEW_LINKER = 'reviews.json';

export const STORAGE = 'STORAGE';
export const TRACKS_STORAGE = 'TRACKS_STORAGE';
export const REVIEWS_STORAGE = 'REVIEWS_STORAGE';
export const PUBLISH_STORAGE = 'PUBLISH_STORAGE';
export const INDEX_STORAGE = 'INDEX_STORAGE';
export const PUBLISH_ROOT = 'PUBLISH_ROOT';
const URI_ARGS = 'URI_ARGS';

export type TReviewLink = { link: string; title: string; date: string; results: { fail: number; success: number; } }

export const MISSING_TRACKS: TIndexSummaryResult = { ok: false, sourcePath: 'missing', featureTitle: 'Missing tracks file', startTime: new Date().toString() };
export const MISSING_TRACKS_FILE = 'Missing tracks file';
export const INDEXED = 'indexed';

const OutReviews = class OutReviews extends AStepper implements IHasOptions, IRequireDomains, ITrackResults, IReviewResult {
  tracksStorage: AStorage;
  reviewsStorage: AStorage;
  publishStorage: AStorage;
  indexStorage: AStorage;
  localFS: StorageFS;
  utils: ReviewsUtils;

  requireDomains = [STORAGE_LOCATION, STORAGE_ITEM];
  options = {
    [STORAGE]: {
      desc: 'General storage type',
      parse: (input: string) => stringOrError(input)
    },
    [TRACKS_STORAGE]: {
      required: true,
      altSource: 'STORAGE',
      desc: 'Storage type used for input',
      parse: (input: string) => stringOrError(input)
    },
    [REVIEWS_STORAGE]: {
      required: true,
      altSource: 'STORAGE',
      desc: 'Storage type used for reviews',
      parse: (input: string) => stringOrError(input)
    },
    [PUBLISH_STORAGE]: {
      desc: 'Storage type used for publishing',
      parse: (input: string) => stringOrError(input)
    },
    [INDEX_STORAGE]: {
      desc: 'Storage type used for indexes',
      parse: (input: string) => stringOrError(input)
    },
    [URI_ARGS]: {
      desc: 'Extra arguments for html assets',
      parse: (input: string) => stringOrError(input)
    },
    [PUBLISH_ROOT]: {
      desc: 'Root path for publishing',
      parse: (input: string) => stringOrError(input)
    },
  };
  publishRoot: string;

  setWorld(world: TWorld, steppers: AStepper[]) {
    super.setWorld(world, steppers);
    this.tracksStorage = findStepperFromOption(steppers, this, world.extraOptions, TRACKS_STORAGE, STORAGE);
    this.reviewsStorage = findStepperFromOption(steppers, this, world.extraOptions, REVIEWS_STORAGE, STORAGE);
    this.indexStorage = findStepperFromOption(steppers, this, world.extraOptions, INDEX_STORAGE, STORAGE);
    this.publishStorage = findStepperFromOption(steppers, this, world.extraOptions, PUBLISH_STORAGE, STORAGE);
    this.publishRoot = getStepperOption(this, PUBLISH_ROOT, this.getWorld().extraOptions) || './published';
    const localFS = new StorageFS();
    localFS.setWorld(world, steppers);
    this.localFS = localFS;
    this.utils = new ReviewsUtils(this.getWorld().logger, this.tracksStorage, this.reviewsStorage, this.publishStorage, this.indexStorage);
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
        const loc = { ...this.getWorld(), mediaType: EMediaTypes.html };

        let tracks;
        const where = await tracks.getCaptureLocation(loc, 'tracks', 'tracks.json');
        tracks = await this.utils.readTracksFile(where).catch(error => tracks = { error });
        await this.writeReview(loc, tracks);
        return OK;
      }
    },
    createReviewsFrom: {
      gwta: `create reviews from {where}`,
      action: async ({ where }: TNamed) => {
        await this.writeReviewsFrom(where.split(',').map(s => s.trim()));
        return OK;
      }
    },
    createFoundReviews: {
      exact: `create found reviews`,
      action: async () => {
        const found = await this.utils.findArtifacts(this.tracksStorage, `${INDEXED}:`);
        await this.writeReviewsFrom(found);
        return OK;
      }
    },

    /**
     * Create indexes
     * Creates a main index for found reviews.
     * This will normally be done after creating reviews.
     */
    createIndex: {
      exact: `create index`,
      action: async () => {
        return await this.createReviewsIndex([this.getWorld().options.DEST]);
      }
    },
    createIndexesFrom: {
      gwta: `create indexes from {where}`,
      action: async ({ where }: TNamed) => {
        const dirs = where.split(',').map(d => d.trim());
        return await this.createReviewsIndex(dirs);
      }
    },
    createFoundIndex: {
      exact: `create found index`,
      action: async () => {
        const found = await this.utils.findArtifacts(this.tracksStorage);
        return await this.createReviewsIndex(found);
      }
    },

    /**
     * Publish reviews
     * Copies reviews, indexes and assets to a publish location.
     * This will normally be done after creating reviews and indexes.
     */
    publishReviews: {
      exact: `publish reviews`,
      action: async () => {
        await this.publishReviews({ ...this.getWorld() });
        return OK;
      }
    },
    publishReviewsFrom: {
      gwta: `publish reviews from {where}`,
      action: async ({ where }: TNamed) => {
        for (const dest of where.split(',').map(d => d.trim())) {
          await this.publishReviews({ ...this.getWorld(), options: { ...this.getWorld().options, DEST: dest } });
        }
        return OK;
      }
    },
    publishFoundReviews: {
      exact: `publish found reviews`,
      action: async () => {
        const found = await this.utils.findArtifacts(this.tracksStorage, `${INDEXED}:`);
        for (const dest of found) {
          await this.publishReviews({ ...this.getWorld(), options: { ...this.getWorld().options, DEST: dest } });
        }
        return OK;
      }
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
        const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dashboard', 'web');
        await this.publishStorage.ensureDirExists(this.publishRoot);
        await this.utils.recurseCopy({ src: `${web}/public`, fromFS: this.localFS, toFS: this.publishStorage, toFolder: this.publishRoot, trimFolder: `${web}/public` });
        await this.utils.recurseCopy({ src: `${web}/built`, fromFS: this.localFS, toFS: this.publishStorage, toFolder: this.publishRoot, trimFolder: `${web}/built` });
        return actionOK({ tree: { summary: 'wrote files', details: await this.publishStorage.readTree(this.publishRoot) } })
      }
    },
  }

  async writeReviewsFrom(where: string[]) {
    for (const dir of where) {
      const locs = await this.utils.getMemberEntries(dir);
      // process each loc using func
      for (const { tag, memDir } of locs) {
        const tracksDir = `${memDir}/tracks`;
        if (!this.publishStorage.exists(tracksDir)) {
          this.getWorld().logger.debug(`no tracks dir ${tracksDir} for ${memDir}`);
          return;
        }
        const tracks = await this.utils.readTracksFile(tracksDir);
        const mediaType = EMediaTypes.html;
        const loc: TLocationOptions = { mediaType, tag, options: { ...this.getWorld().options, DEST: this.world.options.DEST }, extraOptions: { ...this.getWorld().extraOptions } };
        await this.writeReview(loc, tracks);
      }
    }
  }

  async createReviewsIndex(indexDirs: string[]) {
    const uriArgs = getStepperOption(this, URI_ARGS, this.getWorld().extraOptions) || '';
    const htmlGenerator = new HtmlGenerator(uriArgs);
    const results: { ok: boolean, link: string, index: TIndexSummary[], dir: string }[] = [];

    let success = 0;
    let fail = 0;

    for (const spec of indexDirs) {
      const [type, dirIn] = spec.split(':');
      const dir = dirIn || type;
      const summary: TIndexSummary = await (type === INDEXED ? this.utils.getIndexedResults(dir) : this.utils.getReviewSummary(dir));

      const ok = !!summary.results.every(r => r.ok);
      success += summary.results.filter(r => r.ok).length;
      fail += summary.results.filter(r => !r.ok).length;
      const index = toc(summary, dir, uriArgs, htmlGenerator.linkFor, (path: string) => this.publishStorage.pathed(EMediaTypes.html, path, `./${CAPTURE}`));

      results.push({ ok, dir, link: htmlGenerator.linkFor(dir), index });
    }

    const isum = summary(results);

    const title = 'Feature Result Index';
    const html = await htmlGenerator.getHtmlDocument(isum, { title, base: 'capture/' },);
    await this.publishStorage.ensureDirExists([this.publishRoot].join('/'));
    const indexHtml = [this.publishRoot, REVIEWS_INDEX_FILE].join('/');
    const link: TReviewLink = { date: Timer.key, link: indexHtml.replace(/.*\//, ''), title, results: { fail, success } };

    await this.publishStorage?.writeFile(indexHtml, html, EMediaTypes.html);
    await this.writeReviewLinker(link);

    this.getWorld().logger.info(`wrote index file ${indexHtml}`)
    return OK;
  }
  async writeReviewLinker(linked: TReviewLink) {
    await this.publishStorage.ensureDirExists([this.publishRoot, 'reviews'].join('/'));
    let setting = this.getWorld().options.SETTING;
    setting = setting ? `${setting}-` : '';
    // FIXME use AStorage
    const dest = [this.publishRoot, 'reviews'].join('/');
    await this.publishStorage.ensureDirExists(dest);
    const fn = `${dest}/${setting}${Timer.key}-review.json`;
    await this.publishStorage.writeFile(fn, JSON.stringify(linked), EMediaTypes.json);
    this.world.logger.info(`wrote review link ${fn}`)
  }

  async writeReview(loc: TLocationOptions, tracksDoc: TTrackResult | TMissingTracks) {
    const uriArgs = getStepperOption(this, URI_ARGS, loc.extraOptions);
    const htmlGenerator = new HtmlGenerator(uriArgs);

    const dir = await this.reviewsStorage.getCaptureLocation(loc);
    const reviewHtml = await this.reviewsStorage.getCaptureLocation(loc, REVIEW_FILE);
    await this.reviewsStorage.ensureDirExists(dir);

    const { featureJSON, script } = await this.utils.getFeatureDisplay(tracksDoc, htmlGenerator, loc, dir);

    const html = await htmlGenerator.getHtmlDocument(featureJSON, {
      title: `Feature Result ${loc.tag.sequence}`,
      script
    });
    await this.reviewsStorage.writeFile(reviewHtml, html, loc.mediaType);
    this.getWorld().logger.log(`wrote review ${reviewHtml}`);
  }

  async publishReviews(world: TWorld) {
    const fromFS = this.tracksStorage;
    const toFS = this.publishStorage;
    // FIXME media type is ...
    const src = await fromFS.fromCaptureLocation(EMediaTypes.html, world.options.DEST);

    await this.utils.recurseCopy({ src, fromFS, toFS, toFolder: this.publishRoot });
  }
  async writeTracksFile(loc: TLocationOptions, title: string, result: TFeatureResult, startTime: Date, startOffset: number) {
    const dir = await this.reviewsStorage.ensureCaptureLocation(loc, 'tracks', `tracks.json`);
    await this.reviewsStorage.writeFile(dir, JSON.stringify({ meta: { startTime: startTime.toISOString(), title, startOffset }, result }, null, 2), loc.mediaType);
  }
}

export default OutReviews;
