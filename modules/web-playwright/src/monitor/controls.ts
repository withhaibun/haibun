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
	setupResizeHandle();
	setupMediaToggle();
}

function setupResizeHandle() {
	const resizeHandle = document.getElementById('resize-handle');
	const topDisplay = document.getElementById('haibun-media-display') as HTMLElement;
	const logDisplayArea = document.getElementById('haibun-log-display-area') as HTMLElement;
	const header = document.querySelector('.haibun-header');

	if (!resizeHandle || !topDisplay || !logDisplayArea || !header) {
		console.error('Resize elements not found');
		return;
	}

	let isResizing = false;
	let startY: number;
	let startHeightTop: number;

	resizeHandle.addEventListener('mousedown', (e) => {
		isResizing = true;
		startY = e.clientY;
		startHeightTop = topDisplay.clientHeight;
		document.body.style.cursor = 'ns-resize';
		document.body.style.userSelect = 'none';

		document.addEventListener('mousemove', handleMouseMove);
		document.addEventListener('mouseup', handleMouseUp);
	});

	const handleMouseMove = (e: MouseEvent) => {
		if (!isResizing) return;

		const deltaY = e.clientY - startY;
		const newHeightTop = startHeightTop + deltaY;
		const minHeight = 50;
		const maxHeight = window.innerHeight - header.clientHeight - 50;

		const clampedHeightTop = Math.max(minHeight, Math.min(newHeightTop, maxHeight));

		topDisplay.style.height = `${clampedHeightTop}px`;
	};

	const handleMouseUp = () => {
		if (isResizing) {
			isResizing = false;
			document.body.style.cursor = '';
			document.body.style.userSelect = '';
			document.removeEventListener('mousemove', handleMouseMove);
			document.removeEventListener('mouseup', handleMouseUp);
		}
	};
}

export function setupMediaToggle() { // Export the function
	const toggleButton = document.getElementById('haibun-media-toggle')!;
	const mediaPanel = document.getElementById('haibun-media-display') as HTMLElement;
	const resizeHandle = document.getElementById('resize-handle') as HTMLElement;

	let lastMediaHeight = 250;

	toggleButton.addEventListener('click', () => {
		const isHidden = mediaPanel.clientHeight <= 20;

		if (isHidden) {
			mediaPanel.style.height = `${lastMediaHeight}px`;
			resizeHandle.style.display = 'block';
		} else {
			lastMediaHeight = mediaPanel.clientHeight;
			mediaPanel.style.height = '0';
			resizeHandle.style.display = 'none';
		}
	});

	mediaPanel.style.height = '0';
	resizeHandle.style.display = 'none';
}

// Update log entry classes and scroll to current entry based on video time
function updateLogEntriesForCurrentTime(videoElement: HTMLVideoElement) {
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
				userScrolledManually = false;
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
		let latestCurrentEntry: HTMLElement | null = null;

		const updateVideoSteps = () => {
			updateLogEntriesForCurrentTime(videoElement);
		};

		videoElement.addEventListener('seeked', () => {
			userScrolledManually = false;
			updateVideoSteps();
		});

		videoElement.addEventListener('play', () => {
			userScrolledManually = false; // Reset manual scroll when video starts playing
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
					console.log('New video detected, setting up handlers.');
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
				console.log('Sequence diagram content detected.');
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
