import { popupActions } from '../services/constants.js';
import Background from './Background.js';
import MockChrome from '../mock-chrome/MockChrome.js';

declare global {
  interface Window { chrome: typeof chrome; }
}

const mockChrome = <typeof chrome>(new MockChrome() as unknown);
window.chrome = mockChrome;

let bg;

beforeEach(() => {
  // bg = new Background(new LoggerWebsocketsClient());
  // bg.init();
})

describe('startRecording', () => {
  it('starts recording', async () => {
    await mockChrome.runtime.sendMessage({ action: popupActions.START_RECORDING })
  });
});

describe('stop', () => {
  it('stops recording', async () => {
    await mockChrome.runtime.sendMessage({ action: popupActions.STOP_RECORDING })
    // await this.generateCode()
  });
});
