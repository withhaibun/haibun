const CONTENT_SCRIPT_PATH = './js/content.js'
type TTabWithId = chrome.tabs.Tab & { id: number };

export default {
  async getActiveTab(): Promise<TTabWithId> {
    const tab = await chrome.tabs.query({ active: true, currentWindow: true });
    return <TTabWithId>tab[0];
  },

  async sendTabMessage({ action, value = undefined, clean = undefined }: { action: string, value?: any, clean?: boolean }, id?: number) {
    const tabId = id !== undefined ? id : (await this.getActiveTab()).id;
    chrome.tabs.sendMessage(tabId, { action, value, clean })
  },

  async injectContentScript(tabId: number) {
    // if (tabId === undefined) {
    //   tabId = (await this.getActiveTab())?.id;
    // }
    const b = await chrome.scripting.executeScript(<any>{
      target: { tabId },
      injectImmediately: true,
      files: [CONTENT_SCRIPT_PATH]
    });
  }
}
