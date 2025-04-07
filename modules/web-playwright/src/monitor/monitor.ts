import mermaid from 'mermaid';

import { SequenceDiagramGenerator } from './mermaidDiagram.js';
import { TAnyFixme } from '@haibun/core/build/lib/defs.js';
import { TLogLevel, TLogArgs, TMessageContext, EExecutionMessageType } from '@haibun/core/build/lib/interfaces/logger.js'; // Moved EExecutionMessageType here
import { LogEntry } from './messages.js';
import { setupControls } from './controls.js';

declare global {
	interface Window {
		haibunLogData: TAnyFixme[];
		receiveLogData: (logEntry: { level: TLogLevel; message: TLogArgs; messageContext?: TMessageContext, timestamp: number }) => void;
	}
}

window.haibunLogData = window.haibunLogData || [];
console.log('monitor', window.haibunLogData);

// Function exposed to Playwright to receive new logs
window.receiveLogData = (logEntry) => {
	window.haibunLogData.push(logEntry);
	renderLogEntry(logEntry);
	void sequenceDiagramGenerator.update();
};

export const sequenceDiagramGenerator = new SequenceDiagramGenerator();

function renderLogEntry(logEntryData: { level: TLogLevel; message: TLogArgs; messageContext?: TMessageContext, timestamp: number }) {
	const { level, message, messageContext, timestamp } = logEntryData;
	const container = document.getElementById('haibun-log-display-area');
	if (!container) {
		console.error('Could not find log display area #haibun-log-display-area');
		return;
	}

	const logEntry = new LogEntry(level, timestamp, message, messageContext);
	const logEntryElement = logEntry.element; // Get the actual DOM element

	container.appendChild(logEntryElement);

	// On STEP_END, find the last active STEP_START entry and hide it
	if (messageContext?.incident === EExecutionMessageType.STEP_END) {
		// Find the last .haibun-step-start element that does NOT have .disappeared
		const activeStepStartEntries = container.querySelectorAll('.haibun-step-start:not(.disappeared)');
		if (activeStepStartEntries.length > 0) {
			const lastActiveEntry = activeStepStartEntries[activeStepStartEntries.length - 1];
			lastActiveEntry.classList.add('disappeared');
		} else {
			// Warn if STEP_END received but no active STEP_START found
			console.warn('Received STEP_END but found no active STEP_START log entry to hide.');
		}
	}
	// Note: The .haibun-step-start class is added in messages.ts LogEntry constructor

	// Auto-scroll the container to the bottom
	container.scrollTop = container.scrollHeight;
}
function renderAllLogs() {
	const container = document.getElementById('haibun-log-display-area');
	if (container) {
		window.haibunLogData.forEach(renderLogEntry);
		void sequenceDiagramGenerator.update();
	}
}

// Initial render on page load
document.addEventListener('DOMContentLoaded', () => {
	console.log("Monitor DOMContentLoaded");
	// Set start time on body for relative calculations
	if (!document.body.dataset.startTime) {
		document.body.dataset.startTime = `${Date.now()}`;
	}
	mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
	renderAllLogs();
	setupControls();
	console.log("Initial logs rendered.");
});



