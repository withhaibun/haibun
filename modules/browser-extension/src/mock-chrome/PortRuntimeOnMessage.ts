import { TPortContext } from "./MockChrome";
import { Helpers } from "./ports";

export type TAddListenerCallback = (message: any, sender: chrome.runtime.MessageSender, sendResponse?: any) => void
export type THasListenerCallback = (message: any, sender: chrome.runtime.MessageSender, sendResponse?: any) => void


export class PortRuntimeOnMessage implements chrome.runtime.ExtensionMessageEvent {
    ctx: TPortContext;

    constructor(ctx: TPortContext) {
        this.ctx = ctx;
    }

    public addListener(callback: TAddListenerCallback): void {
        this.ctx.listeners.push(callback);
    }

    public getRules(ruleIdentifiers: any, callback?: any): void {
        throw new Error('Method not implemented.');
    }

    public hasListener(callback: THasListenerCallback): boolean {
        return false;
    }

    public removeRules(ruleIdentifiers?: any, callback?: any): void {
        throw new Error('Method not implemented.');
    }

    public addRules(
        rules: chrome.events.Rule[],
        callback?: (rules: chrome.events.Rule[]) => void
    ): void {
        throw new Error('Method not implemented.');
    }

    public removeListener(callback: (message: any, sender: chrome.runtime.MessageSender, sendResponse: any) => void): void {
        this.ctx.listeners = Helpers.removeCallbackFromArray(this.ctx.listeners, callback);
    }

    public hasListeners(): boolean {
        return this.ctx.listeners.length > 0;
    }

    public sendMessage(message: any): void {
        this.ctx.listeners.forEach((listener) => {
            listener(message);
        });
    }
}
