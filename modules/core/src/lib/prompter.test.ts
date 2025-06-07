import { describe, it, expect } from 'vitest';
import { Prompter, readlinePrompt } from './prompter.js';

describe('Prompter', () => {
	it('calls subscribers in order and returns first non-undefined result', async () => {
		const prompter = new Prompter();
		const calls: string[] = [];
		prompter.subscribe(() => { calls.push('first'); return Promise.resolve('answer'); });
		prompter.subscribe(() => { calls.push('second'); return Promise.resolve('nope') });
		const result = await prompter.prompt({ message: 'What?' });
		expect(result).toBe('answer');
		expect(calls).toEqual(['first', 'second']);
	});
	it('returns undefined if all subscribers return undefined', async () => {
		const prompter = new Prompter();
		prompter.subscribe(() => Promise.resolve(undefined));
		prompter.subscribe(() => Promise.resolve(undefined));
		const result = await prompter.prompt({ message: 'What?' });
		expect(result).toBeUndefined();
	});
	it('unsubscribes default prompter', async () => {
		const prompter = new Prompter();
		prompter.unsubscribe(readlinePrompt);
		expect(prompter['subscribers']).toHaveLength(0);
	});
});
