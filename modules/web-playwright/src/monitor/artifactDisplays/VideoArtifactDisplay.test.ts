/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TArtifactVideo, TMessageContext, EExecutionMessageType } from '@haibun/core/build/lib/interfaces/logger.js';
import { LogMessageContent, LogEntry } from '../messages.js';
import { setupMessagesTestDOM, cleanupMessagesTestDOM, createMockTag } from '../test-utils.js';

describe('VideoArtifactDisplay Rendering', () => {
	const TEST_START_TIME = 1700000000000;

	beforeEach(() => {
		setupMessagesTestDOM(TEST_START_TIME);
		const existingContainer = document.getElementById('haibun-video');
		if (existingContainer) {
			existingContainer.remove();
		}
	});

	afterEach(() => {
		cleanupMessagesTestDOM();
		vi.clearAllMocks();
		const existingContainer = document.getElementById('haibun-video');
		if (existingContainer) {
			existingContainer.remove();
		}
	});

	it('should render a Video artifact in details via LogMessageContent when #haibun-video container is missing', async () => {
		const videoPath = '/path/to/video.mp4';
		const artifact: TArtifactVideo = { artifactType: 'video', path: videoPath };
		const context: TMessageContext = {
			incident: EExecutionMessageType.ACTION,
			tag: createMockTag(),
			artifact
		};
		const logMessageContent = new LogMessageContent('Video Artifact in Details', context);
		document.body.appendChild(logMessageContent.element);

		const details = logMessageContent.element.querySelector('.haibun-context-details') as HTMLDetailsElement;
		expect(details).not.toBeNull();

		const messageSummary = details?.querySelector('.haibun-log-message-summary');
		expect(messageSummary?.textContent).toContain('Video Artifact in Details');
		expect(messageSummary?.querySelector('.details-type')?.textContent).toBe('video');

		const artifactContainer = details?.querySelector('.haibun-artifact-container.haibun-artifact-video') as HTMLElement;
		expect(artifactContainer).not.toBeNull();
		expect(artifactContainer.textContent).toBe('Artifact is loading...');

		let video = artifactContainer?.querySelector('video') as HTMLVideoElement;
		expect(video).toBeNull();

		details.open = true;
		details.dispatchEvent(new Event('toggle'));

		await new Promise(resolve => setTimeout(resolve, 0));

		const renderedArtifactContainer = details?.querySelector('.haibun-artifact-container.haibun-artifact-video') as HTMLElement;
		video = renderedArtifactContainer?.querySelector('video') as HTMLVideoElement;
		expect(video).not.toBeNull();
		expect(video).toBeInstanceOf(HTMLVideoElement);
		expect(video?.src).toContain(videoPath);
		expect(video?.controls).toBe(true);
		expect(document.querySelector('#haibun-video video')).toBeNull();
	});

	it('should render a Video artifact in #haibun-video container when present, via LogEntry', async () => {
		const videoContainer = document.createElement('div');
		videoContainer.id = 'haibun-video';
		document.body.appendChild(videoContainer);

		const videoPath = '/path/to/special-video.mp4';
		const artifact: TArtifactVideo = { artifactType: 'video', path: videoPath };
		const context: TMessageContext = {
			incident: EExecutionMessageType.ACTION,
			tag: createMockTag(),
			artifact
		};
		const logEntry = new LogEntry('info', TEST_START_TIME + 500, 'Video Artifact in Container', context);
		document.body.appendChild(logEntry.element);

		await new Promise(resolve => setTimeout(resolve, 0));

		const videoInSpecialContainer = document.querySelector('#haibun-video video') as HTMLVideoElement;
		expect(videoInSpecialContainer).not.toBeNull();
		expect(videoInSpecialContainer).toBeInstanceOf(HTMLVideoElement);
		expect(videoInSpecialContainer?.src).toContain(videoPath);
		expect(videoInSpecialContainer?.controls).toBe(true);
		expect(videoContainer.style.display).toBe('flex');

		const messageContentEl = logEntry.element.querySelector('.haibun-message-content');
		expect(messageContentEl).not.toBeNull();
		expect(messageContentEl!.classList.contains('haibun-simple-message')).toBe(true);
		expect(messageContentEl!.textContent).toContain('Video Artifact in Container');

		const details = logEntry.element.querySelector('.haibun-context-details') as HTMLDetailsElement;
		expect(details).not.toBeNull();
		expect(details.querySelector('.haibun-artifact-container.haibun-artifact-video')).toBeNull();
		expect(details.querySelector('video')).toBeNull();
	});
});
