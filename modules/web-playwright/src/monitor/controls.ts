// Browser-safe TPrompt type (mirrors @haibun/core/lib/prompter.ts without Node.js deps)
type TPrompt = { id: string; message: string; context?: unknown, options?: string[] };
import { LOG_LEVELS, LOG_LEVEL_TRACE } from '@haibun/core/monitor';


declare global {
	interface Window {
		haibunResolvePrompt: (id: string, action: string) => void;
		showPromptControls: (prompts: string) => void;
		hidePromptControls: () => void;
		showStatementInput: () => void;
		hideStatementInput: () => void;
		submitStatement: (statement: string) => void;
	}
}

let currentMaxDepth = 6;
let currentLogLevel: string = LOG_LEVEL_TRACE;

function isVisibleByLevel(entry: HTMLElement): boolean {
	if (entry.classList.contains('disappeared') &&
		!entry.classList.contains('haibun-step-failed') &&
		!entry.classList.contains('haibun-ensure-failed')) {
		return false;
	}

	// Hide successful ENSURE_END entries
	if (entry.classList.contains('haibun-ensure-end') && !entry.classList.contains('haibun-ensure-failed')) {
		return false;
	}

	// Always show failed steps/ensures
	if (entry.classList.contains('haibun-step-failed') || entry.classList.contains('haibun-ensure-failed')) {
		return true;
	}

	// Always show the current executing line
	if (entry.classList.contains('haibun-log-entry-current')) {
		return true;
	}

	// Always show active step/ensure starts
	if ((entry.classList.contains('haibun-step-start') || entry.classList.contains('haibun-ensure-start')) &&
		!entry.classList.contains('disappeared')) {
		return true;
	}

	// Check log level
	const selectedIndex = LOG_LEVELS.indexOf(currentLogLevel as typeof LOG_LEVELS[number]);
	let entryLevelIndex = -1;

	for (let i = 0; i < LOG_LEVELS.length; i++) {
		if (entry.classList.contains(`haibun-level-${LOG_LEVELS[i]}`)) {
			entryLevelIndex = i;
			break;
		}
	}

	if (entryLevelIndex !== -1 && entryLevelIndex < selectedIndex) {
		return false;
	}

	return true;
}

function applyDepthFilter() {
	const container = document.getElementById('haibun-log-display-area');
	if (!container) return;

	// Remove all existing placeholders to ensure clean state
	const placeholders = container.querySelectorAll('.haibun-log-depth-placeholder');
	placeholders.forEach(p => p.remove());

	const entries = Array.from(container.children) as HTMLElement[];
	let hiddenCount = 0;
	let hiddenGroupStart: HTMLElement | null = null;
	let hiddenGroupMaxDepth = 0;

	entries.forEach(entry => {
		if (!entry.classList.contains('haibun-log-entry')) return;

		// If the entry is hidden by level filter, ignore it completely (don't count, don't break group)
		if (!isVisibleByLevel(entry)) {
			// Ensure it doesn't have the depth-hidden class so it doesn't interfere with level hiding
			entry.classList.remove('haibun-log-depth-hidden');
			return;
		}

		const depth = parseInt(entry.dataset.depth || '0', 10);

		if (depth > currentMaxDepth && !entry.classList.contains('haibun-log-entry-current')) {
			entry.classList.add('haibun-log-depth-hidden');
			if (hiddenCount === 0) {
				hiddenGroupStart = entry;
				hiddenGroupMaxDepth = depth;
			} else {
				hiddenGroupMaxDepth = Math.max(hiddenGroupMaxDepth, depth);
			}
			hiddenCount++;
		} else {
			entry.classList.remove('haibun-log-depth-hidden');

			if (hiddenCount > 0 && hiddenGroupStart) {
				insertPlaceholder(container, hiddenGroupStart, hiddenCount, hiddenGroupMaxDepth);
				hiddenCount = 0;
				hiddenGroupStart = null;
				hiddenGroupMaxDepth = 0;
			}
		}
	});

	if (hiddenCount > 0 && hiddenGroupStart) {
		insertPlaceholder(container, hiddenGroupStart, hiddenCount, hiddenGroupMaxDepth);
	}
}

function insertPlaceholder(container: HTMLElement, refNode: HTMLElement, count: number, maxDepth: number) {
	const placeholder = document.createElement('div');
	placeholder.className = 'haibun-log-depth-placeholder';
	placeholder.textContent = `~~${count} lines filtered out up to depth ${maxDepth}~~`;
	placeholder.style.marginLeft = `${currentMaxDepth * 5}px`;
	placeholder.style.cursor = 'pointer';
	placeholder.title = 'Click to show these lines';
	placeholder.onclick = () => {
		const depthInput = document.getElementById('haibun-log-depth') as HTMLSelectElement;
		if (depthInput) {
			// Add option if it doesn't exist
			let optionExists = false;
			for (let i = 0; i < depthInput.options.length; i++) {
				if (depthInput.options[i].value === maxDepth.toString()) {
					optionExists = true;
					break;
				}
			}
			if (!optionExists) {
				const option = document.createElement('option');
				option.value = maxDepth.toString();
				option.textContent = maxDepth.toString();
				depthInput.appendChild(option);
			}

			depthInput.value = maxDepth.toString();
			depthInput.dispatchEvent(new Event('change'));
		}
	};
	container.insertBefore(placeholder, refNode);
}

export function setupControls() {
	const levelSelect = document.getElementById('haibun-debug-level-select') as HTMLSelectElement;
	const depthInput = document.getElementById('haibun-log-depth') as HTMLSelectElement;

	const updateStyles = (selectedLevel: string, maxDepth: number) => {
		currentMaxDepth = maxDepth;
		currentLogLevel = selectedLevel as typeof LOG_LEVELS[number];
		const selectedIndex = LOG_LEVELS.indexOf(selectedLevel as typeof LOG_LEVELS[number]);
		let css = '';
		LOG_LEVELS.forEach((level, index) => {
			if (index < selectedIndex) {
				// Hide entries below selected level, but NOT active step-start/ensure-start entries or failed steps/ensures
				css += `div.haibun-log-entry.haibun-level-${level}:not(.haibun-step-start):not(.haibun-ensure-start):not(.haibun-step-failed):not(.haibun-ensure-failed) { display: none; }\n`;
				// Also hide step-start entries that have disappeared (completed) unless they're failed
				css += `div.haibun-log-entry.haibun-level-${level}.haibun-step-start.disappeared:not(.haibun-step-failed) { display: none; }\n`;
				// Also hide ensure-start entries that have disappeared (completed) unless they're failed
				css += `div.haibun-log-entry.haibun-level-${level}.haibun-ensure-start.disappeared:not(.haibun-ensure-failed) { display: none; }\n`;
			} else {
				// Show entries at or above selected level that haven't disappeared
				css += `div.haibun-log-entry.haibun-level-${level}:not(.disappeared):not(.invisible-future) { display: flex; }\n`;
				// Also show active step-starts even if they would normally be hidden
				css += `div.haibun-log-entry.haibun-level-${level}.haibun-step-start:not(.disappeared):not(.invisible-future) { display: flex; }\n`;
				// Also show active ensure-starts even if they would normally be hidden
				css += `div.haibun-log-entry.haibun-level-${level}.haibun-ensure-start:not(.disappeared):not(.invisible-future) { display: flex; }\n`;
			}
		});

		// Show all active (not disappeared) step-start entries regardless of level
		css += `div.haibun-log-entry.haibun-step-start:not(.disappeared):not(.invisible-future) { display: flex !important; }\n`;
		// Show all active (not disappeared) ensure-start entries regardless of level
		css += `div.haibun-log-entry.haibun-ensure-start:not(.disappeared):not(.invisible-future) { display: flex !important; }\n`;
		// Hide all disappeared entries UNLESS they're failed or current
		css += `div.haibun-log-entry.disappeared:not(.haibun-step-failed):not(.haibun-ensure-failed):not(.haibun-log-entry-current) { display: none !important; }\n`;
		// Always show failed steps regardless of disappeared state or log level
		css += `div.haibun-log-entry.haibun-step-failed:not(.invisible-future) { display: flex !important; }\n`;
		// Always show failed ensures regardless of disappeared state or log level
		css += `div.haibun-log-entry.haibun-ensure-failed:not(.invisible-future) { display: flex !important; }\n`;
		// Hide successful ENSURE_END entries (they're just for signaling, not display), unless current
		css += `div.haibun-log-entry.haibun-ensure-end:not(.haibun-ensure-failed):not(.haibun-log-entry-current) { display: none !important; }\n`;

		let styleElement = document.getElementById('haibun-dynamic-styles');
		if (!styleElement) {
			styleElement = document.createElement('style');
			styleElement.id = 'haibun-dynamic-styles';
			document.head.appendChild(styleElement);
		}
		styleElement.textContent = css;

		applyDepthFilter();
	};

	// Populate the select options from LOG_LEVELS (only if empty)
	if (levelSelect.options.length === 0) {
		LOG_LEVELS.forEach((level) => {
			const option = document.createElement('option');
			option.value = level;
			option.textContent = level.charAt(0).toUpperCase() + level.slice(1);
			if (level === LOG_LEVEL_TRACE) {
				option.selected = true;
			}
			levelSelect.appendChild(option);
		});
	}

	// Hard code default to trace
	levelSelect.value = LOG_LEVEL_TRACE;
	const initialDepth = depthInput ? parseInt(depthInput.value, 10) : 6;
	updateStyles(LOG_LEVEL_TRACE, initialDepth);

	if (levelSelect) {
		levelSelect.addEventListener('change', (event) => {
			const target = event.target as HTMLSelectElement;
			const currentDepth = depthInput ? parseInt(depthInput.value, 10) : 6;
			updateStyles(target.value, currentDepth);
		});
	}

	if (depthInput) {
		depthInput.addEventListener('change', (event) => {
			const target = event.target as HTMLSelectElement;
			const currentLevel = levelSelect ? levelSelect.value : LOG_LEVEL_TRACE;
			updateStyles(currentLevel, parseInt(target.value, 10));
		});
	}

	setupStatementInput();
	setupVideoPlayback();

	// Add MutationObserver for depth filtering
	const logDisplayArea = document.getElementById('haibun-log-display-area');
	if (logDisplayArea) {
		const observer = new MutationObserver((mutations) => {
			let hasLogUpdates = false;
			for (const m of mutations) {
				m.addedNodes.forEach(node => {
					if (node instanceof Element && node.classList.contains('haibun-log-entry')) {
						hasLogUpdates = true;
					}
				});
			}
			if (hasLogUpdates) applyDepthFilter();
		});
		observer.observe(logDisplayArea, { childList: true });
	}
}

function setupStatementInput() {
	const statementInput = document.getElementById('haibun-statement-input') as HTMLInputElement;
	if (statementInput) {
		statementInput.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				const statement = statementInput.value.trim();
				if (statement) {
					window.submitStatement(statement);
				}
			} else if (event.key === 'Escape') {
				window.hideStatementInput();
			}
		});
	}
}

export function setupVideoPlayback() {
	const sequenceDiagram = document.getElementById('sequence-diagram');

	const diagramObserver = new MutationObserver((mutations) => {
		mutations.forEach((mutation) => {
			if (mutation.type === 'childList' && mutation.addedNodes.length > 0 && mutation.target === sequenceDiagram) {
				console.info('Sequence diagram content detected.');
				diagramObserver.disconnect();
			}
		});
	});

	if (sequenceDiagram) {
		diagramObserver.observe(sequenceDiagram, { childList: true });
	}

	// Ensure correct log entry is scrolled into view on static replay (monitor.html)
	window.addEventListener('load', () => {
		setTimeout(() => {
			const currentLatestEntry = document.querySelector('.haibun-log-entry.haibun-stepper-current') as HTMLElement;
			if (currentLatestEntry) {
				currentLatestEntry.scrollIntoView({ behavior: 'auto', block: 'nearest' });
			}
		}, 0);
	});

	const promptContainer = document.getElementById('haibun-prompt-controls-container');
	const rerunButton = <HTMLButtonElement>document.getElementById('haibun-retry-button');
	const nextButton = <HTMLButtonElement>document.getElementById('haibun-next-button');
	const failButton = <HTMLButtonElement>document.getElementById('haibun-fail-button');
	const stepButton = <HTMLButtonElement>document.getElementById('haibun-step-button');
	const continueButton = <HTMLButtonElement>document.getElementById('haibun-continue-button');
	const messageArea = document.getElementById('haibun-prompt-message');

	// Store current prompt id and options for button actions
	let currentPrompt: TPrompt | undefined;

	window.showPromptControls = (promptsJson) => {
		if (!promptContainer) return;
		const prompts: TPrompt[] = JSON.parse(promptsJson);
		if (!prompts.length) {
			promptContainer.style.display = 'none';
			promptContainer.classList.remove('paused-program-glow');
			if (messageArea) messageArea.textContent = '';
			if (rerunButton) rerunButton.disabled = true;
			if (failButton) failButton.disabled = true;
			if (stepButton) stepButton.disabled = true;
			if (continueButton) continueButton.disabled = true;
			currentPrompt = undefined;
			return;
		}
		// Only show the first outstanding prompt (for classic controls)
		const prompt = prompts[0];
		currentPrompt = prompt;
		if (messageArea) messageArea.textContent = prompt.message;
		// Enable/disable buttons based on options
		if (rerunButton) rerunButton.disabled = !prompt.options?.includes('retry');
		if (nextButton) nextButton.disabled = !prompt.options?.includes('next');
		if (failButton) failButton.disabled = !prompt.options?.includes('fail');
		if (stepButton) stepButton.disabled = !prompt.options?.includes('step');
		if (continueButton) continueButton.disabled = !prompt.options?.includes('continue');
		promptContainer.classList.add('paused-program-glow');
		promptContainer.style.display = 'flex';
	};

	window.hidePromptControls = () => {
		if (!promptContainer) return;
		promptContainer.style.display = 'none';
		promptContainer.classList.remove('paused-program-glow');
		if (messageArea) messageArea.textContent = '';
		if (rerunButton) rerunButton.disabled = true;
		if (failButton) failButton.disabled = true;
		if (stepButton) stepButton.disabled = true;
		if (continueButton) continueButton.disabled = true;
		currentPrompt = undefined;
	};

	if (rerunButton) {
		rerunButton.addEventListener('click', () => {
			if (currentPrompt) window.haibunResolvePrompt(currentPrompt.id, 'retry');
		});
	}
	if (nextButton) {
		nextButton.addEventListener('click', () => {
			if (currentPrompt) window.haibunResolvePrompt(currentPrompt.id, 'next');
		});
	}
	if (failButton) {
		failButton.addEventListener('click', () => {
			if (currentPrompt) window.haibunResolvePrompt(currentPrompt.id, 'fail');
		});
	}
	if (stepButton) {
		stepButton.addEventListener('click', () => {
			if (currentPrompt) window.haibunResolvePrompt(currentPrompt.id, 'step');
		});
	}
	if (continueButton) {
		continueButton.addEventListener('click', () => {
			if (currentPrompt) window.haibunResolvePrompt(currentPrompt.id, 'continue');
		});
	}

	window.hidePromptControls();
}
