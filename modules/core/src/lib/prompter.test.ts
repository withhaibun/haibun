import { describe, it, expect } from 'vitest';
import { IPrompter, Prompter, TPromptResponse } from './prompter.js';
import { makePrompt } from './prompter.js';
import { ReadlinePrompter } from './readline-prompter.js';

class TestPrompter implements IPrompter {
	constructor(private answer: TPromptResponse) { }
	prompt = async () => Promise.resolve(this.answer);
	cancel(_id: string, _reason?: string) { }
	resolve(_id: string, _value: TPromptResponse) { }
}

describe('Prompter', () => {
	it('calls subscribers in order and returns first non-undefined result', async () => {
		const prompter = new Prompter();
		class CallsPrompter implements IPrompter {
			static calls = 0;
			prompt = async () => {
				CallsPrompter.calls++;
				return Promise.resolve(undefined);
			}
			cancel(_id: string, _reason?: string) { }
			resolve(_id: string, _value: TPromptResponse) { }
		}
		prompter.subscribe(new CallsPrompter());
		prompter.subscribe(new CallsPrompter());
		const result = await prompter.prompt(makePrompt('What?'));
		expect(result).toBe(undefined);
		expect(CallsPrompter.calls).toBe(2);
	});
	it('returns undefined if all subscribers return undefined', async () => {
		const prompter = new Prompter();
		prompter.subscribe(new TestPrompter(undefined));
		prompter.subscribe(new TestPrompter(undefined));
		const result = await prompter.prompt(makePrompt('What?'));
		expect(result).toBeUndefined();
	});
	it('unsubscribes default prompter', () => {
		const prompter = new Prompter();
		prompter.unsubscribe(prompter.getDefaultPrompter());
		expect(prompter['subscribers']).toHaveLength(0);
	});
});
