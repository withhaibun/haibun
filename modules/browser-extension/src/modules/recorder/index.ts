import getSelector from '../../services/selector'
import { recordingControls } from '../../services/constants'
import { eventsToRecord } from '../code-generator/constants'
import { Store } from '../../services/Store';
import { TBrowserContextMessage } from '@haibun/feature-importer/build/lib/defs';


declare global {
  interface Window { pptRecorderAddedControlListeners: any; }
  interface Document { pptRecorderAddedControlListeners: any; }
}

export default class Recorder {
  _isTopFrame: boolean
  _isRecordingClicks: boolean
  store: Store
  constructor({ store }: any) {
    this._isTopFrame = window.location === window.parent.location
    this._isRecordingClicks = true

    this.store = store
  }

  init(cb?: () => void) {
    const events = Object.values(eventsToRecord)

    if (!window.pptRecorderAddedControlListeners) {
      this._addAllListeners(events)
      cb && cb();
      window.pptRecorderAddedControlListeners = true
    }

    if (!window.document.pptRecorderAddedControlListeners && chrome.runtime?.onMessage) {
      window.document.pptRecorderAddedControlListeners = true
    }

    if (this._isTopFrame) {
      this._sendMessage({ '@context': '#haibun/control', control: recordingControls.EVENT_RECORDER_STARTED })
      this._sendMessage({ '@context': '#haibun/control', control: recordingControls.GET_CURRENT_URL, href: window.location.href })
      this._sendMessage({'@context': '#haibun/control', control: recordingControls.GET_VIEWPORT_SIZE, coordinates: { width: window.innerWidth, height: window.innerHeight },
      });
    }
    return this;
  }

  _addAllListeners(events: string[]) {
    const boundedRecordEvent = this._recordEvent.bind(this)
    events.forEach((type: any) => window.addEventListener(type, boundedRecordEvent, true));
  }

  _sendMessage(msg: TBrowserContextMessage) {
    try {
      chrome.runtime.sendMessage(msg);
    } catch (err) {
      console.debug('caught error', err)
    }
  }

  _recordEvent(e: any) {
    // we explicitly catch any errors and swallow them, as none node-type events are also ingested.
    // for these events we cannot generate selectors, which is OK
    try {
      const selector = getSelector(e, { dataAttribute: this.store.state.dataAttribute })

      this.store.commit('showRecorded')

      this._sendMessage({
        '@context': '#haibun/event',
        selector,
        value: e.target.value,
        tagName: e.target.tagName,
        action: e.type,
        keyCode: e.keyCode ? e.keyCode : null,
        href: e.target.href ? e.target.href : null,
        coordinates: Recorder._getCoordinates(e)
      })
    } catch (err) {
      console.error(err)
    }
  }

  disableClickRecording() {
    this._isRecordingClicks = false
  }

  enableClickRecording() {
    this._isRecordingClicks = true
  }

  static _getCoordinates(evt: { type: string, clientX: number, clientY: number }) {
    const eventsWithCoordinates: any = {
      mouseup: true,
      mousedown: true,
      mousemove: true,
      mouseover: true,
    }

    return eventsWithCoordinates[evt.type] ? { x: evt.clientX, y: evt.clientY } : undefined;
  }
}
