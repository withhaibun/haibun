import { AStepper, CAPTURE, IHasOptions, IPublishResults, IRequireDomains, IReviewResult, ITraceResult, OK, TFeatureResult, TLocationOptions, TWorld } from "@haibun/core/build/lib/defs";
import { STORAGE_ITEM, STORAGE_LOCATION } from '@haibun/domain-storage';
import { findStepperFromOption, getRunTag, getStepperOption, stringOrError } from '@haibun/core/build/lib/util';
import { AStorage } from '@haibun/domain-storage/build/AStorage';
import GenerateHtml from "./generate-html";

const TRACE_STORAGE = 'TRACE_STORAGE';
const REVIEWS_STORAGE = 'REVIEWS_STORAGE';
const PUBLISH_STORAGE = 'PUBLISH_STORAGE';
const INDEX_STORAGE = 'INDEX_STORAGE';
const URI_ARGS = 'URI_ARGS';

export const MISSING_TRACE = { ok: 'Missing trace file', path: 'missing' };

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
      exact: `create review`,
      action: async () => {
        const trace = await this.readTraceFile(this.getWorld());
        this.writeReview(this.getWorld(), trace);
        return OK;
      }
    },
    publishResults: {
      exact: `publish results`,
      action: async () => {
        await this.publishResults();
        return OK;
      }
    },
    createReviews: {
      exact: `create reviews`,
      action: async () => {
        const func = async (loc: TLocationOptions) => {
          const trace = await this.readTraceFile(loc);
          await this.writeReview(loc, trace);
        };
        await this.withLocs(func);
        return OK;
      }
    },
    createIndex: {
      exact: `create index`,
      action: async () => {
        const uriArgs = getStepperOption(this, URI_ARGS, this.getWorld().extraOptions);
        let traces: { loc: TLocationOptions, trace: TFeatureResult | typeof MISSING_TRACE }[] = [];
        const func = async (loc: TLocationOptions) => {
          const trace = await this.readTraceFile(loc);
          traces.push({ loc, trace });
        }
        await this.withLocs(func);
        const generateHTML = new GenerateHtml(this.publishStorage!, uriArgs);
        const content = await generateHTML.getIndex(traces);
        const { html } = await generateHTML.getOutput(content, { title: 'Feature Result Index' });
        const file = `./${CAPTURE}/index.html`;
        await this.indexStorage?.writeFile(file, html);
        this.getWorld().logger.info(`wrote index file ${file}`)
        return OK;
      }
    }
  }
  async withLocs(func: any) {
    const dir = `${process.cwd()}/${CAPTURE}`
    const reviewsIn = this.traceStorage!;
    const n = (i: string) => i.replace(/.*-/, '');
    const loops = await reviewsIn.readdir(dir);
    for (const loop of loops) {
      
      const loopDir = `${dir}/${loop}`;
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
            const loc = { tag, options: this.getWorld().options, extraOptions: this.getWorld().extraOptions };
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

    await this.reviewsStorage!.writeFile(dir, JSON.stringify(result, null, 2));
  }
  async writeReview(loc: TLocationOptions, trace: TFeatureResult | typeof MISSING_TRACE) {
    const uriArgs = getStepperOption(this, URI_ARGS, loc.extraOptions);
    const generateHTML = new GenerateHtml(this.publishStorage!, uriArgs);
    const result = await generateHTML.getFeatureResult(loc, this.traceStorage!, trace);
    const { html, } = await generateHTML.getOutput(result, { title: `Feature Result ${loc.tag.sequence}` });
    const file = await this.reviewsStorage!.ensureCaptureDir(loc, undefined, 'review.html');

    await this.reviewsStorage!.writeFile(file, html);
    this.getWorld().logger.log(`wrote review ${file}`);
  }
  async publishResults() {
    const rin = this.traceStorage!;
    const rout = this.publishStorage!;
    const dir = `./${CAPTURE}/`;
    await rout.rmrf(dir)
    await this.recurseCopy(dir, rin, rout);
  }
  async recurseCopy(dir: string, rin: AStorage, rout: AStorage) {
    const entries = await rin.readdir(dir);

    for (const entry of entries) {
      const here = `${dir}/${entry}`;
      const stat = rin.stat(here);
      if (stat.isDirectory()) {
        await this.recurseCopy(here, rin, rout);
        await rout.mkdirp(here);
      } else {
        const content = await rin.readFile(here);
        await rout.writeFile(`${dir}/${entry}`, content);
      }
    }
  }
}

export default OutReviews;
