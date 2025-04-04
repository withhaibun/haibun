import { TPlaywrightTraceEvent } from "../PlaywrightEvents.js";

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

	public processEvent(event: TPlaywrightTraceEvent): void {
		const content = event.content;
		const requestingPage = content.requestingPage;
		const requestingURL = content.requestingURL;
		const method = content.method;
		const status = content.status;
		const statusText = content.statusText;
		const headers = content.headers;

		// Use URL hostname as the server participant
		let serverAlias = 'Server';
		let serverName = 'Server';
		if (requestingURL) {
			try {
				const url = new URL(requestingURL);
				serverName = url.hostname;
				// Create a simple alias (e.g., remove dots)
				serverAlias = serverName.replace(/[.-]/g, ''); // Corrected regex
				this.addParticipant(serverAlias, serverName);
			} catch (e) {
				// Invalid URL, use default server name
				this.addParticipant(serverAlias, serverName);
			}
		} else {
			this.addParticipant(serverAlias, serverName);
		}


		if (requestingPage && requestingURL) {
			let pageAlias = this.pageNames[requestingPage];
			if (!pageAlias) {
				pageAlias = `Page${this.pageCounter}`;
				this.pageNames[requestingPage] = pageAlias;
				this.addParticipant(pageAlias, `Browser Page ${this.pageCounter}`); // Add participant declaration
				this.pageCounter++;
			}


			if (method) {
				// Sanitize message content for Mermaid
				const message = `${method} ${requestingURL}`.replace(/[:]/g, ''); // Basic sanitization
				this.diagramLines.push(`${pageAlias}->>${serverAlias}: ${message}`);
				if (headers && headers.referer) {
					const note = `Referer: ${headers.referer}`.replace(/[:]/g, '');
					this.diagramLines.push(`Note right of ${pageAlias}: ${note}`);
				}
				// more notes, e.g., User-Agent
				/*
if (headers && headers["user-agent"]) {
						const note = `User-Agent: ${headers["user-agent"]}`.replace(/[:]/g, '');
	this.diagramLines.push(`Note right of ${pageAlias}: ${note}`);
}
				*/
			}

			if (status) {
				const message = `${status} ${statusText || ''}`.replace(/[:]/g, '');
				this.diagramLines.push(`${serverAlias}-->>${pageAlias}: ${message}`);
			}
		}
		this.needsUpdate = true;
	}

	public getDiagram(): string {
		return this.diagramLines.join("\n");
	}
	public update() {
		const mermaidContainer = document.getElementById('sequence-diagram');
		if (mermaidContainer) {
			try {
				const diagramDefinition = this.getDiagram();
				// Ensure container is empty before rendering
				mermaidContainer.innerHTML = '';
				// Insert the diagram definition for Mermaid to process
				const insert = `<pre class="mermaid">${diagramDefinition}</pre>`;
				mermaidContainer.insertAdjacentHTML('beforeend', insert);

				// Re-run Mermaid initialization for the updated content
				// await mermaid.run({ nodes: [mermaidContainer.querySelector('.mermaid')] });


				console.log("Mermaid diagram updated.");
			} catch (e) {
				console.error("Error rendering Mermaid diagram:", e);
				mermaidContainer.innerHTML = `<pre>Error rendering Mermaid diagram:\n${e.message}</pre>`;
			}
		}
		this.needsUpdate = false;
	}
}
