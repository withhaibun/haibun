import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { setupVideoPlayback, } from './controls';

// Helper function to create a log entry element
const createLogEntry = (doc: Document, time: number): HTMLElement => {
    const entry = doc.createElement('div');
    entry.classList.add('haibun-log-entry');
    entry.dataset.time = `${time}`;
    // Add some content to make it clickable
    const summary = doc.createElement('summary');
    summary.textContent = `Log at ${time}`;
    entry.appendChild(summary);
    return entry;
};

// Helper function to dispatch events
const dispatchEvent = (element: Element, eventName: string) => {
    const event = new Event(eventName, { bubbles: true });
    element.dispatchEvent(event);
};

describe('Monitor Video Playback Controls', () => {
    let dom: JSDOM;
    let document: Document;
    let window: Window & typeof globalThis;
    let logDisplayArea: HTMLElement;
    let videoContainer: HTMLElement;
    let videoElement: HTMLVideoElement;
    let videoStartElement: HTMLElement;

    beforeEach(() => {
        const monitorStartTime = Date.now(); // Use a realistic start time
        const videoStartOffset = 1000; // Offset of video start relative to monitor start (ms)

        // Setup JSDOM
        dom = new JSDOM(`
            <!DOCTYPE html>
            <html>
            <head></head>
            <body data-start-time="${monitorStartTime}">
            	<div id="haibun-media-display"> <!-- Added -->
            		<div id="haibun-video">
            			<video controls></video>
            		</div>
            		<!-- Sequence diagram container not needed for these specific tests -->
            	</div>
            	<div id="resize-handle"></div> <!-- Added -->
            	<div id="haibun-log-display-area"></div>
            	<span id="haibun-video-start" data-start="${videoStartOffset}"></span>
                </body>
            </html>
        `, { url: "http://localhost", runScripts: "dangerously", pretendToBeVisual: true });

        window = dom.window as unknown as Window & typeof globalThis;
        document = window.document;

        // Assign to global context for the controls script
        global.window = window;
        global.document = document;
        global.Event = window.Event; // Make Event constructor available
        global.HTMLVideoElement = window.HTMLVideoElement;
        global.HTMLElement = window.HTMLElement;
        // Mock MutationObserver for JSDOM environment
        global.MutationObserver = vi.fn(() => ({
            observe: vi.fn(),
            disconnect: vi.fn(),
            takeRecords: vi.fn(() => []),
        }));

        // Mock video methods/properties needed for tests
        window.HTMLVideoElement.prototype.play = vi.fn();
        window.HTMLVideoElement.prototype.pause = vi.fn();
        Object.defineProperty(window.HTMLVideoElement.prototype, 'currentTime', {
            writable: true,
            value: 0,
        });
        // Mock requestAnimationFrame for scrollIntoView({ behavior: 'smooth' })
        window.requestAnimationFrame = vi.fn((cb) => { cb(Date.now()); return 0; });
        window.HTMLElement.prototype.scrollIntoView = vi.fn();

        // Get DOM elements
        logDisplayArea = document.getElementById('haibun-log-display-area')!;
        videoContainer = document.getElementById('haibun-video')!;
        videoElement = videoContainer.querySelector('video')!;
        videoStartElement = document.getElementById('haibun-video-start')!;

        // Add some log entries with absolute timestamps
        // logAbsoluteTime = monitorStartTime + videoStartOffset + relativeVideoTimeMs
        logDisplayArea.appendChild(createLogEntry(document, monitorStartTime + videoStartOffset + 500));  // 0.5s relative to video start
        logDisplayArea.appendChild(createLogEntry(document, monitorStartTime + videoStartOffset + 1500)); // 1.5s relative to video start
        logDisplayArea.appendChild(createLogEntry(document, monitorStartTime + videoStartOffset + 2500)); // 2.5s relative to video start

        // Setup the controls after the DOM is ready
        setupVideoPlayback(); // Directly test the relevant part
    });

    afterEach(() => {
        // Cleanup JSDOM window/document
        vi.restoreAllMocks();
        window.close();
    });

    it('should seek video when a log entry is clicked', () => {
        const logEntries = logDisplayArea.querySelectorAll<HTMLElement>('.haibun-log-entry');
        const secondLogEntry = logEntries[1]; // Corresponds to 1.5s relative video time

        // Simulate click
        dispatchEvent(secondLogEntry.querySelector('summary')!, 'click'); // Click the summary inside

        // Expect currentTime to be set (relative time in seconds)
        // Expect currentTime to be set to the time relative to video start
        expect(videoElement.currentTime).toBe(1.5);
    });

    it('should update classes correctly on seeked event', () => {
        const logEntries = logDisplayArea.querySelectorAll<HTMLElement>('.haibun-log-entry');
        const firstLogEntry = logEntries[0];  // 0.5s relative
        const secondLogEntry = logEntries[1]; // 1.5s relative
        const thirdLogEntry = logEntries[2];  // 2.5s relative

        // Simulate seeking to 1.6s (relative)
        videoElement.currentTime = 1.6;
        dispatchEvent(videoElement, 'seeked');

        expect(firstLogEntry.classList.contains('haibun-stepper-played')).toBe(true);
        expect(firstLogEntry.classList.contains('haibun-stepper-current')).toBe(false); // 0.5s is before 1.6s

        expect(secondLogEntry.classList.contains('haibun-stepper-played')).toBe(true);
        expect(secondLogEntry.classList.contains('haibun-stepper-current')).toBe(true); // 1.5s is the latest <= 1.6s

        expect(thirdLogEntry.classList.contains('haibun-stepper-notplayed')).toBe(true);
        expect(thirdLogEntry.classList.contains('haibun-stepper-current')).toBe(false);
    });

     it('should update classes correctly during playback via interval', async () => {
        vi.useFakeTimers();
        const logEntries = logDisplayArea.querySelectorAll<HTMLElement>('.haibun-log-entry');
        const firstLogEntry = logEntries[0];  // 0.5s relative
        const secondLogEntry = logEntries[1]; // 1.5s relative
        const thirdLogEntry = logEntries[2];  // 2.5s relative

        // Simulate play starting
        dispatchEvent(videoElement, 'play');

        // Advance time to 0.6s (relative)
        videoElement.currentTime = 0.6;
        vi.advanceTimersByTime(50); // Trigger interval
        await vi.runOnlyPendingTimersAsync(); // Ensure async operations complete if any

        expect(firstLogEntry.classList.contains('haibun-stepper-played')).toBe(true);
        expect(firstLogEntry.classList.contains('haibun-stepper-current')).toBe(true);
        expect(secondLogEntry.classList.contains('haibun-stepper-notplayed')).toBe(true);
        expect(thirdLogEntry.classList.contains('haibun-stepper-notplayed')).toBe(true);

        // Advance time to 1.8s (relative)
        videoElement.currentTime = 1.8;
        vi.advanceTimersByTime(50); // Trigger interval
        await vi.runOnlyPendingTimersAsync();

        expect(firstLogEntry.classList.contains('haibun-stepper-played')).toBe(true);
        expect(firstLogEntry.classList.contains('haibun-stepper-current')).toBe(false);
        expect(secondLogEntry.classList.contains('haibun-stepper-played')).toBe(true);
        expect(secondLogEntry.classList.contains('haibun-stepper-current')).toBe(true);
        expect(thirdLogEntry.classList.contains('haibun-stepper-notplayed')).toBe(true);

        // Advance time to 3.0s (relative)
        videoElement.currentTime = 3.0;
        vi.advanceTimersByTime(50); // Trigger interval
        await vi.runOnlyPendingTimersAsync();

        expect(firstLogEntry.classList.contains('haibun-stepper-played')).toBe(true);
        expect(secondLogEntry.classList.contains('haibun-stepper-played')).toBe(true);
        expect(thirdLogEntry.classList.contains('haibun-stepper-played')).toBe(true);
        expect(thirdLogEntry.classList.contains('haibun-stepper-current')).toBe(true);

        // Simulate pause
        dispatchEvent(videoElement, 'pause');
        // Check interval is cleared (difficult to assert directly, but ensures no more updates)

        vi.useRealTimers();
    });

    it('should handle missing video start element gracefully', () => {
        videoStartElement.remove();

        const logEntries = logDisplayArea.querySelectorAll<HTMLElement>('.haibun-log-entry');
        const secondLogEntry = logEntries[1];

        // Click should not throw error and not change currentTime
        expect(() => {
            dispatchEvent(secondLogEntry.querySelector('summary')!, 'click');
        }).not.toThrow();
        expect(videoElement.currentTime).toBe(0); // Should remain unchanged

        // Seeked should not throw error and not change classes
        videoElement.currentTime = 1.6;
        expect(() => {
            dispatchEvent(videoElement, 'seeked');
        }).not.toThrow();
        expect(secondLogEntry.classList.contains('haibun-stepper-current')).toBe(false);
    });

     it('should handle invalid start time gracefully', () => {
        videoStartElement.dataset.start = "invalid"; // Set invalid start time

        const logEntries = logDisplayArea.querySelectorAll<HTMLElement>('.haibun-log-entry');
        const secondLogEntry = logEntries[1];

        // Click should not throw error and not change currentTime
        expect(() => {
            dispatchEvent(secondLogEntry.querySelector('summary')!, 'click');
        }).not.toThrow();
        expect(videoElement.currentTime).toBe(0);

        // Seeked should not throw error and not change classes
        videoElement.currentTime = 1.6;
        expect(() => {
            dispatchEvent(videoElement, 'seeked');
        }).not.toThrow();
        expect(secondLogEntry.classList.contains('haibun-stepper-current')).toBe(false);
    });

     it('should handle log entries with missing or invalid data-time gracefully', () => {
        const logEntries = logDisplayArea.querySelectorAll<HTMLElement>('.haibun-log-entry');
        const secondLogEntry = logEntries[1];
        delete secondLogEntry.dataset.time;

        const thirdLogEntry = logEntries[2];
        thirdLogEntry.dataset.time = "invalid"; // Set invalid time

        // Simulate seeking to 1.6s (relative)
        videoElement.currentTime = 1.6;
        expect(() => {
            dispatchEvent(videoElement, 'seeked');
        }).not.toThrow(); // Should not throw

        // First entry should still be marked played
        expect(logEntries[0].classList.contains('haibun-stepper-played')).toBe(true);
        expect(logEntries[0].classList.contains('haibun-stepper-current')).toBe(true); // Becomes current as others are invalid

        // Second and third should not have classes applied
        expect(secondLogEntry.classList.length).toBe(1); // Only 'haibun-log-entry'
        expect(thirdLogEntry.classList.length).toBe(1); // Only 'haibun-log-entry'
    });

});

describe('Monitor Media Panel Visibility', () => {
	let dom: JSDOM;
	let document: Document;
	let window: Window & typeof globalThis;
	let mediaPanel: HTMLElement;
	let resizeHandle: HTMLElement;
	let videoContainer: HTMLElement;
	let sequenceDiagram: HTMLElement; // Get the inner div
	let capturedObserverCallback: MutationCallback | null = null; // To store the observer callback

	// Helper to setup DOM for visibility tests
	const setupVisibilityTestDOM = (includeVideo = false, includeDiagram = false) => {
		dom = new JSDOM(`
			<!DOCTYPE html>
			<html>
			<head>
				<style>
					/* Add basic display none from CSS */
					#haibun-media-display, #resize-handle { display: none; }
				</style>
			</head>
			<body>
				<div id="haibun-media-display">
					<div id="haibun-video">
						${includeVideo ? '<video></video>' : ''}
					</div>
					${includeDiagram ? '<div id="sequence-diagram-container"><div id="sequence-diagram"></div></div>' : ''}
				</div>
				<div id="resize-handle"></div>
				<div id="haibun-log-display-area"></div>
			</body>
			</html>
		`, { url: "http://localhost", runScripts: "dangerously", pretendToBeVisual: true });

		window = dom.window as unknown as Window & typeof globalThis;
		document = window.document;

		global.window = window;
		global.document = document;
		global.HTMLElement = window.HTMLElement;
		// Mock MutationObserver to capture the callback
		capturedObserverCallback = null; // Reset before each test
		global.MutationObserver = vi.fn((callback: MutationCallback) => {
			capturedObserverCallback = callback; // Store the callback
			return {
				observe: vi.fn(),
				disconnect: vi.fn(),
				takeRecords: vi.fn(() => []),
			};
		});

		mediaPanel = document.getElementById('haibun-media-display')!;
		resizeHandle = document.getElementById('resize-handle')!;
		videoContainer = document.getElementById('haibun-video')!;
		// sequenceDiagramContainer might not exist if includeDiagram is false
		sequenceDiagram = document.getElementById('sequence-diagram')!; // Get the inner div
	};

	afterEach(() => {
		vi.restoreAllMocks();
		window.close();
	});

	it('should hide media panel and handle initially when no media is present', () => {
		setupVisibilityTestDOM(false, false);
		setupVideoPlayback(); // Run the setup function

		expect(mediaPanel.style.display).toBe(''); // Should remain hidden via CSS
		expect(resizeHandle.style.display).toBe(''); // Should remain hidden via CSS
	});

	it('should show media panel and handle initially if video is present', () => {
		setupVisibilityTestDOM(true, false);
		setupVideoPlayback();

		expect(mediaPanel.style.display).toBe('flex');
		expect(resizeHandle.style.display).toBe('block');
	});

	it('should show media panel and handle when sequence diagram content is added', () => {
		setupVisibilityTestDOM(false, true); // Setup DOM with empty sequence diagram div
		setupVideoPlayback(); // Run setup, which attaches the observer

		// Initially, panel should be hidden (as diagram content isn't present yet)
		expect(mediaPanel.style.display).toBe('');
		expect(resizeHandle.style.display).toBe('');

		// Simulate Mermaid rendering by adding a node and triggering the observer callback
		const dummyNode = document.createElement('svg'); // Simulate SVG added by Mermaid
		sequenceDiagram.appendChild(dummyNode);

		// Manually invoke the captured observer callback
		if (capturedObserverCallback) {
			const mockMutationRecord: Partial<MutationRecord> = {
				type: 'childList',
				target: sequenceDiagram,
				addedNodes: [dummyNode] as unknown as NodeList, // Simulate node addition
			};
			capturedObserverCallback([mockMutationRecord as MutationRecord], {} as MutationObserver);
		} else {
			throw new Error("MutationObserver callback was not captured");
		}

		// Now, the panel should be visible
		expect(mediaPanel.style.display).toBe('flex');
		expect(resizeHandle.style.display).toBe('block');
	});

	it('should show media panel and handle when video is added dynamically', () => {
		setupVisibilityTestDOM(false, false);
		setupVideoPlayback(); // Initial setup

		// Panel should be hidden initially
		expect(mediaPanel.style.display).toBe('');
		expect(resizeHandle.style.display).toBe('');

		// Dynamically add video
		const newVideo = document.createElement('video');
		videoContainer.appendChild(newVideo);

		// Re-run setup or trigger observer manually (re-running setup is simpler here)
		// In a real browser, the MutationObserver would trigger showMediaPanelIfNeeded
		// We simulate the effect by calling the function that contains the observer logic again.
		setupVideoPlayback();

		// Now panel should be visible
		expect(mediaPanel.style.display).toBe('flex');
		expect(resizeHandle.style.display).toBe('block');
	});
});
