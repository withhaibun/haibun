import { TLogLevel, TLogArgs, EExecutionMessageType, TMessageContext } from '@haibun/core/build/lib/interfaces/logger.js';
import { LogEntry } from './messages.js';
import { setupControls } from './controls.js';

export type TLogEntry = {
	level: TLogLevel;
	message: TLogArgs;
	messageContext?: TMessageContext;
	timestamp: number;
};

declare global {
	interface Window {
		haibunCapturedMessages: TLogEntry[];
		receiveLogData: (logEntry: { level: TLogLevel; message: TLogArgs; messageContext?: TMessageContext, timestamp: number }) => void;
		webSocket?: WebSocket;
	}
}

window.haibunCapturedMessages = window.haibunCapturedMessages || [];
console.info('monitor.ts: window.haibunCapturedMessages initialized.');

// Function exposed to Playwright to receive new logs
window.receiveLogData = (logEntry) => {
	window.haibunCapturedMessages.push(logEntry);
	renderLogEntry(logEntry);
};

export function renderLogEntry(logEntryData: TLogEntry) {
	const { level, message, messageContext, timestamp } = logEntryData;
	const container = document.getElementById('haibun-log-display-area');

	const logEntry = new LogEntry(level, timestamp, message, messageContext);
	const logEntryElement = logEntry.element;

	container.appendChild(logEntryElement);

	// On STEP_END, find the last active STEP_START entry and hide it
	if (messageContext?.incident === EExecutionMessageType.STEP_END) {
		const activeStepStartEntries = container.querySelectorAll('.haibun-step-start:not(.disappeared)');
		if (activeStepStartEntries.length > 0) {
			const lastActiveEntry = activeStepStartEntries[activeStepStartEntries.length - 1];
			lastActiveEntry.classList.add('disappeared');
		} else {
			console.warn('Received STEP_END but found no active STEP_START log entry to hide.');
		}
	}

	container.scrollTop = container.scrollHeight;
}
function renderAllLogs() {
	const container = document.getElementById('haibun-log-display-area');
	if (container) {
		console.info(`Rendering ${window.haibunCapturedMessages.length} log entries...`);
		window.haibunCapturedMessages.forEach(renderLogEntry);
	}
}

document.addEventListener('DOMContentLoaded', () => {
	if (!document.body.dataset.startTime) {
		document.body.dataset.startTime = `${Date.now()}`;
	}

	renderAllLogs();
	setupControls();
	console.info("Initial logs rendered.");

});
