import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

import { TAnyFixme } from "./fixme.js";

export type TPrompt = { message: string; context?: TAnyFixme };
export interface IPrompter {
	(prompt: TPrompt): Promise<TPromptResponse>;
}

export type TPromptResponse = string | object | undefined;

export const readlinePrompt: IPrompter = async (prompt: TPrompt) => {
	const rl = createInterface({ input, output });
	const answer = await rl.question(prompt.message ?? 'Press Enter to continue...');
	rl.close();
	return answer;
};

export class Prompter {
	private subscribers: Array<(prompt: TPrompt) => Promise<TPromptResponse>> = [readlinePrompt];

	subscribe(fn: (prompt: TPrompt) => Promise<TPromptResponse>) {
		this.subscribers.push(fn);
	}
	unsubscribe(fn: (prompt: TPrompt) => Promise<TPromptResponse>) {
		this.subscribers = this.subscribers.filter(f => f !== fn);
	}
	async prompt(prompt: TPrompt): Promise<TPromptResponse> {
		let responded = 1;
		return await new Promise<TPromptResponse>((resolve) => {
			for (const fn of this.subscribers) {
				void fn(prompt).then(result => {
					if (result !== undefined) {
						resolve(result);
					} else {
						if (++responded === this.subscribers.length) {
							resolve(undefined);
						}
					}
				})
			}
		});
	}
}
