// https://www.youtube.com/watch?v=xlJddufkgJg

import { ILoggerKeepAlive } from "@haibun/core/build/lib/interfaces/logger.js";

export class ChromeExtensionKeepAlive implements ILoggerKeepAlive {
    lifeline: chrome.runtime.Port | undefined;
    async start() {
        this.keepAlive();

        chrome.runtime.onConnect.addListener((port: chrome.runtime.Port): void => {
            if (port.name === 'keepAlive') {
                this.lifeline = port;
                setTimeout(() => this.keepAliveForced(), 295e3); // 5 minutes minus 5 seconds
                port.onDisconnect.addListener(() => this.keepAliveForced);
            }
        });
    }
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    async stop() {
    }

    async keepAliveForced() {
        this.lifeline?.disconnect();
        this.lifeline = undefined;
        await this.keepAlive();
    }

    async keepAlive() {
        if (this.lifeline) return;
        for (const tab of await chrome.tabs.query({ url: '*://*/*' })) {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id! },
                func: () => chrome.runtime.connect({ name: 'keepAlive' }),
            });
            chrome.tabs.onUpdated.removeListener(() => this.retryOnTabUpdate);
            return;
        }
        chrome.tabs.onUpdated.addListener(() => this.retryOnTabUpdate);
    }

    async retryOnTabUpdate(tabId: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) {
        if (info.url && /^(file|https?):/.test(info.url)) {
            this.keepAlive();
        }
    }
}