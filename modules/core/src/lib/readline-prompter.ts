import { Interface, createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

import { IPrompter, TPrompt, TPromptResponse } from './prompter.js';


export class ReadlinePrompter implements IPrompter {
	private rl?: Interface;
	private currentPromptId?: string;
	async prompt(prompt: TPrompt) {
		if (!process.stdin.isTTY) {
			return undefined;
		}
		this.currentPromptId = prompt.id;
		this.rl = createInterface({ input, output });
		try {
			const answer = await this.rl.question(`${prompt.message} ${prompt.options?.join(', ') ?? ''}: `);
			return answer;
		} finally {
			this.rl.close();
		}
	}
	cancel(id: string, _reason?: string) {
		if (this.currentPromptId === id) {
			this.rl?.close();
		}
	}
	resolve(_id: string, _value: TPromptResponse) {
		// No-op for readline, handled by prompt promise
	}
}
