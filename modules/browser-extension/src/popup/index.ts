import { popupActions } from '../services/constants';

const START = '▶';
const STOP = '■';

const btn = <HTMLButtonElement>document.getElementById('button-record');

btn?.addEventListener('click', () => {
  if (btn.innerHTML === START) {
    btn.innerHTML = STOP;
    chrome.runtime.sendMessage({ action: popupActions.START_RECORDING, payload: window.location.search.replace('?', '') });
  } else {
    btn.innerHTML = START;
    chrome.runtime.sendMessage({ action: popupActions.STOP_RECORDING });
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