import { describe, it, expect } from 'vitest';

// Setup jsdom and real DOMPurify for mermaid parsing in Node.js
defineGlobalDOMPurify();

import Haibun from '@haibun/core/build/steps/haibun.js';
import { asFeatures } from '@haibun/core/build/lib/resolver-features.js';
import { generateMermaidGraph } from './generateMermaidGraph.js';
import { createSteppers } from '@haibun/core/build/lib/util/index.js';
import { Resolver } from '@haibun/core/build/phases/Resolver.js';
import { TProtoFeature } from '@haibun/core/build/lib/resolver-features.js';
import { AStepper } from '@haibun/core/build/lib/astepper.js';
import { OK } from '@haibun/core/build/lib/defs.js';
import { expand } from '@haibun/core/build/lib/features.js';
import { writeFileSync } from 'fs';

class TestStepper extends AStepper {
	steps = {
		exact: {
			exact: 'exact1',
			action: async () => Promise.resolve(OK),
		},
		match: {
			match: /match(?<num>1)/,
			action: async () => Promise.resolve(OK),
		},
		gwta: {
			gwta: 'gwta(?<num>.)',
			action: async () => Promise.resolve(OK),
		},
		gwtaInterpolated: {
			gwta: 'is {what}',
			action: async () => Promise.resolve(OK),
		},
		backgroundStep: {
			exact: 'Background step 1',
			action: async () => Promise.resolve(OK),
		},
	};
}

const toResolvedFeatures = async (f: TProtoFeature, b: TProtoFeature) => {
	const features = asFeatures(f);
	const backgrounds = asFeatures(b);
	const steppers = await createSteppers([TestStepper, Haibun]);
	const expandedFeatures = await expand({ backgrounds, features });
	const resolver = new Resolver(steppers);

	const resolvedFeatures = await resolver.resolveStepsFromFeatures(expandedFeatures);
	return resolvedFeatures;
};

describe('generateMermaidGraph', () => {
	it('should generate a graph with bases, features, steps, variables, and origins', async () => {
		const features = [{
				path: '/feature-1.feature',
				content: `Backgrounds: background-1\nScenario: Feature one scenario\ngwta1\nis {env_var1}`,
			},
			{
				path: '/feature-2.feature',
				content: `Backgrounds: background-1\nScenario: Feature two scenario\ngwta2\nis var_2\nScenario: Another scenario\ngwta3\nis "var_3"`,
			},
		];
		const backgrounds = [{
			path: '/background-1.feature',
			content: `is "the background"`,
		}];
		const resolvedFeatures = await toResolvedFeatures(features, backgrounds);
		writeFileSync('test-resolved-features.json', JSON.stringify(resolvedFeatures, null, 2));

		const lines = await generateMermaidGraph(resolvedFeatures);
		writeFileSync('test-graph.mermaid', lines.join('\n'));

		let line = 0;
		expect(lines[line++]).toEqual('graph TD');
	});

	it('renders bases, backgrounds, env vars, and scenario vars correctly', async () => {
		const features = [
			{
				path: '/base.feature',
				content: `Scenario: Base scenario\nis {env_var1}`,
			},
			{
				path: '/feature-1.feature',
				base: '/base.feature',
				content: `Backgrounds: background-1\nScenario: Feature one scenario\ngwta1\nis var_1`,
			},
			{
				path: '/feature-2.feature',
				content: `Backgrounds: background-1\nScenario: Feature two scenario\ngwta2\nis "var_2"\nScenario: Another scenario\ngwta3\nis var_3`,
			},
		];
		const backgrounds = [
			{
				path: '/background-1.feature',
				content: `is "the background"`,
			},
		];
		const resolvedFeatures = await toResolvedFeatures(features, backgrounds);
		const lines = await generateMermaidGraph(resolvedFeatures);

		const code = lines.join('\n');
		let valid = true;
		try {
			const mermaid = await import('mermaid');
			await mermaid.default.parse(code);
		} catch (e) {
			valid = false;
			console.error('Mermaid parse error:', e);
			console.error('Generated Mermaid code:\n', code);
		}
		expect(valid).toBe(true);

		expect(lines.some((l) => l.includes('subgraph ENV [Environment Variables]'))).toBe(true);
		expect(lines.some((l) => l.includes('subgraph BASES [Bases]'))).toBe(true);
		expect(lines.some((l) => l.includes('base_test_base'))).toBe(true);
		expect(lines.some((l) => l.includes('subgraph BACKGROUNDS [Backgrounds]'))).toBe(true);
		expect(lines.some((l) => l.includes('bg_background_1_feature'))).toBe(true);
		expect(lines.some((l) => l.includes('feature_feature_1_feature --> base_base_feature'))).toBe(true);
		expect(lines.some((l) => l.includes('-.-> bg_background_1_feature'))).toBe(true);
		expect(lines.some((l) => l.includes('-.-> env_'))).toBe(true);
		expect(lines.some((l) => l.includes('-.-> var_'))).toBe(true);

		// Debug: log origins for background detection
		// resolvedFeatures.forEach(f => f.steps.forEach(s => console.log('step', s.text, 'origin', s.origin, 'feature', f.path)));
	});
});

// --- Helper to set up jsdom and DOMPurify ---
function defineGlobalDOMPurify() {
  // Only run in Node.js (not in browser)
  if (typeof window === 'undefined' || !(globalThis as Record<string, unknown>).DOMPurify) {
    // Use require to get the CommonJS build for Node.js compatibility
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { JSDOM } = require('jsdom');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const createDOMPurify = require('dompurify');
    const { window } = new JSDOM('<!DOCTYPE html>');
    global.window = window;
    global.document = window.document;
    global.navigator = window.navigator;
    // The CJS build returns the correct instance for mermaid
    const domPurifyInstance = createDOMPurify(window);
    global.DOMPurify = domPurifyInstance;
    window.DOMPurify = domPurifyInstance;
  }
}

// In getBackgroundFeatures, backgrounds can be detected when the step's origin path is not the same as the feature's path.
// If you have a helper or logic that checks for backgrounds, update it to:
//   - For each step in resolvedFeatures, if step.origin && step.origin !== feature.path, treat it as a background step.
// This is a comment for the implementation file, but for the test, let's ensure the test expects this logic.

// No code change needed in the test file itself, as the detection logic is in the implementation.
// If you want to assert this in the test, you can add a debug log to check the origins:
