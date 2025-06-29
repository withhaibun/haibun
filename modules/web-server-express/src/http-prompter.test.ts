import { describe, it, expect } from 'vitest';
import { HttpPrompter } from './http-prompter.js';
import { makePrompt } from '@haibun/core/build/lib/prompter.js';

describe('HttpPrompter', () => {
  it('resolves when handlePromptResponse is called', async () => {
    const prompter = new HttpPrompter();
    const prompt = makePrompt('What is your name?');
    const promise = prompter.prompt(prompt);
    // Find the promptId
    const pending = prompter.getPendingPrompts();
    expect(pending).toHaveLength(1);
    const promptId = pending[0].id;
    // Simulate a response
    prompter.resolve(promptId, 'Copilot');
    const result = await promise;
    expect(result).toBe('Copilot');
  });

  it('returns undefined if cancel is called before response', async () => {
    const prompter = new HttpPrompter();
    const prompt = makePrompt('Cancel me');
    const promise = prompter.prompt(prompt);
    const pending = prompter.getPendingPrompts();
    expect(pending).toHaveLength(1);
    const promptId = pending[0].id;
    prompter.cancel(promptId);
    const result = await promise;
    expect(result).toBeUndefined();
  });

  it('getPendingPrompts returns correct prompt info', () => {
    const prompter = new HttpPrompter();
    const prompt = makePrompt('Pending?');
    void prompter.prompt(prompt); // don't await
    const pending = prompter.getPendingPrompts();
    expect(pending).toHaveLength(1);
    expect(pending[0].message).toBe('Pending?');
  });
});
