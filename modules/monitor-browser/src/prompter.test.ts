
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSocketPrompter } from './prompter.js';
import { ITransport } from './transport.js';

describe('WebSocketPrompter', () => {
  let prompter: WebSocketPrompter;
  let mockTransport: ITransport;
  let messageHandler: (data: any) => void;

  beforeEach(() => {
    mockTransport = {
      send: vi.fn(),
      onMessage: vi.fn((handler) => {
        messageHandler = handler;
      })
    };
    prompter = new WebSocketPrompter(mockTransport);
  });

  it('subscribes to transport messages', () => {
    expect(mockTransport.onMessage).toHaveBeenCalled();
  });

  it('sends prompt message on prompt()', async () => {
    const prompt = { id: 'p1', message: 'test' };
    prompter.prompt(prompt);
    expect(mockTransport.send).toHaveBeenCalledWith({ type: 'prompt', prompt });
  });

  it('resolves prompt promise when receiving response', async () => {
    const prompt = { id: 'p1', message: 'test' };
    const promptPromise = prompter.prompt(prompt);

    // Simulate response from client
    messageHandler({ type: 'response', id: 'p1', value: 'response_value' });

    const result = await promptPromise;
    expect(result).toBe('response_value');
  });

  it('handles multiple prompts', async () => {
    const p1 = prompter.prompt({ id: '1', message: 'one' });
    const p2 = prompter.prompt({ id: '2', message: 'two' });

    messageHandler({ type: 'response', id: '2', value: 'res2' });
    expect(await p2).toBe('res2');

    messageHandler({ type: 'response', id: '1', value: 'res1' });
    expect(await p1).toBe('res1');
  });

  it('sends cancel message on cancel()', () => {
    prompter.prompt({ id: 'p1', message: 'test' });
    prompter.cancel('p1', 'reason');
    expect(mockTransport.send).toHaveBeenCalledWith({ type: 'cancel', id: 'p1', reason: 'reason' });
  });

  it('resolves prompt on resolve() call from server-side', async () => {
    // This simulates a server-side resolution (e.g. timeout or other logic)
    const promptPromise = prompter.prompt({ id: 'p1', message: 'test' });

    prompter.resolve('p1', 'resolved_locally');
    expect(mockTransport.send).toHaveBeenCalledWith({ type: 'resolve', id: 'p1', value: 'resolved_locally' });

    expect(await promptPromise).toBe('resolved_locally');
  });
});
