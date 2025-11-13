import { TLogLevel, TLogArgs, EExecutionMessageType, TMessageContext } from '@haibun/core/lib/interfaces/logger.js';
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
		showStatementInput: () => void;
		hideStatementInput: () => void;
		submitStatement: (statement: string) => void;
	}
}

window.haibunCapturedMessages = window.haibunCapturedMessages || [];
console.info('monitor.ts: window.haibunCapturedMessages initialized.');

// Track the number of messages we've already rendered to avoid duplicates
let renderedMessageCount = 0;

// Function exposed to Playwright to receive new logs
window.receiveLogData = (logEntry) => {
	console.info(`[receiveLogData] Received log entry:`, logEntry.level, logEntry.message.substring(0, 50));
	window.haibunCapturedMessages.push(logEntry);
	renderedMessageCount++;
	renderLogEntry(logEntry);
};

// Functions for statement input control
window.showStatementInput = () => {
	const statementInput = document.getElementById('haibun-statement-input') as HTMLInputElement;
	if (statementInput) {
		statementInput.style.display = 'inline-block';
		statementInput.focus();
	}
};

window.hideStatementInput = () => {
	const statementInput = document.getElementById('haibun-statement-input') as HTMLInputElement;
	if (statementInput) {
		statementInput.style.display = 'none';
		statementInput.value = '';
	}
};

window.submitStatement = (statement: string) => {
	if (typeof window.haibunSubmitStatement === 'function') {
		window.haibunSubmitStatement(statement);
	}
	window.hideStatementInput();
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

	// Ensure scrolling happens after DOM update
	setTimeout(() => {
		container.scrollTop = container.scrollHeight;
	}, 0);
}

// ...existing code...

function renderAllLogs() {
	const container = document.getElementById('haibun-log-display-area');
	if (container) {
		// Only render messages that haven't been rendered yet
		const messagesToRender = window.haibunCapturedMessages.slice(renderedMessageCount);
		console.info(`Rendering ${messagesToRender.length} new log entries (already had ${renderedMessageCount})...`);
		messagesToRender.forEach(logEntry => {
			renderLogEntry(logEntry);
			renderedMessageCount++;
		});
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
