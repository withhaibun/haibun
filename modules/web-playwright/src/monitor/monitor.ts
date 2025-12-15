import { TLogLevel, TLogArgs, EExecutionMessageType, TMessageContext } from '@haibun/core/monitor';
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
		HAIBUN_VIEW_MODE?: 'document' | 'timeline';
	}
}

window.haibunCapturedMessages = window.haibunCapturedMessages || [];
console.info('monitor.ts: window.haibunCapturedMessages initialized.');

// Track the number of messages we've already rendered to avoid duplicates
let renderedMessageCount = 0;

// Function exposed to Playwright to receive new logs
window.receiveLogData = (logEntry) => {
	monitorState.isLive = true;
	console.info(`[receiveLogData] Received log entry:`, logEntry.level, logEntry.message.substring(0, 50));
	window.haibunCapturedMessages.push(logEntry);

	// Update start time if this is the first message or earlier than current start
	if (window.haibunCapturedMessages.length === 1 || logEntry.timestamp < monitorState.startTime) {
		monitorState.startTime = logEntry.timestamp;
		// Sync display time base
		document.body.dataset.startTime = `${monitorState.startTime}`;
		// Force visibility update since start time changed
		recalcVisibility(monitorState.currentTime);
		updateTimelineMarkers();
	}

	if (logEntry.timestamp - monitorState.startTime > monitorState.maxTime) {
		monitorState.maxTime = logEntry.timestamp - monitorState.startTime;
	}

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

	if (messageContext?.incident) {
		logEntryElement.dataset.incident = messageContext.incident;
	}

	container.appendChild(logEntryElement);

	// Update context header
	if (messageContext?.incident === EExecutionMessageType.FEATURE_START) {
		const feature = (messageContext.incidentDetails as any).feature as { name?: string, path?: string };
		const text = `Feature: ${feature.name || feature.path}`;
		logEntryElement.dataset.contextText = text;
		const contextEl = document.getElementById('haibun-current-context');
		if (contextEl) contextEl.textContent = text;
	} else if (messageContext?.incident === EExecutionMessageType.SCENARIO_START) {
		const contextEl = document.getElementById('haibun-current-context');
		const scenarioTitle = (messageContext.incidentDetails as any).scenarioTitle || `Scenario ${(messageContext.incidentDetails as any).currentScenario}`;
		logEntryElement.dataset.contextText = scenarioTitle;
		if (contextEl) {
			const current = contextEl.textContent || '';
			if (current.startsWith('Feature: ')) {
				contextEl.textContent = `${current.split(' > ')[0]} > ${scenarioTitle}`;
			} else {
				contextEl.textContent = scenarioTitle;
			}
		}
	} else if (typeof message === 'string') {
		if (message.startsWith('Feature: ')) {
			const contextEl = document.getElementById('haibun-current-context');
			if (contextEl) contextEl.textContent = message;
		} else if (message.startsWith('Scenario: ')) {
			const contextEl = document.getElementById('haibun-current-context');
			if (contextEl) {
				const current = contextEl.textContent || '';
				if (current.startsWith('Feature: ')) {
					contextEl.textContent = `${current.split(' > ')[0]} > ${message}`;
				} else {
					contextEl.textContent = message;
				}
			}
		}
	}

	// On STEP_END, find the last active STEP_START entry and handle it
	if (messageContext?.incident === EExecutionMessageType.STEP_END) {
		const activeStepStartEntries = container.querySelectorAll('.haibun-step-start:not(.disappeared)');
		if (activeStepStartEntries.length > 0) {
			const lastActiveEntry = activeStepStartEntries[activeStepStartEntries.length - 1] as HTMLElement;

			// Just mark as disappeared - don't add failed class to STEP_START
			// The STEP_END entry itself will have the failed class if needed
			lastActiveEntry.classList.add('disappeared');
			lastActiveEntry.dataset.endTime = `${timestamp}`;

			// Check failure
			const incidentDetails = messageContext.incidentDetails as Record<string, unknown> | undefined;
			const actionResult = incidentDetails?.actionResult as { ok?: boolean } | undefined;
			if (actionResult?.ok === false) {
				markTimelineError(lastActiveEntry.dataset.time);
			}
		} else {
			console.warn('Received STEP_END but found no active STEP_START log entry to hide.');
		}
	}

	// Store seqPath if available
	const incidentDetails = messageContext?.incidentDetails as Record<string, unknown> | undefined;
	const featureStep = incidentDetails?.featureStep as { seqPath?: string | unknown[] } | undefined;
	if (featureStep?.seqPath) {
		const val = Array.isArray(featureStep.seqPath) ? featureStep.seqPath.join('.') : featureStep.seqPath;
		logEntryElement.dataset.seqPath = val;
	}

	// On ENSURE_END, find the last active ENSURE_START entry and handle it
	if (messageContext?.incident === EExecutionMessageType.ENSURE_END) {
		const activeEnsureStartEntries = container.querySelectorAll('.haibun-ensure-start:not(.disappeared)');
		if (activeEnsureStartEntries.length > 0) {
			const lastActiveEntry = activeEnsureStartEntries[activeEnsureStartEntries.length - 1] as HTMLElement;

			// Check if this ensure failed
			const incidentDetails = messageContext.incidentDetails as Record<string, unknown> | undefined;
			const actionResult = incidentDetails?.actionResult as { ok?: boolean } | undefined;
			const ensureFailed = actionResult?.ok === false;

			if (ensureFailed) {
				// Mark as failed so it stays visible regardless of log level
				lastActiveEntry.classList.add('haibun-ensure-failed');
				markTimelineError(lastActiveEntry.dataset.time);
			}

			// Hide the ensure-start marker (but failed ensures will remain visible via CSS)
			lastActiveEntry.classList.add('disappeared');
			lastActiveEntry.dataset.endTime = `${timestamp}`;
		} else {
			console.warn('Received ENSURE_END but found no active ENSURE_START log entry to hide.');
		}
	}

	// Add timeline marker
	if (messageContext?.incident === EExecutionMessageType.STEP_START || messageContext?.incident === EExecutionMessageType.ENSURE_START) {
		addTimelineMarker(timestamp, messageContext.incident);
	}

	// Move prompt controls to the end
	const promptControls = document.getElementById('haibun-prompt-controls-container');
	if (promptControls) {
		container.appendChild(promptControls);
	}

	// Ensure scrolling happens after DOM update
	// if (monitorState.autoScroll) {
	// 	setTimeout(() => {
	// 		container.scrollTop = container.scrollHeight;
	// 	}, 0);
	// }
}

// --- Monitor State & Time Control ---

const monitorState = {
	isPlaying: true,
	autoScroll: true,
	startTime: 0,
	maxTime: 0,
	currentTime: 0,
	playbackSpeed: 1,
	lastFrameTime: 0,
	lastScrolled: null as HTMLElement | null,
	isLive: false
};

function markTimelineError(timestamp: string | undefined) {
	if (!timestamp) return;
	const markersContainer = document.getElementById('haibun-timeline-markers');
	if (!markersContainer) return;
	const marker = markersContainer.querySelector(`.timeline-marker[data-time="${timestamp}"]`);
	if (marker) {
		marker.classList.add('error');
	}
}

function addTimelineMarker(timestamp: number, type: EExecutionMessageType) {
	const markersContainer = document.getElementById('haibun-timeline-markers');
	if (!markersContainer) return;

	const marker = document.createElement('div');
	marker.className = 'timeline-marker';
	if (type === EExecutionMessageType.ENSURE_START) {
		marker.classList.add('ensure');
	}
	// Store absolute timestamp
	marker.dataset.time = `${timestamp}`;
	markersContainer.appendChild(marker);
	updateTimelineMarkers();
}

function updateTimelineMarkers() {
	const markersContainer = document.getElementById('haibun-timeline-markers');
	if (!markersContainer || monitorState.maxTime === 0) return;

	const markers = markersContainer.children;
	for (let i = 0; i < markers.length; i++) {
		const marker = markers[i] as HTMLElement;
		const timestamp = parseInt(marker.dataset.time || '0', 10);
		const relativeTime = timestamp - monitorState.startTime;
		const percent = (relativeTime / monitorState.maxTime) * 100;
		marker.style.left = `${percent}%`;
	}
}

function updatePlayPauseButton() {
	const btn = document.getElementById('haibun-play-pause');
	if (!btn) return;

	if (monitorState.isPlaying) {
		if (monitorState.autoScroll) {
			btn.textContent = '⏸️'; // Pause
			btn.title = "Pause";
		} else {
			btn.textContent = '🔦'; // Resume AutoScroll (Guided)
			btn.title = "Resume Auto-Scroll";
		}
	} else {
		btn.textContent = '▶️'; // Play
		btn.title = "Play";
	}
}

function setupTimeControls() {
	const slider = document.getElementById('haibun-time-slider') as HTMLInputElement;
	const playPauseBtn = document.getElementById('haibun-play-pause') as HTMLButtonElement;
	const timeDisplay = document.getElementById('haibun-time-display') as HTMLSpanElement;
	const viewToggle = document.getElementById('haibun-view-toggle') as HTMLInputElement;
	const speedSelect = document.getElementById('haibun-playback-speed') as HTMLSelectElement;
	const container = document.getElementById('haibun-log-display-area');

	// Use the first log entry's timestamp as start time if available, otherwise fallback to body dataset or Date.now()
	if (window.haibunCapturedMessages && window.haibunCapturedMessages.length > 0) {
		monitorState.startTime = window.haibunCapturedMessages.reduce((min, m) => Math.min(min, m.timestamp), window.haibunCapturedMessages[0].timestamp);
		const lastTimestamp = window.haibunCapturedMessages.reduce((max, m) => Math.max(max, m.timestamp), window.haibunCapturedMessages[0].timestamp);
		monitorState.maxTime = lastTimestamp - monitorState.startTime;
		// If we have captured messages, we are likely in replay mode, so start paused
		monitorState.isPlaying = false;
		monitorState.autoScroll = false;

		// Set current time to end
		monitorState.currentTime = monitorState.maxTime;

		// Update slider and display immediately
		if (slider) {
			slider.max = `${monitorState.maxTime}`;
			slider.value = `${monitorState.currentTime}`;
		}
		if (timeDisplay) {
			timeDisplay.textContent = `${(monitorState.currentTime / 1000).toFixed(3)}s`;
		}

		// Force visibility update for the end state
		setTimeout(() => {
			recalcVisibility(monitorState.currentTime, true);
		}, 100);
	} else {
		monitorState.startTime = parseInt(document.body.dataset.startTime || `${Date.now()}`, 10);
	}
	// Sync display time base
	document.body.dataset.startTime = `${monitorState.startTime}`;

	const dateEl = document.getElementById('haibun-date');
	if (dateEl) {
		dateEl.textContent = new Date(monitorState.startTime).toISOString();
	}

	monitorState.lastFrameTime = Date.now();

	if (container) {
		const stopAutoScroll = () => {
			if (monitorState.isPlaying && monitorState.autoScroll) {
				monitorState.autoScroll = false;
				updatePlayPauseButton();
			}
		};

		// Rely on explicit user interaction to stop auto-scroll, rather than the generic 'scroll' event
		// which can be triggered by layout shifts or programmatic scrolling in some environments (like Playwright).
		container.addEventListener('wheel', stopAutoScroll, { passive: true });
		container.addEventListener('touchmove', stopAutoScroll, { passive: true });
		container.addEventListener('mousedown', stopAutoScroll);
		container.addEventListener('keydown', stopAutoScroll);
	}

	updatePlayPauseButton();

	playPauseBtn.addEventListener('click', () => {
		if (monitorState.isPlaying && !monitorState.autoScroll) {
			// Resume AutoScroll
			monitorState.autoScroll = true;
			updatePlayPauseButton();
			// Force scroll immediately
			recalcVisibility(monitorState.currentTime, true);
			return;
		}

		// Restart if at end and not live
		if (!monitorState.isPlaying && monitorState.currentTime >= monitorState.maxTime && !monitorState.isLive) {
			monitorState.currentTime = 0;
			// Reset slider and display
			if (slider) slider.value = '0';
			if (timeDisplay) timeDisplay.textContent = '0.000s';
			recalcVisibility(0, true);
		}

		monitorState.isPlaying = !monitorState.isPlaying;
		if (monitorState.isPlaying) {
			monitorState.autoScroll = true;
			monitorState.lastFrameTime = Date.now();
			updateTimeLoop();
		}
		updatePlayPauseButton();
	});

	if (speedSelect) {
		speedSelect.addEventListener('change', (e) => {
			monitorState.playbackSpeed = parseFloat((e.target as HTMLSelectElement).value);
		});
	}

	slider.addEventListener('input', (e) => {
		monitorState.isPlaying = false;
		monitorState.autoScroll = false;
		updatePlayPauseButton();
		const val = parseInt((e.target as HTMLInputElement).value, 10);
		monitorState.currentTime = val;
		recalcVisibility(val, true);
		timeDisplay.textContent = `${(val / 1000).toFixed(3)}s`;
	});

	if (viewToggle) {
		const initialMode = window.HAIBUN_VIEW_MODE || 'timeline';
		const timeControls = document.getElementById('haibun-time-controls');

		if (initialMode === 'document') {
			document.body.classList.add('view-documentation');
			viewToggle.checked = true;
			if (timeControls) timeControls.style.visibility = 'hidden';
		} else {
			document.body.classList.remove('view-documentation');
			viewToggle.checked = false;
			if (timeControls) timeControls.style.visibility = 'visible';
		}

		viewToggle.addEventListener('change', (e) => {
			if ((e.target as HTMLInputElement).checked) {
				document.body.classList.add('view-documentation');
				if (timeControls) timeControls.style.visibility = 'hidden';
			} else {
				document.body.classList.remove('view-documentation');
				if (timeControls) timeControls.style.visibility = 'visible';
			}
		});
	}

	const statementInput = document.getElementById('haibun-statement-input');
	if (statementInput) {
		statementInput.addEventListener('input', () => {
			monitorState.currentTime = monitorState.maxTime;
			monitorState.autoScroll = true;
			recalcVisibility(monitorState.currentTime);

			const slider = document.getElementById('haibun-time-slider') as HTMLInputElement;
			if (slider) slider.value = `${monitorState.currentTime}`;

			const timeDisplay = document.getElementById('haibun-time-display') as HTMLSpanElement;
			if (timeDisplay) timeDisplay.textContent = `${(monitorState.currentTime / 1000).toFixed(3)}s`;
		});
	}

	updateTimeLoop();
}

function updateTimeLoop() {
	if (!monitorState.isPlaying) return;

	const now = Date.now();
	const delta = now - monitorState.lastFrameTime;
	monitorState.lastFrameTime = now;

	// If we are "live" (maxTime is increasing), we just follow real time
	// But if we are replaying, we use speed.
	// Actually, simpler: always use speed for currentTime advancement.
	// But we need to know if we are at the "head" (live).

	// Calculate "live" elapsed time
	const liveElapsed = now - monitorState.startTime;

	// If we are close to live edge, just sync to live (unless speed != 1)
	// But user asked for slowdown control for replaying.

	if (monitorState.playbackSpeed !== 1 || monitorState.currentTime < monitorState.maxTime - 100) {
		monitorState.currentTime += delta * monitorState.playbackSpeed;
	} else {
		// Live mode (speed 1, at head)
		// Ensure we are at least at maxTime to show latest messages immediately (handles client clock lag)
		// monitorState.currentTime = Math.max(liveElapsed, monitorState.maxTime);
	}

	// Update maxTime to be at least liveElapsed (if we are receiving new data)
	// But if we are just viewing a static file, maxTime is fixed?
	// In this monitor, we assume we might be receiving data.
	if (monitorState.isLive && liveElapsed > monitorState.maxTime) {
		monitorState.maxTime = liveElapsed;
	}

	// Cap currentTime at maxTime
	if (monitorState.currentTime > monitorState.maxTime) {
		monitorState.currentTime = monitorState.maxTime;

		// Stop if at end and not live (replay finished)
		if (monitorState.isPlaying && !monitorState.isLive) {
			monitorState.isPlaying = false;
			updatePlayPauseButton();
		}
	}

	const slider = document.getElementById('haibun-time-slider') as HTMLInputElement;
	const timeDisplay = document.getElementById('haibun-time-display') as HTMLSpanElement;

	if (slider) {
		slider.max = `${monitorState.maxTime}`;
		slider.value = `${monitorState.currentTime}`;
	}
	if (timeDisplay) {
		timeDisplay.textContent = `${(monitorState.currentTime / 1000).toFixed(3)}s`;
	}

	recalcVisibility(monitorState.currentTime);
	updateTimelineMarkers();

	requestAnimationFrame(updateTimeLoop);
}

function recalcVisibility(timeMs: number, forceScroll = false) {
	const container = document.getElementById('haibun-log-display-area');
	if (!container) return;

	const entries = container.querySelectorAll('.haibun-log-entry');
	let lastVisible: HTMLElement | null = null;
	let currentFeatureText = '';
	let currentScenarioText = '';

	// Reset highlights
	entries.forEach(e => e.classList.remove('haibun-log-entry-current'));

	for (let i = 0; i < entries.length; i++) {
		const el = entries[i] as HTMLElement;
		const entryTime = parseInt(el.dataset.time || '0', 10) - monitorState.startTime;

		if (entryTime > timeMs + 250) {
			el.classList.add('invisible-future');
			continue;
		}

		if (el.dataset.incident === 'FEATURE_START') {
			currentFeatureText = el.dataset.contextText || '';
			currentScenarioText = '';
		} else if (el.dataset.incident === 'SCENARIO_START') {
			currentScenarioText = el.dataset.contextText || '';
		}

		el.classList.remove('invisible-future');

		if (el.dataset.endTime) {
			const endTime = parseInt(el.dataset.endTime, 10) - monitorState.startTime;
			if (endTime <= timeMs) {
				el.classList.add('disappeared');
				continue;
			} else {
				el.classList.remove('disappeared');
			}
		}

		lastVisible = el;
	}

	// Handle placeholders visibility: hide them if the content they represent is in the future
	const placeholders = container.querySelectorAll('.haibun-log-depth-placeholder');
	placeholders.forEach(p => {
		const el = p as HTMLElement;
		const next = el.nextElementSibling as HTMLElement;
		// If the next element (the first hidden log entry) is future, hide the placeholder
		if (next && next.classList.contains('invisible-future')) {
			el.classList.add('invisible-future');
		} else {
			el.classList.remove('invisible-future');
		}
	});

	const videos = document.querySelectorAll('video');
	if (videos.length > 0) {
		videos.forEach(v => {
			try {
				v.currentTime = timeMs / 1000;
				v.pause();
			} catch (e) {
				console.error('Error updating video time:', e);
			}
		});
	}

	const contextEl = document.getElementById('haibun-current-context');
	if (contextEl) {
		if (currentFeatureText && currentScenarioText) {
			contextEl.textContent = `${currentFeatureText} > ${currentScenarioText}`;
		} else if (currentFeatureText) {
			contextEl.textContent = currentFeatureText;
		} else if (currentScenarioText) {
			contextEl.textContent = currentScenarioText;
		}
	}

	if (lastVisible) {
		lastVisible.classList.add('haibun-log-entry-current');

		if (forceScroll || (monitorState.autoScroll && lastVisible !== monitorState.lastScrolled)) {
			lastVisible.scrollIntoView({ block: 'center', behavior: 'auto' });
			monitorState.lastScrolled = lastVisible;
		}
	}
}

/**
 * Parses the JSON island and feeds data into the monitor in digestible chunks.
 */
function startLazyIngestion() {
	const dataScript = document.getElementById('haibun-log-data');

	// 1. If we are in "Live" mode (no data script), set up controls and return
	if (!dataScript) {
		setupControls(); // Initialize controls for live mode
		if (window.haibunCapturedMessages && window.haibunCapturedMessages.length > 0) {
			renderAllLogsSynchronously(); // Fallback for legacy format
		}
		return;
	}

	// 2. Parse the JSON.
	// This is the only heavy synchronous operation, but it is much faster than JS compilation.
	let allLogs: TLogEntry[] = [];
	try {
		allLogs = JSON.parse(dataScript.textContent || '[]');
	} catch (e) {
		console.error("Failed to parse log data:", e);
		return;
	}

	// Populate the global array so other tools can access it
	window.haibunCapturedMessages = allLogs;

	// Initialize start times based on the full dataset
	if (allLogs.length > 0) {
		monitorState.startTime = allLogs.reduce((min, m) => Math.min(min, m.timestamp), allLogs[0].timestamp);
		const lastTimestamp = allLogs.reduce((max, m) => Math.max(max, m.timestamp), allLogs[0].timestamp);
		monitorState.maxTime = lastTimestamp - monitorState.startTime;
		monitorState.currentTime = monitorState.maxTime;

		// Update UI initial state
		const slider = document.getElementById('haibun-time-slider') as HTMLInputElement;
		if (slider) {
			slider.max = `${monitorState.maxTime}`;
			slider.value = `${monitorState.currentTime}`;
		}

		const dateEl = document.getElementById('haibun-date');
		if (dateEl) {
			dateEl.textContent = new Date(monitorState.startTime).toISOString();
		}
	}

	// Initialize controls before rendering (sets up log level filter)
	setupControls();

	// 3. The Chunking Loop
	let currentIndex = 0;
	const CHUNK_SIZE = 100; // Adjust this: Lower = smoother UI, Higher = faster loading

	function processNextChunk() {
		const end = Math.min(currentIndex + CHUNK_SIZE, allLogs.length);

		for (let i = currentIndex; i < end; i++) {
			// We call renderLogEntry directly instead of receiveLogData
			// to avoid re-pushing to the window.haibunCapturedMessages array
			renderLogEntry(allLogs[i]);
			renderedMessageCount++;
		}

		currentIndex += CHUNK_SIZE;

		if (currentIndex < allLogs.length) {
			// Yield control to the browser to keep the UI responsive
			requestAnimationFrame(processNextChunk);
		} else {
			console.info(`Finished ingesting ${allLogs.length} logs.`);
			// Finalize UI state
			recalcVisibility(monitorState.currentTime, true);
		}
	}

	console.info("Starting lazy log ingestion...");
	processNextChunk();
}

/**
 * Fallback for legacy format (window.haibunCapturedMessages already populated)
 */
function renderAllLogsSynchronously() {
	const container = document.getElementById('haibun-log-display-area');
	if (container) {
		const messagesToRender = window.haibunCapturedMessages.slice(renderedMessageCount);
		console.info(`Rendering ${messagesToRender.length} new log entries (legacy mode)...`);
		messagesToRender.forEach(logEntry => {
			renderLogEntry(logEntry);
			renderedMessageCount++;
		});
		setupControls();
	}
}

document.addEventListener('DOMContentLoaded', () => {
	if (!document.body.dataset.startTime) {
		document.body.dataset.startTime = `${Date.now()}`;
	}

	setupTimeControls();

	// Replace the old renderAllLogs call with the lazy loader
	startLazyIngestion();

	console.info("Monitor initialized.");
});
