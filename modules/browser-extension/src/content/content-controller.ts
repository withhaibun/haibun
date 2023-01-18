// import { overlayActions } from '../modules/overlay/constants'
import { popupActions, /*recordingControls*/ } from '../services/constants.js'

import storage from '../services/storage.js'
import { Store } from '../services/Store.js';
import Recorder from '../modules/recorder/index.js';

// import Capture from '../modules/capture'
export default class ContentController {
  backgroundListener?: any;
  store: Store
  capture: null
  recorder: Recorder;
  // overlay: any
  // recorder: any
  constructor({ store, /*overlay, */ recorder, }: { store: Store, recorder: Recorder }) {
    this.backgroundListener = null;

    this.store = store
    this.capture = null
    // this.overlay = overlay
    this.recorder = recorder
  }

  async init() {
    const { options } = await storage.get(['options'])

    const { dataAttribute } = options?.code || {}

    this.store.commit('setDataAttribute', dataAttribute)

    // this.recorder.init(() => this.listenBackgroundMessages())
    this.listenBackgroundMessages();
  }

  static log(msg: string) {
    chrome.devtools.inspectedWindow.eval(`console.log(CC< '${msg}')`);
  }
  listenBackgroundMessages() {
    this.backgroundListener = this.backgroundListener || this.handleBackgroundMessages.bind(this);
    chrome.runtime.onMessage.addListener(this.backgroundListener)
  }

  errorMessage(message: string) {
    ContentController.log(message);
  }

  async handleBackgroundMessages(msg: any) {
    ContentController.log(`handleBackgroundMessages ${JSON.stringify(msg)}`);

    if (!msg?.action) {
      return
    }

    switch (msg.action) {

      /*
      case overlayActions.TOGGLE_SCREENSHOT_MODE:
        this.handleScreenshot(false)
        break
  
      case overlayActions.TOGGLE_SCREENSHOT_CLIPPED_MODE:
        this.handleScreenshot(true)
        break
  
      case overlayActions.CLOSE_SCREENSHOT_MODE:
        this.cancelScreenshot()
        break
  
      case overlayActions.TOGGLE_OVERLAY:
        msg?.value?.open ? this.overlay.mount(msg.value) : this.overlay.unmount()
        break
      */
      case popupActions.STOP_RECORDING:
        this.store.commit('close')
        break

    }
  }

  /*
  handleScreenshot(isClipped) {
    this.recorder.disableClickRecording()
    this.capture = new Capture({ isClipped, store: this.store })

    this.capture.addCameraIcon()

    this.store.state.screenshotMode
      ? this.capture.startScreenshotMode()
      : this.capture.stopScreenshotMode()

    this.capture.on('click', ({ selector }) => {
      this.store.commit('stopScreenshotMode')

      this.capture.showScreenshotEffect()
      this.recorder._sendMessage({ control: recordingControls.GET_SCREENSHOT, value: selector })
      this.recorder.enableClickRecording()
    })
  }

  cancelScreenshot() {
    if (!this.store.state.screenshotMode) {
      return
    }

    this.store.commit('stopScreenshotMode')
    this.recorder.enableClickRecording()
  }
  */
}
