import { TResolvedFeature } from '@haibun/core/lib/defs.js';
import { sanitize, formatLabel } from './graphUtils.js';
import { getBaseLocations } from './feature-bases.js';

export async function generateMermaidGraphAsMarkdown(resolvedFeatures: TResolvedFeature[], showVariables = true): Promise<string> {
	const graphLines = await generateMermaidGraph(resolvedFeatures, showVariables);
	return graphLines.join('\n');
}

export async function generateMermaidGraph(resolvedFeatures: TResolvedFeature[], showVariables = true): Promise<string[]> {
	const graphLines: string[] = ['graph TD'];

	// BASES (defined first, top-level)
	const baseLocations = getBaseLocations(resolvedFeatures);
	baseLocations.forEach(basePath => {
		const basePathStr = String(basePath);
		graphLines.push(`    base_${sanitize(basePathStr)}(${formatLabel(basePathStr)})`);
	});

	// ENV SUBGRAPH
	const envVars = new Set<string>();
	for (const f of resolvedFeatures)
		for (const step of f.featureSteps) {
			for (const [k, v] of Object.entries(step.action.named || {})) {
				if (/^e_\d+$/.test(k)) {
					envVars.add(v);
				}
			}
		}
	if (envVars.size) {
		graphLines.push('    subgraph ENV [Environment Variables]');
		envVars.forEach(v => {
			graphLines.push(`        env_${sanitize(v)}([${formatLabel(v)}])`);
		});
		graphLines.push('    end');
	}

	// BACKGROUNDS SUBGRAPH
	const { getBackgroundFeatures } = await import('./feature-bases.js');
	const backgrounds = getBackgroundFeatures(resolvedFeatures);
	if (backgrounds.size) {
		graphLines.push('    subgraph BACKGROUNDS [Backgrounds]');
		backgrounds.forEach(bgPath => { // bgPath is the path string from the Set
			graphLines.push(`        bg_${sanitize(bgPath)}[${formatLabel(bgPath)}]`);
		});
		graphLines.push('    end');
	}

	// FEATURES & SCENARIOS
	const baseToStepLinks: string[] = []; // Store base-to-step links here
	resolvedFeatures.forEach((feature) => {
		const featureId = `f_${sanitize(feature.path)}`;
		// Use featureId directly as the subgraph ID for cleaner linking
		graphLines.push(`    subgraph ${featureId} [${formatLabel(feature.path)}]`);

		// Link base to the feature subgraph
		const baseId = `base_${sanitize(feature.base)}`;
		baseToStepLinks.push(`    ${baseId} --> ${featureId}`); // Collect the link to the feature subgraph

		let scenarioIdx = 0;
		let currentScenarioId: string | null = null;
		let previousStepActualId: string | null = null;
		let previousStepIsInScenario: boolean = false;

		feature.featureSteps.forEach((step, stepIdx) => {
			// Assuming step.action and step.action.actionName are always present
			const actionNamePart = sanitize(step.action!.actionName);
			const newStepId = `s_${actionNamePart}_${stepIdx}`;
			const indent = currentScenarioId ? '            ' : '        ';
			const currentStepIsInCurrentScenario = !!currentScenarioId;

			if (step.action!.actionName === 'scenarioStart') {
				if (currentScenarioId) graphLines.push('        end'); // End previous scenario subgraph
				currentScenarioId = `sc_${++scenarioIdx}`;
				graphLines.push(`        subgraph ${currentScenarioId} [${formatLabel(step.in)}]`);
				previousStepActualId = null; // Reset for steps within the new scenario
			} else {
				// This is an actual step node
				graphLines.push(`${indent}${newStepId}[${formatLabel(step.in)}]`);

				// Link from previous actual step in the same scope (feature or scenario)
				if (previousStepActualId) {
					if (currentStepIsInCurrentScenario === previousStepIsInScenario) {
						graphLines.push(`${indent}${previousStepActualId} ==> ${newStepId}`);
					}
				}
				previousStepActualId = newStepId;

				// Link to background if step is from background
				if (step.path !== feature.path) {
					if (backgrounds.has(step.path)) {

						graphLines.push(`${indent}${newStepId} -.-> bg_${sanitize(step.path)}`);
					} else {
						console.warn(`Background step patah "${step.path}" not found in backgrounds set.`);
					}
				}

				// Inline variable linking logic
				if (showVariables) {
					if (step.action!.stepVariables && step.action!.actionName !== 'scenarioStart') {
						const definedScenarioVarsForStep = new Set<string>();

						step.action.stepVariables.forEach((varDef, varIndex) => {
							const varName = varDef.name; // e.g., "what"
							let actualNamedValue: string | undefined = undefined;
							let isEnvLink = false;
							let envLinkTargetName: string | undefined = undefined;

							// Prefixes for indexed named parameters (excluding 'e' which is special)
							// These correspond to TYPE_QUOTED, TYPE_VAR, TYPE_ENV_OR_VAR_OR_LITERAL, TYPE_SPECIAL, TYPE_CREDENTIAL etc. from namedVars.ts
							const indexedPrefixes = ['q', 'b', 't', 's', 'c', 'a', 'n'];
							const envPrefix = 'e';

							// Check for environment variable first (e.g., e_0)
							const envNamedKey = `${envPrefix}_${varIndex}`;
							if (step.action!.named && step.action!.named[envNamedKey] !== undefined) {
								actualNamedValue = String(step.action!.named[envNamedKey]);
								isEnvLink = true;
								envLinkTargetName = actualNamedValue; // For e_X, the value in 'named' is the env var name
							} else {
								// Check other indexed prefixes for scenario variables
								for (const prefix of indexedPrefixes) {
									const namedKeyCandidate = `${prefix}_${varIndex}`;
									if (step.action!.named && step.action!.named[namedKeyCandidate] !== undefined) {
										actualNamedValue = String(step.action!.named[namedKeyCandidate]);
										break;
									}
								}
							}

							if (actualNamedValue !== undefined) { // A value was found for this varDef
								if (isEnvLink && envLinkTargetName) {
									graphLines.push(`${indent}${newStepId} -.-> env_${sanitize(envLinkTargetName)}`);
								} else {
									const scenarioVarNodeId = `sv_${actionNamePart}_${stepIdx}_${sanitize(varName)}`;
									if (!definedScenarioVarsForStep.has(scenarioVarNodeId)) {
										graphLines.push(`${indent}${scenarioVarNodeId}([${formatLabel(varName + " = " + actualNamedValue)}])`);
										definedScenarioVarsForStep.add(scenarioVarNodeId);
									}
									graphLines.push(`${indent}${newStepId} -.-> ${scenarioVarNodeId}`);
								}
							}
						});
					}
				}
			}
			previousStepIsInScenario = currentStepIsInCurrentScenario;
		});
		if (currentScenarioId) graphLines.push('        end'); // End the last scenario subgraph
		graphLines.push('    end');
	});

	// Add base-to-step links at the top level, after all subgraphs are defined
	graphLines.push(...baseToStepLinks);

	return graphLines;
}
