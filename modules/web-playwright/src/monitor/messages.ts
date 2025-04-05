// modules/web-playwright/src/monitor/messages.ts
import { TArtifact, TMessageContext, TExecutorMessageContext, TArtifactMessageContext, TArtifactVideo, TArtifactImage, TArtifactHTML, TArtifactJSON, TArtifactHTTPTrace, TArtifactVideoStart } from '@haibun/core/build/lib/interfaces/logger.js';
import { sequenceDiagramGenerator } from './monitor.js'; // Assuming monitor.js exports this

abstract class LogComponent<T extends HTMLElement = HTMLElement> {
	readonly element: T;

	constructor(tagName: keyof HTMLElementTagNameMap, className?: string | string[]) {
		this.element = document.createElement(tagName) as T;
		if (className) {
			const classes = Array.isArray(className) ? className : [className];
			this.element.classList.add(...classes);
		}
	}

	append(child: LogComponent | HTMLElement): void {
		// Type guard ensures we append the .element property if it's a LogComponent
		this.element.appendChild(child instanceof LogComponent ? child.element : child);
	}

	addClass(className: string): void {
		this.element.classList.add(className);
	}

	setData(key: string, value: string): void {
		this.element.dataset[key] = value;
	}

	setHtml(html: string): void {
		this.element.innerHTML = html;
	}

	setText(text: string): void {
		this.element.textContent = text;
	}
}


// --- Abstract Artifact Display Base Class ---

// Abstract base for artifact displays
abstract class ArtifactDisplay extends LogComponent {
	readonly label: string;
	abstract readonly placementTarget: 'details' | 'haibun-video' | 'body' | 'none';

	constructor(protected artifact: TArtifact, tagName: keyof HTMLElementTagNameMap, className?: string | string[]) {
		super(tagName, className);
		this.artifact = artifact;
		this.label = this.deriveLabel();
		this.render();
	}

	// Default label derivation, can be overridden
	protected deriveLabel(): string {
		return this.artifact.artifactType;
	}

	// Subclasses must implement this to populate their element
	protected abstract render(): void;
}


export class LogEntry extends LogComponent {
	private detailsSummary: LogDetailsSummary;
	private messageContent: LogMessageContent;

	constructor(level: string, timestamp: number, message: string, messageContext?: TMessageContext) {
		super('div', ['haibun-log-entry', `haibun-level-${level}`]);
		this.setData('time', `${timestamp}`);

		// Create structural components
		this.detailsSummary = new LogDetailsSummary(level, timestamp);
		this.messageContent = new LogMessageContent(message, messageContext);

		// Assemble the main structure
		this.append(this.detailsSummary);
		// Always append message content; layout will be handled by CSS
		this.append(this.messageContent);

		// Handle placements for artifacts that don't go in the main flow
		this.handleSpecialPlacements();
	}

	private handleSpecialPlacements(): void {
		const artifactDisplay = this.messageContent.artifactDisplay; // Access the created artifact display
		if (!artifactDisplay) return;

		if (artifactDisplay.placementTarget === 'body') {
			document.body.appendChild(artifactDisplay.element);
		} else if (artifactDisplay.placementTarget === 'haibun-video') {
			const haibunVideoContainer = document.querySelector<HTMLElement>('#haibun-video');
			if (haibunVideoContainer) {
				haibunVideoContainer.replaceChildren(artifactDisplay.element);
				haibunVideoContainer.style.display = 'flex';
			}
		}
		// 'details' placement is handled within LogMessageContent constructor
	}
}

// --- Log Entry Structure Components (Used by LogEntry) ---

class LogDetailsSummary extends LogComponent<HTMLElement> { // Using HTMLElement for summary tag
	constructor(level: string, timestamp: number) {
		super('summary', 'haibun-log-details-summary');
		const relativeTime = calculateRelativeTime(timestamp);
		this.setHtml(`${level}<div class="time-small">${formatTime(relativeTime)}s</div>`);
	}
}

class LogMessageContent extends LogComponent {
	// Publicly accessible artifact display for LogEntry to check placement
	readonly artifactDisplay: ArtifactDisplay | null = null;

	constructor(message: string, messageContext?: TMessageContext) {
		super('div', 'haibun-message-content');

		const summaryMessage = getSummaryMessage(message, messageContext);
		const artifact = (messageContext as TArtifactMessageContext)?.artifact

		if (artifact) {
			this.artifactDisplay = createArtifactDisplay(artifact); // Factory creates the specific display

			if (this.artifactDisplay && this.artifactDisplay.placementTarget === 'details') {
				// Case 1: Artifact exists and belongs in the details section here.
				const detailsElement = document.createElement('details');
				detailsElement.classList.add('haibun-artifact-details');
				const messageSummary = new LogMessageSummary(summaryMessage, this.artifactDisplay.label);
				detailsElement.appendChild(messageSummary.element);
				detailsElement.appendChild(this.artifactDisplay.element);
				this.append(detailsElement);

			} else if (this.artifactDisplay && this.artifactDisplay.placementTarget !== 'details') {
				// Case 2: Artifact exists but is placed elsewhere (body, #haibun-video).
				// Display the summary message here for context.
				this.addClass('haibun-simple-message');
				this.setText(summaryMessage);

			} else if (!this.artifactDisplay) {
				// Case 3: Artifact was expected but couldn't be created (unsupported type).
				this.addClass('haibun-simple-message');
				this.setText(`[Unsupported artifact type: ${artifact.artifactType}] ${summaryMessage}`);
			}
		} else if (summaryMessage !== message) {
			// Case 4: No artifact, but the summary message was modified.
			this.addClass('haibun-simple-message');
			this.setText(summaryMessage);
		} else {
			// Case 5: No artifact, message not modified. Display original message.
			this.addClass('haibun-simple-message');
			this.setText(message);
		}
		// Ensure the element is never hidden by default
		this.element.style.display = '';
	}
}

class LogMessageSummary extends LogComponent<HTMLElement> { // Using HTMLElement for summary tag
	constructor(summaryMessage: string, artifactLabel: string) {
		super('summary', 'haibun-log-message-summary');
		const labelSpan = document.createElement('span');
		labelSpan.className = 'details-type';
		labelSpan.textContent = artifactLabel;
		// Set text first, then append span
		this.setText(summaryMessage);
		this.append(labelSpan);
	}
}


// --- Artifact Display Components (Details) ---

// Factory function to create the correct ArtifactDisplay instance
function createArtifactDisplay(artifact: TArtifact): ArtifactDisplay | null {
	switch (artifact.artifactType) {
		case 'html': return new HtmlArtifactDisplay(<TArtifactHTML>artifact);
		case 'image': return new ImageArtifactDisplay(<TArtifactImage>artifact);
		case 'video': return new VideoArtifactDisplay(<TArtifactVideo>artifact);
		case 'video/start': return new VideoStartArtifactDisplay(<TArtifactVideoStart>artifact);
		case 'json': return new JsonArtifactDisplay(<TArtifactJSON>artifact);
		case 'json/http/trace':
			return new JsonArtifactHTTPTrace(<TArtifactHTTPTrace>artifact);
		default: {
			throw Error(`Unsupported artifact type "${(<TArtifact>artifact).artifactType}" for display`);
		}
	}
}

// Specific implementations for each artifact type
class HtmlArtifactDisplay extends ArtifactDisplay {
	readonly placementTarget = 'details';
	constructor(protected artifact: TArtifactHTML) {
		super(artifact, 'iframe');
		this.element.style.border = 'none';
		this.element.style.width = '100%';
		this.element.style.height = '80vh';
	}
	protected render(): void {
		if (this.artifact.html) {
			(this.element as HTMLIFrameElement).srcdoc = this.artifact.html;
		}
	}
}

class ImageArtifactDisplay extends ArtifactDisplay {
	readonly placementTarget = 'details';
	constructor(protected artifact: TArtifactImage) {
		super(artifact, 'img');
		(this.element as HTMLImageElement).alt = 'Screen capture artifact';
	}
	protected render(): void {
		if (this.artifact.path) {
			(this.element as HTMLImageElement).src = this.artifact.path;
		}
	}
}

class VideoArtifactDisplay extends ArtifactDisplay {
	readonly placementTarget: 'details' | 'haibun-video';
	constructor(protected artifact: TArtifactVideo) {
		super(artifact, 'video');
		const videoElement = this.element as HTMLVideoElement;
		videoElement.controls = true;
		videoElement.style.width = '320px';
		this.placementTarget = document.querySelector('#haibun-video') ? 'haibun-video' : 'details';
		if (this.placementTarget === 'details') {
			console.info('Cannot find #haibun-video container; appending video to details.');
		}
	}
	protected render(): void {
		(this.element as HTMLVideoElement).src = this.artifact.path;
	}
}

class VideoStartArtifactDisplay extends ArtifactDisplay {
	readonly placementTarget = 'body';
	constructor(protected artifact: TArtifactVideoStart) {
		super(artifact, 'span');
		this.element.id = 'haibun-video-start';
	}
	protected render(): void {
		this.setData('start', `${this.artifact.start}`);
	}
}

class JsonArtifactHTTPTrace extends ArtifactDisplay {
	readonly placementTarget = 'details';
	constructor(protected artifact: TArtifactHTTPTrace) {
		super(artifact, 'pre', 'haibun-message-details-json');
	}
	protected deriveLabel(): string {
		return '⇄ Trace';
	}
	protected render(): void {
		sequenceDiagramGenerator.processEvent(this.artifact.trace);
	}
}

class JsonArtifactDisplay extends ArtifactDisplay {
	readonly placementTarget = 'details';
	constructor(protected artifact: TArtifactJSON) {
		super(artifact, 'pre', 'haibun-message-details-json');
	}
	protected deriveLabel(): string {
		return this.artifact.artifactType;
	}
	protected render(): void {
		this.setText(JSON.stringify(this.artifact.json, null, 2));
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
	if (messageContext && (messageContext as TExecutorMessageContext).topic?.stage === 'Executor' && (messageContext as TExecutorMessageContext).topic.result?.in) {
		return `${message} ${(messageContext as TExecutorMessageContext).topic.result.in}`;
	}
	return message;
}
