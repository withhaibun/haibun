/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TArtifactSpeech, TMessageContext, EExecutionMessageType } from '@haibun/core/build/lib/interfaces/logger.js';
import { LogMessageContent } from '../messages.js';
import { setupMessagesTestDOM, cleanupMessagesTestDOM, createMockTag } from '../test-utils.js';
import { TTag } from '@haibun/core/build/lib/ttag.js';
import { SpeechArtifactDisplay } from './SpeechArtifactDisplay.js';

describe('SpeechArtifactDisplay', () => {
	const TEST_START_TIME = 1700000000000;
	const mockTag: TTag = createMockTag();

	beforeEach(() => {
		setupMessagesTestDOM(TEST_START_TIME);
	});

	afterEach(() => {
		cleanupMessagesTestDOM();
		vi.restoreAllMocks();
	});

	it('should create an audio element with controls and set src on render', async () => {
		const artifact: TArtifactSpeech = { artifactType: 'speech', path: 'test.mp3', transcript: 'Test transcription', durationS: 5 };
		const context: TMessageContext = { incident: EExecutionMessageType.ACTION, tag: mockTag, artifact };

		const logMessageContent = new LogMessageContent('Speech artifact', context);
		const logDisplayArea = document.getElementById('haibun-log-display-area');
		expect(logDisplayArea).not.toBeNull();
		logDisplayArea!.appendChild(logMessageContent.element);

		const detailsElement = logMessageContent.element.querySelector('details.haibun-context-details') as HTMLDetailsElement;
		expect(detailsElement).not.toBeNull();

		const artifactDisplay = logMessageContent.artifactDisplay as unknown as SpeechArtifactDisplay;
		expect(artifactDisplay).toBeInstanceOf(SpeechArtifactDisplay);

		let artifactContainer = logMessageContent.element.querySelector('.haibun-artifact-container') as HTMLElement;
		expect(artifactContainer).not.toBeNull();
		expect(artifactContainer.textContent).toBe('Artifact is loading...');

		detailsElement.open = true;
		detailsElement.dispatchEvent(new Event('toggle'));

		await vi.dynamicImportSettled();

		artifactContainer = logMessageContent.element.querySelector('.haibun-artifact-container') as HTMLElement;
		const audioElement = artifactContainer.querySelector('audio') as HTMLAudioElement;

		expect(audioElement).not.toBeNull();
		expect(audioElement.tagName).toBe('AUDIO');
		expect(audioElement.controls).toBe(true);
		expect(audioElement.style.width).toBe('320px');
		expect(audioElement.src).toContain('test.mp3');
	});
});
