import { TPrompt } from "@haibun/core/build/lib/prompter.js";

declare global {
	interface Window {
		haibunResolvePrompt: (action: string) => void;
		showPromptControls: (prompt: string) => void;
		hidePromptControls: () => void;
	}
}

let userScrolledManually = false;

export function setupControls() {
	const levelSelect = document.getElementById('haibun-debug-level-select') as HTMLSelectElement;
	const levels = ['debug', 'log', 'info', 'error'];

	const updateStyles = (selectedLevel: string) => {
		const selectedIndex = levels.indexOf(selectedLevel);
		let css = '';
		levels.forEach((level, index) => {
			if (index < selectedIndex) {
				css += `div.haibun-log-entry.haibun-level-${level}:not(.disappeared) { display: none; }\n`;
			} else {
				css += `div.haibun-log-entry.haibun-level-${level}:not(.disappeared) { display: flex; }\n`;
			}
		});
		let styleElement = document.getElementById('haibun-dynamic-styles');
		if (!styleElement) {
			styleElement = document.createElement('style');
			styleElement.id = 'haibun-dynamic-styles';
			document.head.appendChild(styleElement);
		}
		styleElement.textContent = css;
	};

	if (levelSelect) {
		levelSelect.addEventListener('change', (event) => {
			const target = event.target as HTMLSelectElement;
			updateStyles(target.value);
		});
		updateStyles(levelSelect.value);
	}

	setupVideoPlayback();
}

// Update log entry classes and scroll to current entry based on video time
function updateLogEntriesForCurrentTime(videoElement: HTMLVideoElement) {
	if (userScrolledManually) return;
	const monitorStartTimeStr = document.body.dataset.startTime;
	const videoStartOffsetStr = document.getElementById('haibun-video-start')?.dataset.start;
	if (!monitorStartTimeStr || !videoStartOffsetStr) return;
	const monitorStartTime = parseInt(monitorStartTimeStr, 10);
	const videoStartOffset = parseInt(videoStartOffsetStr, 10);
	if (isNaN(monitorStartTime) || isNaN(videoStartOffset)) return;
	const videoAbsoluteStartTime = monitorStartTime + videoStartOffset;
	const currentVideoTimeMs = videoElement.currentTime * 1000;
	let currentLatestEntry: HTMLElement | null = null;

	document.querySelectorAll<HTMLElement>('.haibun-log-entry').forEach(entry => {
		entry.classList.remove('haibun-stepper-played', 'haibun-stepper-notplayed', 'haibun-stepper-current');
		const entryTimeStr = entry.dataset.time;
		if (!entryTimeStr) return;
		const entryAbsoluteTime = parseInt(entryTimeStr, 10);
		if (isNaN(entryAbsoluteTime)) return;
		const logRelativeToVideoMs = entryAbsoluteTime - videoAbsoluteStartTime;
		if (logRelativeToVideoMs <= currentVideoTimeMs) {
			entry.classList.add('haibun-stepper-played');
			if (!currentLatestEntry || entryAbsoluteTime > parseInt(currentLatestEntry.dataset.time || '0', 10)) {
				currentLatestEntry = entry;
			}
		} else {
			entry.classList.add('haibun-stepper-notplayed');
		}
	});

	if (currentLatestEntry) {
		currentLatestEntry.classList.add('haibun-stepper-current');
		setTimeout(() => {
			currentLatestEntry.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}, 0);
	}
}

// Poll video time and update log entries if it changes
function pollVideoTimeAndUpdate(videoElement: HTMLVideoElement) {
	let lastTime = videoElement.currentTime;
	setInterval(() => {
		if (videoElement.currentTime !== lastTime) {
			lastTime = videoElement.currentTime;
			updateLogEntriesForCurrentTime(videoElement);
		}
	}, 100);
}

export function setupVideoPlayback() {
	const sequenceDiagram = document.getElementById('sequence-diagram');
	const videoContainer = document.getElementById('haibun-focus');
	const logDisplayArea = document.getElementById('haibun-log-display-area') as HTMLElement;

	logDisplayArea.addEventListener('click', (event) => {
		const target = event.target as HTMLElement;
		const logEntry = findLogEntry(target);

		if (logEntry && logEntry.dataset.time) {
			const videoElement = videoContainer.querySelector('video');
			if (videoElement) {
				const monitorStartTimeStr = document.body.dataset.startTime;
				const videoStartOffsetStr = document.getElementById('haibun-video-start')?.dataset.start;

				if (!monitorStartTimeStr || !videoStartOffsetStr) {
					console.warn('Monitor start time or video start offset not found. Cannot seek video.');
					return;
				}
				const monitorStartTime = parseInt(monitorStartTimeStr, 10);
				const videoStartOffset = parseInt(videoStartOffsetStr, 10);

				if (isNaN(monitorStartTime) || isNaN(videoStartOffset)) {
					console.warn('Invalid monitor start time or video start offset.');
					return;
				}
				const videoAbsoluteStartTime = monitorStartTime + videoStartOffset;

				// Calculate the time to seek to
				const entryAbsoluteTime = parseInt(logEntry.dataset.time, 10);
				if (isNaN(entryAbsoluteTime)) {
					console.warn('Clicked log entry missing or invalid data-time:', logEntry);
					return;
				}
				// Calculate time relative to video start
				const logRelativeToVideoMs = entryAbsoluteTime - videoAbsoluteStartTime;
				const seekTime = logRelativeToVideoMs / 1000;

				if (!isNaN(seekTime)) {
					videoElement.currentTime = Math.max(0, seekTime);
				}
			}
		}
	});

	let scrollTimeout: number | undefined;
	logDisplayArea.addEventListener('scroll', () => {
		clearTimeout(scrollTimeout);
		scrollTimeout = window.setTimeout(() => {
			userScrolledManually = true;
		}, 150);
	});

	const setupVideoTimeUpdateHandler = (videoElement: HTMLVideoElement) => {
		let playInterval: number | undefined;

		const updateVideoSteps = () => {
			updateLogEntriesForCurrentTime(videoElement);
		};

		videoElement.addEventListener('seeked', () => {
			userScrolledManually = false;
			updateVideoSteps();
		});

		videoElement.addEventListener('play', () => {
			userScrolledManually = false;
			if (playInterval === undefined) {
				updateVideoSteps();
				playInterval = window.setInterval(updateVideoSteps, 50);
			}
		});

		const clearPlayInterval = () => {
			if (playInterval !== undefined) {
				clearInterval(playInterval);
				playInterval = undefined;
				updateVideoSteps();
			}
		};
		videoElement.addEventListener('pause', clearPlayInterval);
		videoElement.addEventListener('ended', clearPlayInterval);

		updateVideoSteps();
	};

	let existingVideo = videoContainer.querySelector('video');
	if (existingVideo) {
		setupVideoTimeUpdateHandler(existingVideo as HTMLVideoElement);
		pollVideoTimeAndUpdate(existingVideo as HTMLVideoElement);
	}

	const videoObserver = new MutationObserver((mutations) => {
		mutations.forEach((mutation) => {
			if (mutation.type === 'childList') {
				const newVideo = videoContainer.querySelector('video');
				if (newVideo && newVideo !== existingVideo) {
					console.info('New video detected, setting up handlers.');
					setupVideoTimeUpdateHandler(newVideo as HTMLVideoElement);
					pollVideoTimeAndUpdate(newVideo as HTMLVideoElement);
					existingVideo = newVideo;
				}
			}
		});
	});

	videoObserver.observe(videoContainer, { childList: true });

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

	// Robust auto-scroll for monitor.html and live playback
	function scrollToCurrentLogEntry() {
		const logDisplayArea = document.getElementById('haibun-log-display-area');
		if (!logDisplayArea) return;
		// Try to find the first not-played entry
		let entry = logDisplayArea.querySelector('.haibun-log-entry.haibun-stepper-notplayed');
		// If all are played, scroll to the last played
		if (!entry) {
			const played = logDisplayArea.querySelectorAll('.haibun-log-entry.haibun-stepper-played');
			if (played.length) entry = played[played.length - 1];
		}
		if (entry) {
			(entry as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
	}

	if (logDisplayArea) {
		const scrollObserver = new MutationObserver(() => {
			scrollToCurrentLogEntry();
		});
		scrollObserver.observe(logDisplayArea, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
	}

	window.addEventListener('DOMContentLoaded', () => {
		const promptContainer = document.getElementById('haibun-prompt-controls-container');
		const rerunButton = <HTMLButtonElement>document.getElementById('haibun-retry-button');
		const failButton = <HTMLButtonElement>document.getElementById('haibun-fail-button');
		const stepButton = <HTMLButtonElement>document.getElementById('haibun-step-button');
		const continueButton = <HTMLButtonElement>document.getElementById('haibun-continue-button');
		const messageArea = document.getElementById('haibun-prompt-message');

		window.showPromptControls = (prompt) => {
			const { message, options } = <TPrompt>JSON.parse(prompt);
			messageArea.textContent = message;
			if (options.includes('r') || options.includes('retry')) {
				rerunButton.disabled = false;
			}
			if (options.includes('f') || options.includes('fail')) {
				failButton.disabled = false;
			}
			if (options.includes('s') || options.includes('step')) {
				stepButton.disabled = false;
			}
			if (options.includes('c') || options.includes('continue')) {
				continueButton.disabled = false;
			}

			promptContainer.classList.add('paused-program-glow');
			promptContainer.style.display = 'flex';
		};

		window.hidePromptControls = () => {
			promptContainer.style.display = 'none';
			promptContainer.classList.remove('paused-program-glow');
		}
		rerunButton.disabled = true;
		failButton.disabled = true;
		stepButton.disabled = true;
		continueButton.disabled = true;
		messageArea.textContent = '';

		window.hidePromptControls();

		rerunButton.addEventListener('click', () => {
			window.haibunResolvePrompt('retry');
		});
		failButton.addEventListener('click', () => {
			window.haibunResolvePrompt('fail');
		});
		stepButton.addEventListener('click', () => {
			window.haibunResolvePrompt('step');
		});
		continueButton.addEventListener('click', () => {
			window.haibunResolvePrompt('continue');
		});
		const logEntries = document.querySelectorAll('.haibun-log-entry');
		if (logEntries.length > 0) {
			// If no current, set the first as current and all as notplayed
			if (!document.querySelector('.haibun-stepper-current')) {
				logEntries.forEach(entry => {
					entry.classList.remove('haibun-stepper-current', 'haibun-stepper-played', 'haibun-stepper-notplayed');
					entry.classList.add('haibun-stepper-notplayed');
				});
				logEntries[0].classList.add('haibun-stepper-current');
			}
			// Scroll to the current entry
			setTimeout(() => {
				logEntries[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
			}, 0);
		}
	});
}

function findLogEntry(element: HTMLElement): HTMLElement | null {
	let current = element;
	while (current && !current.classList.contains('haibun-log-entry')) {
		current = current.parentElement;
	}
	return current;
}
