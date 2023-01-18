/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

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
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry need to be wrapped in an IIFE because it need to be isolated against other modules in the chunk.
(() => {
var exports = __webpack_exports__;
var __webpack_unused_export__;

__webpack_unused_export__ = ({ value: true });
const constants_1 = __webpack_require__(161);
const START = '▶';
const STOP = '■';
const btn = document.getElementById('button-record');
btn?.addEventListener('click', () => {
    if (btn.innerHTML === START) {
        btn.innerHTML = STOP;
        chrome.runtime.sendMessage({ action: constants_1.popupActions.START_RECORDING, payload: window.location.search.replace('?', '') });
    }
    else {
        btn.innerHTML = START;
        chrome.runtime.sendMessage({ action: constants_1.popupActions.STOP_RECORDING });
    }
});
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'READY') {
        btn.innerHTML = START;
        btn.disabled = false;
    }
    if (request.action === 'ERROR') {
        btn.innerHTML = request.value;
        btn.disabled = true;
    }
});

})();

/******/ })()
;