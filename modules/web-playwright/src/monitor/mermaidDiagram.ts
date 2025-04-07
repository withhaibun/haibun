import mermaid from 'mermaid';
import { TAnyFixme } from '@haibun/core/build/lib/defs.js';
import { TArtifactHTTPTrace, THTTPTraceContent } from '@haibun/core/build/lib/interfaces/logger.js';
import { shortenURI, shortenUserAgent } from '@haibun/core/build/lib/util/index.js';

// Helper function for sanitization
const sanitizeMermaidContent = (message: string): string => {
	let sanitized = message.replace(/"/g, "'"); // Replace double quotes
	// IMPORTANT: Escape semicolon FIRST to avoid breaking other entities
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
	private needsUpdate = false;
	private diagramLines: string[] = ['sequenceDiagram']; // Initialize with diagram type
	private pageNames: Record<string, string> = {};
	private pageCounter = 1;
	private participantAdded: Record<string, boolean> = {}; // Track added participants

	// Add participant declaration if not already added
	private addParticipant(alias: string, name: string) {
		if (!this.participantAdded[alias]) {
			this.diagramLines.splice(1, 0, `participant ${alias} as ${name}`); // Insert after 'sequenceDiagram'
			this.participantAdded[alias] = true;
		}
	}

	public processEvent(trace: THTTPTraceContent, httpEvent: TArtifactHTTPTrace['httpEvent'], filters = jsonFilters): void {
		this.needsUpdate = true; // Set flag immediately
		const requestingPage = trace.requestingPage;
		const requestingURL = trace.requestingURL;
		const method = trace.method;
		const status = trace.status;
		const statusText = trace.statusText;
		const headers = trace.headers;

		// Use URL hostname as the server participant
		let serverAlias = 'UnknownAlias'; // Default if URL is missing
		let serverName = 'Unknown';
		if (requestingURL) {
			try {
				const url = new URL(requestingURL);
				serverName = url.hostname;
				// Handle empty hostname (e.g., for about:blank)
				if (serverName) {
					serverAlias = serverName.replace(/[.-]/g, '');
					if (!serverAlias) {
						serverAlias = 'HostAlias'; // Fallback alias if replacement results in empty string
					}
				}
			} catch (e) {
				serverAlias = 'InvalidURLAlias';
			}
		}
		this.addParticipant(serverAlias, serverName);

		if (skipEvent(filters, httpEvent, serverName, trace)) {
			return;
		}

		if (requestingPage && requestingURL) {
			let pageAlias = this.pageNames[requestingPage];
			if (!pageAlias) {
				let pageName = `Browser Page ${this.pageCounter}`;
				let baseAlias = '';
				try {
					// Try to get hostname from the current URL for a better name
					const url = new URL(requestingURL);
					const hostname = url.hostname;
					if (hostname && requestingURL !== 'about:blank') {
						baseAlias = hostname.replace(/[.-]/g, '');
						if (!baseAlias) baseAlias = 'Host'; // Fallback if hostname becomes empty
						pageName = `${hostname} ${this.pageCounter}`;
					} else {
						// Fallback for about:blank or empty hostname
						baseAlias = 'Page';
					}
				} catch (e) {
					// Fallback for invalid URL
					baseAlias = 'Page';
				}
				// Ensure unique alias by appending counter
				pageAlias = `${baseAlias}${this.pageCounter}`;
				this.pageNames[requestingPage] = pageAlias;
				this.addParticipant(pageAlias, pageName);
				this.pageCounter++;
			}


			if (method) {
				const message = sanitizeMermaidContent(`${method} ${shortenURI(requestingURL)}`);
				this.diagramLines.push(`${pageAlias}->>${serverAlias}: ${message}`);
				if (headers && headers.referer) {
					const note = shortenURI(sanitizeMermaidContent(`Referer: ${headers.referer}`));
					this.diagramLines.push(`Note right of ${pageAlias}: ${note}`);
				}
				if (headers && headers["accept"]) {
					const note = sanitizeMermaidContent(`Accept: ${headers["accept"]}`);
					this.diagramLines.push(`Note right of ${pageAlias}: ${note}`);
				}
				if (headers && headers["content-type"]) {
					const note = sanitizeMermaidContent(`Content-type: ${headers['content-type']}`);
					this.diagramLines.push(`Note right of ${pageAlias}: ${note}`);
				}
			}

			if (status) {
				// Sanitize response message
				const message = sanitizeMermaidContent(`${status} ${statusText || ''}`);
				this.diagramLines.push(`${serverAlias}-->>${pageAlias}: ${message}`);
			}
		}
		// this.needsUpdate = true; // Moved to the beginning
	}

	public getDiagram(): string {
		return this.diagramLines.join("\n");
	}
	public async update() { // Make async
		// Only update the DOM and render if necessary
		if (!this.needsUpdate) {
			return;
		}

		const mermaidContainer = document.getElementById('sequence-diagram');
		if (mermaidContainer) {
			let diagramDefinition = ''; // Declare outside try
			try {
				diagramDefinition = this.getDiagram(); // Assign inside try

				mermaid.initialize({ maxTextSize: 900000 });
				// Ensure container is empty before rendering
				mermaidContainer.innerHTML = '';
				// Insert the diagram definition for Mermaid to process
				const insert = `<pre class="mermaid">${diagramDefinition}</pre>`;
				mermaidContainer.insertAdjacentHTML('beforeend', insert);

				await mermaid.run({ nodes: [mermaidContainer.querySelector('.mermaid')] });

				console.log("Mermaid diagram rendered.");
				this.needsUpdate = false; // Reset flag only after successful render
			} catch (e) {
				console.error("Failed Mermaid diagram definition:\n", diagramDefinition); // Log failing definition
				console.error("Error rendering Mermaid diagram:", e);
				const detailedError = (typeof e === 'object' && e !== null && 'str' in e) ? (e as TAnyFixme).str : null;
				const errorMessage = detailedError || (e instanceof Error ? e.message : String(e));
				mermaidContainer.innerHTML = `<pre>Error rendering Mermaid diagram:\n\n${errorMessage}\n\n--- Diagram Definition ---\n${diagramDefinition}</pre>`;
				// Optionally reset needsUpdate here too, or leave it true to retry later? Resetting for now.
				this.needsUpdate = false;
			}
		} else {
			console.warn("Sequence diagram container not found.");
			// Reset flag even if container not found to avoid repeated attempts
			this.needsUpdate = false;
		}
	}
}
export function skipEvent(filters, httpEvent, serverName, { requestingPage, requestingURL, method, status, statusText, headers }: THTTPTraceContent) {
	if (!serverName) {
		console.info('No server name found, skipping result.');
		return true;
	}
	if (requestingURL === 'about:blank') {
		console.info('Requesting URL is about:blank, skipping result.');
		return true;
	}
	if (httpEvent === 'request') {
		if (headers && headers.accept) {
			const acceptHeader = headers.accept;
			if (!filters.request.accept.some(filterValue => acceptHeader.includes(filterValue))) {
				console.info('qx', acceptHeader, filters.request.accept);
				return true;
			} else {
				console.info('qY', acceptHeader, filters.request.accept);
			}
		}
	} else if (httpEvent === 'response') {
		if (headers && headers['content-type']) {
			const contentTypeHeader = headers['content-type'];
			if (!filters.response.type.some(filterValue => contentTypeHeader.includes(filterValue))) {
				console.info('px', contentTypeHeader);
				return true;
			} else {
				console.info('pY', contentTypeHeader);
			}
		}
	} else {
		console.warn(`Unknown HTTP event type: ${httpEvent}`);
		return true;
	}
	return false;
}
