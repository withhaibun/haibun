import { describe, it, expect } from 'vitest';
import { IPrompter, Prompter, ReadlinePrompter } from './prompter.js';

class TestPrompter implements IPrompter {
	constructor(private answer) { }
	prompt = async () => Promise.resolve(this.answer);
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
		}
		prompter.subscribe(new CallsPrompter());
		prompter.subscribe(new CallsPrompter());
		const result = await prompter.prompt({ message: 'What?' });
		expect(result).toBe(undefined);
		expect(CallsPrompter.calls).toBe(2);
	});
	it('returns undefined if all subscribers return undefined', async () => {
		const prompter = new Prompter();
		prompter.subscribe(new TestPrompter(undefined));
		prompter.subscribe(new TestPrompter(undefined));
		const result = await prompter.prompt({ message: 'What?' });
		expect(result).toBeUndefined();
	});
	it('unsubscribes default prompter', () => {
		const prompter = new Prompter();
		prompter.unsubscribe(new ReadlinePrompter());
		expect(prompter['subscribers']).toHaveLength(0);
	});
});
