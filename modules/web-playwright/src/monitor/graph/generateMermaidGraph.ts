import { TResolvedFeature } from '@haibun/core/build/lib/defs.js';
import { sanitize, formatLabel } from './graphUtils.js';
import { getBaseLocations } from './feature-bases.js';
import { getEnvVarLinks, getScenarioVars } from './mermaidGraphLinks.js';

export async function generateMermaidGraph(resolvedFeatures: TResolvedFeature[]): Promise<string[]> {
    const graphLines: string[] = ['graph TD'];

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

    // BASES SUBGRAPH
    const baseLocations = getBaseLocations(resolvedFeatures);
    if (baseLocations.size) {
        graphLines.push('    subgraph BASES [Bases]');
        baseLocations.forEach(basePath => {
            const basePathStr = String(basePath);
            graphLines.push(`        base_${sanitize(basePathStr)}([${formatLabel(basePathStr)}])`);
        });
        graphLines.push('    end');
    }

    // BACKGROUNDS SUBGRAPH
    const { getBackgroundFeatures } = await import('./feature-bases.js');
    const backgrounds = getBackgroundFeatures(resolvedFeatures);
    if (backgrounds.size) {
        graphLines.push('    subgraph BACKGROUNDS [Backgrounds]');
        backgrounds.forEach((bgFeature, bgPath) => {
            graphLines.push(`        bg_${sanitize(bgPath)}([${formatLabel(bgPath)}])`);
        });
        graphLines.push('    end');
    }

    // FEATURES & SCENARIOS
    resolvedFeatures.forEach((feature, featureIdx) => {
        const featureId = `feature_${sanitize(feature.path)}`;
        graphLines.push(`    subgraph subgraph_${featureId} [${formatLabel(feature.path)}]`);
        // Link to base if present
        if (feature.base) {
            graphLines.push(`        ${featureId} --> base_${sanitize(feature.base)}`);
        }
        // Steps and scenario subgraph
        let scenarioIdx = 0;
        let scenarioId = null;
        feature.featureSteps.forEach((step, stepIdx) => {
            if (step.in && step.in.startsWith('Scenario:')) {
                if (scenarioId) graphLines.push('        end');
                scenarioId = `scenario_${featureIdx}_${++scenarioIdx}`;
                graphLines.push(`        subgraph ${scenarioId} [${formatLabel(step.in)}]`);
            }
            const stepId = `step_${featureIdx}_${stepIdx}`;
            graphLines.push(`            ${stepId}[${formatLabel(step.in)}]`);
            // Link to background if step is from background
            if (step.origin && step.origin !== feature.path && backgrounds.has(step.origin)) {
                graphLines.push(`            ${stepId} -.-> bg_${sanitize(step.origin)}`);
            }
        });
        if (scenarioId) graphLines.push('        end');
        graphLines.push('    end');
        // VARS
        const envLinks = getEnvVarLinks(feature.featureSteps);
        envLinks.forEach(({ stepIndex, envVar }) => {
            const stepId = `step_${featureIdx}_${stepIndex}`;
            graphLines.push(`    ${stepId} -.-> env_${sanitize(envVar)}`);
        });
        const scenarioVars = getScenarioVars(feature.featureSteps);
        scenarioVars.forEach(({ stepIndex, varName }) => {
            const stepId = `step_${featureIdx}_${stepIndex}`;
            graphLines.push(`    ${stepId} -.-> var_${featureIdx}_${stepIndex}_${sanitize(varName)}`);
            graphLines.push(`    var_${featureIdx}_${stepIndex}_${sanitize(varName)}([${formatLabel(varName)}])`);
        });
    });
    return graphLines;
}
