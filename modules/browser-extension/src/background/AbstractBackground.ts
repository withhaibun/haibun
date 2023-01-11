import Badge from '../services/badge'
import browser from '../services/browser'
import storage from '../services/storage'
// import { overlayActions } from '../modules/overlay/constants'
import { headlessActions } from '../modules/code-generator/constants'
import LoggerWebSocketsClient from "@haibun/context/build/websocket-client/LoggerWebSocketsClient";
import { TWithContext } from '@haibun/context/build/Context'

export type THandlers = {
  runtime: {
    onMessage: (message: any, sender: any, sendResponse: (response: any) => void) => void,
  },
  webNavigation: {
    onBeforeNavigate: (details: any) => void,
    onCompleted: (details: any) => void
  },
  webRequest: {
    onBeforeRequest: (details: any) => void
  },
  tabs: {
    onActivated: (activeInfo: any) => void
  },
  network: {
    onRequestFinished: (request: any) => void
  }
}

export default abstract class AbstractBackground {
  handlers?: THandlers = undefined;
  _recording: any[]
  // overlayHandler: any
  _badgeState: string
  _isPaused: boolean
  _handledGoto: boolean
  _handledViewPortSize: boolean
  logger: LoggerWebSocketsClient;
  badge: Badge

  constructor(logger: LoggerWebSocketsClient) {
    this.badge = new Badge();
    this.logger = logger;
    this._recording = []

    // this.overlayHandler = null

    this._badgeState = ''
    this._isPaused = false

    // Some events are sent double on page navigations to simplify the event recorder.
    // We keep some simple state to disregard events if needed.
    this._handledGoto = false
    this._handledViewPortSize = false
  }

  sendControlMessage(type: string, value: TWithContext) {
    this.logger.log(type, { control: type, '@context': '#haibun/control', ...value });
  }

  init() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => this.handlePopupMessage(request));
  }

  async startRecording(toTabIndex: undefined | number) {
    await this.cleanUp()

    this._badgeState = ''
    this._handledGoto = false
    this._handledViewPortSize = false

    if (toTabIndex) {
      console.log('>>>', await chrome.tabs.query({ index: toTabIndex, }));
      const tabId = (await chrome.tabs.query({ index: toTabIndex, }))[0]?.id;
      await this.injectContentScript('startRecording', tabId!);
      chrome.tabs.update(tabId!, { active: true });
    }

    for (const [type, value] of Object.entries(this.handlers!)) {
      for (const [name, handler] of Object.entries(value)) {
        console.log('adding', name, (chrome as any)[type][name]);

        (chrome as any)[type][name].addListener(handler);
      }
    }
    // this.toggleOverlay({ open: true, clear: true })

    // this.overlayHandler = this.handleOverlayMessage.bind(this)

    // chrome.runtime.onMessage.addListener(this.overlayHandler)

    this.badge.start()
  }
  injectContentScript(reason: string, tabId: number) {
    this.logger.log(reason, <TWithContext>{ '@context': '#haibun/info', 'info': `inject ${reason}` });
    browser.injectContentScript(tabId);
  }

  async stop() {
    await this.logger.disconnect();
    this._badgeState = this._recording.length > 0 ? '1' : ''

    for (const [type, value] of Object.entries(this.handlers!)) {
      for (const [name, handler] of Object.entries(value)) {
        (chrome as any)[type][name].removeListener(handler);
      }
    }
    this.handlers = undefined;
    this.badge.stop(this._badgeState)
    storage.set({ recording: this._recording })
  }

  pause() {
    this.badge.pause()
    this._isPaused = true
  }

  unPause() {
    this.badge.start()
    this._isPaused = false
  }

  cleanUp() {
    this._recording = []
    this._isPaused = false
    this.badge.reset()

    return new Promise(function (resolve) {
      chrome.storage.local.remove('recording', () => resolve(true))
    })
  }

  abstract recordCurrentUrl(href: string): Promise<void>;

  abstract recordCurrentViewportSize(value: { width: number, height: number }): Promise<void>;

  abstract recordNavigation(): Promise<void>;

  /*
  recordScreenshot(value: any) {
    this.handleMessage({
      selector: undefined,
      value,
      action: headlessActions.SCREENSHOT,
    })
  }
  */

  onMessage(msg: any, sender?: any) {
    if (msg.control) {
      return this.handleRecordingMessage(msg /*, sender*/)
    }

    if (msg.action === 'ERROR') {
      setTimeout(() => {
        this.badge.setText('ERR')
        chrome.runtime.sendMessage(msg);
      }, 1000);
    }

    console.log('onMessage', msg, sender);
    setTimeout(() => {
      this.badge.setText('WAIT')
      chrome.runtime.sendMessage(msg);
    }, 1000);

    // NOTE: To account for clicks etc. we need to record the frameId
    // and url to later target the frame in playback
    msg.frameId = sender?.frameId;
    msg.frameUrl = sender?.url;

    if (!this._isPaused) {
      // this.logger.log('handleMessage', msg);
      // this._recording.push(msg)
      // storage.set({ recording: this._recording })
    }
  }

  /*
  async handleOverlayMessage({ control }: any) {
    if (!control) {
      return
    }
 
    if (control === overlayActions.RESTART) {
      chrome.storage.local.set({ restart: true })
      chrome.storage.local.set({ clear: false })
      chrome.runtime.onMessage.removeListener(this.overlayHandler)
      this.stop()
      this.cleanUp()
      this.startRecording()
    }
 
    if (control === overlayActions.CLOSE) {
      this.toggleOverlay()
      chrome.runtime.onMessage.removeListener(this.overlayHandler)
    }
 
    if (control === overlayActions.COPY) {
      const options = (await storage.get('options'))?.options || {};
      const generator = new CodeGenerator(options)
      const code = generator.generate(this._recording)
 
      browser.sendTabMessage({
        action: 'CODE',
        value: code.haibun
      })
    }
 
    if (control === overlayActions.STOP) {
      chrome.storage.local.set({ clear: true })
      chrome.storage.local.set({ pause: false })
      chrome.storage.local.set({ restart: false })
      this.stop()
    }
 
    if (control === overlayActions.UNPAUSE) {
      chrome.storage.local.set({ pause: false })
      this.unPause()
    }
 
    if (control === overlayActions.PAUSE) {
      chrome.storage.local.set({ pause: true })
      this.pause()
    }
 
    // TODO: the next 3 events do not need to be listened in background
    // content script controller, should be able to handle that directly from overlay
    if (control === overlayActions.CLIPPED_SCREENSHOT) {
      browser.sendTabMessage({ action: overlayActions.TOGGLE_SCREENSHOT_CLIPPED_MODE })
    }
 
    if (control === overlayActions.FULL_SCREENSHOT) {
      browser.sendTabMessage({ action: overlayActions.TOGGLE_SCREENSHOT_MODE })
    }
 
    if (control === overlayActions.ABORT_SCREENSHOT) {
      browser.sendTabMessage({ action: overlayActions.CLOSE_SCREENSHOT_MODE })
    }
  }
  */

  abstract handleRecordingMessage({ control, href, value, coordinates }: any): void;

  abstract handlePopupMessage(msg: any): void;

  abstract onCompleted({ frameId }: any): Promise<void>;

  /*
  // TODO: Use a better naming convention for this arguments
  toggleOverlay({ open = false, clear = false, pause = false } = {}) {
    browser.sendTabMessage({ action: overlayActions.TOGGLE_OVERLAY, value: { open, clear, pause } })
  }
  */
}
