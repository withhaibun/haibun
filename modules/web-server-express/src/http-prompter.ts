import { BasePromptManager } from '@haibun/core/build/lib/base-prompt-manager.js';
import { TWorld } from '@haibun/core/build/lib/defs.js';

/**
 * HTTP-based prompter that responds to prompt requests via HTTP API
 */
export class HttpPrompter extends BasePromptManager {
	private world: TWorld;

	constructor(world?: TWorld) {
		super();
		this.world = world;
		if (this.world && this.world.prompter && this.world.prompter.subscribe) {
			this.world.prompter.subscribe(this);
		}
	}
	protected showPrompt(_: unknown): void { }
	protected hidePrompt(_: string): void { }

	// getPendingPrompts for HTTP API
	getPendingPrompts() {
		return Array.from(this.outstandingPrompts.entries()).map(([id, data]) => ({
			id,
			message: data.prompt?.message,
			context: data.prompt?.context,
			options: data.prompt?.options,
			timestamp: data.timestamp,
			age: Date.now() - (data.timestamp || 0)
		}));
	}
}
