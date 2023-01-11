/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ 479:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
// import { overlayActions } from '../modules/overlay/constants'
const constants_1 = __webpack_require__(161);
const storage_1 = __importDefault(__webpack_require__(570));
// import Capture from '../modules/capture'
class ContentController {
    // overlay: any
    // recorder: any
    constructor({ store, /*overlay, */ recorder, }) {
        this.backgroundListener = null;
        this.store = store;
        this.capture = null;
        // this.overlay = overlay
        this.recorder = recorder;
    }
    async init() {
        const { options } = await storage_1.default.get(['options']);
        const { dataAttribute } = options?.code || {};
        this.store.commit('setDataAttribute', dataAttribute);
        // this.recorder.init(() => this.listenBackgroundMessages())
        this.listenBackgroundMessages();
    }
    static log(msg) {
        chrome.devtools.inspectedWindow.eval(`console.log(CC< '${msg}')`);
    }
    listenBackgroundMessages() {
        this.backgroundListener = this.backgroundListener || this.handleBackgroundMessages.bind(this);
        chrome.runtime.onMessage.addListener(this.backgroundListener);
    }
    errorMessage(message) {
        ContentController.log(message);
    }
    async handleBackgroundMessages(msg) {
        ContentController.log(`handleBackgroundMessages ${JSON.stringify(msg)}`);
        if (!msg?.action) {
            return;
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
            case constants_1.popupActions.STOP_RECORDING:
                this.store.commit('close');
                break;
        }
    }
}
exports["default"] = ContentController;


/***/ }),

/***/ 112:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
const content_controller_1 = __importDefault(__webpack_require__(479));
const Store_1 = __webpack_require__(177);
// // import Overlay from '@/modules/overlay'
const recorder_1 = __importDefault(__webpack_require__(703));
const bg = document.body.style.backgroundColor;
document.body.style.backgroundColor = 'orange';
setTimeout(() => { document.body.style.backgroundColor = bg; }, 1000);
const store = new Store_1.Store();
window.contentController = new content_controller_1.default({
    // overlay: new Overlay({ store }),
    recorder: new recorder_1.default({ store }).init(),
    store
});
// console.log('init headlessController');
// window.contentController.init();


/***/ }),

/***/ 557:
/***/ ((__unused_webpack_module, exports) => {


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

/***/ 703:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {


var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
const selector_1 = __importDefault(__webpack_require__(507));
const constants_1 = __webpack_require__(161);
const constants_2 = __webpack_require__(557);
class Recorder {
    constructor({ store }) {
        this._isTopFrame = window.location === window.parent.location;
        this._isRecordingClicks = true;
        this.store = store;
    }
    init(cb) {
        const events = Object.values(constants_2.eventsToRecord);
        if (!window.pptRecorderAddedControlListeners) {
            this._addAllListeners(events);
            cb && cb();
            window.pptRecorderAddedControlListeners = true;
        }
        if (!window.document.pptRecorderAddedControlListeners && chrome.runtime?.onMessage) {
            window.document.pptRecorderAddedControlListeners = true;
        }
        if (this._isTopFrame) {
            this._sendMessage({ '@context': '#haibun/control', control: constants_1.recordingControls.EVENT_RECORDER_STARTED });
            this._sendMessage({ '@context': '#haibun/control', control: constants_1.recordingControls.GET_CURRENT_URL, href: window.location.href });
            this._sendMessage({ '@context': '#haibun/control', control: constants_1.recordingControls.GET_VIEWPORT_SIZE, coordinates: { width: window.innerWidth, height: window.innerHeight },
            });
        }
        return this;
    }
    _addAllListeners(events) {
        const boundedRecordEvent = this._recordEvent.bind(this);
        events.forEach((type) => window.addEventListener(type, boundedRecordEvent, true));
    }
    _sendMessage(msg) {
        try {
            chrome.runtime.sendMessage(msg);
        }
        catch (err) {
            console.debug('caught error', err);
        }
    }
    _recordEvent(e) {
        // we explicitly catch any errors and swallow them, as none node-type events are also ingested.
        // for these events we cannot generate selectors, which is OK
        try {
            const selector = (0, selector_1.default)(e, { dataAttribute: this.store.state.dataAttribute });
            this.store.commit('showRecorded');
            this._sendMessage({
                '@context': '#haibun/event',
                selector,
                value: e.target.value,
                tagName: e.target.tagName,
                action: e.type,
                keyCode: e.keyCode ? e.keyCode : null,
                href: e.target.href ? e.target.href : null,
                coordinates: Recorder._getCoordinates(e)
            });
        }
        catch (err) {
            console.error(err);
        }
    }
    disableClickRecording() {
        this._isRecordingClicks = false;
    }
    enableClickRecording() {
        this._isRecordingClicks = true;
    }
    static _getCoordinates(evt) {
        const eventsWithCoordinates = {
            mouseup: true,
            mousedown: true,
            mousemove: true,
            mouseover: true,
        };
        return eventsWithCoordinates[evt.type] ? { x: evt.clientX, y: evt.clientY } : undefined;
    }
}
exports["default"] = Recorder;


/***/ }),

/***/ 177:
/***/ ((__unused_webpack_module, exports) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Store = void 0;
class Store {
    constructor() {
        this.state = {};
    }
    commit(type, payload) {
        this.state[type] = payload;
    }
}
exports.Store = Store;


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

/***/ 507:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {


Object.defineProperty(exports, "__esModule", ({ value: true }));
const finder_js_1 = __webpack_require__(657);
function selector(e, { dataAttribute }) {
    if (dataAttribute && e.target.getAttribute(dataAttribute)) {
        return `[${dataAttribute}="${e.target.getAttribute(dataAttribute)}"]`;
    }
    if (e.target.id) {
        return `#${e.target.id}`;
    }
    return (0, finder_js_1.finder)(e.target, {
        seedMinLength: 5,
        optimizedMinLength: e.target.id ? 2 : 10,
        attr: name => name === dataAttribute,
    });
}
exports["default"] = selector;


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

/***/ 657:
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "finder": () => (/* binding */ finder)
/* harmony export */ });
var Limit;
(function (Limit) {
    Limit[Limit["All"] = 0] = "All";
    Limit[Limit["Two"] = 1] = "Two";
    Limit[Limit["One"] = 2] = "One";
})(Limit || (Limit = {}));
let config;
let rootDocument;
function finder(input, options) {
    if (input.nodeType !== Node.ELEMENT_NODE) {
        throw new Error(`Can't generate CSS selector for non-element node type.`);
    }
    if ("html" === input.tagName.toLowerCase()) {
        return "html";
    }
    const defaults = {
        root: document.body,
        idName: (name) => true,
        className: (name) => true,
        tagName: (name) => true,
        attr: (name, value) => false,
        seedMinLength: 1,
        optimizedMinLength: 2,
        threshold: 1000,
        maxNumberOfTries: 10000,
    };
    config = Object.assign(Object.assign({}, defaults), options);
    rootDocument = findRootDocument(config.root, defaults);
    let path = bottomUpSearch(input, Limit.All, () => bottomUpSearch(input, Limit.Two, () => bottomUpSearch(input, Limit.One)));
    if (path) {
        const optimized = sort(optimize(path, input));
        if (optimized.length > 0) {
            path = optimized[0];
        }
        return selector(path);
    }
    else {
        throw new Error(`Selector was not found.`);
    }
}
function findRootDocument(rootNode, defaults) {
    if (rootNode.nodeType === Node.DOCUMENT_NODE) {
        return rootNode;
    }
    if (rootNode === defaults.root) {
        return rootNode.ownerDocument;
    }
    return rootNode;
}
function bottomUpSearch(input, limit, fallback) {
    let path = null;
    let stack = [];
    let current = input;
    let i = 0;
    while (current && current !== config.root.parentElement) {
        let level = maybe(id(current)) ||
            maybe(...attr(current)) ||
            maybe(...classNames(current)) ||
            maybe(tagName(current)) || [any()];
        const nth = index(current);
        if (limit === Limit.All) {
            if (nth) {
                level = level.concat(level.filter(dispensableNth).map((node) => nthChild(node, nth)));
            }
        }
        else if (limit === Limit.Two) {
            level = level.slice(0, 1);
            if (nth) {
                level = level.concat(level.filter(dispensableNth).map((node) => nthChild(node, nth)));
            }
        }
        else if (limit === Limit.One) {
            const [node] = (level = level.slice(0, 1));
            if (nth && dispensableNth(node)) {
                level = [nthChild(node, nth)];
            }
        }
        for (let node of level) {
            node.level = i;
        }
        stack.push(level);
        if (stack.length >= config.seedMinLength) {
            path = findUniquePath(stack, fallback);
            if (path) {
                break;
            }
        }
        current = current.parentElement;
        i++;
    }
    if (!path) {
        path = findUniquePath(stack, fallback);
    }
    return path;
}
function findUniquePath(stack, fallback) {
    const paths = sort(combinations(stack));
    if (paths.length > config.threshold) {
        return fallback ? fallback() : null;
    }
    for (let candidate of paths) {
        if (unique(candidate)) {
            return candidate;
        }
    }
    return null;
}
function selector(path) {
    let node = path[0];
    let query = node.name;
    for (let i = 1; i < path.length; i++) {
        const level = path[i].level || 0;
        if (node.level === level - 1) {
            query = `${path[i].name} > ${query}`;
        }
        else {
            query = `${path[i].name} ${query}`;
        }
        node = path[i];
    }
    return query;
}
function penalty(path) {
    return path.map((node) => node.penalty).reduce((acc, i) => acc + i, 0);
}
function unique(path) {
    switch (rootDocument.querySelectorAll(selector(path)).length) {
        case 0:
            throw new Error(`Can't select any node with this selector: ${selector(path)}`);
        case 1:
            return true;
        default:
            return false;
    }
}
function id(input) {
    const elementId = input.getAttribute("id");
    if (elementId && config.idName(elementId)) {
        return {
            name: "#" + cssesc(elementId, { isIdentifier: true }),
            penalty: 0,
        };
    }
    return null;
}
function attr(input) {
    const attrs = Array.from(input.attributes).filter((attr) => config.attr(attr.name, attr.value));
    return attrs.map((attr) => ({
        name: "[" +
            cssesc(attr.name, { isIdentifier: true }) +
            '="' +
            cssesc(attr.value) +
            '"]',
        penalty: 0.5,
    }));
}
function classNames(input) {
    const names = Array.from(input.classList).filter(config.className);
    return names.map((name) => ({
        name: "." + cssesc(name, { isIdentifier: true }),
        penalty: 1,
    }));
}
function tagName(input) {
    const name = input.tagName.toLowerCase();
    if (config.tagName(name)) {
        return {
            name,
            penalty: 2,
        };
    }
    return null;
}
function any() {
    return {
        name: "*",
        penalty: 3,
    };
}
function index(input) {
    const parent = input.parentNode;
    if (!parent) {
        return null;
    }
    let child = parent.firstChild;
    if (!child) {
        return null;
    }
    let i = 0;
    while (child) {
        if (child.nodeType === Node.ELEMENT_NODE) {
            i++;
        }
        if (child === input) {
            break;
        }
        child = child.nextSibling;
    }
    return i;
}
function nthChild(node, i) {
    return {
        name: node.name + `:nth-child(${i})`,
        penalty: node.penalty + 1,
    };
}
function dispensableNth(node) {
    return node.name !== "html" && !node.name.startsWith("#");
}
function maybe(...level) {
    const list = level.filter(notEmpty);
    if (list.length > 0) {
        return list;
    }
    return null;
}
function notEmpty(value) {
    return value !== null && value !== undefined;
}
function* combinations(stack, path = []) {
    if (stack.length > 0) {
        for (let node of stack[0]) {
            yield* combinations(stack.slice(1, stack.length), path.concat(node));
        }
    }
    else {
        yield path;
    }
}
function sort(paths) {
    return Array.from(paths).sort((a, b) => penalty(a) - penalty(b));
}
function* optimize(path, input, scope = {
    counter: 0,
    visited: new Map(),
}) {
    if (path.length > 2 && path.length > config.optimizedMinLength) {
        for (let i = 1; i < path.length - 1; i++) {
            if (scope.counter > config.maxNumberOfTries) {
                return; // Okay At least I tried!
            }
            scope.counter += 1;
            const newPath = [...path];
            newPath.splice(i, 1);
            const newPathKey = selector(newPath);
            if (scope.visited.has(newPathKey)) {
                return;
            }
            if (unique(newPath) && same(newPath, input)) {
                yield newPath;
                scope.visited.set(newPathKey, true);
                yield* optimize(newPath, input, scope);
            }
        }
    }
}
function same(path, input) {
    return rootDocument.querySelector(selector(path)) === input;
}
const regexAnySingleEscape = /[ -,\.\/:-@\[-\^`\{-~]/;
const regexSingleEscape = /[ -,\.\/:-@\[\]\^`\{-~]/;
const regexExcessiveSpaces = /(^|\\+)?(\\[A-F0-9]{1,6})\x20(?![a-fA-F0-9\x20])/g;
const defaultOptions = {
    escapeEverything: false,
    isIdentifier: false,
    quotes: "single",
    wrap: false,
};
function cssesc(string, opt = {}) {
    const options = Object.assign(Object.assign({}, defaultOptions), opt);
    if (options.quotes != "single" && options.quotes != "double") {
        options.quotes = "single";
    }
    const quote = options.quotes == "double" ? '"' : "'";
    const isIdentifier = options.isIdentifier;
    const firstChar = string.charAt(0);
    let output = "";
    let counter = 0;
    const length = string.length;
    while (counter < length) {
        const character = string.charAt(counter++);
        let codePoint = character.charCodeAt(0);
        let value = void 0;
        // If it’s not a printable ASCII character…
        if (codePoint < 0x20 || codePoint > 0x7e) {
            if (codePoint >= 0xd800 && codePoint <= 0xdbff && counter < length) {
                // It’s a high surrogate, and there is a next character.
                const extra = string.charCodeAt(counter++);
                if ((extra & 0xfc00) == 0xdc00) {
                    // next character is low surrogate
                    codePoint = ((codePoint & 0x3ff) << 10) + (extra & 0x3ff) + 0x10000;
                }
                else {
                    // It’s an unmatched surrogate; only append this code unit, in case
                    // the next code unit is the high surrogate of a surrogate pair.
                    counter--;
                }
            }
            value = "\\" + codePoint.toString(16).toUpperCase() + " ";
        }
        else {
            if (options.escapeEverything) {
                if (regexAnySingleEscape.test(character)) {
                    value = "\\" + character;
                }
                else {
                    value = "\\" + codePoint.toString(16).toUpperCase() + " ";
                }
            }
            else if (/[\t\n\f\r\x0B]/.test(character)) {
                value = "\\" + codePoint.toString(16).toUpperCase() + " ";
            }
            else if (character == "\\" ||
                (!isIdentifier &&
                    ((character == '"' && quote == character) ||
                        (character == "'" && quote == character))) ||
                (isIdentifier && regexSingleEscape.test(character))) {
                value = "\\" + character;
            }
            else {
                value = character;
            }
        }
        output += value;
    }
    if (isIdentifier) {
        if (/^-[-\d]/.test(output)) {
            output = "\\-" + output.slice(1);
        }
        else if (/\d/.test(firstChar)) {
            output = "\\3" + firstChar + " " + output.slice(1);
        }
    }
    // Remove spaces after `\HEX` escapes that are not followed by a hex digit,
    // since they’re redundant. Note that this is only possible if the escape
    // sequence isn’t preceded by an odd number of backslashes.
    output = output.replace(regexExcessiveSpaces, function ($0, $1, $2) {
        if ($1 && $1.length % 2) {
            // It’s not safe to remove the space, so don’t.
            return $0;
        }
        // Strip the space.
        return ($1 || "") + $2;
    });
    if (!isIdentifier && options.wrap) {
        return quote + output + quote;
    }
    return output;
}


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
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	var __webpack_exports__ = __webpack_require__(112);
/******/ 	
/******/ })()
;