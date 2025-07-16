import { Interface, createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

import { IPrompter, TPrompt, TPromptResponse } from './prompter.js';


export class ReadlinePrompter implements IPrompter {
	private rl?: Interface;
	private currentPromptId?: string;
	private history: string[] = [];

	async prompt(prompt: TPrompt) {
		if (!process.stdin.isTTY) {
			return undefined;
		}
		this.currentPromptId = prompt.id;
		this.rl = createInterface({
			input,
			output,
			history: this.history,
			historySize: 100,
			removeHistoryDuplicates: true
		});
		try {
			const answer = await this.rl.question(`${prompt.message} ${prompt.options?.join(', ') ?? ''}: `);
			// Add non-empty answers to history
			if (answer && answer.trim() && !this.history.includes(answer.trim())) {
				this.history.unshift(answer.trim());
				// Keep history size manageable
				if (this.history.length > 100) {
					this.history = this.history.slice(0, 100);
				}
			}
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
