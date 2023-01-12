import browser from '../services/browser.js'
import { popupActions, recordingControls } from '../services/constants.js'
import LoggerWebSocketsClient from "@haibun/context/build/websocket-client/LoggerWebSocketsClient.js";
import AbstractBackground from './AbstractBackground.js'

// http://www.softwareishard.com/blog/har-12-spec/#entries
export type TRequestResult = {
  // unique ID for request
  pageref: string,
  startedDateTime: string,
  time: number,
  request: any,
  response: any,
  cache: any,
  timings: {},
  serverIPAddress: string,
  connection: number,
  comment: string
}
export default class Background extends AbstractBackground {
  constructor(logger: LoggerWebSocketsClient) {
    super(logger);
  }

  async startRecording(toTabIndex: undefined | number) {
    this.handlers = {
      runtime: {
        onMessage: this.onMessage.bind(this),
      },
      webNavigation: {
        onBeforeNavigate: this.onBeforeNavigate.bind(this),
        onCompleted: this.onCompleted.bind(this),
      },
      webRequest: {
        onBeforeRequest: this.onBeforeRequest.bind(this),
      },
      tabs: {
        onActivated: this.onActivated.bind(this),
      },
      network: {
        onRequestFinished: this.onRequestFinished.bind(this),
      },
    }
    super.startRecording(toTabIndex);
    const { url: href } = (await browser.getActiveTab());
    this.sendControlMessage('startRecording', { href });
  }

  async recordCurrentUrl(href: string) {
    if (!this._handledGoto) {
      this.sendControlMessage('recordCurrentUrl', { href });
      this._handledGoto = true
    }
  }

  async recordCurrentViewportSize(value: { width: number, height: number }) {
    if (!this._handledViewPortSize) {
      this.sendControlMessage('viewportSize', { value });
      this._handledViewPortSize = true
    }
  }

  async recordNavigation() {
    this.sendControlMessage('navigation', {});
  }

  handleRecordingMessage({ control, href, value, coordinates }: any) {
    if (control === recordingControls.EVENT_RECORDER_STARTED) {
      this.badge.setText(this._badgeState)
    }

    if (control === recordingControls.GET_VIEWPORT_SIZE) {
      this.recordCurrentViewportSize(coordinates)
    }

    if (control === recordingControls.GET_CURRENT_URL) {
      this.recordCurrentUrl(href)
    }

    /*
    if (control === recordingControls.GET_SCREENSHOT) {
      this.recordScreenshot(value)
    }
    */
  }

  handlePopupMessage(msg: any) {
    console.log('\n\n________\nMESSAGE', msg);

    if (!msg.action) {
      return;
    }
    if (msg.action === popupActions.START_RECORDING) {
      this.startRecording(msg.payload ? parseInt(msg.payload, 10) : undefined)
    } else if (msg.action === popupActions.STOP_RECORDING) {
      browser.sendTabMessage({ action: popupActions.STOP_RECORDING })
      this.sendControlMessage(popupActions.STOP_RECORDING, {});
      this.stop()
    } else {
      this.logger.log('handlePopupMessage', msg);
    }
  }

  onRequestFinished(request: TRequestResult) {
    this.sendControlMessage('onRequestFinished', {
      serverIPAddress: request.serverIPAddress, pageref: request.pageref, time: request.time
    });
  };

  onActivated(activeInfo: any) {
    chrome.tabs.get(activeInfo.tabId, function (tab) {
      console.log(':::', tab);
    });
  }

  async onBeforeRequest({ url }: any) {
    this.sendControlMessage('onBeforeRequest', { url });
  }

  async onBeforeNavigate({ url }: any) {
    this.sendControlMessage('onBeforeNavigate', { url });
  }

  async onCompleted({ frameId }: any) {
    console.log('onCompleted', frameId);
    // this.toggleOverlay({ open: true, pause: this._isPaused })
    if (frameId === 0) {
      this.recordNavigation();
    }
    const where = await chrome.tabs.query({ active: true, currentWindow: true });
    await this.injectContentScript('webNavigation.onComplete', where[0].id!);
  }
}
