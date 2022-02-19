import GenerateReview from "./generate-review";
import { AStepper, IHasOptions, IRequireDomains, OK, TNamed, TResult, TWorld } from "@haibun/core/build/lib/defs";
import { STORAGE_ITEM, STORAGE_LOCATION } from '@haibun/domain-storage';
import { ensureCaptureDir, findStepper, getCaptureDir, getRunTag, getStepperOption, stringOrError } from '@haibun/core/build/lib/util';
import { AStorage } from '@haibun/domain-storage/build/defs';

const IN_STORAGE = 'IN_STORAGE';
const OUT_STORAGE = 'OUT_STORAGE';

const OutReviewsStepper = class OutReviews extends AStepper implements IHasOptions, IRequireDomains {
  reviewsIn?: AStorage;
  reviewsOut?: AStorage;
  requireDomains = [STORAGE_LOCATION, STORAGE_ITEM];
  options = {
    [IN_STORAGE]: {
      required: true,
      desc: 'Storage type used for input',
      parse: (input: string) => stringOrError(input)
    },
    [OUT_STORAGE]: {
      required: true,
      desc: 'Storage type used for output',
      parse: (input: string) => stringOrError(input)
    },
  };
  async setWorld(world: TWorld, steppers: AStepper[]) {
    this.world = world;
    const reviewsIn = getStepperOption(this, IN_STORAGE, this.world.options);
    this.reviewsIn = findStepper(steppers, reviewsIn);
    if (!this.reviewsIn) {
      throw Error(`can't find ${IN_STORAGE} ${reviewsIn} ${JSON.stringify(steppers.map(s => s.constructor.name), null, 2)}`);
    }

    const reviewsOut = getStepperOption(this, OUT_STORAGE, this.world.options);
    this.reviewsOut = findStepper(steppers, reviewsOut);
    if (!this.reviewsOut) {
      throw Error(`can't find ${OUT_STORAGE} ${reviewsOut} ${JSON.stringify(steppers.map(s => s.constructor.name), null, 2)}`);
    }
  }

  steps = {
    publishReview: {
      gwta: `create review`,
      action: async () => {
        const world = this.world!;
        const uriArgs = getStepperOption(this, 'URI_ARGS', this.world!.options);
        const reviewsIn = this.reviewsIn!;
        const reviewsOut = this.reviewsOut!;
        const output = reviewsIn.readFile(getCaptureDir(world, 'trace') + '/trace.json', 'utf-8');
        const result: TResult = JSON.parse(output);
        const generateReview = new GenerateReview();
        const { html, sequence, video } = await generateReview.getOutput(reviewsIn, this.world!, result, { uriArgs });
        const file = ensureCaptureDir(world, 'review', '/review.html');
        reviewsOut.writeFile(file, Buffer.from(html, 'utf8'));
        return OK;
      }
    },
    publishReviews: {
      gwta: `publish reviews to {where: STORAGE_LOCATION}`,
      action: async ({ where }: TNamed) => {
        const dir = `${process.cwd()}/${where}`
        const uriArgs = getStepperOption(this, 'URI_ARGS', this.world!.options);
        const reviewsIn = this.reviewsIn!;
        const reviewsOut = this.reviewsOut!;

        const loops = await reviewsIn.readdir(dir);
        for (const loop of loops) {
          const loopDir = `${dir}/${loop}`;
          const sequences = await reviewsIn.readdir(loopDir);
          for (const seq of sequences) {
            const seqDir = `${loopDir}/${seq}`;
            const featureNums = reviewsIn.readdir(seqDir)
            for (const featureNum of featureNums) {
              const featDir = `${seqDir}/${featureNum}`;
              const members = reviewsIn.readdir(featDir);
              for (const member of members) {
                const memDir = `${featDir}/${member}`;
                const output = reviewsIn.readFile(`${memDir}/trace/trace.json`, 'utf-8');
                const result: TResult = JSON.parse(output);
                const generateReview = new GenerateReview();
                const { html, sequence, video } = await generateReview.getOutput(reviewsIn, this.world!, result, { uriArgs });
                const tag = getRunTag(seq, loop, member, featureNum, {});
                const w = { options: {}, tag };
                const file = getCaptureDir(w, 'review') + '/review.html';
                reviewsOut.writeFile(file, Buffer.from(html, 'utf8'));
              }
            }
          }
        }
        return OK;
      }
    }
  }
}

export default OutReviewsStepper;