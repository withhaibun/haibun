/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TArtifactVideoStart, TMessageContext, EExecutionMessageType } from '@haibun/core/build/lib/interfaces/logger.js';
import { LogEntry } from '../messages.js';
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
		expect(messageContentEl!.classList.contains('haibun-simple-message')).toBe(false);

		// The message is in the summary part of the details element
		const messageSummary = details?.querySelector('.haibun-log-message-summary');
		expect(messageSummary?.textContent).toContain('Video Start Event');
		// expect(messageContentEl!.textContent).toContain('Video Start Event'); // This would fail
	});

});
