/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TArtifactVideo, TMessageContext, EExecutionMessageType } from '@haibun/core/lib/interfaces/logger.js';
import { LogMessageContent, LogEntry } from '../messages.js';
import { setupMessagesTestDOM, cleanupMessagesTestDOM, createMockTag } from '../test-utils.js';

describe('VideoArtifactDisplay Rendering', () => {
	const TEST_START_TIME = 1700000000000;

	beforeEach(() => {
		setupMessagesTestDOM(TEST_START_TIME);
		const existingContainer = document.getElementById('haibun-focus');
		if (existingContainer) {
			existingContainer.remove();
		}
	});

	afterEach(() => {
		cleanupMessagesTestDOM();
		vi.clearAllMocks();
		const existingContainer = document.getElementById('haibun-focus');
		if (existingContainer) {
			existingContainer.remove();
		}
	});

	it.skip('should render a Video artifact in #haibun-focus container via LogMessageContent when present', async () => {
		const videoContainer = document.createElement('div');
		videoContainer.id = 'haibun-focus';
		document.body.appendChild(videoContainer);

		const videoPath = '/path/to/video-via-logmessagecontent.mp4';
		const artifact: TArtifactVideo = { artifactType: 'video', path: videoPath };
		const context: TMessageContext = {
			incident: EExecutionMessageType.ACTION,
			tag: createMockTag(),
			artifacts: [artifact]
		};
		const logMessageContent = new LogMessageContent('Video Artifact in #haibun-focus', context);
		document.body.appendChild(logMessageContent.element);

		await new Promise(resolve => setTimeout(resolve, 0));

		const videoInSpecialContainer = document.querySelector('#haibun-focus video') as HTMLVideoElement;
		expect(videoInSpecialContainer, 'Video element should be in #haibun-focus container').not.toBeNull();
		if (videoInSpecialContainer) { // Type guard
			expect(videoInSpecialContainer).toBeInstanceOf(HTMLVideoElement);
			expect(videoInSpecialContainer.src).toContain(videoPath);
			expect(videoInSpecialContainer.controls).toBe(true);
		}
		expect(videoContainer.style.display, '#haibun-focus container should be visible').toBe('flex');
		const details = logMessageContent.element.querySelector('.haibun-context-details') as HTMLDetailsElement;
		expect(details, 'Details element within LogMessageContent should exist').not.toBeNull();

		const artifactContainerInDetails = details?.querySelector('.haibun-artifact-container.haibun-artifact-video');
		expect(artifactContainerInDetails, 'Artifact container for video should NOT be in details').toBeNull();
		const messageSummary = details?.querySelector('.haibun-log-message-summary');
		expect(messageSummary?.textContent, 'Summary message should be present').toContain('Video Artifact in #haibun-focus');
		expect(messageSummary?.querySelector('.details-type')?.textContent, 'Details type label should be "video"').toBe('video');
	});

	it.skip('should render a Video artifact in #haibun-focus container when present, via LogEntry', async () => {
		const videoContainer = document.createElement('div');
		videoContainer.id = 'haibun-focus';
		document.body.appendChild(videoContainer);

		const videoPath = '/path/to/special-video.mp4';
		const artifact: TArtifactVideo = { artifactType: 'video', path: videoPath };
		const context: TMessageContext = {
			incident: EExecutionMessageType.ACTION,
			tag: createMockTag(),
			artifacts: [artifact]
		};
		const logEntry = new LogEntry('info', TEST_START_TIME + 500, 'Video Artifact in Container', context);
		document.body.appendChild(logEntry.element);

		await new Promise(resolve => setTimeout(resolve, 0));

		const videoInSpecialContainer = document.querySelector('#haibun-focus video') as HTMLVideoElement;
		expect(videoInSpecialContainer).not.toBeNull();
		expect(videoInSpecialContainer).toBeInstanceOf(HTMLVideoElement);
		expect(videoInSpecialContainer?.src).toContain(videoPath);
		expect(videoInSpecialContainer?.controls).toBe(true);
		expect(videoContainer.style.display).toBe('flex');

		const messageContentEl = logEntry.element.querySelector('.haibun-message-content');
		expect(messageContentEl).not.toBeNull();
		// If an artifact is present in messageContext, LogMessageContent will not have 'haibun-simple-message' class.
		// It will instead construct the details/summary structure.
		expect(messageContentEl!.classList.contains('haibun-simple-message')).toBe(false);
		// The primary message is part of the summary within the details element, not direct textContent of messageContentEl
		// expect(messageContentEl!.textContent).toContain('Video Artifact in Container'); // This would fail

		const details = logEntry.element.querySelector('.haibun-context-details') as HTMLDetailsElement;
		expect(details).not.toBeNull();

		// Check that the summary inside details contains the message
		const messageSummary = details?.querySelector('.haibun-log-message-summary');
		expect(messageSummary?.textContent).toContain('Video Artifact in Container');

		expect(details.querySelector('.haibun-artifact-container.haibun-artifact-video')).toBeNull();
		expect(details.querySelector('video')).toBeNull();
	});
});
