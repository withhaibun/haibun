import { describe, it, expect, vi } from 'vitest';
import { HttpClientPrompter } from './http-client-prompter.js';


describe('HttpClientPrompter', () => {
  const serverUrl = 'http://localhost:12370';
  const accessToken = 'test-subscription-token-456';

  it('can poll for prompts and respond', async () => {
    // Mock fetch to simulate server response
    let fetchCount = 0;
    globalThis.fetch = vi.fn(async (url) => {
      fetchCount++;
      if (url.includes('/prompts')) {
        return new Response(JSON.stringify({ prompts: [{ id: 'test-id', response: 'client-response' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('', { status: 404 });
    });
    const prompter = new HttpClientPrompter(serverUrl, accessToken);
    const prompt = { id: 'test-id', message: 'Test prompt from client', response: 'client-response' };
    const result = await prompter.prompt(prompt);
    expect(result).toBe('client-response');
    expect(fetchCount).toBeGreaterThan(0);
  });

  it('can cancel pending prompts', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ prompts: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));
    const prompter = new HttpClientPrompter(serverUrl, accessToken);
    const prompt = { id: 'test-cancel', message: 'Prompt to cancel', response: 'should-not-resolve' };
    const promise = prompter.prompt(prompt);
    prompter.cancel('test-cancel');
    const result = await promise;
    expect(result).toBeUndefined();
  });
});
