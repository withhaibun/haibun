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

export function setupVideoPlayback() { // Add export
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
				// Get Monitor start time and Video start offset
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
				// Corrected variable names in the log message if uncommented later
				// console.log(`Calculated seekTime: ${seekTime}s (Entry: ${entryAbsoluteTime}, Start: ${videoAbsoluteStartTime})`);

				// Seek the video (allow seeking slightly before 0 for precision)
				if (!isNaN(seekTime)) {
					videoElement.currentTime = Math.max(0, seekTime); // Ensure seek time is not negative

					// No need to manually update classes here,
					// the 'seeked' event handler will take care of it.
				}
			}
		}
	});

	// Setup timeupdate handler for video to highlight current step
	const setupVideoTimeUpdateHandler = (videoElement: HTMLVideoElement) => {
		let playInterval: number | undefined; // Use number for interval ID, undefined when not set
		let latestCurrentEntry: HTMLElement | null = null; // Track the current entry

		const updateVideoSteps = () => {
			// Get Monitor start time and Video start offset
			const monitorStartTimeStr = document.body.dataset.startTime;
			const videoStartOffsetStr = document.getElementById('haibun-video-start')?.dataset.start;

			if (!monitorStartTimeStr || !videoStartOffsetStr) {
				// console.warn('Monitor start time or video start offset not found during update.');
				return; // Cannot calculate relative times
			}
			const monitorStartTime = parseInt(monitorStartTimeStr, 10);
			const videoStartOffset = parseInt(videoStartOffsetStr, 10);

			if (isNaN(monitorStartTime) || isNaN(videoStartOffset)) {
				// console.warn('Invalid monitor start time or video start offset during update.');
				return; // Cannot calculate relative times
			}
			const videoAbsoluteStartTime = monitorStartTime + videoStartOffset;
			// Removed extra closing brace here

			const currentVideoTimeMs = videoElement.currentTime * 1000;
			let currentLatestEntry: HTMLElement | null = null; // Entry to be marked current in this update

			document.querySelectorAll<HTMLElement>('.haibun-log-entry').forEach(entry => {
				// Clear previous state for all entries first
				entry.classList.remove('haibun-stepper-played', 'haibun-stepper-notplayed', 'haibun-stepper-current');

				const entryTimeStr = entry.dataset.time;
				if (!entryTimeStr) return; // Skip entries without time
				const entryAbsoluteTime = parseInt(entryTimeStr, 10);
				if (isNaN(entryAbsoluteTime)) return; // Skip entries with invalid time

				// Calculate entry time relative to video start
				const logRelativeToVideoMs = entryAbsoluteTime - videoAbsoluteStartTime;

				// Determine played/notplayed status
				if (logRelativeToVideoMs <= currentVideoTimeMs) {
					entry.classList.add('haibun-stepper-played');
					entry.classList.remove('haibun-stepper-notplayed');
					// This entry is a candidate for the current step
					// Update if this entry is later than the current candidate
					if (!currentLatestEntry || entryAbsoluteTime > parseInt(currentLatestEntry.dataset.time || '0', 10)) {
						currentLatestEntry = entry;
					}
				} else {
					entry.classList.add('haibun-stepper-notplayed');
					entry.classList.remove('haibun-stepper-played');
				}
				// entry.classList.remove('haibun-stepper-current'); // Already removed above
			});

			// Mark the actual latest entry as current and scroll if needed
			if (currentLatestEntry) {
				currentLatestEntry.classList.add('haibun-stepper-current');
				if (currentLatestEntry !== latestCurrentEntry) { // Only scroll if the current entry changed
					if (!isElementInViewport(currentLatestEntry)) {
						currentLatestEntry.scrollIntoView({ behavior: 'smooth', block: 'center' });
					}
					latestCurrentEntry = currentLatestEntry;
				}
			} else {
				// If no entry is before or at the current time, clear the tracker
				latestCurrentEntry = null;
			}
		};

		// Update state definitively after a seek
		videoElement.addEventListener('seeked', () => {
			// console.log('seeked');
			updateVideoSteps();
		});

		// Use interval for smooth updates during playback
		videoElement.addEventListener('play', () => {
			// console.log('play');
			if (playInterval === undefined) { // Prevent multiple intervals
				updateVideoSteps(); // Update immediately on play
				playInterval = window.setInterval(updateVideoSteps, 50); // Update frequently (e.g., 50ms)
			}
		});

		// Clear interval on pause or end
		const clearPlayInterval = () => {
			// console.log('pause/ended');
			if (playInterval !== undefined) {
				clearInterval(playInterval);
				playInterval = undefined;
				updateVideoSteps(); // Ensure final state is correct after pause/end
			}
		};
		videoElement.addEventListener('pause', clearPlayInterval);
		videoElement.addEventListener('ended', clearPlayInterval);

		// Initial update in case video is loaded paused or has an initial time
		updateVideoSteps();
	};

	// --- MutationObserver setup ---
	let existingVideo = videoContainer.querySelector('video');
	if (existingVideo) {
		setupVideoTimeUpdateHandler(existingVideo as HTMLVideoElement);
	}

	const observer = new MutationObserver((mutations) => {
		mutations.forEach((mutation) => {
			if (mutation.type === 'childList') {
				const newVideo = videoContainer.querySelector('video');
				if (newVideo && newVideo !== existingVideo) {
					console.log('New video detected, setting up handlers.');
					// Potentially clean up old interval if video element is replaced?
					// For now, just setup handlers for the new one.
					setupVideoTimeUpdateHandler(newVideo as HTMLVideoElement);
					existingVideo = newVideo;
				}
				// Handle video removal? (Optional)
				// else if (!newVideo && existingVideo) {
				//   console.log('Video removed.');
				//   existingVideo = null;
				//   // Clean up any associated intervals if necessary
				// }
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
