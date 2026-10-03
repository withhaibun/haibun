import { Page } from "playwright";

import type { TWorld } from "@haibun/core/lib/world.js";
import { AStepper, IHasCycles, IHasOptions, StepperKinds, TStepperSteps, TFeatureStep } from "@haibun/core/lib/astepper.js";
import { stringOrError, findStepper, actionNotOK, actionOK, findStepperFromOptionOrKind } from "@haibun/core/lib/util/index.js";
import { getAxeBrowserResult, evalSeverity } from "./lib/a11y-axe.js";
import { axeReportHtml } from "./lib/report.js";
import { axeAssertions } from "./lib/axe-earl.js";
import { earlDomainDefinitions, writeEarlAssertions } from "./lib/earl.js";
import { executionOf, formatRecordName } from "@haibun/core/lib/seq-path.js";
import type { AxeResults } from "axe-core";
import { MEDIA_TYPE } from "@haibun/core/lib/media-types.js";
import { AStorage } from "@haibun/domain-storage/AStorage.js";

import { HtmlArtifact } from "@haibun/core/schema/protocol.js";

type TGetsPage = { getPage: () => Promise<Page> };

class A11yStepper extends AStepper implements IHasOptions, IHasCycles {
	description =
		"Checks the current page with axe, records the result of each rule that applies to it as an EARL assertion, and passes when the page's serious and moderate accessibility violations are within the given counts.";
	cycles = { getConcerns: () => ({ domains: earlDomainDefinitions }) };
	options = {
		[StepperKinds.STORAGE]: {
			desc: "Storage for results",
			parse: (input: string) => stringOrError(input),
		},
	};
	pageGetter?: TGetsPage;
	steppers: AStepper[] = [];
	storage?: AStorage;
	async setWorld(world: TWorld, steppers: AStepper[]) {
		await super.setWorld(world, steppers);
		this.pageGetter = findStepper<TGetsPage>(steppers, "WebPlaywright");
		this.steppers = steppers;
		this.storage = findStepperFromOptionOrKind(steppers, this, world.moduleOptions, StepperKinds.STORAGE);
	}

	steps = {
		checkA11yRuntime: {
			gwta: `page is accessible accepting serious {serious:number} and moderate {moderate:number}`,
			action: async ({ serious, moderate }: { serious: string; moderate: string }, featureStep: TFeatureStep) => {
				const page = await this.pageGetter?.getPage();
				if (!page) {
					return actionNotOK(`the runtime doesn't hold a page`);
				}
				return await this.checkA11y(page, parseInt(serious, 10), parseInt(moderate, 10), featureStep);
			},
		},
	} as const satisfies TStepperSteps;
	/** Check the page with axe, record the result of each rule that applies to it as an assertion the step made, save the report, and pass where
	 *  the page's serious and moderate violations are within the counts accepted. A check that fails to run fails the
	 *  step, stating why. */
	async checkA11y(page: Page, serious: number, moderate: number, featureStep: TFeatureStep) {
		const results = await getAxeBrowserResult(page);
		const evaluation = evalSeverity(results, { serious, moderate });
		const step = formatRecordName({ execution: executionOf(this.getWorld().tag), path: featureStep.seqPath });
		await writeEarlAssertions(this.getWorld().shared.getStore(), axeAssertions(results, step));
		const artifact = await this.saveReport(results, featureStep);
		if (evaluation.ok) return actionOK({ artifact });
		const { found } = evaluation;
		return actionNotOK(`the page has ${found.serious} serious and ${found.moderate} moderate accessibility violations, where ${serious} and ${moderate} are accepted`, { artifact });
	}

	/** Save the check's report as an HTML artifact a reviewer reads, where a storage stepper keeps artifacts. */
	private async saveReport(results: AxeResults, featureStep: TFeatureStep) {
		if (!this.storage) {
			this.getWorld().eventLogger.warn("a storage stepper isn't defined, so the accessibility report isn't saved");
			return undefined;
		}
		const saved = await this.storage.saveArtifact(`a11y-check-${featureStep.seqPath.join(".")}.html`, axeReportHtml(results));
		const artifactEvent = HtmlArtifact.parse({
			id: `${featureStep.seqPath.join(".")}.artifact.a11y`,
			timestamp: Date.now(),
			kind: "artifact",
			artifactType: "html",
			path: saved.baseRelativePath,
			mimetype: MEDIA_TYPE.html,
		});
		this.getWorld().eventLogger.artifact(featureStep, artifactEvent);
		return artifactEvent;
	}
}

export default A11yStepper;
