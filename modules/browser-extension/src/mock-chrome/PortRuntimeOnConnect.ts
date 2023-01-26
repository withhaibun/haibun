import { TPortContext } from "./MockChrome.js";
import { arrayHasCallback, removeCallbackFromArray } from "./ports.js";

export class PortRuntimeOnConnect implements chrome.runtime.ExtensionConnectEvent {
    ctx: TPortContext;

    constructor(ctx: TPortContext) {
        this.ctx = ctx;
    }

    public addListener(callback: (port: chrome.runtime.Port) => void): void {
        this.ctx.listeners.push(callback);
    }

    public getRules(ruleIdentifiers: any, callback?: any): void {
        throw new Error('Method not implemented.');
    }

    public hasListener(callback: (port: chrome.runtime.Port) => void): boolean {
        return arrayHasCallback(this.ctx.listeners, callback);
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

    public removeListener(callback: (port: chrome.runtime.Port) => void): void {
        this.ctx.listeners = removeCallbackFromArray(this.ctx.listeners, callback);
    }

    public hasListeners(): boolean {
        return this.ctx.listeners.length > 0;
    }

    public sendMessage(message: any): void {
        this.ctx.listeners.forEach(listener => {
            listener(message);
        });
    }
}
