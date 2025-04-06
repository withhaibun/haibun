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
		// Initial style update
		updateStyles(levelSelect.value);
	}

	// Setup video playback functionality
	setupVideoPlayback();
	// Setup resize handle functionality
	setupResizeHandle();
}

function setupResizeHandle() {
	const resizeHandle = document.getElementById('resize-handle');
	const bottomDisplay = document.getElementById('haibun-media-display') as HTMLElement;
	const logDisplayArea = document.getElementById('haibun-log-display-area') as HTMLElement;
	const header = document.querySelector('.haibun-header'); // Assuming header has this class

	if (!resizeHandle || !bottomDisplay || !logDisplayArea || !header) {
		console.error('Resize elements not found');
		return;
	}

	let isResizing = false;
	let startY: number;
	let startHeightBottom: number;
	// No longer need startHeightLog or headerHeight for this logic

	// Set initial padding-bottom for log display area
	const setInitialLogPadding = () => {
		requestAnimationFrame(() => {
			const initialBottomHeight = bottomDisplay.clientHeight;
			const initialHandleHeight = resizeHandle.clientHeight;
			logDisplayArea.style.paddingBottom = `${initialBottomHeight + initialHandleHeight}px`;
		});
	};
	setInitialLogPadding(); // Call immediately
	// Optional: Recalculate on window resize if needed
	// window.addEventListener('resize', setInitialLogPadding);


	resizeHandle.addEventListener('mousedown', (e) => {
		isResizing = true;
		startY = e.clientY;
		startHeightBottom = bottomDisplay.clientHeight;
		// No longer need startHeightLog
		// startHeightLog = logDisplayArea.clientHeight; // No longer needed
		document.body.style.cursor = 'ns-resize'; // Change cursor during resize
		document.body.style.userSelect = 'none'; // Prevent text selection

		// Add listeners to document to capture mouse move everywhere
		document.addEventListener('mousemove', handleMouseMove);
		document.addEventListener('mouseup', handleMouseUp);
	});

	const handleMouseMove = (e: MouseEvent) => {
		if (!isResizing) return;

		const deltaY = startY - e.clientY; // Calculate change in Y
		const newHeightBottom = startHeightBottom + deltaY;
		const minHeight = 50; // Minimum height for the bottom panel
		const maxHeight = window.innerHeight - header.clientHeight - 50; // Max height (leave space for header and min log area)

		// Clamp the new height
		const clampedHeightBottom = Math.max(minHeight, Math.min(newHeightBottom, maxHeight));

		// Apply new height to bottom panel and handle position
		bottomDisplay.style.height = `${clampedHeightBottom}px`;
		resizeHandle.style.bottom = `${clampedHeightBottom}px`; // Move handle with the panel

		// Adjust padding-bottom of log area instead of height
		logDisplayArea.style.paddingBottom = `${clampedHeightBottom + resizeHandle.clientHeight}px`;
	};

	const handleMouseUp = () => {
		if (isResizing) {
			isResizing = false;
			document.body.style.cursor = ''; // Reset cursor
			document.body.style.userSelect = ''; // Re-enable text selection
			document.removeEventListener('mousemove', handleMouseMove);
			document.removeEventListener('mouseup', handleMouseUp);
		}
	};
}

function setupVideoPlayback() {
	// Initialize sequence diagram if it exists
	const sequenceDiagram = document.getElementById('sequence-diagram');
	if (sequenceDiagram) {
		// Make sure the sequence diagram is visible
		const sequenceDiagramContainer = document.getElementById('sequence-diagram-container');
		if (sequenceDiagramContainer) {
			sequenceDiagramContainer.style.display = 'flex'; // Use flex for internal layout
		}
	}
	const logDisplayArea = document.getElementById('haibun-log-display-area');
	if (!logDisplayArea) return;

	// Find video element in the #haibun-video container
	const videoContainer = document.getElementById('haibun-video');
	if (!videoContainer) return;

	// Setup click handlers for log entries to seek video
	logDisplayArea.addEventListener('click', (event) => {
		const target = event.target as HTMLElement;
		const logEntry = findLogEntry(target);

		if (logEntry && logEntry.dataset.time) {
			const videoElement = videoContainer.querySelector('video');
			if (videoElement) {
				// Get the start time from the video-start element or body
				const startTimeElement = document.getElementById('haibun-video-start') || document.body;
				const startTime = parseInt(startTimeElement.dataset.start || startTimeElement.dataset.startTime || '0', 10); // Check body data-startTime too

				// Calculate the time to seek to
				const entryTime = parseInt(logEntry.dataset.time, 10);
				const seekTime = (entryTime - startTime) / 1000;

				// Seek the video
				if (seekTime >= 0) {
					videoElement.currentTime = seekTime;

					// Remove current class from all entries
					document.querySelectorAll('.haibun-stepper-current').forEach(el => {
						el.classList.remove('haibun-stepper-current');
					});

					// Add current class to clicked entry
					logEntry.classList.add('haibun-stepper-current');
				}
			}
		}
	});

	// Setup timeupdate handler for video to highlight current step
	const setupVideoTimeUpdateHandler = (videoElement: HTMLVideoElement) => {
		videoElement.addEventListener('timeupdate', () => {
			const currentTime = videoElement.currentTime * 1000; // Convert to ms
			const startTimeElement = document.getElementById('haibun-video-start') || document.body;
			const startTime = parseInt(startTimeElement.dataset.start || startTimeElement.dataset.startTime || '0', 10); // Check body data-startTime too

			// Find the log entry closest to the current video time
			const logEntries = document.querySelectorAll('.haibun-log-entry');
			let closestEntry: HTMLElement | null = null;
			let closestDiff = Number.MAX_VALUE;

			logEntries.forEach(entry => {
				const entryTime = parseInt((entry as HTMLElement).dataset.time || '0', 10);
				const entryVideoTime = entryTime - startTime;

				// Only consider entries that have happened before the current video time
				if (entryVideoTime <= currentTime) {
					const diff = currentTime - entryVideoTime;
					if (diff < closestDiff) {
						closestDiff = diff;
						closestEntry = entry as HTMLElement;
					}
				}
			});

			// Update classes
			document.querySelectorAll('.haibun-stepper-current').forEach(el => {
				el.classList.remove('haibun-stepper-current');
			});

			if (closestEntry) {
				closestEntry.classList.add('haibun-stepper-current');

				// Mark entries as played/not played
				logEntries.forEach(entry => {
					const entryTime = parseInt((entry as HTMLElement).dataset.time || '0', 10);
					const entryVideoTime = entryTime - startTime;

					if (entryVideoTime <= currentTime) {
						entry.classList.add('haibun-stepper-played');
						entry.classList.remove('haibun-stepper-notplayed');
					} else {
						entry.classList.add('haibun-stepper-notplayed');
						entry.classList.remove('haibun-stepper-played');
					}
				});

				// Scroll to the current entry if it's not visible
				if (!isElementInViewport(closestEntry)) {
					closestEntry.scrollIntoView({ behavior: 'smooth', block: 'center' });
				}
			}
		});
	};

	// Setup any existing or future videos
	let existingVideo = videoContainer.querySelector('video'); // Use let
	if (existingVideo) {
		setupVideoTimeUpdateHandler(existingVideo as HTMLVideoElement);
	}

	// Use MutationObserver to detect when new videos are added
	const observer = new MutationObserver((mutations) => {
		mutations.forEach((mutation) => {
			if (mutation.type === 'childList') {
				const newVideo = videoContainer.querySelector('video');
				if (newVideo && newVideo !== existingVideo) {
					setupVideoTimeUpdateHandler(newVideo as HTMLVideoElement);
					existingVideo = newVideo; // Update reference to the current video
				}
			}
		});
	});

	observer.observe(videoContainer, { childList: true });
}

// Helper function to find the parent log entry element
function findLogEntry(element: HTMLElement): HTMLElement | null {
	let current = element;
	while (current && !current.classList.contains('haibun-log-entry')) {
		current = current.parentElement;
	}
	return current;
}

// Helper function to check if an element is in the viewport
function isElementInViewport(element: HTMLElement): boolean {
	const rect = element.getBoundingClientRect();
	const logDisplayArea = document.getElementById('haibun-log-display-area');
	if (!logDisplayArea) return false; // Should not happen, but check

	const logRect = logDisplayArea.getBoundingClientRect();

	// Check if the element is within the visible bounds of the logDisplayArea
	return (
		rect.top >= logRect.top &&
		rect.left >= logRect.left &&
		rect.bottom <= logRect.bottom &&
		rect.right <= logRect.right
	);
}
