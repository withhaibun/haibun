import { TArtifact, TArtifactSpeech, TArtifactVideo, TArtifactVideoStart, TArtifactImage, TArtifactHTML, TArtifactJSON, TArtifactHTTPTrace, TMessageContext, TArtifactResolvedFeatures } from '@haibun/core/build/lib/interfaces/logger.js';
import { EExecutionMessageType } from '@haibun/core/build/lib/interfaces/logger.js';

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
	readonly artifactDisplay: ArtifactDisplay | null = null;
	private artifactContainer: HTMLElement | null = null;
	private hasArtifactBeenRendered = false;

	constructor(message: string, messageContext?: TMessageContext) {
		super('div', 'haibun-message-content');

		if (messageContext) {
			const { incident, incidentDetails, artifact } = messageContext;
			const summaryMessageToDisplay = getSummaryMessage(message, messageContext);
			let labelForSummary = EExecutionMessageType[incident] || 'Context';

			// Attempt to create artifact display first, as it might influence the label
			if (artifact) {
				this.artifactDisplay = createArtifactDisplay(artifact);
				if (this.artifactDisplay) {
					labelForSummary = (this.artifactDisplay.label !== this.artifactDisplay.artifactType)
						? this.artifactDisplay.label
						: (this.artifactDisplay.artifactType || labelForSummary);
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
				const pre = document.createElement('pre');
				pre.classList.add('haibun-message-details-json');
				pre.appendChild(disclosureJson(incidentDetails));
				detailsElement.appendChild(pre);
			}

			if (this.artifactDisplay) {
				const placement = this.artifactDisplay.placementTarget;
				if (!placement || placement === 'details') {
					this.artifactContainer = document.createElement('div');
					this.artifactContainer.className = `haibun-artifact-container haibun-artifact-${this.artifactDisplay.artifactType.replace(/\//g, '-')}`;
					this.artifactContainer.textContent = 'Artifact is loading...';
					detailsElement.appendChild(this.artifactContainer);

					const targetContainer = this.artifactContainer;
					const onceToggleListener = async () => {
						if (detailsElement.open && this.artifactDisplay && !this.hasArtifactBeenRendered) {
							try {
								await this.artifactDisplay.render(targetContainer);
							} catch (error) {
								console.error(`[LogMessageContent] Error rendering artifact ${this.artifactDisplay.label}:`, error);
								targetContainer.innerHTML = `<p class="haibun-artifact-error">Error loading artifact: ${(error as Error).message}</p>`;
							}
							this.hasArtifactBeenRendered = true;
						}
					};
					detailsElement.addEventListener('toggle', () => { void onceToggleListener(); });
				} else {
					// Special placement, artifact rendered outside detailsElement
					void this.renderSpecialPlacementArtifact(this.artifactDisplay, placement);
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
			container.textContent = 'Artifact is loading...';
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
		} else if (placement === 'haibun-video') {
			const haibunVideoContainer = document.querySelector<HTMLElement>('#haibun-video');
			if (haibunVideoContainer) {
				await createAndRenderArtifact(container => {
					haibunVideoContainer.replaceChildren(container);
					haibunVideoContainer.style.display = 'flex';
				});
			} else {
				console.warn('[LogMessageContent] #haibun-video container not found for artifact placement.');
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

function getSummaryMessage(message: string, messageContext?: TMessageContext): string {
	if (messageContext?.incident === EExecutionMessageType.STEP_END && messageContext.incidentDetails?.result?.in) {
		return `${message} ${messageContext.incidentDetails.result.in}`;
	}
	return message;
}
