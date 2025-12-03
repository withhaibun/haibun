import { TArtifact, TArtifactSpeech, TArtifactVideo, TArtifactVideoStart, TArtifactImage, TArtifactHTML, TArtifactJSON, TArtifactHTTPTrace, TMessageContext, TArtifactResolvedFeatures } from '@haibun/core/lib/interfaces/logger.js';
import { EExecutionMessageType } from '@haibun/core/lib/interfaces/logger.js';
import MarkdownIt from 'markdown-it';

import { disclosureJson } from './disclosureJson.js';
import { LogComponent, ArtifactDisplay } from './artifactDisplays/artifactDisplayBase.js';

import { JsonArtifactDisplay } from './artifactDisplays/JsonArtifactDisplay.js';
import { HtmlArtifactDisplay } from './artifactDisplays/HtmlArtifactDisplay.js';
import { ImageArtifactDisplay } from './artifactDisplays/ImageArtifactDisplay.js';
import { VideoArtifactDisplay } from './artifactDisplays/VideoArtifactDisplay.js';
import { SpeechArtifactDisplay } from './artifactDisplays/SpeechArtifactDisplay.js';
import { VideoStartArtifactDisplay } from './artifactDisplays/VideoStartArtifactDisplay.js';
import { JsonArtifactHTTPTrace } from './artifactDisplays/JsonArtifactHTTPTrace.js';
import { ResolvedFeaturesArtifactDisplay } from './artifactDisplays/ResolvedFeaturesArtifactDisplay.js';

export class LogEntry extends LogComponent {
	private detailsSummary: LogDetailsSummary;
	private messageContent: LogMessageContent;

	constructor(level: string, timestamp: number, message: string, messageContext?: TMessageContext) {
		super('div', ['haibun-log-entry', `haibun-level-${level}`]);
		if (messageContext?.incident === EExecutionMessageType.STEP_START) {
			this.addClass('haibun-step-start');
		}

		if (messageContext?.incident === EExecutionMessageType.ENSURE_START) {
			this.addClass('haibun-ensure-start');
		}

		// Check if this step ended with failure
		if (messageContext?.incident === EExecutionMessageType.STEP_END) {
			const incidentDetails = messageContext.incidentDetails as Record<string, unknown> | undefined;
			const actionResult = incidentDetails?.actionResult as { ok?: boolean } | undefined;
			if (actionResult?.ok === false) {
				this.addClass('haibun-step-failed');
			}
		}

		// Check if ensure ended with failure
		if (messageContext?.incident === EExecutionMessageType.ENSURE_END) {
			this.addClass('haibun-ensure-end');
			const incidentDetails = messageContext.incidentDetails as Record<string, unknown> | undefined;
			const actionResult = incidentDetails?.actionResult as { ok?: boolean } | undefined;
			if (actionResult?.ok === false) {
				this.addClass('haibun-ensure-failed');
			}
		}

		this.setData('time', `${timestamp}`);

		// Indentation based on seqPath
		const incidentDetails = messageContext?.incidentDetails as Record<string, unknown> | undefined;
		const featureStep = incidentDetails?.featureStep as { seqPath?: unknown[] } | undefined;
		if (featureStep?.seqPath && Array.isArray(featureStep.seqPath)) {
			const depth = featureStep.seqPath.length;
			// Indent by 5px per depth level
			this.element.style.marginLeft = `${depth * 5}px`;
			this.setData('depth', `${depth}`);
		}

		this.detailsSummary = new LogDetailsSummary(level, timestamp);
		this.messageContent = new LogMessageContent(message, messageContext);

		this.append(this.detailsSummary);
		this.append(this.messageContent);

	}

}

// --- Log Entry Structure Components (Used by LogEntry) ---

class LogDetailsSummary extends LogComponent<HTMLElement> {
	constructor(level: string, timestamp: number) {
		super('summary', 'haibun-log-details-summary');
		const relativeTime = calculateRelativeTime(timestamp);
		this.setHtml(`${level}<div class="time-small">${formatTime(relativeTime)}s</div>`);
	}
}

export class LogMessageContent extends LogComponent {
	readonly artifactDisplays: ArtifactDisplay[] = [];
	private artifactContainers: HTMLElement[] = [];

	constructor(message: string, messageContext?: TMessageContext) {
		super('div', 'haibun-message-content');

		if (messageContext) {
			const { incident, incidentDetails, artifacts } = messageContext;
			const summaryMessageToDisplay = getSummaryMessage(message);
			let labelForSummary = EExecutionMessageType[incident] || 'Context';

			if (incidentDetails && typeof incidentDetails === 'object' && 'featureStep' in incidentDetails) {
				const { featureStep } = incidentDetails as any;
				if (featureStep?.path) {
					labelForSummary = featureStep.path;
				}
			}

			// Create artifact displays for all artifacts
			if (artifacts && artifacts.length > 0) {
				for (const artifact of artifacts) {
					const display = createArtifactDisplay(artifact);
					if (display) {
						this.artifactDisplays.push(display);
						if (display.label !== display.artifactType) {
							labelForSummary = display.label;
						} else if (display.artifactType) {
							labelForSummary = display.artifactType;
						}
					}
				}
			}

			const detailsElement = document.createElement('details');
			detailsElement.classList.add('haibun-context-details');

			// Check if we should auto-open based on artifacts
			const shouldAutoOpen = artifacts && artifacts.some(a =>
				['html', 'image', 'video', 'video/start', 'resolvedFeatures'].includes(a.artifactType)
			);

			// Only auto-open if we are in documentation view
			const isDocView = document.body.classList.contains('view-documentation');

			if (shouldAutoOpen && isDocView) {
				detailsElement.open = true;
			}

			const { stepperName, actionName } = (incidentDetails as any)?.featureStep?.action || {};
			const hasArtifacts = artifacts && artifacts.length > 0;
			const messageSummary = new LogMessageSummary(summaryMessageToDisplay, labelForSummary, incident, stepperName, actionName, hasArtifacts);
			if (incident === EExecutionMessageType.STEP_START) {
				const loader = document.createElement('div');
				loader.className = 'haibun-loader';
				loader.title = 'Executing...';
				messageSummary.element.prepend(loader);
			}
			detailsElement.appendChild(messageSummary.element);

			if (this.artifactDisplays.length > 0) {
				for (const artifactDisplay of this.artifactDisplays) {
					const placement = artifactDisplay.placementTarget;
					if (!placement || placement === 'details') {
						const artifactContainer = document.createElement('div');
						artifactContainer.className = `haibun-artifact-container haibun-artifact-${artifactDisplay.artifactType.replace(/\//g, '-')}`;
						artifactContainer.textContent = 'Artifact is rendering...';
						// Append artifacts directly to detailsElement
						detailsElement.appendChild(artifactContainer);
						this.artifactContainers.push(artifactContainer);

						// Render immediately if open, or wait for toggle
						const renderArtifact = async () => {
							try {
								await artifactDisplay.render(artifactContainer);
							} catch (error) {
								console.error(`[LogMessageContent] Error rendering artifact ${artifactDisplay.label}:`, error);
								artifactContainer.innerHTML = `<p class="haibun-artifact-error">Error loading artifact: ${(error as Error).message}</p>`;
							}
						};

						if (detailsElement.open) {
							void renderArtifact();
						} else {
							const onToggle = () => {
								if (detailsElement.open) {
									void renderArtifact();
									detailsElement.removeEventListener('toggle', onToggle);
								}
							};
							detailsElement.addEventListener('toggle', onToggle);
						}
					} else {
						void this.renderSpecialPlacementArtifact(artifactDisplay, placement);
					}
				}
			}

			if (incidentDetails) {
				const pre = document.createElement('div');
				pre.classList.add('haibun-message-details-json');
				pre.appendChild(disclosureJson(incidentDetails));
				detailsElement.appendChild(pre);
			}

			this.append(detailsElement);
		} else {
			this.addClass('haibun-simple-message');

			let markdownHtml = '';
			try {
				const md = new MarkdownIt({
					html: true,
					linkify: true,
					typographer: true
				});

				if (message.trim().startsWith('>')) {
					markdownHtml = md.render(message);
				} else {
					markdownHtml = md.render('```\n' + message + '\n```');
				}
			} catch (e) {
				console.error('Error rendering markdown:', e);
				markdownHtml = `<div class="haibun-error">Error rendering markdown: ${e}</div>`;
			}

			const plainDiv = document.createElement('div');
			plainDiv.className = 'haibun-prose-plain';
			plainDiv.textContent = message;

			const markdownDiv = document.createElement('div');
			markdownDiv.className = 'haibun-prose-markdown';
			markdownDiv.innerHTML = markdownHtml;

			this.element.appendChild(plainDiv);
			this.element.appendChild(markdownDiv);
		}
	}

	private async renderSpecialPlacementArtifact(artifactDisplay: ArtifactDisplay, placement: string): Promise<void> {
		const createAndRenderArtifact = async (targetElementUpdater: (container: HTMLElement) => void) => {
			const container = document.createElement('div');
			container.className = `haibun-artifact-special-placement haibun-artifact-${artifactDisplay.artifactType.replace(/\//g, '-')}`;
			container.textContent = 'Artifact is rendering...';
			try {
				await artifactDisplay.render(container);
			} catch (error) {
				console.error(`[LogMessageContent] Error rendering artifact ${artifactDisplay.label} for special placement ${placement}:`, error);
				container.innerHTML = `<p class="haibun-artifact-error">Error loading artifact: ${(error as Error).message}</p>`;
			}
			targetElementUpdater(container);
		};

		if (placement === 'body') {
			await createAndRenderArtifact(container => document.body.appendChild(container));
		} else if (placement === 'haibun-focus') {
			const haibunVideoContainer = document.querySelector<HTMLElement>('#haibun-focus');
			if (haibunVideoContainer) {
				await createAndRenderArtifact(container => {
					haibunVideoContainer.replaceChildren(container);
					haibunVideoContainer.style.display = 'flex';
				});
			} else {
				console.warn('[LogMessageContent] #haibun-focus container not found for artifact placement.');
			}
		}
	}
}

class LogMessageSummary extends LogComponent<HTMLElement> {
	private labelSpan: HTMLSpanElement;
	private emoji: string | undefined;

	constructor(summaryMessage: string, initialLabel: string, incident?: EExecutionMessageType, stepperName?: string, actionName?: string, hasArtifacts: boolean = false) {
		super('summary', 'haibun-log-message-summary');
		this.labelSpan = document.createElement('span');
		this.labelSpan.className = 'haibun-log-label';
		if (hasArtifacts) {
			this.labelSpan.classList.add('haibun-log-artifact-label');
		}
		this.labelSpan.textContent = initialLabel;

		let mainText = summaryMessage;
		let seqPathText = '';

		// Extract and strip Emoji
		const emojiMatch = mainText.match(/^(\p{Extended_Pictographic}|\p{Emoji_Presentation})\s+(.*)$/u);
		if (emojiMatch) {
			this.emoji = emojiMatch[1];
			mainText = emojiMatch[2];
		}

		if (this.emoji) {
			const emojiSpan = document.createElement('span');
			emojiSpan.className = 'haibun-log-emoji';
			emojiSpan.textContent = this.emoji;
			this.element.appendChild(emojiSpan);
		} else {
			const emptySpan = document.createElement('span');
			this.element.appendChild(emptySpan);
		}

		const seqPathMatchSuffix = mainText.match(/^(.*)\s\(([\d.,-]+)\)$/);
		const seqPathMatchPrefix = mainText.match(/^\s*\[([\d.,-]+)\]\s*(.*)$/);

		if (seqPathMatchSuffix) {
			mainText = seqPathMatchSuffix[1];
			seqPathText = seqPathMatchSuffix[2];
		} else if (seqPathMatchPrefix) {
			seqPathText = seqPathMatchPrefix[1];
			mainText = seqPathMatchPrefix[2];
		}

		const pathSuffixMatch = mainText.match(/^(.*)\s+([^\s]+:([\d.,-]+))$/);
		const wholePathMatch = mainText.match(/^([^\s]+:([\d.,-]+))$/);

		if (pathSuffixMatch) {
			mainText = pathSuffixMatch[1];
			if (!seqPathText) {
				seqPathText = pathSuffixMatch[3].replace(/,/g, '.');
			}
		} else if (wholePathMatch) {
			if (!seqPathText) {
				seqPathText = wholePathMatch[2].replace(/,/g, '.');
			}
			mainText = '';
		}

		// Sanitize seqPathText to remove confusing prefixes like "1-" or ".."
		if (seqPathText) {
			seqPathText = seqPathText.replace(/^1-/, '').replace(/^\.+/, '');
		}

		const textContainer = document.createElement('div');
		textContainer.className = 'haibun-log-message-text';

		const isProse = stepperName === 'Haibun' && actionName === 'prose';
		const isAction = incident === EExecutionMessageType.ACTION;
		const isStep = !isProse && !isAction && /^\s*[a-z]/.test(mainText);

		if (isStep) {
			textContainer.classList.add('haibun-log-step');
		} else if (isAction) {
			textContainer.classList.add('haibun-log-action');
		}

		// Store both plain text and markdown-rendered versions
		let markdownHtml = '';
		try {
			const md = new MarkdownIt({
				html: true,
				linkify: true,
				typographer: true
			});
			markdownHtml = md.render(mainText);
		} catch (e) {
			console.error('Error rendering markdown:', e);
			markdownHtml = `<div class="haibun-error">Error rendering markdown: ${e}</div>`;
		}

		// Create container for plain text
		const plainSpan = document.createElement('span');
		plainSpan.className = 'haibun-prose-plain';
		plainSpan.textContent = mainText;

		// Create container for markdown
		const markdownDiv = document.createElement('div');
		markdownDiv.className = 'haibun-prose-markdown';
		markdownDiv.innerHTML = markdownHtml;

		textContainer.appendChild(plainSpan);
		textContainer.appendChild(markdownDiv);
		this.element.appendChild(textContainer);

		this.append(this.labelSpan);

		if (seqPathText) {
			const seqPathSpan = document.createElement('span');
			seqPathSpan.className = 'haibun-seqpath';
			seqPathSpan.textContent = seqPathText;
			this.element.appendChild(seqPathSpan);
		}
	}

	updateLabel(newLabel: string): void {
		this.labelSpan.textContent = newLabel.replace(/_/g, ' ');
	}
}

// --- Artifact Display Components (Details) ---

function createArtifactDisplay(artifact: TArtifact): ArtifactDisplay | null {
	const { artifactType } = artifact;

	switch (artifactType) {
		case 'html': return new HtmlArtifactDisplay(<TArtifactHTML>artifact);
		case 'image': return new ImageArtifactDisplay(<TArtifactImage>artifact);
		case 'speech': return new SpeechArtifactDisplay(<TArtifactSpeech>artifact);
		case 'video': return new VideoArtifactDisplay(<TArtifactVideo>artifact);
		case 'video/start': return new VideoStartArtifactDisplay(<TArtifactVideoStart>artifact);
		case 'json': return new JsonArtifactDisplay(<TArtifactJSON>artifact);
		case 'json/http/trace':
			return new JsonArtifactHTTPTrace(<TArtifactHTTPTrace>artifact);
		case 'resolvedFeatures': {
			return new ResolvedFeaturesArtifactDisplay(artifact as TArtifactResolvedFeatures);
		}
		default: {
			throw Error(`Unsupported artifact type "${(<TArtifact>artifact).artifactType}" for display from ${artifactType}`);
		}
	}
}

// --- Helper Functions ---

function calculateRelativeTime(timestamp: number): number {
	const startTime = parseInt(document.body.dataset.startTime || `${Date.now()}`, 10);
	return timestamp - startTime;
}

function formatTime(relativeTimeMs: number): string {
	return (relativeTimeMs / 1000).toFixed(3).replace('.', ':');
}

function getSummaryMessage(message: string): string {
	// The message already contains featureStep.in for both STEP_START and STEP_END
	// so we don't need to append it
	return message;
}
