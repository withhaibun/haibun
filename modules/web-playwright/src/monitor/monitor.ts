import mermaid from 'mermaid';

import { SequenceDiagramGenerator } from './mermaidDiagram.js';
import { TAnyFixme } from '@haibun/core/build/lib/defs.js';
import { TLogLevel, TLogArgs, TMessageContext } from '@haibun/core/build/lib/interfaces/logger.js';
import { logMessageDetails, logMessageContent } from './messages.js';
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
	sequenceDiagramGenerator.update();
};

export const sequenceDiagramGenerator = new SequenceDiagramGenerator();

function renderLogEntry(logEntry: { level: TLogLevel; message: TLogArgs; messageContext?: TMessageContext, timestamp: number }) {
	const { level, message, messageContext, timestamp } = logEntry;
	const container = document.getElementById('haibun-log-display-area');
	const logContainer = document.createElement('div');
	logContainer.classList.add('haibun-log-container', `haibun-level-${level}`);
	logContainer.dataset.time = `${timestamp}`;

	const messageDetailsDiv = logMessageDetails(level, timestamp);
	// const messageContentDiv = logMessageContent(message, messageContext);
	logContainer.appendChild(messageDetailsDiv);
	// logContainer.appendChild(messageContentDiv);
	container.appendChild(logContainer);

	// Auto-scroll
	if (container.scrollHeight > container.clientHeight) {
		logContainer.scrollIntoView({ block: 'end' });
	}
}
function renderAllLogs() {
	const container = document.getElementById('haibun-log-display-area');
	if (container) {
		// container.innerHTML = '<div class="haibun-disappears"><div class="haibun-loader"></div>Rendering logs...</div>'; // Clear and show loader
		window.haibunLogData.forEach(renderLogEntry);
		sequenceDiagramGenerator.update();
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



