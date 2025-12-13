
import { IPrompter, TPrompt, TPromptResponse } from '@haibun/core/lib/prompter.js';
import { ITransport } from './transport.js';

export class WebSocketPrompter implements IPrompter {
  private transport: ITransport;
  private resolveMap = new Map<string, (value: TPromptResponse) => void>();

  constructor(transport: ITransport) {
    this.transport = transport;
    this.transport.onMessage((data: any) => {
      if (data.type === 'response' && data.id) {
        const resolve = this.resolveMap.get(data.id);
        if (resolve) {
          resolve(data.value);
          this.resolveMap.delete(data.id);
        }
      }
    });
  }

  async prompt(prompt: TPrompt): Promise<TPromptResponse> {
    this.transport.send({ type: 'prompt', prompt });
    return new Promise((resolve) => {
      this.resolveMap.set(prompt.id, resolve);
    });
  }

  cancel(id: string, reason?: string) {
    this.transport.send({ type: 'cancel', id, reason });
    this.resolveMap.delete(id);
  }

  resolve(id: string, value: TPromptResponse) {
    this.transport.send({ type: 'resolve', id, value });
    const resolve = this.resolveMap.get(id);
    if (resolve) {
      resolve(value);
      this.resolveMap.delete(id);
    }
  }
}
