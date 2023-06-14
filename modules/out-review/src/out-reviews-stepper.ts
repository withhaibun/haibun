import { AStepper, CAPTURE, IHasOptions, IRequireDomains, OK, TFeatureResult, TNamed, TWorld, } from "@haibun/core/build/lib/defs.js";
import { EMediaTypes, guessMediaExt, IPublishResults, IReviewResult, STORAGE_ITEM, STORAGE_LOCATION, TLocationOptions, TMediaType, TMissingTracks, TTrackResult } from '@haibun/domain-storage/build/domain-storage.js';
import { actionOK, findStepperFromOption, getFeatureTitlesFromResults, getRunTag, getStepperOption, stringOrError } from '@haibun/core/build/lib/util/index.js';
import { AStorage } from '@haibun/domain-storage/build/AStorage.js';
import HtmlGenerator, { TFeatureSummary, TIndexSummary, TIndexSummaryResult, TStepSummary, TSummaryItem } from "./html-generator.js";
import { ITrackResults } from '@haibun/domain-storage/build/domain-storage.js';
import { summary } from "./components/index/summary.js";
import { toc } from "./components/index/toc.js";
import { ReviewScript } from "./assets.js";
import StorageFS from "@haibun/storage-fs/build/storage-fs.js";
import path from "path";
import { fileURLToPath } from "url";

// FIXME use TRACK_STORAGE
export const TRACKS_STORAGE = 'TRACE_STORAGE';
export const REVIEWS_STORAGE = 'REVIEWS_STORAGE';
const PUBLISH_STORAGE = 'PUBLISH_STORAGE';
const INDEX_STORAGE = 'INDEX_STORAGE';
const URI_ARGS = 'URI_ARGS';

export const MISSING_TRACKS: TIndexSummaryResult = { ok: false, sourcePath: 'missing', featureTitle: 'Missing tracks file', startTime: new Date().toString() };
export const MISSING_TRACKS_FILE = 'Missing tracks file';
const INDEXED = 'indexed';

const OutReviews = class OutReviews extends AStepper implements IHasOptions, IRequireDomains, ITrackResults, IReviewResult, IPublishResults {
  tracksStorage: AStorage;
  reviewsStorage: AStorage;
  publishStorage: AStorage;
  indexStorage: AStorage;
  localFS: StorageFS;

  requireDomains = [STORAGE_LOCATION, STORAGE_ITEM];
  options = {
    [TRACKS_STORAGE]: {
      required: true,
      desc: 'Storage type used for input',
      parse: (input: string) => stringOrError(input)
    },
    [REVIEWS_STORAGE]: {
      required: true,
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
  };

  setWorld(world: TWorld, steppers: AStepper[]) {
    super.setWorld(world, steppers);
    this.tracksStorage = findStepperFromOption(steppers, this, world.extraOptions, TRACKS_STORAGE);
    this.reviewsStorage = findStepperFromOption(steppers, this, world.extraOptions, REVIEWS_STORAGE, TRACKS_STORAGE);
    this.indexStorage = findStepperFromOption(steppers, this, world.extraOptions, INDEX_STORAGE, REVIEWS_STORAGE, TRACKS_STORAGE);
    this.publishStorage = findStepperFromOption(steppers, this, world.extraOptions, PUBLISH_STORAGE, REVIEWS_STORAGE, TRACKS_STORAGE);
    const localFS = new StorageFS();
    localFS.setWorld(world, steppers);
    this.localFS = localFS;
  }

  steps = {
    createReview: {
      // create a review from current world only
      exact: `create review`,
      action: async () => {
        const loc = { ...this.getWorld(), mediaType: EMediaTypes.html };

        let tracks;
        tracks = await this.readTracksFile(loc).catch(error => tracks = { error });
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
        const found = await this.findArtifacts(this.tracksStorage, `${INDEXED}:`);
        await this.writeReviewsFrom(found);
        return OK;
      }
    },
    publishResults: {
      exact: `publish results`,
      action: async () => {
        await this.publishResults({ ...this.getWorld() });
        return OK;
      }
    },
    publishResultsFrom: {
      gwta: `publish results from {where}`,
      action: async ({ where }: TNamed) => {
        for (const dest of where.split(',').map(d => d.trim())) {
          await this.publishResults({ ...this.getWorld(), options: { ...this.getWorld().options, DEST: dest } });
        }
        return OK;
      }
    },
    publishFoundResults: {
      exact: `publish found results`,
      action: async () => {
        const found = await this.findArtifacts(this.tracksStorage, `${INDEXED}:`);
        for (const dest of found) {
          await this.publishResults({ ...this.getWorld(), options: { ...this.getWorld().options, DEST: dest } });
        }
        return OK;
      }
    },
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
        const found = await this.findArtifacts(this.tracksStorage);
        return await this.createReviewsIndex(found);
      }
    },
    createDashboardPage: {
      exact: `create dashboard page`,
      action: async () => {
        const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dashboard', 'web');
        const assetSrc = path.join(web, 'built');
        const publicSrc = path.join(web, 'public');
        await this.recurseCopy({ src: assetSrc, fromFS: this.localFS, toFS: this.publishStorage, toFolder: '/dashboard', trimFolder: assetSrc });
        await this.recurseCopy({ src: publicSrc, fromFS: this.localFS, toFS: this.publishStorage, toFolder: '/dashboard', trimFolder: publicSrc });
        return actionOK({ tree: { summary: 'wrote files', details: await this.publishStorage.readTree('/dashboard') } })
      }
    },
    publishDashboardLink: {
      exact: `publish dashboard link`,
      action: async () => {
        const found = await this.findArtifacts(this.tracksStorage);
        return await this.createReviewsIndex(found);
      }
    },
  }

  // find parseable artifacts from known tracks
  async findArtifacts(fromWhere: AStorage, filter?: string) {
    const dir = await fromWhere.readdirStat(`./${CAPTURE}`);
    const found: string[] = [];
    for (const entry of dir) {
      const entryDir = entry.name.replace(/.*\//, '');
      if (entryDir === 'sarif') {
        found.push(`${INDEXED}:${entryDir}`);
      } else if (entry.isDirectory) {
        const entries = await fromWhere.readdirStat(`${entry.name}`);
        const loop = entries.map(e => e.name.replace(/.*\//, '')).find(e => e === 'loop-1');
        if (loop) {
          found.push(entryDir);
        }
      }
    }
    return filter ? found.filter(f => !f.includes(filter)) : found;
  }
  async writeReviewsFrom(where: string[]) {
    const func = async (loc: TLocationOptions) => {
      const tracks = await this.readTracksFile(loc);
      await this.writeReview(loc, tracks);
    };
    for (const dir of where) {
      await this.withDestLocs(dir, func, EMediaTypes.html);
    }
  }

  async getIndexedResults(dir: string) {
    const file = this.indexStorage.fromCaptureLocation(EMediaTypes.json, dir, 'indexed.json');
    let contents;
    try {
      contents = await this.indexStorage.readFile(file);
      const indexSummary: TIndexSummary = JSON.parse(contents);
      return indexSummary;
    } catch (e) {
      this.getWorld().logger.error(`can't parse indexedResults ${file}: ${e} from ${contents}`);
      throw (e);
    }
  }

  async getReviewSummary(dir: string) {
    const res: Partial<TIndexSummary> = {
      indexTitle: 'none',
      results: <TIndexSummaryResult[]>[]
    }
    const func = async (loc: TLocationOptions) => {
      const tracks = await this.readTracksFile(loc);

      const { result, meta } = (<TTrackResult>tracks);
      const { title: indexTitle, startTime } = meta;
      res.indexTitle = indexTitle;
      const featureTitles = getFeatureTitlesFromResults(result);

      if (result) {
        const r = {
          ok: result.ok,
          sourcePath: await this.publishStorage.getCaptureLocation(loc) + '/review.html',
          startTime: new Date(startTime).toString(),
          featureTitle: featureTitles.join(',')
        }

        res.results.push(r);
      } else {
        // res.results!.push({ error: `no result` });
      }
    }

    await this.withDestLocs(dir, func, EMediaTypes.html);
    return res as TIndexSummary;
  }
  async createReviewsIndex(indexDirs: string[]) {
    const uriArgs = getStepperOption(this, URI_ARGS, this.getWorld().extraOptions) || '';
    const htmlGenerator = new HtmlGenerator(uriArgs);
    const results: { ok: boolean, link: string, index: TIndexSummary[], dir: string }[] = [];

    for (const spec of indexDirs) {
      const [type, dirIn] = spec.split(':');
      const dir = dirIn || type;
      const indexer = type === INDEXED ? this.getIndexedResults.bind(this) : this.getReviewSummary.bind(this);
      const summary: TIndexSummary = await indexer(dir);

      const ok = !!summary.results.every(r => r.ok);
      const index = toc(summary, dir, uriArgs, htmlGenerator.linkFor, (path: string) => this.publishStorage.pathed(EMediaTypes.html, path, `./${CAPTURE}`));

      results.push({ ok, dir, link: htmlGenerator.linkFor(dir), index });
    }

    const isum = summary(results);

    const html = await htmlGenerator.getHtmlDocument(isum, { title: 'Feature Result Index' });
    const indexHtml = this.publishStorage?.fromCaptureLocation(EMediaTypes.html, 'index.html');

    await this.publishStorage?.writeFile(indexHtml, html, EMediaTypes.html);

    this.getWorld().logger.info(`wrote index file ${indexHtml}`)
    return OK;
  }
  async withDestLocs(dest: string, func: any, mediaType: TMediaType) {
    const reviewsIn = this.tracksStorage;
    const n = (i: string) => {
      return parseInt(i.replace(/.*-/, ''));
    }

    const start = this.tracksStorage.fromCaptureLocation(EMediaTypes.html, dest);

    const loops = await reviewsIn.readdir(start);
    for (const loop of loops) {
      const loopDir = `${start}/${loop}`;

      const sequences = await reviewsIn.readdir(loopDir);
      for (const seq of sequences) {
        const seqDir = `${loopDir}/${seq}`;
        const featureNums = await reviewsIn.readdir(seqDir)
        for (const featureNum of featureNums) {
          const featDir = `${seqDir}/${featureNum}`;
          const members = await reviewsIn.readdir(featDir);
          for (const member of members) {
            const memDir = `${featDir}/${member}`;
            const tag = getRunTag(n(seqDir), n(loopDir), n(featDir), n(memDir))

            const loc = { mediaType, tag, options: { ...this.getWorld().options, DEST: dest }, extraOptions: { ...this.getWorld().extraOptions } };

            await func(loc);
          }
        }
      }
    }
  }
  async readTracksFile(loc: TLocationOptions): Promise<TTrackResult | TMissingTracks> {
    try {
      const tracks = this.tracksStorage;
      const output = await tracks.readFile(await tracks.getCaptureLocation(loc, 'tracks') + '/tracks.json', 'utf-8');
      const result = JSON.parse(output);
      return result;
    } catch (e) {
      return {
        error: (<any>e).toString()
      };
    }
  }

  async writeTracksFile(loc: TLocationOptions, title: string, result: TFeatureResult, startTime: Date, startOffset: number) {
    const dir = await this.reviewsStorage.ensureCaptureLocation(loc, 'tracks', `tracks.json`);
    await this.reviewsStorage.writeFile(dir, JSON.stringify({ meta: { startTime: startTime.toISOString(), title, startOffset }, result }, null, 2), loc.mediaType);
  }

  async writeReview(loc: TLocationOptions, tracksDoc: TTrackResult | TMissingTracks) {
    const uriArgs = getStepperOption(this, URI_ARGS, loc.extraOptions);
    const htmlGenerator = new HtmlGenerator(uriArgs);

    const dir = await this.reviewsStorage.getCaptureLocation(loc);
    const reviewHtml = await this.reviewsStorage.getCaptureLocation(loc, `review.html`);
    await this.reviewsStorage.ensureDirExists(dir);

    const { featureJSON, script } = await this.getFeatureDisplay(tracksDoc, htmlGenerator, loc, dir);

    const html = await htmlGenerator.getHtmlDocument(featureJSON, {
      title: `Feature Result ${loc.tag.sequence}`,
      script
    });
    await this.reviewsStorage.writeFile(reviewHtml, html, loc.mediaType);
    this.getWorld().logger.log(`wrote review ${reviewHtml}`);
  }

  async getFeatureDisplay(tracksDoc: TTrackResult | TMissingTracks, htmlGenerator: HtmlGenerator, loc: TLocationOptions, dir: string) {
    if ((tracksDoc as TMissingTracks).error) {
      const dir = await this.reviewsStorage.getCaptureLocation(loc);
      return { featureJSON: htmlGenerator.getFeatureError(dir, (tracksDoc as TMissingTracks).error), script: undefined };
    } else {
      const { startOffset } = (<TTrackResult>tracksDoc).meta;
      const featureTitle = getFeatureTitlesFromResults((<TTrackResult>tracksDoc).result).join(',');
      const tracksResult = await this.tracksToSummaryItem(loc, this.tracksStorage, <TTrackResult>tracksDoc, dir);
      return { featureJSON: htmlGenerator.getFeatureResult(tracksResult as TFeatureSummary, featureTitle), script: ReviewScript(startOffset) };
    }
  }

  async publishResults(world: TWorld) {
    const fromFS = this.tracksStorage;
    const toFS = this.publishStorage;
    // FIXME media type is ...
    const src = await fromFS.fromCaptureLocation(EMediaTypes.html, world.options.DEST);

    await this.recurseCopy({ src, fromFS, toFS });
  }
  async recurseCopy({ src, fromFS, toFS, toFolder, trimFolder }: { src: string, fromFS: AStorage, toFS: AStorage, toFolder?: string, trimFolder?: string }) {
    const entries = await fromFS.readdirStat(src);

    for (const entry of entries) {
      const here = entry.name;
      if (entry.isDirectory) {
        await this.recurseCopy({ src: here, fromFS, toFS, toFolder, trimFolder });
      } else {
        const content = await fromFS.readFile(here);
        const ext = <EMediaTypes>guessMediaExt(entry.name);

        const trimmed = trimFolder ? here.replace(trimFolder, '') : here;
        const dest = toFolder ? `${toFolder}/${trimmed}`.replace(/\/\//, '/') : trimmed;
        await toFS.mkdirp(path.dirname(dest));
        await toFS.writeFile(dest, content, ext);
      }
    }
  }
  async tracksToSummaryItem(loc: TLocationOptions, storage: AStorage, tracks: TTrackResult | typeof MISSING_TRACKS, dir: string): Promise<TSummaryItem> {
    const { result, meta } = (<TTrackResult>tracks);
    const { title, startTime } = meta;
    const videoBase = await this.tracksStorage.getCaptureLocation(loc, 'video');
    let videoSrc: string | undefined = undefined;
    try {
      const file = (await storage.readdir(videoBase))[0];
      videoSrc = this.publishStorage.pathed(EMediaTypes.video, await this.publishStorage.getCaptureLocation(loc, 'video') + `/${file}`, dir);
    } catch (e) {
      // there is no video file
    }

    if (!result) {
      return { title, startTime, sourcePath: MISSING_TRACKS_FILE, ok: false, subResults: [] }
    } else {
      const i: Partial<TSummaryItem> = { videoSrc, title, startTime, sourcePath: result.path, ok: result.ok, subResults: [] }
      for (const stepResult of (result as TFeatureResult).stepResults) {
        for (const actionResult of stepResult.actionResults) {
          const sr: Partial<TSummaryItem> = {
            start: (actionResult as any).start, seq: stepResult.seq, in: stepResult.in,
            sourcePath: stepResult.sourcePath,
            ok: actionResult.ok, name: actionResult.name, topics: actionResult.topics, traces: actionResult.traces
          };
          i.subResults?.push(sr as TStepSummary);
        }
      }
      return i as TSummaryItem;
    }
  }
}


export default OutReviews;
