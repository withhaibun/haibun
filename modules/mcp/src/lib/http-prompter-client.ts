/**
 * HttpPrompterClient - HTTP client for accessing remote prompter service endpoints.
 * Used by MCP server tools to retrieve and respond to prompts via HTTP API.
 */
export class HttpPrompterClient {

	constructor(private httpBaseUrl: string, private accessToken?: string) {
		this.httpBaseUrl = httpBaseUrl;
	}

	private getHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json'
		};

		if (this.accessToken) {
			headers['Authorization'] = `Bearer ${this.accessToken}`;
		}

		return headers;
	}

	/**
	 * Get all pending prompts by calling the HTTP prompter endpoint
	 */
	async getPrompts() {
		const response = await fetch(`${this.httpBaseUrl}/prompts`, {
			headers: this.getHeaders()
		});
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		const responseData = await response.json();

		// Handle different response formats:
		// 1. Direct array: [prompt1, prompt2, ...]
		// 2. Wrapped object: { prompts: [prompt1, prompt2, ...] }
		if (Array.isArray(responseData)) {
			return responseData;
		} else if (responseData && Array.isArray(responseData.prompts)) {
			return responseData.prompts;
		} else {
			// Return empty array for unexpected formats
			return [];
		}
	}

	/**
	 * Respond to a prompt by calling the HTTP prompter endpoint
	 */
	async respondToPrompt(id: string, response: string) {
		try {
			const httpResponse = await fetch(`${this.httpBaseUrl}/prompts/${id}/respond`, {
				method: 'POST',
				headers: this.getHeaders(),
				body: JSON.stringify({ response }),
			});

			if (!httpResponse.ok) {
				throw new Error(`HTTP ${httpResponse.status}: ${httpResponse.statusText}`);
			}

			return await httpResponse.json();
		} catch (error) {
			console.warn('Failed to respond to prompt via HTTP prompter:', error);
			throw error;
		}
	}
}
