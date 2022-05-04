import { AStepper, CAPTURE, IHasOptions, IRequireDomains, OK, TFeatureResult, TNamed, TWorld, } from "@haibun/core/build/lib/defs";
import { EMediaTypes, guessMediaExt, IPublishResults, IReviewResult, STORAGE_ITEM, STORAGE_LOCATION, TLocationOptions, TMediaType, TTraceResult } from '@haibun/domain-storage';
import { findStepperFromOption, getRunTag, getStepperOption, stringOrError } from '@haibun/core/build/lib/util';
import { AStorage } from '@haibun/domain-storage/build/AStorage';
import HtmlGenerator, { TIndexSummary, TSummaryItem } from "./html-generator";
import { ITraceResult } from '@haibun/domain-storage/build/domain-storage';
import { summary } from "./components/index/summary";
import { toc } from "./components/index/toc";

export const TRACE_STORAGE = 'TRACE_STORAGE';
export const REVIEWS_STORAGE = 'REVIEWS_STORAGE';
const PUBLISH_STORAGE = 'PUBLISH_STORAGE';
const INDEX_STORAGE = 'INDEX_STORAGE';
const URI_ARGS = 'URI_ARGS';

export const MISSING_TRACE: TIndexSummary = { ok: false, path: 'missing', title: 'Missing trace file', startTime: new Date() };
const INDEXED = 'indexed';

const OutReviews = class OutReviews extends AStepper implements IHasOptions, IRequireDomains, ITraceResult, IReviewResult, IPublishResults {
  traceStorage?: AStorage;
  reviewsStorage?: AStorage;
  publishStorage?: AStorage;
  indexStorage?: AStorage;

  requireDomains = [STORAGE_LOCATION, STORAGE_ITEM];
  options = {
    [TRACE_STORAGE]: {
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
    this.traceStorage = findStepperFromOption(steppers, this, world.extraOptions, TRACE_STORAGE);
    this.reviewsStorage = findStepperFromOption(steppers, this, world.extraOptions, REVIEWS_STORAGE, TRACE_STORAGE);
    this.indexStorage = findStepperFromOption(steppers, this, world.extraOptions, INDEX_STORAGE, REVIEWS_STORAGE, TRACE_STORAGE);
    this.publishStorage = findStepperFromOption(steppers, this, world.extraOptions, PUBLISH_STORAGE, REVIEWS_STORAGE, TRACE_STORAGE);
  }

  steps = {
    createReview: {
      // create a review from current world only
      exact: `create review`,
      action: async () => {
        const loc = { ...this.getWorld(), mediaType: EMediaTypes.html };
        const traceResult = await this.readTraceFile(loc);
        this.writeReview(loc, traceResult);
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
        const found = await this.findArtifacts(this.traceStorage!, `${INDEXED}:`);
        this.writeReviewsFrom(found);
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
        const found = await this.findArtifacts(this.traceStorage!, `${INDEXED}:`);
        for (const dest of found) {
          await this.publishResults({ ...this.getWorld(), options: { ...this.getWorld().options, DEST: dest } });
        }
        return OK;
      }
    },
    createIndex: {
      exact: `create index`,
      action: async () => {
        return await this.createIndexes([this.getWorld().options.DEST]);
      }
    },
    createIndexesFrom: {
      gwta: `create indexes from {where}`,
      action: async ({ where }: TNamed) => {
        const dirs = where.split(',').map(d => d.trim());
        return await this.createIndexes(dirs);
      }
    },
    createFoundIndex: {
      exact: `create found index`,
      action: async () => {
        const found = await this.findArtifacts(this.traceStorage!);
        return await this.createIndexes(found);
      }
    },
  }

  // find parseable artifacts from known traces
  async findArtifacts(fromWhere: AStorage, filter?: string) {
    const dir = await fromWhere.readdirStat(`./${CAPTURE}`);
    let found: string[] = [];
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
      const trace = await this.readTraceFile(loc);

      await this.writeReview(loc, trace);
    };
    for (const dir of where) {
      await this.withDestLocs(dir, func, EMediaTypes.html);
    }
  }

  async getIndexedResults(dir: string) {
    const file = this.indexStorage!.fromCaptureLocation(EMediaTypes.json, dir, 'indexed.json');
    let contents;
    try {
      contents = await this.indexStorage!.readFile(file);
      const reviewIndexes: TIndexSummary[] = JSON.parse(contents);
      return reviewIndexes;
    } catch (e) {
      this.getWorld().logger.error(`can't parse indexedResults ${file}: ${e} from ${contents}`);
      throw (e);
    }
  }

  async getReviewIndex(dir: string) {
    let reviewIndexes: TIndexSummary[] = [];
    const func = async (loc: TLocationOptions) => {
      const trace = await this.readTraceFile(loc);
      const { result, meta } = (<TTraceResult>trace);
      const { title, startTime } = meta;
      if (result) {
        const res = {
          ok: result.ok,
          path: await this.publishStorage!.getCaptureLocation(loc) + '/review.html',
          title,
          startTime
        }

        reviewIndexes.push(res);
      } else {
        reviewIndexes.push(<typeof MISSING_TRACE>trace);
      }
    }

    await this.withDestLocs(dir, func, EMediaTypes.html);
    return reviewIndexes;
  }
  async createIndexes(indexDirs: string[]) {
    const uriArgs = getStepperOption(this, URI_ARGS, this.getWorld().extraOptions) || '';
    const htmlGenerator = new HtmlGenerator(this.publishStorage!, uriArgs);
    const results: { ok: boolean, link: string, index: TIndexSummary[], dir: string }[] = [];

    for (const spec of indexDirs) {
      const [type, dirIn] = spec.split(':');
      const dir = dirIn || type;
      const indexer = type === INDEXED ? this.getIndexedResults.bind(this) : this.getReviewIndex.bind(this);
      const summaries = await indexer(dir);
      const ok = !!summaries.every(s => s.ok);
      const index = toc(summaries, dir, uriArgs, htmlGenerator.linkFor, (path: string) => this.publishStorage!.pathed(EMediaTypes.html, path, `./${CAPTURE}`));
      results.push({ ok, dir, link: htmlGenerator.linkFor(dir), index });
    }

    const isum = summary(results);
    const { html } = await htmlGenerator.getHtmlDocument(isum, { title: 'Feature Result Index' });
    const indexHtml = this.publishStorage?.fromCaptureLocation(EMediaTypes.html, 'index.html');

    await this.publishStorage?.writeFile(indexHtml!, html, EMediaTypes.html);
    this.getWorld().logger.info(`wrote index file ${indexHtml}`)
    return OK;
  }
  async withDestLocs(dest: string, func: any, mediaType: TMediaType) {
    const reviewsIn = this.traceStorage!;
    const n = (i: string) => {
      return parseInt(i.replace(/.*-/, ''));
    }

    const start = this.traceStorage!.fromCaptureLocation(EMediaTypes.html, dest);

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
  async readTraceFile(loc: TLocationOptions): Promise<TTraceResult | typeof MISSING_TRACE> {
    const traceIn = this.traceStorage!;
    try {
      const output = await traceIn.readFile(await traceIn.getCaptureLocation(loc, 'trace') + '/trace.json', 'utf-8');
      const result = JSON.parse(output);
      return result;
    } catch (e) {
      return MISSING_TRACE;
    }
  }

  async writeTraceFile(loc: TLocationOptions, startTime: Date, title: string, result: TFeatureResult) {
    const dir = await this.reviewsStorage!.ensureCaptureLocation(loc, 'trace', `trace.json`);

    await this.reviewsStorage!.writeFile(dir, JSON.stringify({ meta: { startTime, title }, result }, null, 2), loc.mediaType);
  }

  async writeReview(loc: TLocationOptions, trace: TTraceResult | typeof MISSING_TRACE) {
    const uriArgs = getStepperOption(this, URI_ARGS, loc.extraOptions);
    const generateHTML = new HtmlGenerator(this.publishStorage!, uriArgs);

    const dir = await this.reviewsStorage!.getCaptureLocation(loc);

    const reviewHtml = await this.reviewsStorage!.getCaptureLocation(loc, `review.html`);

    await this.reviewsStorage!.ensureDirExists(dir);
    const result = await this.traceToResult(loc, this.traceStorage!, <TTraceResult>trace, dir);

    const i = generateHTML.getFeatureResult(result as TSummaryItem);

    const { html } = await generateHTML.getHtmlDocument(i, { title: `Feature Result ${loc.tag.sequence}` });

    await this.reviewsStorage!.writeFile(reviewHtml, html, loc.mediaType);
    this.getWorld().logger.log(`wrote review ${reviewHtml}`);
  }
  async publishResults(world: TWorld) {
    const rin = this.traceStorage!;
    const rout = this.publishStorage!;
    // FIXME media type is ...
    const dir = await rin.getCaptureLocation({ ...world, mediaType: EMediaTypes.html });
    await this.recurseCopy(dir, rin, rout);
  }
  async recurseCopy(dir: string, rin: AStorage, rout: AStorage) {
    const entries = await rin.readdirStat(dir);

    for (const entry of entries) {
      const here = entry.name;
      if (entry.isDirectory) {
        await rout.mkdirp(here);
        await this.recurseCopy(here, rin, rout);
      } else {
        const content = await rin.readFile(here);
        const ext = <EMediaTypes>guessMediaExt(entry.name);

        await rout.writeFile(here, content, ext);
      }
    }
  }
  async traceToResult(loc: TLocationOptions, storage: AStorage, trace: TTraceResult | typeof MISSING_TRACE, dir: string) {
    const { result, meta } = (<TTraceResult>trace);
    const { title, startTime } = meta;
    const videoBase = await this.traceStorage!.getCaptureLocation(loc, 'video');
    let videoSrc: string | undefined = undefined;
    try {
      const file = (await storage.readdir(videoBase))[0];
      videoSrc = this.publishStorage!.pathed(EMediaTypes.video, await this.publishStorage!.getCaptureLocation(loc, 'video') + `/${file}`, dir);
    } catch (e) { }

    if (!result) {
      return (<typeof MISSING_TRACE>result).path;
    } else {
      const i: Partial<TSummaryItem> = { videoSrc, title, startTime, path: result.path, ok: result.ok, subResults: [] }
      for (const stepResult of (result as TFeatureResult).stepResults) {
        for (const actionResult of stepResult.actionResults) {
          const sr: Partial<TSummaryItem> = {
            start: (actionResult as any).start, seq: stepResult.seq, in: stepResult.in,
            ok: actionResult.ok, name: actionResult.name, topics: actionResult.topics, traces: (actionResult as any).traces
          };
          i.subResults?.push(sr as TSummaryItem);
        }
      }
      return i;
    }
  }
}

export default OutReviews;
