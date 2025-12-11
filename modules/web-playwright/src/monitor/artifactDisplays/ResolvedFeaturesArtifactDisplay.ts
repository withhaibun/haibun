import { TArtifactResolvedFeatures, TMessageContext, EExecutionMessageType } from "@haibun/core/lib/interfaces/logger.js";
import { generateMermaidGraphAsMarkdown } from "../graph/generateMermaidGraph.js";
import { ArtifactDisplay } from "./artifactDisplayBase.js";

import mermaid from 'mermaid';

mermaid.initialize({
	maxTextSize: 1000000,
	maxEdges: 10000,
});

let instanceCounter = 0;

export class ResolvedFeaturesArtifactDisplay extends ArtifactDisplay {
	readonly placementTarget = 'details';

	constructor(protected artifact: TArtifactResolvedFeatures) {
		super(artifact);
	}

	public async render(container: HTMLElement): Promise<void> {
		if (!this.artifact.resolvedFeatures || this.artifact.resolvedFeatures.length === 0) {
			container.innerHTML = '<p>No resolved features to display.</p>';
			return;
		}

		let registeredOutcomes: Record<string, { proofStatements?: string[]; proofPath?: string; isBackground?: boolean; activityBlockSteps?: string[] }> | undefined = undefined;
		const maybeWin = globalThis as unknown as Window & { haibunCapturedMessages?: unknown };
		const captured = maybeWin.haibunCapturedMessages as unknown;
		if (Array.isArray(captured) && captured.length) {
			registeredOutcomes = {};
			for (const entry of captured as unknown[]) {
				const e = entry as Record<string, unknown>;
				const mc = e.messageContext as TMessageContext | undefined;
				if (!mc) continue;

				if (mc.incident === EExecutionMessageType.GRAPH_LINK) {
					const details = mc.incidentDetails as Record<string, unknown>;
					const outcomeRaw = String(details.outcome || '').trim();
					if (outcomeRaw) {
						const key = outcomeRaw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
						const stripped = outcomeRaw.replace(/\{[^}]+\}/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
						registeredOutcomes[key] = {
							proofStatements: Array.isArray(details.proofStatements) ? details.proofStatements : undefined,
							proofPath: typeof details.proofPath === 'string' ? details.proofPath : undefined,
							isBackground: typeof details.isBackground === 'boolean' ? details.isBackground : undefined,
							activityBlockSteps: Array.isArray(details.activityBlockSteps) ? details.activityBlockSteps : undefined,
						};
						if (stripped && stripped !== key) registeredOutcomes[stripped] = registeredOutcomes[key];
					}
				}
			}
		}

		const mermaidGraph = await generateMermaidGraphAsMarkdown(this.artifact.resolvedFeatures, false, registeredOutcomes);

		const graphSvgId = `mermaid-graph-svg-${instanceCounter++}-${Date.now()}`;

		container.innerHTML = '';

		const controls = document.createElement('div');
		controls.className = 'haibun-mermaid-controls';
		controls.innerHTML = `
			<button class="haibun-zoom-in">Zoom +</button>
			<button class="haibun-zoom-out">Zoom -</button>
			<button class="haibun-copy-code">Copy code</button>
			<button class="haibun-toggle-code">Show code</button>
		`;
		container.appendChild(controls);

		const codePre = document.createElement('pre');
		codePre.className = 'haibun-mermaid-code';
		codePre.style.display = 'none';
		codePre.textContent = mermaidGraph;
		container.appendChild(codePre);

		const svgHolder = document.createElement('div');
		svgHolder.className = 'haibun-mermaid-svg-holder';
		container.appendChild(svgHolder);

		const zoomIn = controls.querySelector<HTMLButtonElement>('.haibun-zoom-in')!;
		const zoomOut = controls.querySelector<HTMLButtonElement>('.haibun-zoom-out')!;
		const toggleCode = controls.querySelector<HTMLButtonElement>('.haibun-toggle-code')!;
		const copyCode = controls.querySelector<HTMLButtonElement>('.haibun-copy-code')!;

		let scale = 1;
		const applyZoom = () => {
			const svg = svgHolder.querySelector('svg');
			if (svg) {
				svg.style.transform = `scale(${scale})`;
				svg.style.transformOrigin = '0 0';
			}
		};

		zoomIn.addEventListener('click', () => {
			scale = scale + 0.2;
			applyZoom();
		});

		copyCode.addEventListener('click', () => {
			void navigator.clipboard.writeText(codePre.textContent || '').then(() => {
				copyCode.textContent = 'Copied!';
				setTimeout(() => { copyCode.textContent = 'Copy code'; }, 1200);
			}).catch(() => {
				copyCode.textContent = 'Copy failed';
				setTimeout(() => { copyCode.textContent = 'Copy code'; }, 1200);
			});
		});

		zoomOut.addEventListener('click', () => {
			scale = Math.max(0.2, scale - 0.2);
			applyZoom();
		});
		toggleCode.addEventListener('click', () => {
			if (codePre.style.display === 'none') {
				codePre.style.display = 'block';
				svgHolder.style.display = 'none';
				toggleCode.textContent = 'Show graph';
			} else {
				codePre.style.display = 'none';
				svgHolder.style.display = 'block';
				toggleCode.textContent = 'Show code';
			}
		});

		try {
			const renderMermaid = async () => {
				try {
					const { svg, bindFunctions } = await mermaid.render(graphSvgId, mermaidGraph);
					svgHolder.innerHTML = svg;
					if (bindFunctions) bindFunctions(svgHolder);
				} catch (err) {
					console.error('Error rendering Mermaid graph:', err);
					svgHolder.innerHTML = `<p class="haibun-artifact-error">Error rendering graph: ${(err as Error).message}</p>`;
				}
			};

			await renderMermaid();

			const debounced = (fn: () => void, wait = 180) => {
				let t: number | null = null;
				return () => {
					if (t) window.clearTimeout(t);
					t = window.setTimeout(() => { fn(); t = null; }, wait);
				};
			};

			let ro: ResizeObserver | null = null;
			if (typeof ResizeObserver !== 'undefined') {
				ro = new ResizeObserver(debounced(() => {
					void renderMermaid();
				}));
				ro.observe(svgHolder);
			}
		} catch (error) {
			console.error('Error rendering Mermaid graph:', error);
			svgHolder.innerHTML = `<p class="haibun-artifact-error">Error rendering graph: ${(error as Error).message}</p>`;
		}
	}
}
