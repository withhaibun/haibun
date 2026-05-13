import { AStepper } from "./astepper.js";
import { constructorName } from "./util/index.js";
import { namedInterpolation } from "./namedVars.js";

/**
 * Metadata for a single step, extracted from a stepper definition.
 * Used by both LSP (for autocomplete/hover) and MCP (for tool registration).
 */
export interface StepDescriptor {
	stepperName: string;
	stepName: string;
	method: string;
	pattern: string;
	params: Record<string, "string" | "number">;
	/** Domain key for each parameter (e.g., { data: 'haibun-email', id: 'string' }) */
	paramDomains?: Record<string, string>;
	/**
	 * Domain key of the products this step produces (`productsDomain` on the
	 * step definition). Used by the actions-bar step picker to show
	 * `… → muskeg-revocation` so the user sees what the step yields before
	 * running it.
	 */
	productsDomain?: string;
	capability?: string;
	inputSchema?: Record<string, unknown>;
	outputSchema?: Record<string, unknown>;
}

/**
 * Central registry for extracting step metadata from steppers.
 * Ensures that LSP and MCP share identical step definitions.
 */
export class StepperRegistry {
	/**
	 * Extract metadata from all steps in the provided steppers.
	 * Filters out steps marked with `exposeMCP: false`.
	 */
	static getMetadata(steppers: AStepper[]): StepDescriptor[] {
		return steppers.flatMap((stepper) => {
			const stepperName = constructorName(stepper);
			return Object.entries(stepper.steps)
				.filter(([, def]) => def.exposeMCP !== false)
				.map(([stepName, stepDef]) => {
					const params: Record<string, "string" | "number"> = {};
					const pattern = stepDef.gwta || stepDef.exact || stepDef.match?.toString() || stepName;

					const paramDomains: Record<string, string> = {};
					if (stepDef.gwta) {
						const { stepValuesMap } = namedInterpolation(stepDef.gwta);
						if (stepValuesMap) {
							for (const v of Object.values(stepValuesMap)) {
								params[v.term] = v.domain === "number" ? "number" : "string";
								paramDomains[v.term] = v.domain || "string";
							}
						}
					}
					const method = `${stepperName}-${stepName}`;
					return { stepperName, stepName, method, pattern, params, paramDomains, productsDomain: stepDef.productsDomain, capability: stepDef.capability };
				});
		});
	}

	/**
	 * Convert a gwta pattern to an LSP snippet format.
	 * Transforms `{varName}` to `${1:varName}` for tab-stop support.
	 */
	static patternToSnippet(pattern: string): string {
		let i = 1;
		return pattern.replace(/\{(\w+)(?::\s*\w+)?\}/g, (_, name) => `\${${i++}:${name}}`);
	}
}
