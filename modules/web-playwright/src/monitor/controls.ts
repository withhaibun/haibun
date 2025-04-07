let userScrolledManually = false; // Flag to track manual scrolling (module-level)

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
	const topDisplay = document.getElementById('haibun-media-display') as HTMLElement;
	const logDisplayArea = document.getElementById('haibun-log-display-area') as HTMLElement;
	const header = document.querySelector('.haibun-header'); // Assuming header has this class

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
		document.body.style.cursor = 'ns-resize'; // Change cursor during resize
		document.body.style.userSelect = 'none'; // Prevent text selection

		// Add listeners to document to capture mouse move everywhere
		document.addEventListener('mousemove', handleMouseMove);
		document.addEventListener('mouseup', handleMouseUp);
	});

	const handleMouseMove = (e: MouseEvent) => {
		if (!isResizing) return;

		const deltaY = e.clientY - startY; // Calculate change in Y (Reversed for top panel)
		const newHeightTop = startHeightTop + deltaY;
		const minHeight = 50; // Minimum height for the top panel
		const maxHeight = window.innerHeight - header.clientHeight - 50; // Max height (leave space for header and min log area below)

		// Clamp the new height
		const clampedHeightTop = Math.max(minHeight, Math.min(newHeightTop, maxHeight));

		// Apply new height to top panel
		topDisplay.style.height = `${clampedHeightTop}px`;
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

// Helper function to show the media panel and resize handle
function showMediaPanelIfNeeded(mediaPanel: HTMLElement | null, resizeHandle: HTMLElement | null) {
	if (mediaPanel && resizeHandle) {
		// Check if already visible to avoid redundant style changes
		if (mediaPanel.style.display !== 'flex') {
			mediaPanel.style.display = 'flex';
		}
		if (resizeHandle.style.display !== 'block') {
			resizeHandle.style.display = 'block';
		}
	}
}

export function setupVideoPlayback() { // Add export
	// Get references to media elements and controls
	const mediaPanel = document.getElementById('haibun-media-display');
	const resizeHandle = document.getElementById('resize-handle');
	const sequenceDiagram = document.getElementById('sequence-diagram'); // Check inner div for content
	const videoContainer = document.getElementById('haibun-video');
	const logDisplayArea = document.getElementById('haibun-log-display-area') as HTMLElement; // Keep this check and cast

	if (!logDisplayArea || !videoContainer || !mediaPanel || !resizeHandle) {
		console.error("Required elements for video playback/layout not found.");
		return; // Exit if essential elements are missing
	}
	// userScrolledManually is now module-level

	// Check if media exists initially (video OR sequence diagram content)
	const existingVideoCheck = videoContainer.querySelector('video');
	if (existingVideoCheck || (sequenceDiagram && sequenceDiagram.hasChildNodes())) {
		showMediaPanelIfNeeded(mediaPanel, resizeHandle);
	}

	// Setup click handlers for log entries to seek video
	logDisplayArea.addEventListener('click', (event) => {
		const target = event.target as HTMLElement;
		const logEntry = findLogEntry(target);

		if (logEntry && logEntry.dataset.time) {
			const videoElement = videoContainer.querySelector('video');
			if (videoElement) {
				userScrolledManually = false; // Resume auto-scroll on click/seek
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

	// Detect manual scroll
	let scrollTimeout: number | undefined;
	logDisplayArea.addEventListener('scroll', () => {
		const videoElement = videoContainer.querySelector('video'); // Need video element ref here too
		// Use a timeout to avoid setting the flag during programmatic scrolls which might trigger rapid scroll events
		clearTimeout(scrollTimeout);
		scrollTimeout = window.setTimeout(() => {
			// Simpler approach: Any scroll event sets the flag. Play/seek events clear it.
			userScrolledManually = true;
			// console.log('Manual scroll detected, setting flag.');
		}, 150); // Wait 150ms after the last scroll event to set the flag
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
			});

			// Mark the actual latest entry as current and scroll if needed
			if (currentLatestEntry) {
				currentLatestEntry.classList.add('haibun-stepper-current');
				// Scroll the current entry into view ONLY if the user hasn't scrolled manually
				// Scroll the current entry into view ONLY if the user hasn't scrolled manually AND it's not already visible
				if (!userScrolledManually && !isElementInViewport(currentLatestEntry)) {
					// console.log('Auto-scrolling to:', currentLatestEntry);
					currentLatestEntry.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); // Use 'nearest'
				} else if (userScrolledManually) {
					// console.log('Manual scroll active, not auto-scrolling.');
				} // else: Element is already in viewport, no need to scroll
				latestCurrentEntry = currentLatestEntry; // Update the tracked entry
			} else {
				// If no entry is before or at the current time, clear the tracker
				latestCurrentEntry = null;
			}
		};

		// Update state definitively after a seek
		videoElement.addEventListener('seeked', () => {
			// console.log('seeked');
			userScrolledManually = false; // Resume auto-scroll on seek
			// console.log('Seek detected, clearing manual scroll flag.');
			updateVideoSteps();
		});

		// Use interval for smooth updates during playback
		videoElement.addEventListener('play', () => {
			// console.log('play');
			userScrolledManually = false; // Resume auto-scroll on play
			// console.log('Play detected, clearing manual scroll flag.');
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
	let existingVideo = videoContainer.querySelector('video'); // Keep tracking var separate
	if (existingVideo) { // Setup handler if video exists initially
		setupVideoTimeUpdateHandler(existingVideo as HTMLVideoElement);
	}

	const observer = new MutationObserver((mutations) => {
		mutations.forEach((mutation) => {
			if (mutation.type === 'childList') {
				const newVideo = videoContainer.querySelector('video');
				if (newVideo && newVideo !== existingVideo) {
					console.log('New video detected, setting up handlers and showing panel.');
					// Show panel/handle when new video is added
					showMediaPanelIfNeeded(mediaPanel, resizeHandle);
					setupVideoTimeUpdateHandler(newVideo as HTMLVideoElement);
					existingVideo = newVideo; // Update tracked video element
				}
			}
		});
	});

	observer.observe(videoContainer, { childList: true });

	// --- Separate Observer for Sequence Diagram Content ---
	const diagramObserver = new MutationObserver((mutations) => {
		mutations.forEach((mutation) => {
			// Check if nodes were added AND the target is the sequence diagram div
			if (mutation.type === 'childList' && mutation.addedNodes.length > 0 && mutation.target === sequenceDiagram) {
				console.log('Sequence diagram content detected, showing panel.');
				showMediaPanelIfNeeded(mediaPanel, resizeHandle);
				diagramObserver.disconnect(); // Stop observing once content is added
			}
		});
	});

	// Start observing the sequence diagram div for added children (like the SVG)
	if (sequenceDiagram) {
		diagramObserver.observe(sequenceDiagram, { childList: true });
	}
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
