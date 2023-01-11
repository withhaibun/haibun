import { Helpers } from "./ports";


export class PortOnMessage implements chrome.runtime.PortMessageEvent {
    public listeners: any[];

    constructor() {
        this.listeners = [];
    }

    public addListener(callback: (message: Object, port: chrome.runtime.Port) => void): void {

        this.listeners.push(callback);
    }

    public getRules(ruleIdentifiers: any, callback?: any): void {
        throw new Error('Method not implemented.');
    }

    public hasListener(callback: (message: Object, port: chrome.runtime.Port) => void): boolean {
        return Helpers.arrayHasCallback(this.listeners, callback);
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

    public removeListener(callback: (message: Object, port: chrome.runtime.Port) => void): void {
        this.listeners = Helpers.removeCallbackFromArray(this.listeners, callback);
    }

    public hasListeners(): boolean {
        return this.listeners.length > 0;
    }

    public sendMessage(message: any): void {
        this.listeners.forEach(listener => {
            listener(message);
        });
    }
}
