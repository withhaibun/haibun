
// Copyright (c) Microsoft Corporation. All rights reserved.

import { arrayHasCallback, removeCallbackFromArray } from "./ports.js";

// Licensed under the MIT License.
export class PortDisconnect implements chrome.runtime.PortDisconnectEvent {
    public listeners: any[];
    public callbackForDisconnect: any[];

    constructor() {
        this.listeners = [];
        this.callbackForDisconnect = [];
    }

    public addListener(callback: any): void {
        this.listeners.push(callback);
        this.callbackForDisconnect.push(callback);
    }

    public getRules(ruleIdentifiers: any, callback?: any): void {
        throw new Error('Method not implemented.');
    }

    public hasListener(callback: (port: chrome.runtime.Port) => void): boolean {
        return arrayHasCallback(this.listeners, callback);
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
        this.listeners = removeCallbackFromArray(this.listeners, callback);
    }

    public hasListeners(): boolean {
        return this.listeners.length > 0;
    }

    public disconnect(port: any): void {
        this.listeners.forEach(listener => {
            listener(port);
        });
    }
}
