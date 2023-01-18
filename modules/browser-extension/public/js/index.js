/******/ (function() { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ 49:
/***/ (function(__unused_webpack_module, exports) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.KeepAlive = void 0;
class KeepAlive {
    init() {
        this.keepAlive();
        chrome.runtime.onConnect.addListener(port => {
            if (port.name === 'keepAlive') {
                this.lifeline = port;
                setTimeout(this.keepAliveForced, 295e3); // 5 minutes minus 5 seconds
                port.onDisconnect.addListener(this.keepAliveForced);
            }
        });
    }
    keepAliveForced() {
        this.lifeline?.disconnect();
        this.lifeline = undefined;
        this.keepAlive();
    }
    async keepAlive() {
        if (this.lifeline)
            return;
        for (const tab of await chrome.tabs.query({ url: '*://*/*' })) {
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => chrome.runtime.connect({ name: 'keepAlive' }),
                });
                chrome.tabs.onUpdated.removeListener(this.retryOnTabUpdate);
                return;
            }
            catch (e) { }
        }
        chrome.tabs.onUpdated.addListener(this.retryOnTabUpdate);
    }
    async retryOnTabUpdate(tabId, info, tab) {
        if (info.url && /^(file|https?):/.test(info.url)) {
            this.keepAlive();
        }
    }
}
exports.KeepAlive = KeepAlive;


/***/ }),

/***/ 851:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
const badge_1 = __importDefault(__webpack_require__(422));
const browser_1 = __importDefault(__webpack_require__(197));
const storage_1 = __importDefault(__webpack_require__(570));
const constants_1 = __webpack_require__(161);
// import { overlayActions } from '../modules/overlay/constants'
const constants_2 = __webpack_require__(557);
const Keepalive_1 = __webpack_require__(49);
const badge = new badge_1.default();
class Background {
    constructor() {
        this._recording = [];
        this._boundedMessageHandler = null;
        this._boundedNavigationHandler = null;
        this._boundedWaitHandler = null;
        // this.overlayHandler = null
        this._badgeState = '';
        this._isPaused = false;
        // Some events are sent double on page navigations to simplify the event recorder.
        // We keep some simple state to disregard events if needed.
        this._handledGoto = false;
        this._handledViewPortSize = false;
    }
    init() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => this.handlePopupMessage(request));
        console.log('init');
    }
    startConnection() {
        this.keepalive = new Keepalive_1.KeepAlive();
        this.connection = new WebSocket('ws://localhost:3140');
    }
    async startRecording() {
        await this.cleanUp();
        this.startConnection();
        this._badgeState = '';
        this._handledGoto = false;
        this._handledViewPortSize = false;
        await browser_1.default.injectContentScript();
        console.log('injected');
        // this.toggleOverlay({ open: true, clear: true })
        this._boundedMessageHandler = this.handleMessage.bind(this);
        this._boundedNavigationHandler = this.handleNavigation.bind(this);
        this._boundedWaitHandler = () => badge.wait();
        // this.overlayHandler = this.handleOverlayMessage.bind(this)
        // chrome.runtime.onMessage.addListener(this._boundedMessageHandler)
        // chrome.runtime.onMessage.addListener(this.overlayHandler)
        chrome.tabs.onActivated.addListener((activeInfo) => {
            chrome.tabs.get(activeInfo.tabId, function (tab) {
                console.log(':::', tab);
            });
        });
        chrome.webNavigation.onBeforeNavigate.addListener(this._boundedWaitHandler);
        chrome.webNavigation.onCompleted.addListener((what) => {
            this._boundedNavigationHandler(what);
            console.log('xal1', what);
            chrome.tabs.query({ active: true, currentWindow: true }, (where) => {
                console.log('xal', what, where);
            });
        });
        badge.start();
    }
    stopConnection() {
        this.connection.close();
        this.keepalive = undefined;
    }
    stop() {
        this.stopConnection();
        this._badgeState = this._recording.length > 0 ? '1' : '';
        chrome.runtime.onMessage.removeListener(this._boundedMessageHandler);
        chrome.webNavigation.onCompleted.removeListener(this._boundedNavigationHandler);
        chrome.webNavigation.onBeforeNavigate.removeListener(this._boundedWaitHandler);
        badge.stop(this._badgeState);
        storage_1.default.set({ recording: this._recording });
    }
    pause() {
        badge.pause();
        this._isPaused = true;
    }
    unPause() {
        badge.start();
        this._isPaused = false;
    }
    cleanUp() {
        this._recording = [];
        this._isPaused = false;
        badge.reset();
        return new Promise(function (resolve) {
            chrome.storage.local.remove('recording', () => resolve(true));
        });
    }
    recordCurrentUrl(href) {
        if (!this._handledGoto) {
            this.handleMessage({
                selector: undefined,
                value: undefined,
                action: constants_2.headlessActions.GOTO,
                href,
            });
            this._handledGoto = true;
        }
    }
    recordCurrentViewportSize(value) {
        if (!this._handledViewPortSize) {
            this.handleMessage({
                selector: undefined,
                value,
                action: constants_2.headlessActions.VIEWPORT,
            });
            this._handledViewPortSize = true;
        }
    }
    recordNavigation() {
        this.handleMessage({
            selector: undefined,
            value: undefined,
            action: constants_2.headlessActions.NAVIGATION,
        });
    }
    /*
    recordScreenshot(value: any) {
      this.handleMessage({
        selector: undefined,
        value,
        action: headlessActions.SCREENSHOT,
      })
    }
    */
    handleMessage(msg, sender) {
        if (msg.control) {
            return this.handleRecordingMessage(msg /*, sender*/);
        }
        /*
        if (msg.type === 'SIGN_CONNECT') {
          return
        }
        */
        // NOTE: To account for clicks etc. we need to record the frameId
        // and url to later target the frame in playback
        msg.frameId = sender?.frameId;
        msg.frameUrl = sender?.url;
        if (!this._isPaused) {
            this.publisher.send(msg);
            this._recording.push(msg);
            storage_1.default.set({ recording: this._recording });
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
    handleRecordingMessage({ control, href, value, coordinates }) {
        if (control === constants_1.recordingControls.EVENT_RECORDER_STARTED) {
            badge.setText(this._badgeState);
        }
        if (control === constants_1.recordingControls.GET_VIEWPORT_SIZE) {
            this.recordCurrentViewportSize(coordinates);
        }
        if (control === constants_1.recordingControls.GET_CURRENT_URL) {
            this.recordCurrentUrl(href);
        }
        /*
        if (control === recordingControls.GET_SCREENSHOT) {
          this.recordScreenshot(value)
        }
        */
    }
    handlePopupMessage(msg) {
        console.log('\n\n________\nMESSAGE', msg);
        if (!msg.action) {
            return;
        }
        if (msg.action === constants_1.popupActions.START_RECORDING) {
            this.startRecording();
        }
        if (msg.action === constants_1.popupActions.STOP_RECORDING) {
            browser_1.default.sendTabMessage({ action: constants_1.popupActions.STOP_RECORDING });
            this.stop();
        }
        if (msg.action === constants_1.popupActions.CLEAN_UP) {
            // chrome.runtime.onMessage.removeListener(this.overlayHandler)
            msg.value && this.stop();
            // this.toggleOverlay()
            this.cleanUp();
        }
        if (msg.action === constants_1.popupActions.PAUSE) {
            if (!msg.stop) {
                browser_1.default.sendTabMessage({ action: constants_1.popupActions.PAUSE });
            }
            this.pause();
        }
        if (msg.action === constants_1.popupActions.UN_PAUSE) {
            if (!msg.stop) {
                browser_1.default.sendTabMessage({ action: constants_1.popupActions.UN_PAUSE });
            }
            this.unPause();
        }
    }
    async handleNavigation({ frameId }) {
        // await browser.injectContentScript()
        // this.toggleOverlay({ open: true, pause: this._isPaused })
        if (frameId === 0) {
            this.recordNavigation();
        }
    }
}
exports["default"] = Background;


/***/ }),

/***/ 985:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
const background_1 = __importDefault(__webpack_require__(851));
const background = new background_1.default();
background.init();


/***/ }),

/***/ 607:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
__exportStar(__webpack_require__(985), exports);
__exportStar(__webpack_require__(486), exports);


/***/ }),

/***/ 486:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.MockPort = void 0;
const PortOnMessage_1 = __webpack_require__(719);
const PortRuntimeOnMessage_1 = __webpack_require__(16);
const PortRuntimeOnConnect_1 = __webpack_require__(320);
const PortDisconnect_1 = __webpack_require__(612);
const connected = {};
let defaultConnector;
class MockPort {
    constructor(name, sender) {
        this.postMessage = (message) => {
            console.log('postMessage', message);
        };
        this.disconnect = () => console.log('disconnect');
        /** An object which allows the addition and removal of listeners for a Chrome event. */
        this.onDisconnect = new PortDisconnect_1.PortDisconnect();
        /** An object which allows the addition and removal of listeners for a Chrome event. */
        this.onMessage = new PortOnMessage_1.PortOnMessage();
        this.name = name;
        this.sender = sender;
        this.onDisconnect = new PortDisconnect_1.PortDisconnect();
        this.onMessage = new PortOnMessage_1.PortOnMessage();
        this.listeners = [];
    }
}
exports.MockPort = MockPort;
const connect = (extensionId, ci) => {
    const name = ci?.name;
    const connector = new MockPort(name || 'foo');
    if (name) {
        connected[name] = connector;
    }
    else {
        defaultConnector = connector;
    }
    return connector;
};
const ctx = { listeners: [] };
const onMessage = new PortRuntimeOnMessage_1.PortRuntimeOnMessage(ctx);
const onConnect = new PortRuntimeOnConnect_1.PortRuntimeOnConnect(ctx);
const sendMessage = async (message) => {
    console.log('sendMessage', message);
    for (const listener of ctx.listeners) {
        console.log('sendMessage', 'listener', listener);
        listener(message);
    }
};
class MockChrome {
    constructor() {
        this.runtime = {
            connect,
            onMessage,
            sendMessage,
            onConnect,
            connectNative: undefined,
            getBackgroundPage: undefined,
            getManifest: undefined,
            getPackageDirectoryEntry: undefined,
            getPlatformInfo: undefined,
            getURL: undefined,
            reload: undefined,
            requestUpdateCheck: undefined,
            restart: undefined,
            restartAfterDelay: undefined,
            sendNativeMessage: undefined,
            setUninstallURL: undefined,
            openOptionsPage: undefined,
            lastError: undefined,
            id: '',
            OnInstalledReason: undefined,
            onConnectExternal: undefined,
            onSuspend: undefined,
            onStartup: undefined,
            onInstalled: undefined,
            onSuspendCanceled: undefined,
            onMessageExternal: undefined,
            onRestartRequired: undefined,
            onUpdateAvailable: undefined,
            onBrowserUpdateAvailable: undefined
        };
        this.extension = {
            getBackgroundPage: undefined,
            getURL: undefined,
            setUpdateUrlData: undefined,
            getViews: undefined,
            isAllowedFileSchemeAccess: undefined,
            isAllowedIncognitoAccess: undefined,
            sendRequest: undefined,
            getExtensionTabs: undefined,
            inIncognitoContext: false,
            lastError: undefined,
            onRequest: undefined,
            onRequestExternal: undefined
        };
    }
}
exports["default"] = MockChrome;


/***/ }),

/***/ 612:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.PortDisconnect = void 0;
const ports_1 = __webpack_require__(130);
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
class PortDisconnect {
    constructor() {
        this.listeners = [];
        this.callbackForDisconnect = [];
    }
    addListener(callback) {
        console.log('addListeners PortDisconnect');
        this.listeners.push(callback);
        this.callbackForDisconnect.push(callback);
    }
    getRules(ruleIdentifiers, callback) {
        throw new Error('Method not implemented.');
    }
    hasListener(callback) {
        return ports_1.Helpers.arrayHasCallback(this.listeners, callback);
    }
    removeRules(ruleIdentifiers, callback) {
        throw new Error('Method not implemented.');
    }
    addRules(rules, callback) {
        throw new Error('Method not implemented.');
    }
    removeListener(callback) {
        this.listeners = ports_1.Helpers.removeCallbackFromArray(this.listeners, callback);
    }
    hasListeners() {
        return this.listeners.length > 0;
    }
    disconnect(port) {
        this.listeners.forEach(listener => {
            listener(port);
        });
    }
}
exports.PortDisconnect = PortDisconnect;


/***/ }),

/***/ 719:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.PortOnMessage = void 0;
const ports_1 = __webpack_require__(130);
class PortOnMessage {
    constructor() {
        this.listeners = [];
    }
    addListener(callback) {
        console.log('addListeners PortOnMessage');
        this.listeners.push(callback);
    }
    getRules(ruleIdentifiers, callback) {
        throw new Error('Method not implemented.');
    }
    hasListener(callback) {
        return ports_1.Helpers.arrayHasCallback(this.listeners, callback);
    }
    removeRules(ruleIdentifiers, callback) {
        throw new Error('Method not implemented.');
    }
    addRules(rules, callback) {
        throw new Error('Method not implemented.');
    }
    removeListener(callback) {
        this.listeners = ports_1.Helpers.removeCallbackFromArray(this.listeners, callback);
    }
    hasListeners() {
        return this.listeners.length > 0;
    }
    sendMessage(message) {
        this.listeners.forEach(listener => {
            console.log('sm', 'PortOnMessage');
            listener(message);
        });
    }
}
exports.PortOnMessage = PortOnMessage;


/***/ }),

/***/ 320:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.PortRuntimeOnConnect = void 0;
const ports_1 = __webpack_require__(130);
class PortRuntimeOnConnect {
    constructor(ctx) {
        this.ctx = ctx;
    }
    addListener(callback) {
        console.log('addListeners PortRuntimeOnConnect');
        this.ctx.listeners.push(callback);
    }
    getRules(ruleIdentifiers, callback) {
        throw new Error('Method not implemented.');
    }
    hasListener(callback) {
        return ports_1.Helpers.arrayHasCallback(this.ctx.listeners, callback);
    }
    removeRules(ruleIdentifiers, callback) {
        throw new Error('Method not implemented.');
    }
    addRules(rules, callback) {
        throw new Error('Method not implemented.');
    }
    removeListener(callback) {
        this.ctx.listeners = ports_1.Helpers.removeCallbackFromArray(this.ctx.listeners, callback);
    }
    hasListeners() {
        return this.ctx.listeners.length > 0;
    }
    sendMessage(message) {
        this.ctx.listeners.forEach(listener => {
            console.log(listener);
            listener(message);
        });
    }
}
exports.PortRuntimeOnConnect = PortRuntimeOnConnect;


/***/ }),

/***/ 16:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.PortRuntimeOnMessage = void 0;
const ports_1 = __webpack_require__(130);
class PortRuntimeOnMessage {
    constructor(ctx) {
        this.ctx = ctx;
    }
    addListener(callback) {
        console.log('addListeners PortRuntimeOnMessage');
        this.ctx.listeners.push(callback);
    }
    getRules(ruleIdentifiers, callback) {
        throw new Error('Method not implemented.');
    }
    hasListener(callback) {
        return false;
    }
    removeRules(ruleIdentifiers, callback) {
        throw new Error('Method not implemented.');
    }
    addRules(rules, callback) {
        throw new Error('Method not implemented.');
    }
    removeListener(callback) {
        this.ctx.listeners = ports_1.Helpers.removeCallbackFromArray(this.ctx.listeners, callback);
    }
    hasListeners() {
        return this.ctx.listeners.length > 0;
    }
    sendMessage(message) {
        console.log('sm');
        this.ctx.listeners.forEach((listener) => {
            console.log('sm', 'PortRuntimeOnMessage');
            listener(message);
        });
    }
}
exports.PortRuntimeOnMessage = PortRuntimeOnMessage;


/***/ }),

/***/ 130:
/***/ (function(__unused_webpack_module, exports) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Helpers = void 0;
var Helpers;
(function (Helpers) {
    function arrayHasCallback(array, callback) {
        for (let i = 0; i < array.length; i++) {
            const currentCallback = array[i];
            if (currentCallback.toString() === callback.toString()) {
                return true;
            }
        }
        return false;
    }
    Helpers.arrayHasCallback = arrayHasCallback;
    function removeCallbackFromArray(array, callback) {
        return array.filter(item => {
            return item.toString() !== callback.toString();
        });
    }
    Helpers.removeCallbackFromArray = removeCallbackFromArray;
})(Helpers = exports.Helpers || (exports.Helpers = {}));


/***/ }),

/***/ 557:
/***/ (function(__unused_webpack_module, exports) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.headlessTypes = exports.eventsToRecord = exports.headlessActions = void 0;
exports.headlessActions = {
    GOTO: 'GOTO',
    CHANGE: 'CHANGE',
    VIEWPORT: 'VIEWPORT',
    WAITFORSELECTOR: 'WAITFORSELECTOR',
    NAVIGATION: 'NAVIGATION',
    NAVIGATION_PROMISE: 'NAVIGATION_PROMISE',
    FRAME_SET: 'FRAME_SET',
    SCREENSHOT: 'SCREENSHOT',
};
exports.eventsToRecord = {
    CLICK: 'click',
    DBLCLICK: 'dblclick',
    CHANGE: 'change',
    KEYDOWN: 'keydown',
    SELECT: 'select',
    SUBMIT: 'submit',
    LOAD: 'load',
    UNLOAD: 'unload',
};
exports.headlessTypes = {
    HAIBUN: 'haibun',
};


/***/ }),

/***/ 422:
/***/ (function(__unused_webpack_module, exports) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
const DEFAULT_COLOR = '#45C8F1';
const RECORDING_COLOR = '#FF0000';
const DEFAULT_LOGO = '../images/logo.png';
const RECORDING_LOGO = '../images/logo-red.png';
const PAUSE_LOGO = '../images/logo-yellow.png';
class Badge {
    stop(text) {
        chrome.action.setIcon({ path: DEFAULT_LOGO });
        chrome.action.setBadgeBackgroundColor({ color: DEFAULT_COLOR });
        this.setText(text);
    }
    reset() {
        this.setText('');
    }
    setText(text) {
        chrome.action.setBadgeText({ text });
    }
    pause() {
        chrome.action.setIcon({ path: PAUSE_LOGO });
    }
    start() {
        chrome.action.setIcon({ path: RECORDING_LOGO });
    }
    wait() {
        chrome.action.setBadgeBackgroundColor({ color: RECORDING_COLOR });
        this.setText('wait');
    }
}
exports["default"] = Badge;


/***/ }),

/***/ 197:
/***/ (function(__unused_webpack_module, exports) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
const CONTENT_SCRIPT_PATH = './js/content.js';
exports["default"] = {
    async getActiveTab() {
        const tab = await chrome.tabs.query({ active: true, currentWindow: true });
        console.log('getActiveTab queryOptions', tab);
        return tab[0];
    },
    async sendTabMessage({ action, value = undefined, clean = undefined }) {
        const { id: tabId } = await this.getActiveTab();
        chrome.tabs.sendMessage(tabId, { action, value, clean });
    },
    async injectContentScript() {
        const { id: tabId } = await this.getActiveTab();
        const b = await chrome.scripting.executeScript({
            target: { tabId },
            // allFrames: true,
            injectImmediately: true,
            files: [CONTENT_SCRIPT_PATH]
        });
        console.log('injectContentScript tab.id', tabId, b);
        // return new Promise(function (resolve) {
        //   chrome.tabs.executeScript({ file: CONTENT_SCRIPT_PATH, allFrames: false }, res => {
        //     console.log('moo');
        //     resolve(res)
        //   })
        // })
    },
    copyToClipboard(text) {
        return navigator.permissions.query({ name: 'clipboard-write' }).then((result) => {
            if (result.state !== 'granted' && result.state !== 'prompt') {
                return Promise.reject();
            }
            navigator.clipboard.writeText(text);
        });
    },
    /*
    getBackgroundConnector() {
      return chrome.runtime.connect({ name: 'recordControls' })
    },
  
    getChecklyCookie() {
      return new Promise(function (resolve) {
        chrome.cookies.getAll({}, res =>
          resolve(res.find(cookie => cookie.name.startsWith('checkly_has_account')))
        )
      })
    },
  
    openOptionsPage() {
      chrome.runtime.openOptionsPage?.()
    },
  
    openHelpPage() {
      chrome.tabs.create({ url: DOCS_URL })
    },
  
    openChecklyRunner({ code, runner, isLoggedIn }: any) {
      if (!isLoggedIn) {
        chrome.tabs.create({ url: SIGNUP_URL })
        return
      }
  
      const script = encodeURIComponent(btoa(code))
      const url = `${RUN_URL}?framework=${runner}&script=${script}`
      chrome.tabs.create({ url })
    },
    */
};


/***/ }),

/***/ 161:
/***/ (function(__unused_webpack_module, exports) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.popupActions = exports.recordingControls = void 0;
exports.recordingControls = {
    EVENT_RECORDER_STARTED: 'EVENT_RECORDER_STARTED',
    GET_VIEWPORT_SIZE: 'GET_VIEWPORT_SIZE',
    GET_CURRENT_URL: 'GET_CURRENT_URL',
    GET_SCREENSHOT: 'GET_SCREENSHOT',
};
exports.popupActions = {
    START_RECORDING: 'START_RECORDING',
    STOP_RECORDING: 'STOP_RECORDING',
    CLEAN_UP: 'CLEAN_UP',
    PAUSE: 'PAUSE',
    UN_PAUSE: 'UN_PAUSE',
};


/***/ }),

/***/ 570:
/***/ (function(__unused_webpack_module, exports) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports["default"] = {
    get(keys) {
        if (!chrome.storage || !chrome.storage.local) {
            return Promise.reject('Browser storage not available');
        }
        return new Promise(resolve => chrome.storage.local.get(keys, props => resolve(props)));
    },
    set(props) {
        if (!chrome.storage || !chrome.storage.local) {
            return Promise.reject('Browser storage not available');
        }
        return new Promise(resolve => chrome.storage.local.set(props, () => resolve(true)));
    },
    remove(keys) {
        if (!chrome.storage || !chrome.storage.local) {
            return Promise.reject('Browser storage not available');
        }
        return new Promise(resolve => chrome.storage.local.remove(keys, () => resolve(true)));
    },
};


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	var __webpack_exports__ = __webpack_require__(607);
/******/ 	
/******/ })()
;