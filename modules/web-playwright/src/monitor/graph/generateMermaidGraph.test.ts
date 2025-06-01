import { describe, it, expect } from 'vitest';

import { getResolvedTestFeatures } from '@haibun/core/build/lib/test/resolvedTestFeatures.js';

// Setup jsdom and real DOMPurify for mermaid parsing in Node.js
defineGlobalDOMPurify();

import { generateMermaidGraph } from './generateMermaidGraph.js';

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
		const resolvedFeatures = await getResolvedTestFeatures(features, backgrounds);

		const lines = await generateMermaidGraph(resolvedFeatures);

		const graphContent = lines.join('\n');
		try {
			const mermaid = await import('mermaid');
			await mermaid.default.parse(graphContent);
		} catch (e) {
			console.error('Mermaid parse error:', e);
			console.log('Generated Mermaid Graph (on error):\n', graphContent);
			throw e;
		}

		let line = 0;
		expect(lines[line++].trim()).toBe('graph TD');

		expect(lines[line++].trim()).toBe('base_test_base("test_base")');

		// Check for ENV Subgraph and vars
		expect(lines[line++].trim()).toBe('subgraph ENV [Environment Variables]');
		expect(lines[line++].trim()).toBe('env_empty_sanitized_string([" "])');
		expect(lines[line++].trim()).toBe('env_env_var1(["env_var1"])');
		expect(lines[line++].trim()).toBe('end');

		// Check for BACKGROUNDS Subgraph (sharp-cornered rectangle)
		expect(lines[line++].trim()).toBe('subgraph BACKGROUNDS [Backgrounds]');
		expect(lines[line++].trim()).toBe('bg__background_1_feature["/background-1.feature"]');
		expect(lines[line++].trim()).toBe('end');

		// Feature 1 (uses "test_base", background, env var)
		expect(lines[line++].trim()).toBe('subgraph f__feature_1_feature ["/feature-1.feature"]');
		expect(lines[line++].trim()).toBe('s_gwtaInterpolated_0["is #quot;the background#quot;"]');

		expect(lines[line++].trim()).toBe('s_gwtaInterpolated_0 -.-> bg__background_1_feature');
		expect(lines[line++].trim()).toBe('sv_gwtaInterpolated_0_what(["what = the background"])');
		expect(lines[line++].trim()).toBe('s_gwtaInterpolated_0 -.-> sv_gwtaInterpolated_0_what');
		expect(lines[line++].trim()).toBe('subgraph sc_1 ["Scenario: Feature one scenario"]');
		expect(lines[line++].trim()).toBe('s_gwta_2["gwta1"]');
		expect(lines[line++].trim()).toBe('s_gwtaInterpolated_3["is {env_var1}"]');
		expect(lines[line++].trim()).toBe('s_gwta_2 ==> s_gwtaInterpolated_3');
		expect(lines[line++].trim()).toBe('s_gwtaInterpolated_3 -.-> env_env_var1');
		expect(lines[line++].trim()).toBe('end');
		expect(lines[line++].trim()).toBe('end');

		// Feature 2 (uses "test_base", background, scenario vars)
		expect(lines[line++].trim()).toBe('subgraph f__feature_2_feature ["/feature-2.feature"]');
		expect(lines[line++].trim()).toBe('s_gwtaInterpolated_0["is #quot;the background#quot;"]');
		expect(lines[line++].trim()).toBe('s_gwtaInterpolated_0 -.-> bg__background_1_feature');
		expect(lines[line++].trim()).toBe('sv_gwtaInterpolated_0_what(["what = the background"])');
		expect(lines[line++].trim()).toBe('s_gwtaInterpolated_0 -.-> sv_gwtaInterpolated_0_what');
		expect(lines[line++].trim()).toBe('subgraph sc_1 ["Scenario: Feature two scenario"]');
		expect(lines[line++].trim()).toBe('s_gwta_2["gwta2"]');
		expect(lines[line++].trim()).toBe('s_gwtaInterpolated_3["is var_2"]');
		expect(lines[line++].trim()).toBe('s_gwta_2 ==> s_gwtaInterpolated_3');
		expect(lines[line++].trim()).toBe('sv_gwtaInterpolated_3_what(["what = var_2"])');
		expect(lines[line++].trim()).toBe('s_gwtaInterpolated_3 -.-> sv_gwtaInterpolated_3_what');
		expect(lines[line++].trim()).toBe('end');
		expect(lines[line++].trim()).toBe('subgraph sc_2 ["Scenario: Another scenario"]');
		expect(lines[line++].trim()).toBe('s_gwta_5["gwta3"]');
		expect(lines[line++].trim()).toBe('s_gwtaInterpolated_6["is #quot;var_3#quot;"]');
		expect(lines[line++].trim()).toBe('s_gwta_5 ==> s_gwtaInterpolated_6');
		expect(lines[line++].trim()).toBe('sv_gwtaInterpolated_6_what(["what = var_3"])');
		expect(lines[line++].trim()).toBe('s_gwtaInterpolated_6 -.-> sv_gwtaInterpolated_6_what');
		expect(lines[line++].trim()).toBe('end');
		expect(lines[line++].trim()).toBe('end');

		// Base to feature links
		expect(lines[line++].trim()).toBe('base_test_base --> f__feature_1_feature');
		expect(lines[line++].trim()).toBe('base_test_base --> f__feature_2_feature');

		// Ensure no more lines
		expect(lines.length).toBe(line);
	});
});

function defineGlobalDOMPurify() {
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
