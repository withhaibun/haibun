import { createInterface, Interface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

import { TAnyFixme } from "./fixme.js";

export type TPrompt = { message: string; context?: TAnyFixme, options?: string[] };
export interface IPrompter {
	prompt(prompt: TPrompt): Promise<TPromptResponse>;
	cancel?(): void
}

export type TPromptResponse = string | object | undefined;

export class ReadlinePrompter implements IPrompter {
	rl: Interface;
	async prompt(prompt: TPrompt) {
		this.rl = createInterface({ input, output });
		const answer = await this.rl.question(`${prompt.message} ${prompt.options ? prompt.options.join(', ') : ''}: `);
		this.rl.close();
		return answer;
	}
	cancel() {
		this?.rl.close();
	}
}

export class Prompter {
	private subscribers: IPrompter[] = [new ReadlinePrompter()];

	subscribe(p: IPrompter) {
		this.subscribers.push(p);
	}
	unsubscribe(p: IPrompter) {
		this.subscribers = this.subscribers.filter(s => s.constructor.name !== p.constructor.name);
	}
	async prompt(prompt: TPrompt): Promise<TPromptResponse> {
		let responded = 1;
		return await new Promise<TPromptResponse>((resolve) => {
			for (const subscriber of this.subscribers) {
				void subscriber.prompt(prompt).then(result => {
					if (result !== undefined) {
						this.subscribers.forEach(subscriber => subscriber.cancel && subscriber.cancel());
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
