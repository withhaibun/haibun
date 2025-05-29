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
	it('should generate a comprehensive Mermaid graph', async () => {
		const features = [{
			path: '/feature-1.feature',
			content: `Backgrounds: background-1\nScenario: Feature one scenario\ngwta1\nis {env_var1}`,
		},
		{
			path: '/feature-2.feature',
			content: `Backgrounds: background-1\nScenario: Feature two scenario\ngwta2\nis var_2\nScenario: Another scenario\ngwta3\nis "var_3"`, // Uses scenario var and quoted scenario var
		},
		];
		const backgrounds = [{
			path: '/background-1.feature',
			content: `is "the background"`,
		}];
		const resolvedFeatures = await toResolvedFeatures(features, backgrounds);
		const lines = await generateMermaidGraph(resolvedFeatures);

		const graphContent = lines.join('\n');
		// Validate overall Mermaid syntax first
		let valid = true;
		try {
			const mermaid = await import('mermaid');
			await mermaid.default.parse(graphContent);
		} catch (e) {
			valid = false;
			console.error('Mermaid parse error:', e);
		}
		expect(valid).toBe(true);

		// Specific structural and content checks
		expect(graphContent).toContain('graph TD');
		expect(graphContent).toContain('base_test_base("test_base")');
		// Check for ENV Subgraph and vars
		expect(graphContent).toContain('subgraph ENV [Environment Variables]');
		expect(graphContent).toContain('env_env_var1(["env_var1"])');

		// Check for BACKGROUNDS Subgraph (sharp-cornered rectangle)
		expect(graphContent).toContain('subgraph BACKGROUNDS [Backgrounds]');
		expect(graphContent).toContain('bg__background_1_feature["/background-1.feature"]');

		// Feature 1 (uses "test_base", background, env var)
		// feature-1.feature is at index 0 in resolvedFeatures
		expect(graphContent).toContain('base_test_base --> feature__feature_1_feature');
		expect(graphContent).toContain('subgraph feature__feature_1_feature ["/feature-1.feature"]');
		expect(graphContent).toMatch(/step_gwtaInterpolated_0_0\["is #quot;the background#quot;"\]/); // Background step in f1
		expect(graphContent).toMatch(/step_gwtaInterpolated_0_0 -\.-> bg__background_1_feature/);    // Link to background node
		expect(graphContent).toMatch(/scenariovar_gwtaInterpolated_0_0_what\(\["what = the background"\]\)/); // Var from background step
		expect(graphContent).toMatch(/step_gwtaInterpolated_0_0 -\.-> scenariovar_gwtaInterpolated_0_0_what/);
		expect(graphContent).toContain('subgraph scenario_0_1 ["Scenario: Feature one scenario"]'); // Scenario in f1
		expect(graphContent).toMatch(/step_gwta_0_2\["gwta1"\]/); // Step in f1 scenario
		expect(graphContent).toMatch(/step_gwtaInterpolated_0_3\["is {env_var1}"\]/); // Env var step in f1 scenario
		expect(graphContent).toMatch(/step_gwta_0_2 ==> step_gwtaInterpolated_0_3/); // Sequential link
		expect(graphContent).toMatch(/step_gwtaInterpolated_0_3 -\.-> env_env_var1/); // Link to env var

		// Feature 2 (uses "test_base", background, scenario vars)
		// feature-2.feature is at index 1 in resolvedFeatures
		expect(graphContent).toContain('base_test_base --> feature__feature_2_feature');
		expect(graphContent).toContain('subgraph feature__feature_2_feature ["/feature-2.feature"]');
		expect(graphContent).toMatch(/step_gwtaInterpolated_1_0\["is #quot;the background#quot;"\]/); // Background step in f2
		expect(graphContent).toContain('subgraph scenario_1_1 ["Scenario: Feature two scenario"]'); // First scenario in f2
		expect(graphContent).toMatch(/step_gwtaInterpolated_1_3\["is var_2"\]/); // Step with var_2
		expect(graphContent).toMatch(/scenariovar_gwtaInterpolated_1_3_what\(\["what = var_2"\]\)/); // var_2 definition and link
		expect(graphContent).toMatch(/step_gwtaInterpolated_1_3 -\.-> scenariovar_gwtaInterpolated_1_3_what/);
		expect(graphContent).toContain('subgraph scenario_1_2 ["Scenario: Another scenario"]'); // Second scenario in f2
		expect(graphContent).toMatch(/step_gwtaInterpolated_1_6\["is #quot;var_3#quot;"\]/); // Step with "var_3"
		expect(graphContent).toMatch(/scenariovar_gwtaInterpolated_1_6_what\(\["what = var_3"\]\)/); // "var_3" definition and link
	});
});

// --- Helper to set up jsdom and DOMPurify ---
// In getBackgroundFeatures, backgrounds can be detected when the step's origin path is not the same as the feature's path.
// If you have a helper or logic that checks for backgrounds, update it to:
//   - For each step in resolvedFeatures, if step.origin && step.origin !== feature.path, treat it as a background step.
// This is a comment for the implementation file, but for the test, let's ensure the test expects this logic.

// No code change needed in the test file itself, as the detection logic is in the implementation.
// If you want to assert this in the test, you can add a debug log to check the origins:
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
