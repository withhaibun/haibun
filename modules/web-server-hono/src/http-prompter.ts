import { BasePromptManager } from "@haibun/core/lib/base-prompt-manager.js";
import type { TWorld } from "@haibun/core/lib/execution.js";

interface PendingPrompt {
	id: string;
	message: string | undefined;
	context: Record<string, unknown> | undefined;
	options: string[] | undefined;
	timestamp: number | undefined;
	age: number;
}

/**
 * HTTP-based prompter that responds to prompt requests via HTTP API
 */
export class HttpPrompter extends BasePromptManager {
	private readonly world: TWorld;

	constructor(world: TWorld) {
		super();
		this.world = world;
		if (this.world.prompter?.subscribe) {
			this.world.prompter.subscribe(this);
		}
	}

	protected showPrompt(_: unknown): void {
		/* noop */
	}
	protected hidePrompt(_: string): void {
		/* noop */
	}

	/**
	 * Get all pending prompts for HTTP API
	 */
	getPendingPrompts(): PendingPrompt[] {
		return Array.from(this.outstandingPrompts.entries()).map(([id, data]) => ({
			id,
			message: data.prompt?.message,
			context: data.prompt?.context as Record<string, unknown> | undefined,
			options: data.prompt?.options,
			timestamp: data.timestamp,
			age: Date.now() - (data.timestamp ?? 0),
		}));
	}
}
