import mermaid from 'mermaid';

import { SequenceDiagramGenerator } from './mermaidDiagram.js';
import { TAnyFixme } from '@haibun/core/build/lib/defs.js';
import { TLogLevel, TLogArgs, TMessageContext } from '@haibun/core/build/lib/interfaces/logger.js';
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
	void sequenceDiagramGenerator.update(); // Ignore returned promise
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

	container.appendChild(logEntry.element);

	// Auto-scroll
	if (container.scrollHeight > container.clientHeight) {
		logEntry.element.scrollIntoView({ block: 'end' });
	}
}
function renderAllLogs() {
	const container = document.getElementById('haibun-log-display-area');
	if (container) {
		// container.innerHTML = '<div class="haibun-disappears"><div class="haibun-loader"></div>Rendering logs...</div>'; // Clear and show loader
		window.haibunLogData.forEach(renderLogEntry);
		void sequenceDiagramGenerator.update(); // Ignore returned promise
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
	renderAllLogs(); // Render any logs loaded during rehydration
	setupControls(); // Setup dropdowns, etc.
	console.log("Initial logs rendered.");
});



