import { TArtifact, TArtifactSpeech, TArtifactVideo, TArtifactVideoStart, TArtifactImage, TArtifactHTML, TArtifactJSON, TArtifactHTTPTrace } from '@haibun/core/build/lib/interfaces/artifacts.js';
import { TMessageContext, EExecutionMessageType } from '@haibun/core/build/lib/interfaces/logger.js';
import { sequenceDiagramGenerator } from './monitor.js';
import { disclosureJson } from './disclosureJson.js';

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
export abstract class ArtifactDisplay extends LogComponent {
	readonly label: string;
	abstract readonly placementTarget: 'details' | 'haibun-video' | 'haibun-sequence-diagram' | 'body' | 'none';

	constructor(protected artifact: TArtifact, tagName: keyof HTMLElementTagNameMap, className?: string | string[]) {
		super(tagName, className);
		this.artifact = artifact;
		this.label = this.deriveLabel();
		this.render();
	}

	protected deriveLabel(): string {
		return this.artifact.artifactType;
	}

	protected abstract render(): void;

	public get artifactType(): string {
		return this.artifact.artifactType;
	}
}


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

		this.handleSpecialPlacements();
	}

	private handleSpecialPlacements(): void {
		const artifactDisplay = this.messageContent.artifactDisplay;
		if (!artifactDisplay) return;

		if (artifactDisplay.placementTarget === 'body') {
			document.body.appendChild(artifactDisplay.element);
		} else if (artifactDisplay.placementTarget === 'haibun-video') {
			const haibunVideoContainer = document.querySelector<HTMLElement>('#haibun-video');
			if (haibunVideoContainer) {
				haibunVideoContainer.replaceChildren(artifactDisplay.element);
				haibunVideoContainer.style.display = 'flex';
			}
		} else if (artifactDisplay.placementTarget === 'haibun-sequence-diagram') {
			// The element is already rendered in the details by LogMessageContent.
			// Here, we just need to ensure the data is processed for the diagram if needed.
			// The JsonArtifactHTTPTrace.render method already handles this.
			// No need to move the element itself.
			// sequenceDiagramGenerator.processEvent is called within JsonArtifactHTTPTrace.render
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
	readonly artifactDisplay: ArtifactDisplay | null = null;

	constructor(message: string, messageContext?: TMessageContext) {
		super('div', 'haibun-message-content');

		const summaryMessage = getSummaryMessage(message, messageContext);

		if (messageContext) {
			// Context exists: ALWAYS create the details structure
			const incident = messageContext.incident;
			const incidentDetails = messageContext.incidentDetails;
			const artifact = messageContext.artifact;
			let finalLabel = EExecutionMessageType[incident] || 'Context'; // Default label is incident type

			// Check for artifact and update label if needed
			if (artifact) {
				this.artifactDisplay = createArtifactDisplay(artifact);
				if (this.artifactDisplay) {
					// Use artifact label if available and different, otherwise use type
					finalLabel = (this.artifactDisplay.label !== this.artifactDisplay.artifactType)
						? this.artifactDisplay.label
						: (this.artifactDisplay.artifactType || finalLabel);
					// NOTE: We no longer check placementTarget or return early here
				}
			}

			// --- Create Details Wrapper ---
			const detailsElement = document.createElement('details');
			detailsElement.classList.add('haibun-context-details');

			// Create the summary line
			const messageSummary = new LogMessageSummary(summaryMessage, finalLabel);

			// Add loader specifically to the message summary if STEP_START
			if (incident === EExecutionMessageType.STEP_START) {
				const loader = document.createElement('div');
				loader.className = 'haibun-loader';
				messageSummary.element.prepend(loader); // Prepend to the summary element
			}
			detailsElement.appendChild(messageSummary.element); // Append the summary (with potential loader)


			// Add incidentDetails JSON inside the details element
			if (incidentDetails) {
				const pre = document.createElement('pre');
				pre.classList.add('haibun-message-details-json');
				pre.appendChild(disclosureJson(incidentDetails))
				detailsElement.appendChild(pre);
			}

			// Add artifact display if it exists.
			// For JsonArtifactHTTPTrace, this ensures the <pre> is always added here.
			if (this.artifactDisplay) {
				detailsElement.appendChild(this.artifactDisplay.element);
			}

			this.append(detailsElement); // Append the whole details structure

			// If artifact placement is NOT 'details', we might still want the simple message class on the parent
			if (this.artifactDisplay && this.artifactDisplay.placementTarget !== 'details') {
				this.addClass('haibun-simple-message');
				// Optionally set text again if the summary text differs significantly from the desired simple text
				// this.setText(summaryMessage);
			}

		} else {
			// No context: display simple message
			this.addClass('haibun-simple-message');
			this.setText(message); // Use original message
		}

	}
}

class LogMessageSummary extends LogComponent<HTMLElement> {
	private labelSpan: HTMLSpanElement;

	constructor(summaryMessage: string, initialLabel: string) {
		super('summary', 'haibun-log-message-summary');
		this.labelSpan = document.createElement('span');
		this.labelSpan.className = 'details-type'; // Class for styling the label
		this.updateLabel(initialLabel); // Set initial label with formatting
		// Set text first, then append span
		this.setText(summaryMessage);
		this.append(this.labelSpan);
	}

	updateLabel(newLabel: string): void {
		this.labelSpan.textContent = newLabel.replace(/_/g, ' ');
	}
}


// --- Artifact Display Components (Details) ---

// Factory function to create the correct ArtifactDisplay instance
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
		default: {
			throw Error(`Unsupported artifact type "${(<TArtifact>artifact).artifactType}" for display from ${artifactType}`);
		}
	}
}

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
		(this.element as HTMLImageElement).src = getRuntimePath(this.artifact);
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
		(this.element as HTMLVideoElement).src = getRuntimePath(this.artifact);
	}
}
class SpeechArtifactDisplay extends ArtifactDisplay {
	readonly placementTarget: 'details';
	constructor(protected artifact: TArtifactSpeech) {
		super(artifact, 'audio');
		const audioElement = this.element as HTMLAudioElement;
		audioElement.controls = true;
		audioElement.style.width = '320px';
		// create audio element that plays when it is clicked
		audioElement.addEventListener('click', () => {
			audioElement.play().catch((error) => {
				console.error('Error playing audio:', error);
			});
		}
		);
	}
	protected render(): void {
		(this.element as HTMLAudioElement).src = getRuntimePath(this.artifact);
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
	readonly placementTarget: 'details' | 'haibun-sequence-diagram';
	constructor(protected artifact: TArtifactHTTPTrace) {
		super(artifact, 'pre', 'haibun-message-details-json');
		this.placementTarget = document.querySelector('#sequence-diagram') ? 'haibun-sequence-diagram' : 'details';
	}
	protected deriveLabel(): string {
		return '⇄ Trace';
	}
	protected render(): void {
		if (this.artifact.httpEvent !== 'route') {
			sequenceDiagramGenerator.processEvent(this.artifact.trace, this.artifact.httpEvent);
		}
		this.append(disclosureJson(this.artifact.trace));
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
		this.append(disclosureJson(this.artifact.json || {}));
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
	// Check for STEP_END incident and access details via incidentDetails
	if (messageContext?.incident === EExecutionMessageType.STEP_END && messageContext.incidentDetails?.result?.in) {
		return `${message} ${messageContext.incidentDetails.result.in}`;
	}
	return message;
}

function getRuntimePath(artifact: { path: string, runtimePath?: string }): string {
	const isRuntime = document.body.dataset.haibunRuntime === 'true';
	if (isRuntime && artifact.runtimePath) {
		const prefix = artifact.runtimePath.endsWith('/') ? artifact.runtimePath : `${artifact.runtimePath}/`;
		return `${prefix}${artifact.path.replace(/^\.\//, '')}`;
	}
	return artifact.path;
}

