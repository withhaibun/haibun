import { TResolvedFeature } from '@haibun/core/build/lib/defs.js';
import { sanitize, formatLabel } from './graphUtils.js';
import { getBaseLocations } from './feature-bases.js';
import { getEnvVarLinks, getScenarioVars } from './mermaidGraphLinks.js';

export async function generateMermaidGraph(resolvedFeatures: TResolvedFeature[]): Promise<string[]> {
    const graphLines: string[] = ['graph TD'];

    // BASES SUBGRAPH (defined first)
    const baseLocations = getBaseLocations(resolvedFeatures);
    if (baseLocations.size) {
        graphLines.push('    subgraph BASES [Bases]');
        baseLocations.forEach(basePath => {
            const basePathStr = String(basePath);
            graphLines.push(`        base_${sanitize(basePathStr)}([${formatLabel(basePathStr)}])`);
        });
        graphLines.push('    end');
    }

    // ENV SUBGRAPH
    const envVars = new Set<string>();
    resolvedFeatures.forEach(f => {
        f.featureSteps.forEach(step => {
            if (step.action && step.action.named) {
                for (const [k, v] of Object.entries(step.action.named)) {
                    if (/^e_\d+$/.test(k) && typeof v === 'string') {
                        envVars.add(v);
                    }
                }
            }
        });
    });
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
            graphLines.push(`        bg_${sanitize(bgPath)}([${formatLabel(bgPath)}])`);
        });
        graphLines.push('    end');
    }

    // FEATURES & SCENARIOS
    resolvedFeatures.forEach((feature, featureIdx) => {
        const featureId = `feature_${sanitize(feature.path)}`;
        // Use featureId directly as the subgraph ID for cleaner linking
        graphLines.push(`    subgraph ${featureId} [${formatLabel(feature.path)}]`);
        // Link base to the first step of the first scenario
        if (feature.base && typeof feature.base === 'string' && feature.base.trim() !== '') {
            const baseId = `base_${sanitize(feature.base)}`;
            let firstStepIdToLink: string | null = null;

            for (let i = 0; i < feature.featureSteps.length; i++) {
                const currentStepDetails = feature.featureSteps[i];
                if (currentStepDetails.action?.actionName === 'scenarioStart') {
                    // This is a scenario declaration. We need the *next* step, if it's an actual step.
                    if (i + 1 < feature.featureSteps.length) {
                        const nextStepDetails = feature.featureSteps[i + 1];
                        // Check if the next line is an actual step (not another scenario start)
                        if (nextStepDetails.action?.actionName !== 'scenarioStart') {
                            firstStepIdToLink = `step_${featureIdx}_${i + 1}`;
                            break; // Found the first step of the first scenario
                        }
                    }
                    // Only consider the first scenario encountered for this linking logic.
                    break;
                }
            }

            if (firstStepIdToLink) {
                graphLines.push(`    ${baseId} --> ${firstStepIdToLink}`);
            }
        }
        let scenarioIdx = 0;
        let currentScenarioId: string | null = null;
        let previousStepActualId: string | null = null;
        let previousStepIsInScenario: boolean = false;

        feature.featureSteps.forEach((step, stepIdx) => {
            const stepId = `step_${featureIdx}_${stepIdx}`;
            const indent = currentScenarioId ? '            ' : '        ';
            const currentStepIsInCurrentScenario = !!currentScenarioId;

            if (step.action?.actionName === 'scenarioStart') {
                if (currentScenarioId) graphLines.push('        end'); // End previous scenario subgraph
                currentScenarioId = `scenario_${featureIdx}_${++scenarioIdx}`;
                graphLines.push(`        subgraph ${currentScenarioId} [${formatLabel(step.in)}]`);
                previousStepActualId = null; // Reset for steps within the new scenario
            } else {
                // This is an actual step node
                graphLines.push(`${indent}${stepId}[${formatLabel(step.in)}]`);

                // Link from previous actual step in the same scope (feature or scenario)
                if (previousStepActualId) {
                    if (currentStepIsInCurrentScenario === previousStepIsInScenario) {
                        graphLines.push(`${indent}${previousStepActualId} ==> ${stepId}`);
                    }
                }
                previousStepActualId = stepId;

                // Link to background if step is from background
                if (step.origin && step.origin !== feature.path && backgrounds.has(step.origin)) {
                    graphLines.push(`${indent}${stepId} -.-> bg_${sanitize(step.origin)}`);
                }
            }
            previousStepIsInScenario = currentStepIsInCurrentScenario;
        });
        if (currentScenarioId) graphLines.push('        end'); // End the last scenario subgraph
        graphLines.push('    end');
        // VARS
        const envLinks = getEnvVarLinks(feature.featureSteps);
        envLinks.forEach(({ stepIndex, envVar }) => {
            const stepDetails = feature.featureSteps[stepIndex]; // stepDetails is TFeatureStep
            // Ensure link originates from an actual step, not a scenario start action
            if (stepDetails && stepDetails.action?.actionName !== 'scenarioStart') {
                const stepId = `step_${featureIdx}_${stepIndex}`;
                graphLines.push(`    ${stepId} -.-> env_${sanitize(envVar)}`);
            }
        });
        const scenarioVars = getScenarioVars(feature.featureSteps);
        scenarioVars.forEach(({ stepIndex, varName }) => {
            const stepDetails = feature.featureSteps[stepIndex];
            // Ensure link originates from an actual step, not a scenario start action
            if (stepDetails && stepDetails.action?.actionName !== 'scenarioStart') {
                const stepId = `step_${featureIdx}_${stepIndex}`;
                const scenarioVarNodeId = `var_${featureIdx}_${stepIndex}_${sanitize(varName)}`;
                graphLines.push(`    ${stepId} -.-> ${scenarioVarNodeId}`);
                graphLines.push(`    ${scenarioVarNodeId}([${formatLabel(varName)}])`);
            }
        });
    });
    return graphLines;
}
