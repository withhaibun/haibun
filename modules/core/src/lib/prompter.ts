import { TAnyFixme } from "./fixme.js";
import { ReadlinePrompter } from './readline-prompter.js';

export type TPrompt = { id: string; message: string; context?: TAnyFixme, options?: string[] };
export interface IPrompter {
	prompt(prompt: TPrompt): Promise<TPromptResponse>;
	cancel(id: string, reason?: string): void;
	resolve(id: string, value: TPromptResponse): void;
}

export type TPromptResponse = string | object | undefined;

export class Prompter {
	/**
	 * Map of outstanding prompts by ID. Each prompt is managed independently and can be resolved or cancelled by ID.
	 */
	private outstandingPrompts = new Map<string, { resolve: (value: TPromptResponse) => void, reject: (reason?: unknown) => void }>();
	private subscribers: IPrompter[];
	private readonly defaultPrompter: IPrompter;

	constructor(subscribers: IPrompter[] = [new ReadlinePrompter()]) {
		this.defaultPrompter = subscribers[0];
		this.subscribers = subscribers;
	}

	subscribe(p: IPrompter) {
		this.subscribers.push(p);
	}
	unsubscribe(p: IPrompter) {
		const typeName = p.constructor.name;
		this.subscribers = this.subscribers.filter(s => s.constructor.name !== typeName);
	}

	async prompt(prompt: TPrompt): Promise<TPromptResponse> {
		if (this.outstandingPrompts?.has?.(prompt.id)) {
			return undefined;
		}
		if (this.subscribers.length === 0) {
			return undefined;
		}
		let responded = 1;
		return await new Promise<TPromptResponse>((resolve) => {
			for (const subscriber of this.subscribers) {
				subscriber.prompt(prompt).then(result => {
					if (result !== undefined) {
						this.subscribers.forEach(s => s.cancel && s.cancel(prompt.id));
						resolve(result);
					} else {
						if (++responded === this.subscribers.length) {
							resolve(undefined);
						}
					}
				});
			}
		});
	}

	cancel(id: string, reason?: string) {
		this.outstandingPrompts.get(id)?.reject(reason);
		this.outstandingPrompts.delete(id);
	}

	resolve(id: string, value: TPromptResponse) {
		this.outstandingPrompts.get(id)?.resolve(value);
		this.outstandingPrompts.delete(id);
	}

	getDefaultPrompter() {
		return this.defaultPrompter;
	}
}

export function makePrompt(message: string, context?: TAnyFixme, options?: string[]): TPrompt {
	return { id: 'prompt-' + Math.random().toString(36).slice(2), message, context, options };
}
