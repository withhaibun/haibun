import { EOL } from "os";
import { create } from "xmlbuilder2";

import { AStepper, IHasOptions, IPublishResults, IRequireDomains, IReviewResult, ITraceResult, OK, TFeatureResult, TLocationOptions, TNamed, TResult, TTrace, TWorld } from "@haibun/core/build/lib/defs";
import { STORAGE_ITEM, STORAGE_LOCATION } from '@haibun/domain-storage';
import { findStepperFromOption, getRunTag, getStepperOption, stringOrError } from '@haibun/core/build/lib/util';
import { AStorage } from '@haibun/domain-storage/build/AStorage';
import ReviewScript from "./review-script";

const TRACE_STORAGE = 'TRACE_STORAGE';
const REVIEWS_STORAGE = 'REVIEWS_STORAGE';
const PUBLISH_STORAGE = 'PUBLISH_STORAGE';
const INDEX_STORAGE = 'INDEX_STORAGE';
const URI_ARGS = 'URI_ARGS';

const OutReviews = class OutReviews extends AStepper implements IHasOptions, IRequireDomains, ITraceResult, IReviewResult, IPublishResults {
  content: string = '<not initialized"';
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
    this.reviewsStorage = findStepperFromOption(steppers, this, world.extraOptions, REVIEWS_STORAGE);
    this.publishStorage = findStepperFromOption(steppers, this, world.extraOptions, PUBLISH_STORAGE, REVIEWS_STORAGE);
    this.indexStorage = findStepperFromOption(steppers, this, world.extraOptions, INDEX_STORAGE, PUBLISH_STORAGE, REVIEWS_STORAGE);
  }

  steps = {
    createReview: {
      gwta: `create review`,
      action: async () => {
        const reviewsIn = this.traceStorage!;
        const output = await reviewsIn.readFile(await this.reviewsStorage!.getCaptureDir(this.getWorld(), 'trace') + '/trace.json', 'utf-8');
        this.writeReview(this.getWorld(), output);
        return OK;
      }
    },
    publishResults: {
      gwta: `publish results`,
      action: async () => {
        const rin = this.traceStorage!;
        const rout = this.publishStorage!;
        const dir = await rin.getCaptureDir(this.getWorld());
        await this.recurseCopy(dir, rin, rout);
        return OK;
      }
    },
    publishReviews: {
      gwta: `create index`,
      action: async ({ where }: TNamed) => {
        const dir = `${process.cwd()}/${where}`
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
                const output = await reviewsIn.readFile(`${memDir}/trace/trace.json`, 'utf-8');
                const tag = getRunTag(n(seqDir), n(loopDir), n(featDir), n(memDir))
                this.writeReview({ tag, options: this.getWorld().options, extraOptions: this.getWorld().extraOptions }, output);
              }
            }
          }
        }
        return OK;
      }
    }
  }
  async writeTraceFile(loc: TLocationOptions, result: TFeatureResult) {
    const dir = await this.reviewsStorage!.ensureCaptureDir(loc, 'trace', `trace.json`);

    await this.reviewsStorage!.writeFile(dir, JSON.stringify(result, null, 2));
  }
  async writeReview(loc: TLocationOptions, result: TFeatureResult) {
    const uriArgs = getStepperOption(this, URI_ARGS, loc.extraOptions);
    const { html, } = await this.getOutput(this.traceStorage!, result, { uriArgs });
    const file = await this.reviewsStorage!.ensureCaptureDir(loc, undefined, 'review.html');

    await this.reviewsStorage!.writeFile(file, html);
    this.getWorld().logger.log(`wrote review ${file}`);
  }
  async publishResults(world: TWorld) {
    const rin = this.traceStorage!;
    const rout = this.publishStorage!;
    const dir = await rin.getCaptureDir(world);
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
  traces(a: any) {
    const { traces } = a;
    const byUrl = (traces as TTrace[]).map((i) => ({ url: i.response.trace.url, since: i.response.since, headersContent: i.response.trace.headersContent }));

    const ret = byUrl.map(({ url, since, headersContent }) => {
      const summary = {
        a: {
          '@data-time': since,
          '@onclick': `setTime(${since})`,
          '#': `${since} ${url}`,
        }
      }
      const ul = (headersContent as any).map((i: any) => ({
        li:
        {
          '#': `${i.name}: ${i.value}`
        }
      }));

      return {
        details: {
          ul,
          summary
        }
      }
    });
    return ret;
  }

  async getOutput(storage: AStorage, result: TFeatureResult, { title = 'Haibun-Review', prettyPrint = true, uriArgs = '' }) {
    const videoBase = await this.traceStorage!.getCaptureDir(this.getWorld(), 'video');
    const video = await storage.readdir(videoBase)[0];
    const forHTML: any = {
      html: {
        "@xmlns": "http://www.w3.org/1999/xhtml",
        "@style": "font-family: 'Open Sans', sans-serif",
        link: {
          '@href': "https://fonts.googleapis.com/css2?family=Open+Sans&display=swap",
          '@rel': "stylesheet"
        },
        title,
        div: {
          '@style': 'position: fixed; top: 0, background-color: rgba(255,255,255,0.5), width: 100%',
          video: {
            '@id': 'video',
            '@controls': true,
            '@height': '480',
            '@width': '100%',
            source: {
              '@type': 'video/webm',
              '@src': `video/${video}${uriArgs}`
            }
          },
        },
        section: {
          '@style': 'padding-top: 480',
          div: []
        },
        script: {
          '@type': 'text/javascript',
          '#': '{{SCRIPT}}'
        },
      }
    }

    const feature: any = {
      div: {
        '@style': 'border-top: 1px dotted grey; padding-top: 4em',
        a: {
          '#': `Result: ${result.ok}`,
        },
        div: []
      }
    }
    // for (const f of result.results!) {
    for (const s of result.stepResults) {
      for (const a of s.actionResults) {
        const start = (a as any).start;
        const o = {
          '@style': 'padding-top: 1em',
          a: {
            '@data-time': start,
            '@onclick': `setTime(${start})`,
            b: {
              b: {
                '#': `<<  `,
                span: [{
                  '@style': 'background: black; color: white; padding: 5, width: 3em; text-align: right',
                  '#': `${s.seq}`,
                },
                {
                  '#': `${a.ok} ${a.name} ${s.in}  `
                }]

              }
            }
          },
          details: [(a.topics && {
            '#': JSON.stringify(a.topics),
            summary: {
              '#': 'topics'
            },
          }),
          ((a as any).traces && {
            '#': this.traces(a),
            summary: {
              '#': 'trace'
            },
          }),
          ]
        }
        feature.div.div.push(o);
      }
      // }
    }

    forHTML.html.section.div.push(feature);
    const created = create(forHTML).end({ prettyPrint, newline: EOL });
    const html = this.finish(created);
    this.content = html;
    return { html };
  }
  finish(html: string) {
    html = html.replace('{{SCRIPT}}', ReviewScript);
    return html;
  }
  async writeOutput(result: TResult, args: any) {
    return `wrote to ${this.content}`;
  }
}

export default OutReviews;
