import mermaid from 'mermaid';
import { TAnyFixme } from '@haibun/core/build/lib/defs.js';
import { THTTPTraceContent } from '@haibun/core/build/lib/interfaces/logger.js';

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

	public processEvent(trace: THTTPTraceContent): void {
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
				if (!serverName) {
					serverName = 'Internal';
					serverAlias = 'InternalAlias';
				} else {
					// Create a simple alias from non-empty hostname
					serverAlias = serverName.replace(/[.-]/g, '');
					// Ensure alias is not empty after replacement (e.g., if hostname was just '.')
					if (!serverAlias) {
						serverAlias = 'HostAlias'; // Fallback alias if replacement results in empty string
					}
				}
			} catch (e) {
				// Invalid URL
				serverName = 'Invalid URL';
				serverAlias = 'InvalidURLAlias';
			}
		}
		// Add the determined participant (Unknown, Internal, HostAlias, InvalidURLAlias, or derived)
		this.addParticipant(serverAlias, serverName);


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
				// Sanitize message content for Mermaid using the helper function
				const message = sanitizeMermaidContent(`${method} ${requestingURL}`);
				this.diagramLines.push(`${pageAlias}->>${serverAlias}: ${message}`);
				if (headers && headers.referer) {
					const note = sanitizeMermaidContent(`Referer: ${headers.referer}`);
					this.diagramLines.push(`Note right of ${pageAlias}: ${note}`);
				}
				// more notes, e.g., User-Agent
				if (headers && headers["user-agent"]) {
					// Sanitize user-agent note
					// Use sanitizeMermaidNote for note content
					const note = sanitizeMermaidContent(`User-Agent: ${headers["user-agent"]}`);
					this.diagramLines.push(`Note right of ${pageAlias}: ${note}`);
				}
			}

			if (status) {
				// Sanitize response message
				const message = sanitizeMermaidContent(`${status} ${statusText || ''}`);
				this.diagramLines.push(`${serverAlias}-->>${pageAlias}: ${message}`);
			}
		}
		this.needsUpdate = true;
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
				// Ensure container is empty before rendering
				mermaidContainer.innerHTML = '';
				// Insert the diagram definition for Mermaid to process
				const insert = `<pre class="mermaid">${diagramDefinition}</pre>`;
				mermaidContainer.insertAdjacentHTML('beforeend', insert);

				// Render the diagram using mermaid
				await mermaid.run({ nodes: [mermaidContainer.querySelector('.mermaid')] });

				console.log("Mermaid diagram rendered.");
				this.needsUpdate = false; // Reset flag only after successful render
			} catch (e) {
				console.error("Failed Mermaid diagram definition:\n", diagramDefinition); // Log failing definition
				console.error("Error rendering Mermaid diagram:", e);
				// Display error in the container
				// Check if 'e' is an object and has 'str' property before accessing
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
