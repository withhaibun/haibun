import { describe, it, expect } from 'vitest';

import MockChrome from './MockChrome.js';
const mockChrome = new MockChrome();

describe.skip('MockChrome', () => {
    it('addListener', async () => {
        const listenerPromise = new Promise<void>((resolve) => {
            mockChrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
                expect(message).toEqual({ action: 'test' });
                resolve();
            });
        });
        await listenerPromise

        await mockChrome.runtime.sendMessage({ action: 'test' });
    }, 500)
})