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

	// On STEP_END, find the last active STEP_START entry and handle it
	if (messageContext?.incident === EExecutionMessageType.STEP_END) {
		const activeStepStartEntries = container.querySelectorAll('.haibun-step-start:not(.disappeared)');
		if (activeStepStartEntries.length > 0) {
			const lastActiveEntry = activeStepStartEntries[activeStepStartEntries.length - 1];

			// Just mark as disappeared - don't add failed class to STEP_START
			// The STEP_END entry itself will have the failed class if needed
			lastActiveEntry.classList.add('disappeared');
		} else {
			console.warn('Received STEP_END but found no active STEP_START log entry to hide.');
		}
	}

	// On ENSURE_END, find the last active ENSURE_START entry and handle it
	if (messageContext?.incident === EExecutionMessageType.ENSURE_END) {
		const activeEnsureStartEntries = container.querySelectorAll('.haibun-ensure-start:not(.disappeared)');
		if (activeEnsureStartEntries.length > 0) {
			const lastActiveEntry = activeEnsureStartEntries[activeEnsureStartEntries.length - 1];

			// Check if this ensure failed
			const incidentDetails = messageContext.incidentDetails as Record<string, unknown> | undefined;
			const actionResult = incidentDetails?.actionResult as { ok?: boolean } | undefined;
			const ensureFailed = actionResult?.ok === false;

			if (ensureFailed) {
				// Mark as failed so it stays visible regardless of log level
				lastActiveEntry.classList.add('haibun-ensure-failed');
			}

			// Hide the ensure-start marker (but failed ensures will remain visible via CSS)
			lastActiveEntry.classList.add('disappeared');
		} else {
			console.warn('Received ENSURE_END but found no active ENSURE_START log entry to hide.');
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
