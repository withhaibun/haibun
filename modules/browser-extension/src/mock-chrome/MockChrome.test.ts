import MockChrome from './MockChrome.js';

const mockChrome = new MockChrome();

describe.skip('MockChrome', () => {
    it('addListener', async (done) => {
        mockChrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            expect(message).toEqual({ action: 'test' });
            done();
        });
        await mockChrome.runtime.sendMessage({ action: 'test' });
    }, 500)
})