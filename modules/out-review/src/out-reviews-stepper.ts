import { AStepper, IHasOptions, IRequireDomains, OK, TFeatureResult, TNamed, TWorld, } from "@haibun/core/build/lib/defs";
import { EMediaTypes, guessMediaExt, IPublishResults, IReviewResult, STORAGE_ITEM, STORAGE_LOCATION, TLocationOptions, TMediaType } from '@haibun/domain-storage';
import { findStepperFromOption, getRunTag, getStepperOption, stringOrError } from '@haibun/core/build/lib/util';
import { AStorage } from '@haibun/domain-storage/build/AStorage';
import HtmlGenerator, { TINDEX_SUMMARY } from "./html-generator";
import { ITraceResult } from '@haibun/domain-storage/build/domain-storage';

export const TRACE_STORAGE = 'TRACE_STORAGE';
export const REVIEWS_STORAGE = 'REVIEWS_STORAGE';
const PUBLISH_STORAGE = 'PUBLISH_STORAGE';
const INDEX_STORAGE = 'INDEX_STORAGE';
const URI_ARGS = 'URI_ARGS';

export const MISSING_TRACE: TINDEX_SUMMARY = { ok: false, path: 'missing', title: 'Missing trace file' };

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
        const trace = await this.readTraceFile(loc);
        this.writeReview(loc, trace);
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
    publishResults: {
      exact: `publish results`,
      action: async () => {
        await this.publishResults({ ...this.getWorld() });
        return OK;
      }
    },
    createReviews: {
      gwta: `create reviews from {where}`,
      action: async ({ where }: TNamed) => {
        const func = async (loc: TLocationOptions) => {
          const trace = await this.readTraceFile(loc);

          await this.writeReview(loc, trace);
        };
        for (const dir of where.split(',').map(s => s.trim())) {
          await this.withDestLocs(dir, func, EMediaTypes.html);
        }
        return OK;
      }
    },
    createIndexesFrom: {
      gwta: `create indexes from {where}`,
      action: async ({ where }: TNamed) => {
        const dirs = where.split(',').map(d => d.trim());
        return await this.createIndexes(dirs);
      }
    },
    createIndex: {
      exact: `create index`,
      action: async () => {
        return await this.createIndexes([this.getWorld().options.DEST]);
      }
    }
  }

  async getIndexedResults(dir: string) {
    const file = this.indexStorage!.fromCaptureDir(EMediaTypes.json, dir, 'indexed.json');
    let contents;
    try {
      contents = await this.indexStorage!.readFile(file);
      const reviewIndexes: TINDEX_SUMMARY[] = JSON.parse(contents);
      return reviewIndexes;
    } catch (e) {
      this.getWorld().logger.error(`can't parse indexedResults ${file}: ${e} from ${contents}`);
      throw (e);
    }
  }

  async getReviewIndex(dir: string) {
    let reviewIndexes: TINDEX_SUMMARY[] = [];
    const func = async (loc: TLocationOptions) => {
      const trace = await this.readTraceFile(loc);
      const res = {
        ok: trace.ok,
        path: await this.publishStorage!.getCaptureDir(loc) + '/review.html',
        title: `${loc.tag.featureNum} ${trace.path}`
      }

      reviewIndexes.push(res);
    }

    await this.withDestLocs(dir, func, EMediaTypes.html);
    return reviewIndexes;
  }
  async createIndexes(indexDirs: string[]) {
    const uriArgs = getStepperOption(this, URI_ARGS, this.getWorld().extraOptions);
    const htmlGenerator = new HtmlGenerator(this.traceStorage!, this.publishStorage!, uriArgs);
    const results: { ok: boolean, link: string, index: TINDEX_SUMMARY[], dir: string }[] = [];

    for (const spec of indexDirs) {
      const [type, dirIn] = spec.split(':');
      const dir = dirIn || type;
      const indexer = type === 'indexed' ? this.getIndexedResults.bind(this) : this.getReviewIndex.bind(this);
      const summaries = await indexer(dir);
      const ok = !!summaries.every(s => s.ok);
      const index = await htmlGenerator.getIndex(summaries, dir);
      results.push({ ok, dir, link: htmlGenerator.linkFor(dir), index });
    }

    const indexSummary = htmlGenerator.getIndexSummary(results);
    const { html } = await htmlGenerator.getOutput(indexSummary, { title: 'Feature Result Index' });
    const indexHtml = this.publishStorage?.fromCaptureDir(EMediaTypes.html, 'index.html');
    
    await this.publishStorage?.writeFile(indexHtml!, html, EMediaTypes.html);
    this.getWorld().logger.info(`wrote index file ${indexHtml}`)
    return OK;
  }
  async withDestLocs(dest: string, func: any, mediaType: TMediaType) {
    const reviewsIn = this.traceStorage!;
    const n = (i: string) => {
      return parseInt(i.replace(/.*-/, ''));
    }

    const start = this.traceStorage!.fromCaptureDir(EMediaTypes.html, dest);

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
  async readTraceFile(loc: TLocationOptions): Promise<TFeatureResult | typeof MISSING_TRACE> {
    const traceIn = this.traceStorage!;
    try {
      const output = await traceIn.readFile(await traceIn.getCaptureDir(loc, 'trace') + '/trace.json', 'utf-8');
      const result = JSON.parse(output);
      return result;
    } catch (e) {
      return MISSING_TRACE;
    }

  }
  async writeTraceFile(loc: TLocationOptions, result: TFeatureResult) {
    const dir = await this.reviewsStorage!.ensureCaptureDir(loc, 'trace', `trace.json`);

    await this.reviewsStorage!.writeFile(dir, JSON.stringify(result, null, 2), loc.mediaType);
  }
  async writeReview(loc: TLocationOptions, trace: TFeatureResult | typeof MISSING_TRACE) {
    const uriArgs = getStepperOption(this, URI_ARGS, loc.extraOptions);
    const generateHTML = new HtmlGenerator(this.traceStorage!, this.publishStorage!, uriArgs);

    const dir = await this.reviewsStorage!.getCaptureDir(loc);

    const reviewHtml = await this.reviewsStorage!.getCaptureDir(loc, `review.html`);
    
    await this.reviewsStorage!.ensureDirExists(dir);
    const result = await generateHTML.getFeatureResult(loc, this.traceStorage!, trace, dir);
    const { html } = await generateHTML.getOutput(result, { title: `Feature Result ${loc.tag.sequence}` });

    await this.reviewsStorage!.writeFile(reviewHtml, html, loc.mediaType);
    this.getWorld().logger.log(`wrote review ${reviewHtml}`);
  }
  async publishResults(world: TWorld) {
    const rin = this.traceStorage!;
    const rout = this.publishStorage!;
    // FIXME media type is 
    // FIXME media type is ...
    const dir = await rin.getCaptureDir({ ...world, mediaType: EMediaTypes.html });
    await this.recurseCopy(dir, rin, rout);
  }
  async recurseCopy(dir: string, rin: AStorage, rout: AStorage) {
    const entries = await rin.readdir(dir);

    for (const entry of entries) {
      const here = `${dir}/${entry}`;
      const stat = rin.stat(here);
      if (stat.isDirectory()) {
        await rout.mkdirp(here);
        await this.recurseCopy(here, rin, rout);
      } else {
        const content = await rin.readFile(here);
        const ext = <EMediaTypes>guessMediaExt(entry);
        await rout.writeFile(`${dir}/${entry}`, content, ext);
      }
    }
  }
}

export default OutReviews;
