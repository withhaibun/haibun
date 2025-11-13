import { TArtifact, TArtifactSpeech, TArtifactVideo, TArtifactVideoStart, TArtifactImage, TArtifactHTML, TArtifactJSON, TArtifactHTTPTrace, TMessageContext, TArtifactResolvedFeatures } from '@haibun/core/lib/interfaces/logger.js';
import { EExecutionMessageType } from '@haibun/core/lib/interfaces/logger.js';

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
		this.setData('time', `${timestamp}`);

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

			const messageSummary = new LogMessageSummary(summaryMessageToDisplay, labelForSummary);
			if (incident === EExecutionMessageType.STEP_START) {
				const loader = document.createElement('div');
				loader.className = 'haibun-loader';
				messageSummary.element.prepend(loader);
			}
			detailsElement.appendChild(messageSummary.element);

			if (incidentDetails) {
				const pre = document.createElement('div');
				pre.classList.add('haibun-message-details-json');
				pre.appendChild(disclosureJson(incidentDetails));
				detailsElement.appendChild(pre);
			}

			if (this.artifactDisplays.length > 0) {
				for (const [i, artifactDisplay] of this.artifactDisplays.entries()) {
					const placement = artifactDisplay.placementTarget;
					if (!placement || placement === 'details') {
						const artifactContainer = document.createElement('div');
						artifactContainer.className = `haibun-artifact-container haibun-artifact-${artifactDisplay.artifactType.replace(/\//g, '-')}`;
						artifactContainer.textContent = 'Artifact is rendering...';
						detailsElement.appendChild(artifactContainer);
						this.artifactContainers.push(artifactContainer);

						// Attach a handler for this artifact container only
						const onToggle = async () => {
							if (detailsElement.open) {
								try {
									await artifactDisplay.render(artifactContainer);
								} catch (error) {
									console.error(`[LogMessageContent] Error rendering artifact ${artifactDisplay.label}:`, error);
									artifactContainer.innerHTML = `<p class=\"haibun-artifact-error\">Error loading artifact: ${(error as Error).message}</p>`;
								}
							} else {
								artifactContainer.innerHTML = 'Artifact is rendering...';
							}
						};
						detailsElement.addEventListener('toggle', onToggle);
					} else {
						void this.renderSpecialPlacementArtifact(artifactDisplay, placement);
					}
				}
			}
			this.append(detailsElement);
		} else {
			this.addClass('haibun-simple-message');
			this.setText(message);
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

	constructor(summaryMessage: string, initialLabel: string) {
		super('summary', 'haibun-log-message-summary');
		this.labelSpan = document.createElement('span');
		this.labelSpan.className = 'details-type';
		this.updateLabel(initialLabel);
		this.setText(summaryMessage);
		this.append(this.labelSpan);
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
