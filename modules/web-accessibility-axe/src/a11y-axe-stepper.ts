import { Page } from "playwright";

import { TWorld, TFeatureStep } from "@haibun/core/lib/defs.js";
import { AStepper, IHasOptions, StepperKinds, TStepperSteps } from "@haibun/core/lib/astepper.js";
import { TAnyFixme } from "@haibun/core/lib/fixme.js";
import { TArtifactHTML } from "@haibun/core/lib/interfaces/logger.js";
import { stringOrError, findStepper, actionNotOK, actionOK, findStepperFromOption } from "@haibun/core/lib/util/index.js";
import { getAxeBrowserResult, evalSeverity } from "./lib/a11y-axe.js";
import { generateHTMLAxeReportFromBrowserResult } from "./lib/report.js";
import { AStorage } from "@haibun/domain-storage/AStorage.js";
import { EMediaTypes } from "@haibun/domain-storage/media-types.js";
import { resolve } from "path";

type TGetsPage = { getPage: () => Promise<Page> };

class A11yStepper extends AStepper implements IHasOptions {
  options = {
    [StepperKinds.STORAGE]: {
      desc: 'Storage for results',
      parse: (input: string) => stringOrError(input),
    },
  };
  pageGetter?: TGetsPage;
  steppers: AStepper[] = [];
  storage?: AStorage;
  async setWorld(world: TWorld, steppers: AStepper[]) {
    await super.setWorld(world, steppers);
    this.pageGetter = findStepper<TGetsPage>(steppers, 'WebPlaywright');
    this.steppers = steppers;
    this.storage = findStepperFromOption(steppers, this, world.moduleOptions, StepperKinds.STORAGE);
  }

  asNumber = (value: string) => value.match(/[^\d+]/) ? NaN : parseInt(value);
  steps = {
    checkA11yRuntime: {
      gwta: `page is accessible accepting serious {serious:number} and moderate {moderate:number}`,
      action: async ({ serious, moderate }: { serious: string, moderate: string }, featureStep: TFeatureStep) => {
        const page = await this.pageGetter?.getPage();
        if (!page) {
          return actionNotOK(`no page in runtime`);
        }
        return await this.checkA11y(page, parseInt(serious, 10), parseInt(moderate, 10), `a11y-check-${featureStep.seqPath}`, featureStep);
      },
    },
  } satisfies TStepperSteps;
  async checkA11y(page: Page, serious: number, moderate: number, filename: string, featureStep?: TFeatureStep) {
    try {
      const axeReport = await getAxeBrowserResult(page);
      const evaluation = evalSeverity(axeReport, {
        serious,
        moderate,
      });
      if (evaluation.ok) {
        const artifact = await this.generateArtifact(axeReport, filename, featureStep);
        return Promise.resolve(actionOK({ artifact }));
      }
      const message = `not acceptable`;
      const artifact = await this.generateArtifact(axeReport, filename, featureStep);

      return actionNotOK(message, { artifact });
    } catch (e) {
      console.error(e);
      const { message } = { message: 'test' };
      return actionNotOK(message, { artifact: { artifactType: 'json', json: { exception: { summary: message, details: e } } } });
    }
  }

  private async generateArtifact(axeReport: TAnyFixme, filename: string, featureStep?: TFeatureStep) {
    const html = generateHTMLAxeReportFromBrowserResult(axeReport);
    if (this.storage) {
      const loc = { ...this.getWorld(), mediaType: EMediaTypes.html };
      const dir = await this.storage.ensureCaptureLocation(loc, '');
      const path = resolve(dir, filename + '.html');
      await this.storage.writeFile(path, html, EMediaTypes.html);
      const relativePath = await this.storage.getRelativePath(path);
      const artifact: TArtifactHTML = { artifactType: 'html', path: relativePath || path };

      // Emit artifact event for new-style monitors
      if (featureStep && this.getWorld().eventLogger) {
        const { HtmlArtifact } = await import('@haibun/core/lib/EventLogger.js');
        const artifactEvent = HtmlArtifact.parse({
          id: `${featureStep.seqPath.join('.')}.artifact.a11y`,
          timestamp: Date.now(),
          kind: 'artifact',
          artifactType: 'html',
          path: path, // Use absolute path so consumers can resolve relative to their root
          mimetype: 'text/html',
        });
        this.getWorld().eventLogger.artifact(featureStep, artifactEvent);
      }

      return artifact;
    }
    this.getWorld().logger?.warn(`no storage defined, including report inline`);
    const artifact: TArtifactHTML = { artifactType: 'html', html };
    return artifact;
  }
}

export default A11yStepper;
