/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TArtifactVideoStart, TMessageContext, EExecutionMessageType } from '@haibun/core/build/lib/interfaces/logger.js';
import { LogMessageContent, LogEntry } from '../messages.js';
import { setupMessagesTestDOM, cleanupMessagesTestDOM, createMockTag } from '../test-utils.js';

describe('VideoStartArtifactDisplay', () => {
	const TEST_START_TIME = 1700000000000;

	beforeEach(() => {
		setupMessagesTestDOM(TEST_START_TIME);
	});

	afterEach(() => {
		cleanupMessagesTestDOM();
	});

	it('should be placed in document.body by LogEntry and have data attribute set', async () => {
		const startTime = 54321;
		const artifact: TArtifactVideoStart = { artifactType: 'video/start', start: startTime };
		const context: TMessageContext = {
			incident: EExecutionMessageType.ACTION,
			tag: createMockTag(),
			artifact
		};

		const logEntry = new LogEntry('info', TEST_START_TIME + 100, 'Video Start Event', context);
		const logArea = document.getElementById('haibun-log-display-area') || document.body;
		logArea.appendChild(logEntry.element);

		await new Promise(resolve => setTimeout(resolve, 0));

		const startSpanInBody = document.body.querySelector('#haibun-video-start') as HTMLSpanElement;
		expect(startSpanInBody).not.toBeNull();
		expect(startSpanInBody).toBeInstanceOf(HTMLSpanElement);
		expect(startSpanInBody.dataset.start).toBe(`${startTime}`);

		const details = logEntry.element.querySelector('.haibun-context-details');
		expect(details).not.toBeNull();
		expect(details!.querySelector('.haibun-artifact-container.haibun-artifact-video-start')).toBeNull();
		expect(details!.querySelector('#haibun-video-start')).toBeNull();

		const messageContentEl = logEntry.element.querySelector('.haibun-message-content');
		expect(messageContentEl).not.toBeNull();
		expect(messageContentEl!.classList.contains('haibun-simple-message')).toBe(true);
		expect(messageContentEl!.textContent).toContain('Video Start Event');
	});

	it('LogMessageContent should not create artifactContainer for video/start type', () => {
		const startTime = 12345;
		const artifact: TArtifactVideoStart = { artifactType: 'video/start', start: startTime };
		const context: TMessageContext = { incident: EExecutionMessageType.ACTION, tag: createMockTag(), artifact };

		const logMessageContent = new LogMessageContent('Video start artifact message', context);
		document.body.appendChild(logMessageContent.element);

		expect(logMessageContent.artifactDisplay).not.toBeNull();
		expect(logMessageContent.artifactDisplay?.artifactType).toBe('video/start');

		const detailsElement = logMessageContent.element.querySelector('details.haibun-context-details');
		expect(detailsElement).not.toBeNull();
		const artifactContainerInsideDetails = detailsElement!.querySelector('.haibun-artifact-container');
		expect(artifactContainerInsideDetails).toBeNull();

		expect(logMessageContent.element.classList.contains('haibun-simple-message')).toBe(true);
	});
});
