/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TArtifactSpeech, TMessageContext, EExecutionMessageType } from '@haibun/core/build/lib/interfaces/logger.js';
import { LogMessageContent } from '../messages.js';
import { setupMessagesTestDOM, cleanupMessagesTestDOM, createMockTag } from '../test-utils.js';
import { TTag } from '@haibun/core/build/lib/ttag.js';

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
		const context: TMessageContext = { incident: EExecutionMessageType.ACTION, tag: mockTag, artifacts: [artifact] };

		const logMessageContent = new LogMessageContent('Speech artifact', context);
		const logDisplayArea = document.getElementById('haibun-log-display-area');
		expect(logDisplayArea).not.toBeNull();
		if (!logDisplayArea) return;
		logDisplayArea.appendChild(logMessageContent.element);

		const detailsElement = logMessageContent.element.querySelector('details.haibun-context-details') as HTMLDetailsElement;
		expect(detailsElement).not.toBeNull();
		if (!detailsElement) return;

		let artifactContainer = detailsElement.querySelector('.haibun-artifact-container') as HTMLElement;
		expect(artifactContainer).not.toBeNull();
		if (!artifactContainer) return;
		expect(artifactContainer.textContent).toBe('Artifact is rendering...');

		detailsElement.open = true;
		detailsElement.dispatchEvent(new Event('toggle'));

		await vi.dynamicImportSettled();
		await new Promise(process.nextTick);

		artifactContainer = detailsElement.querySelector('.haibun-artifact-container.haibun-artifact-speech') as HTMLElement;
		expect(artifactContainer).not.toBeNull();
		if (!artifactContainer) return;

		const audioElement = artifactContainer.querySelector('audio') as HTMLAudioElement;
		expect(audioElement).not.toBeNull();
		if (!audioElement) return;

		expect(audioElement.tagName).toBe('AUDIO');
		expect(audioElement.controls).toBe(true);
		expect(audioElement.style.width).toBe('320px');
		expect(audioElement.src).toContain('test.mp3');
	});

	it('should render audio artifact in details after toggle', async () => {
		const audioBase64 = 'data:audio/mpeg;base64,test';
		const artifact: TArtifactSpeech = { artifactType: 'speech', path: audioBase64, transcript: 'Test transcription', durationS: 5 };
		const context: TMessageContext = { incident: EExecutionMessageType.ACTION, tag: mockTag, artifacts: [artifact] };

		const logMessageElement = new LogMessageContent('Speech artifact message', context);
		const logDisplayArea = document.getElementById('haibun-log-display-area');
		expect(logDisplayArea).not.toBeNull();
		if (!logDisplayArea) return;
		logDisplayArea.appendChild(logMessageElement.element);

		const detailsElement = logMessageElement.element.querySelector('details.haibun-context-details') as HTMLDetailsElement;
		expect(detailsElement).not.toBeNull();
		if (!detailsElement) return;

		let artifactContainer = detailsElement.querySelector('.haibun-artifact-container') as HTMLElement;
		expect(artifactContainer).not.toBeNull();
		if (!artifactContainer) return;

		const initialTextContent = artifactContainer.textContent;
		expect(initialTextContent).toBe('Artifact is rendering...');

		detailsElement.open = true;
		detailsElement.dispatchEvent(new Event('toggle'));
		await vi.dynamicImportSettled();
		await new Promise(process.nextTick);

		artifactContainer = detailsElement.querySelector('.haibun-artifact-container.haibun-artifact-speech') as HTMLElement;
		expect(artifactContainer).not.toBeNull();
		if (!artifactContainer) return;

		const audioElement = artifactContainer.querySelector('audio');
		expect(audioElement).not.toBeNull();
		if (!audioElement) return;

		expect(audioElement.src).toBe(audioBase64);
		expect(audioElement.controls).toBe(true);
		expect(artifactContainer.textContent).not.toBe(initialTextContent);
	});
});
