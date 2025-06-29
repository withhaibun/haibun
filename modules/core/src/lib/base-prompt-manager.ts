import { TPrompt, TPromptResponse, IPrompter } from './prompter.js';

export abstract class BasePromptManager implements IPrompter {
    protected outstandingPrompts = new Map<string, { resolve: (value: TPromptResponse) => void, reject: (reason?: unknown) => void, prompt?: TPrompt, timestamp?: number }>();

    protected abstract showPrompt(prompt: TPrompt): void;
    protected abstract hidePrompt(id: string): void;

    public getOutstandingPrompts() {
        return this.outstandingPrompts;
    }

    async prompt(prompt: TPrompt): Promise<TPromptResponse> {
        if (this.outstandingPrompts.has(prompt.id)) {
            return undefined;
        }
        this.showPrompt(prompt);
        return new Promise<TPromptResponse>((resolve, reject) => {
            this.outstandingPrompts.set(prompt.id, { resolve, reject, prompt, timestamp: Date.now() });
        });
    }

    resolve(id: string, value: TPromptResponse) {
        this.outstandingPrompts.get(id)?.resolve(value);
        this.outstandingPrompts.delete(id);
        this.hidePrompt(id);
    }

    cancel(id: string, _reason?: string) {
        this.outstandingPrompts.get(id)?.resolve(undefined);
        this.outstandingPrompts.delete(id);
        this.hidePrompt(id);
    }
}
