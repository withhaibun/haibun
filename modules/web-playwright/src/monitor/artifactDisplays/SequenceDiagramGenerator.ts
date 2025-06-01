import mermaid from 'mermaid';

import { TAnyFixme } from '@haibun/core/build/lib/fixme.js';
import { TArtifactHTTPTrace, THTTPTraceContent } from '@haibun/core/build/lib/interfaces/logger.js';
import { shortenURI } from '@haibun/core/build/lib/util/index.js';

const sanitizeMermaidContent = (message: string): string => {
	let sanitized = message.replace(/"/g, "'");
	sanitized = sanitized.replace(/;/g, '#59;');
	sanitized = sanitized.replace(/\(/g, '#40;');
	sanitized = sanitized.replace(/\)/g, '#41;');
	sanitized = sanitized.replace(/,/g, '#44;');
	return sanitized;
};

const jsonFilters = {
	request: {
		method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
		accept: ['application/json'],
	},
	response: {
		type: ['application/json'],
	},
}

export class SequenceDiagramGenerator {
	private needsUpdate = true; // Start with true, assume an update is needed initially
	private diagramLines: string[] = ['sequenceDiagram'];
	private pageNames: Record<string, string> = {};
	private pageCounter = 1;
	private participantAdded: Record<string, boolean> = {};
	private mermaidContainerId: string;
	private parentElement: HTMLElement;
	private currentDiagramString = ''; // Store the last successfully rendered/generated diagram

	constructor(id: string, parentElement: HTMLElement) {
		this.mermaidContainerId = `mermaid-container-${id}`;
		this.parentElement = parentElement;
		this.ensureMermaidContainer();
		this.currentDiagramString = this.buildDiagramString(); // Initialize with empty diagram
	}

	private ensureMermaidContainer(): void {
		let container = this.parentElement.querySelector(`#${this.mermaidContainerId}`);
		if (!container) {
			container = document.createElement('div');
			container.id = this.mermaidContainerId;
			container.className = 'mermaid';
			this.parentElement.appendChild(container);
		}
	}

	private addParticipant(alias: string, name: string) {
		if (!this.participantAdded[alias]) {
			let insertIndex = 1;
			for (let i = this.diagramLines.length - 1; i >= 1; i--) {
				if (this.diagramLines[i].startsWith('participant ')) {
					insertIndex = i + 1;
					break;
				}
			}
			this.diagramLines.splice(insertIndex, 0, `participant ${alias} as ${name}`);
			this.participantAdded[alias] = true;
		}
	}

	private resetDiagramState(): void {
		this.diagramLines = ['sequenceDiagram'];
		this.pageNames = {};
		this.pageCounter = 1;
		this.participantAdded = {};
		// No: this.needsUpdate = true; // Don't set here, compare diagram strings later
	}

	private buildDiagramString(): string {
		if (this.diagramLines.length <= 1) {
			return 'sequenceDiagram'; // Canonical empty diagram
		}
		return this.diagramLines.join("\n");
	}

	public generateDiagramFromHistory(): void {
		this.resetDiagramState();

		if (window.haibunLogData) {
			const httpTraceEvents = window.haibunLogData.filter(
				entry => entry.messageContext?.artifact?.artifactType === 'json/http/trace' &&
					(entry.messageContext.artifact as TArtifactHTTPTrace).httpEvent !== 'route'
			);

			for (const logEntry of httpTraceEvents) {
				// Ensure messageContext and artifact are defined before trying to cast and access httpEvent
				if (logEntry.messageContext && logEntry.messageContext.artifact) {
					const artifact = logEntry.messageContext.artifact as TArtifactHTTPTrace;
					if (artifact && artifact.trace && typeof artifact.trace === 'object') {
						this.processSingleEvent(artifact.trace, artifact.httpEvent);
					}
				}
			}
		}
		// processSingleEvent will set it to true if it adds anything.
		// Here, we compare the generated diagram with the *last rendered* one.
		const finalDiagram = this.buildDiagramString();
		if (finalDiagram === this.currentDiagramString) {
			this.needsUpdate = false;
		} else {
			this.needsUpdate = true;
		}
	}

	public processSingleEvent(trace: THTTPTraceContent, httpEvent: TArtifactHTTPTrace['httpEvent'], filters = jsonFilters): void {
		this.needsUpdate = true;
		const { requestingPage, requestingURL, method, status, statusText, headers } = trace;

		let serverAlias = 'UnknownServerAlias';
		let serverName = 'UnknownServer';
		if (requestingURL) {
			try {
				const url = new URL(requestingURL);
				serverName = url.hostname;
				if (url.hostname === 'localhost' && url.port) {
					serverName = `${url.hostname}:${url.port}`;
				}
				if (serverName) {
					serverAlias = serverName.toLowerCase().replace(/[.:-]/g, '');
				} else {
					serverAlias = 'sourcealias';
					serverName = 'Source';
				}
			} catch (e) {
				serverAlias = 'invalidurlalias';
				serverName = 'InvalidURL';
			}
		}
		this.addParticipant(serverAlias, serverName);

		if (skipEvent(filters, httpEvent, serverName, trace)) {
			return;
		}

		let pageAlias = 'UnknownPageAlias';
		let pageParticipantName = 'UnknownPage';

		if (requestingPage) {
			const existingAlias = this.pageNames[requestingPage];
			if (!existingAlias) {
				pageAlias = requestingPage.toLowerCase().replace(/[.-]/g, '');
				pageParticipantName = requestingPage;

				if (!pageAlias.trim()) {
					pageAlias = `Page${this.pageCounter}`;
				}

				this.pageNames[requestingPage] = pageAlias;
				this.addParticipant(pageAlias, pageParticipantName);
				this.pageCounter++;
			} else {
				pageAlias = existingAlias;
				const participantLine = this.diagramLines.find(line => line.startsWith(`participant ${pageAlias} as `));
				if (participantLine) {
					pageParticipantName = participantLine.substring(participantLine.indexOf(' as ') + 4);
				} else {
					pageParticipantName = pageAlias;
				}
			}
		} else {
			pageAlias = 'ClientPage';
			pageParticipantName = 'Client Page';
			this.addParticipant(pageAlias, pageParticipantName);
		}


		if (method && requestingURL) {
			const message = sanitizeMermaidContent(`${method} ${shortenURI(requestingURL)}`);
			this.diagramLines.push(`${pageAlias}->>${serverAlias}: ${message}`);
			if (headers) {
				if (headers.referer) {
					const note = shortenURI(sanitizeMermaidContent(`Referer: ${headers.referer}`));
					this.diagramLines.push(`Note right of ${pageAlias}: ${note}`);
				}
				if (headers["accept"]) {
					const note = sanitizeMermaidContent(`Accept: ${headers["accept"]}`);
					this.diagramLines.push(`Note right of ${pageAlias}: ${note}`);
				}
				if (headers["content-type"]) {
					const note = sanitizeMermaidContent(`Content-type: ${headers['content-type']}`);
					this.diagramLines.push(`Note right of ${pageAlias}: ${note}`);
				}
			}
		}

		if (status) {
			const message = sanitizeMermaidContent(`${status} ${statusText || ''}`);
			this.diagramLines.push(`${serverAlias}-->>${pageAlias}: ${message}`);
		}
	}

	public getDiagram(): string {
		return this.buildDiagramString();
	}

	// Getter for testing purposes
	public getNeedsUpdate(): boolean {
		return this.needsUpdate;
	}

	// Setter for testing purposes, to simulate rendering having occurred.
	public setNeedsUpdate(value: boolean): void {
		this.needsUpdate = value;
	}

	public async update() {
		this.generateDiagramFromHistory();

		const mermaidContainer = this.parentElement.querySelector<HTMLElement>(`#${this.mermaidContainerId}`);
		if (!mermaidContainer) {
			console.error("Mermaid container not found for ID:", this.mermaidContainerId);
			return;
		}

		if (!this.needsUpdate && mermaidContainer.querySelector('svg')) {
			return;
		}

		const diagramToRender = this.getDiagram();

		try {
			mermaid.initialize({ maxTextSize: 900000, startOnLoad: false });
			mermaidContainer.innerHTML = '';
			const insert = `<pre class="mermaid">${diagramToRender}</pre>`;
			mermaidContainer.insertAdjacentHTML('beforeend', insert);

			const mermaidElement = mermaidContainer.querySelector<HTMLElement>('.mermaid');
			if (mermaidElement) {
				await mermaid.run({ nodes: [mermaidElement] });
				console.log("Mermaid diagram rendered.");
				this.currentDiagramString = diagramToRender;
				this.needsUpdate = false;
			} else {
				console.error("Mermaid pre element not found after insert.");
				mermaidContainer.innerHTML = `<pre>Error: Could not find .mermaid element for rendering.</pre>`;
			}
		} catch (e) {
			console.error("Failed Mermaid diagram definition:\\\\n", diagramToRender);
			console.error("Error rendering Mermaid diagram:", e);
			const detailedError = (typeof e === 'object' && e !== null && 'str' in e) ? (e as TAnyFixme).str : null;
			const errorMessage = detailedError || (e instanceof Error ? e.message : String(e));
			mermaidContainer.innerHTML = `<pre>Error rendering Mermaid diagram:\\\\n\\\\n${errorMessage}\\\\n\\\\n--- Diagram Definition ---\\n${diagramToRender}</pre>`;
			// Even on error, we consider this "render attempt" complete.
			// Setting currentDiagramString to the one that failed, and needsUpdate to false prevents re-looping on a bad diagram.
			this.currentDiagramString = diagramToRender;
			this.needsUpdate = false;
		}
	}
}
export function skipEvent(filters, httpEvent, serverName, { requestingURL, headers }: THTTPTraceContent) {
	if (!serverName) {
		return true;
	}
	if (requestingURL === 'about:blank') {
		return true;
	}
	if (httpEvent === 'request') {
		if (headers && headers.accept) {
			const acceptHeader = headers.accept;
			if (!filters.request.accept.some(filterValue => acceptHeader.includes(filterValue))) {
				return true;
			}
		}
	} else if (httpEvent === 'response') {
		if (headers && headers['content-type']) {
			const contentTypeHeader = headers['content-type'];
			if (!filters.response.type.some(filterValue => contentTypeHeader.includes(filterValue))) {
				return true;
			}
		}
	} else {
		console.warn(`Unknown HTTP event type: ${httpEvent}`);
		return true;
	}
	return false;
}
