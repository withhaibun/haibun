/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ 379:
/***/ ((__unused_webpack_module, exports) => {


// https://www.youtube.com/watch?v=xlJddufkgJg
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ChromeExtensionKeepAlive = void 0;
class ChromeExtensionKeepAlive {
    async start() {
        this.keepAlive();
        chrome.runtime.onConnect.addListener((port) => {
            if (port.name === 'keepAlive') {
                this.lifeline = port;
                setTimeout(() => this.keepAliveForced(), 295e3); // 5 minutes minus 5 seconds
                port.onDisconnect.addListener(() => this.keepAliveForced);
            }
        });
    }
    async stop() {
    }
    async keepAliveForced() {
        this.lifeline?.disconnect();
        this.lifeline = undefined;
        await this.keepAlive();
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
                chrome.tabs.onUpdated.removeListener(() => this.retryOnTabUpdate);
                return;
            }
            catch (e) { }
        }
        chrome.tabs.onUpdated.addListener(() => this.retryOnTabUpdate);
    }
    async retryOnTabUpdate(tabId, info, tab) {
        if (info.url && /^(file|https?):/.test(info.url)) {
            this.keepAlive();
        }
    }
}
exports.ChromeExtensionKeepAlive = ChromeExtensionKeepAlive;


/***/ }),

/***/ 399:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
const badge_1 = __importDefault(__webpack_require__(422));
const browser_1 = __importDefault(__webpack_require__(197));
const storage_1 = __importDefault(__webpack_require__(570));
class AbstractBackground {
    constructor(logger) {
        this.handlers = undefined;
        this.badge = new badge_1.default();
        this.logger = logger;
        this._recording = [];
        // this.overlayHandler = null
        this._badgeState = '';
        this._isPaused = false;
        // Some events are sent double on page navigations to simplify the event recorder.
        // We keep some simple state to disregard events if needed.
        this._handledGoto = false;
        this._handledViewPortSize = false;
    }
    sendControlMessage(type, value) {
        this.logger.log(type, { control: type, '@context': '#haibun/control', ...value });
    }
    init() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => this.handlePopupMessage(request));
    }
    async startRecording(toTabIndex) {
        await this.cleanUp();
        this._badgeState = '';
        this._handledGoto = false;
        this._handledViewPortSize = false;
        if (toTabIndex) {
            console.log('>>>', await chrome.tabs.query({ index: toTabIndex, }));
            const tabId = (await chrome.tabs.query({ index: toTabIndex, }))[0]?.id;
            await this.injectContentScript('startRecording', tabId);
            chrome.tabs.update(tabId, { active: true });
        }
        for (const [type, value] of Object.entries(this.handlers)) {
            for (const [name, handler] of Object.entries(value)) {
                console.log('adding', name, chrome[type][name]);
                chrome[type][name].addListener(handler);
            }
        }
        // this.toggleOverlay({ open: true, clear: true })
        // this.overlayHandler = this.handleOverlayMessage.bind(this)
        // chrome.runtime.onMessage.addListener(this.overlayHandler)
        this.badge.start();
    }
    injectContentScript(reason, tabId) {
        this.logger.log(reason, { '@context': '#haibun/info', 'info': `inject ${reason}` });
        browser_1.default.injectContentScript(tabId);
    }
    async stop() {
        await this.logger.disconnect();
        this._badgeState = this._recording.length > 0 ? '1' : '';
        for (const [type, value] of Object.entries(this.handlers)) {
            for (const [name, handler] of Object.entries(value)) {
                chrome[type][name].removeListener(handler);
            }
        }
        this.handlers = undefined;
        this.badge.stop(this._badgeState);
        storage_1.default.set({ recording: this._recording });
    }
    pause() {
        this.badge.pause();
        this._isPaused = true;
    }
    unPause() {
        this.badge.start();
        this._isPaused = false;
    }
    cleanUp() {
        this._recording = [];
        this._isPaused = false;
        this.badge.reset();
        return new Promise(function (resolve) {
            chrome.storage.local.remove('recording', () => resolve(true));
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
    onMessage(msg, sender) {
        if (msg.control) {
            return this.handleRecordingMessage(msg /*, sender*/);
        }
        if (msg.action === 'ERROR') {
            setTimeout(() => {
                this.badge.setText('ERR');
                chrome.runtime.sendMessage(msg);
            }, 1000);
        }
        console.log('onMessage', msg, sender);
        setTimeout(() => {
            this.badge.setText('WAIT');
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
}
exports["default"] = AbstractBackground;


/***/ }),

/***/ 128:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
const browser_1 = __importDefault(__webpack_require__(197));
const constants_1 = __webpack_require__(161);
const AbstractBackground_1 = __importDefault(__webpack_require__(399));
class Background extends AbstractBackground_1.default {
    constructor(logger) {
        super(logger);
    }
    async startRecording(toTabIndex) {
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
        };
        super.startRecording(toTabIndex);
        const { url: href } = (await browser_1.default.getActiveTab());
        this.sendControlMessage('startRecording', { href });
    }
    async recordCurrentUrl(href) {
        if (!this._handledGoto) {
            this.sendControlMessage('recordCurrentUrl', { href });
            this._handledGoto = true;
        }
    }
    async recordCurrentViewportSize(value) {
        if (!this._handledViewPortSize) {
            this.sendControlMessage('viewportSize', { value });
            this._handledViewPortSize = true;
        }
    }
    async recordNavigation() {
        this.sendControlMessage('navigation', {});
    }
    handleRecordingMessage({ control, href, value, coordinates }) {
        if (control === constants_1.recordingControls.EVENT_RECORDER_STARTED) {
            this.badge.setText(this._badgeState);
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
            this.startRecording(msg.payload ? parseInt(msg.payload, 10) : undefined);
        }
        else if (msg.action === constants_1.popupActions.STOP_RECORDING) {
            browser_1.default.sendTabMessage({ action: constants_1.popupActions.STOP_RECORDING });
            this.sendControlMessage(constants_1.popupActions.STOP_RECORDING, {});
            this.stop();
        }
        else {
            this.logger.log('handlePopupMessage', msg);
        }
    }
    onRequestFinished(request) {
        this.sendControlMessage('onRequestFinished', {
            serverIPAddress: request.serverIPAddress, pageref: request.pageref, time: request.time
        });
    }
    ;
    onActivated(activeInfo) {
        chrome.tabs.get(activeInfo.tabId, function (tab) {
            console.log(':::', tab);
        });
    }
    async onBeforeRequest({ url }) {
        this.sendControlMessage('onBeforeRequest', { url });
    }
    async onBeforeNavigate({ url }) {
        this.sendControlMessage('onBeforeNavigate', { url });
    }
    async onCompleted({ frameId }) {
        console.log('onCompleted', frameId);
        // this.toggleOverlay({ open: true, pause: this._isPaused })
        if (frameId === 0) {
            this.recordNavigation();
        }
        const where = await chrome.tabs.query({ active: true, currentWindow: true });
        await this.injectContentScript('webNavigation.onComplete', where[0].id);
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
const __1 = __webpack_require__(607);
const Background_1 = __importDefault(__webpack_require__(128));
const LoggerWebSocketsClient_1 = __importDefault(__webpack_require__(118));
const constants_1 = __webpack_require__(161);
const ChromeExtensionKeepAlive_1 = __webpack_require__(379);
const port = __1.DEFAULT_PORT;
const keepAlive = new ChromeExtensionKeepAlive_1.ChromeExtensionKeepAlive();
const webSocketLogger = new LoggerWebSocketsClient_1.default(port, { keepAlive });
const background = new Background_1.default(webSocketLogger);
background.init();
loggerConnect(webSocketLogger);
async function loggerConnect(logger) {
    const errorHandler = (error) => {
        background.onMessage({ action: 'ERROR', value: `Could not connect to websocket on port ${port} ${JSON.stringify(error)}.` });
    };
    await logger.connect(errorHandler);
}
background.onMessage({ action: constants_1.popupActions.READY });


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
exports.DEFAULT_PORT = void 0;
__exportStar(__webpack_require__(985), exports);
__exportStar(__webpack_require__(486), exports);
exports.DEFAULT_PORT = 3931;


/***/ }),

/***/ 486:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


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
    for (const listener of ctx.listeners) {
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
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


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
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.PortOnMessage = void 0;
const ports_1 = __webpack_require__(130);
class PortOnMessage {
    constructor() {
        this.listeners = [];
    }
    addListener(callback) {
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
            listener(message);
        });
    }
}
exports.PortOnMessage = PortOnMessage;


/***/ }),

/***/ 320:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.PortRuntimeOnConnect = void 0;
const ports_1 = __webpack_require__(130);
class PortRuntimeOnConnect {
    constructor(ctx) {
        this.ctx = ctx;
    }
    addListener(callback) {
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
            listener(message);
        });
    }
}
exports.PortRuntimeOnConnect = PortRuntimeOnConnect;


/***/ }),

/***/ 16:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.PortRuntimeOnMessage = void 0;
const ports_1 = __webpack_require__(130);
class PortRuntimeOnMessage {
    constructor(ctx) {
        this.ctx = ctx;
    }
    addListener(callback) {
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
        this.ctx.listeners.forEach((listener) => {
            listener(message);
        });
    }
}
exports.PortRuntimeOnMessage = PortRuntimeOnMessage;


/***/ }),

/***/ 130:
/***/ ((__unused_webpack_module, exports) => {


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

/***/ 422:
/***/ ((__unused_webpack_module, exports) => {


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
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
const CONTENT_SCRIPT_PATH = './js/content.js';
exports["default"] = {
    async getActiveTab() {
        const tab = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab[0];
    },
    async sendTabMessage({ action, value = undefined, clean = undefined }, id) {
        const tabId = id !== undefined ? id : (await this.getActiveTab()).id;
        chrome.tabs.sendMessage(tabId, { action, value, clean });
    },
    async injectContentScript(tabId) {
        // if (tabId === undefined) {
        //   tabId = (await this.getActiveTab())?.id;
        // }
        const b = await chrome.scripting.executeScript({
            target: { tabId },
            injectImmediately: true,
            files: [CONTENT_SCRIPT_PATH]
        });
    }
};


/***/ }),

/***/ 161:
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.popupActions = exports.recordingControls = void 0;
exports.recordingControls = {
    EVENT_RECORDER_STARTED: 'eventRecorderStarted',
    GET_VIEWPORT_SIZE: 'getViewportSize',
    GET_CURRENT_URL: 'getCurrentURL',
    GET_SCREENSHOT: 'getScreenshot',
};
exports.popupActions = {
    START_RECORDING: 'startRecording',
    STOP_RECORDING: 'stopRecording',
    READY: 'READY'
};


/***/ }),

/***/ 570:
/***/ ((__unused_webpack_module, exports) => {


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


/***/ }),

/***/ 118:
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
// FIXME should use ConnectedLogger, etc
const defaultMessageHandler = (event) => {
    console.log('socket.onmessage', event);
};
class LoggerWebSocketsClient {
    constructor(port = 3294, args) {
        this.port = port;
        this.keepAlive = args?.keepAlive;
    }
    async connect(errorHandler) {
        this.socket = new WebSocket(`ws://localhost:${this.port}`);
        this.socket.onerror = errorHandler;
        this.socket.onmessage = onmessage || defaultMessageHandler;
        console.log('onmessage', this.socket.onmessage);
        await this.keepAlive?.start();
    }
    async disconnect() {
    }
    log(args, message) {
        this.out('log', args, { ...message, ctime: new Date().getTime() });
    }
    out(level, args, contexted) {
        this.socket?.send(JSON.stringify({ level: JSON.stringify(level), contexted }));
    }
    ;
}
exports["default"] = LoggerWebSocketsClient;
//# sourceMappingURL=LoggerWebSocketsClient.js.map

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
/******/ 	var __webpack_exports__ = __webpack_require__(985);
/******/ 	
/******/ })()
;