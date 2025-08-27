import { describe, it } from 'vitest';

import { getResolvedTestFeatures } from '@haibun/core/lib/test/resolvedTestFeatures.js';

// Setup jsdom and real DOMPurify for mermaid parsing in Node.js

import { generateMermaidGraph } from './generateMermaidGraph.js';

describe.skip('generateMermaidGraph', () => {
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
			throw e;
		}

	});
});
