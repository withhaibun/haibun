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

	// On STEP_START, add 'haibun-disappears' class to the log entry
	if (messageContext?.incident === EExecutionMessageType.STEP_START) {
		logEntryElement.classList.add('haibun-disappears');
	}

	// On STEP_END, find all elements with 'haibun-disappears' and add 'disappeared'
	if (messageContext?.incident === EExecutionMessageType.STEP_END) {
		const entriesToHide = container.querySelectorAll('.haibun-disappears');
		entriesToHide.forEach(entry => {
			entry.classList.add('disappeared');
			// Optionally remove the marker class now that it's disappeared
			// entry.classList.remove('haibun-disappears');
		});
		// No warning needed here, as it's okay if nothing needs hiding
	}

	// Auto-scroll (move this after appending and potential modifications)
	if (container.scrollHeight > container.clientHeight) {
		logEntryElement.scrollIntoView({ block: 'end' });
	}
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



