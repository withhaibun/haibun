/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TArtifactVideoStart, TMessageContext, EExecutionMessageType } from '@haibun/core/lib/interfaces/logger.js';
import { LogMessageContent } from '../messages.js';
import { setupMessagesTestDOM, cleanupMessagesTestDOM, createMockTag } from '../test-utils.js';

describe('VideoStartArtifactDisplay', () => {
	const TEST_START_TIME = 1700000000000;

	beforeEach(() => {
		// Clear the document body and set up the initial DOM structure for tests
		document.body.innerHTML = '<div id="haibun-log-display-area"></div>';
		setupMessagesTestDOM(TEST_START_TIME);
	});

	afterEach(() => {
		cleanupMessagesTestDOM();
	});

	it('should correctly handle a TArtifactVideoStart and create a special placement span', async () => {
		const videoStartTime = TEST_START_TIME + 500;
		const artifact: TArtifactVideoStart = {
			artifactType: 'video/start',
			start: videoStartTime
		};
		const messageContext: TMessageContext = {
			incident: EExecutionMessageType.ACTION,
			tag: createMockTag(),
			artifacts: [artifact]
		};

		// Instantiate LogMessageContent directly to test its handling of 'video/start'
		const logMessageContent = new LogMessageContent('Video started event', messageContext);

		// LogMessageContent with a 'special' placement artifact needs to be appended to the DOM
		// for its renderArtifactForSpecialPlacement to find parentElement and insert the special span.
		// We'll simulate this by appending it to a temporary LogEntry-like structure.
		const logEntryElement = document.createElement('div');
		logEntryElement.className = 'haibun-log-entry'; // Add class for 'closest' to work
		logEntryElement.appendChild(logMessageContent.element);
		const logArea = document.getElementById('haibun-log-display-area');
		logArea?.appendChild(logEntryElement);

		// Allow async operations in renderArtifactForSpecialPlacement to complete
		await new Promise(resolve => setTimeout(resolve, 0));

		const startSpan = document.body.querySelector('#haibun-video-start') as HTMLSpanElement;
		expect(startSpan).not.toBeNull();
		expect(startSpan).toBeInstanceOf(HTMLSpanElement);
		expect(startSpan.dataset.start).toBe(`${videoStartTime}`);

		// Verify that the LogMessageContent itself doesn't create an artifact container in details
		// for 'special' placement artifacts.
		const detailsElement = logMessageContent.element.querySelector('details.haibun-context-details');
		if (detailsElement) {
			const artifactContainerInsideDetails = detailsElement.querySelector('.haibun-artifact-container');
			expect(artifactContainerInsideDetails).toBeNull();
		}
	});
});
