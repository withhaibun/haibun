/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TArtifactImage, TMessageContext, EExecutionMessageType } from '@haibun/core/build/lib/interfaces/logger.js';
import { LogMessageContent } from '../messages.js';
import { TTag } from '@haibun/core/build/lib/ttag.js';
import { setupMessagesTestDOM, cleanupMessagesTestDOM } from '../test-utils.js';

describe('ImageArtifactDisplay', () => {
	const TEST_START_TIME = 1700000000000;

	beforeEach(() => {
		setupMessagesTestDOM(TEST_START_TIME);
		document.body.innerHTML = '';
	});

	afterEach(() => {
		cleanupMessagesTestDOM();
		vi.clearAllMocks();
	});

	it('should render an Image artifact correctly and lazily via LogMessageContent', async () => {
		const imagePath = '/path/to/image.png';
		const artifact: TArtifactImage = { artifactType: 'image', path: imagePath };
		const mockTagImage: TTag = { key: 'image', sequence: 1, featureNum: 1, params: {}, trace: false };
		const context: TMessageContext = {
			incident: EExecutionMessageType.ACTION,
			tag: mockTagImage,
			artifact
		};
		const logMessageContent = new LogMessageContent('Image Artifact', context);
		const element = logMessageContent.element;
		document.body.appendChild(element);

		const details = element.querySelector('details.haibun-context-details') as HTMLDetailsElement;
		expect(details).not.toBeNull();
		expect(details?.tagName).toBe('DETAILS');

		const messageSummary = details?.querySelector('.haibun-log-message-summary');
		expect(messageSummary).not.toBeNull();
		expect(messageSummary?.textContent).toContain('Image Artifact');
		expect(messageSummary?.querySelector('.details-type')?.textContent).toBe('image');

		const artifactContainer = details?.querySelector('.haibun-artifact-container.haibun-artifact-image') as HTMLElement;
		expect(artifactContainer).not.toBeNull();
		expect(artifactContainer.textContent).toBe('Artifact is rendering...');

		let img = artifactContainer?.querySelector('img') as HTMLImageElement;
		expect(img).toBeNull();

		details.open = true;
		details.dispatchEvent(new Event('toggle'));

		await new Promise(resolve => setTimeout(resolve, 0));

		const renderedArtifactContainer = details?.querySelector('.haibun-artifact-container.haibun-artifact-image') as HTMLElement;
		expect(renderedArtifactContainer).not.toBeNull();
		img = renderedArtifactContainer?.querySelector('img') as HTMLImageElement;
		expect(img).not.toBeNull();
		expect(img).toBeInstanceOf(HTMLImageElement);
		expect(img?.src).toContain(imagePath);
		expect(img?.alt).toBe('Screen capture artifact');
	});

	it('should render image artifact in details after toggle', async () => {
		const imageBase64 = 'data:image/png;base64,test';
		const artifact: TArtifactImage = { artifactType: 'image', path: imageBase64 };
		const mockTagImage: TTag = { key: 'imageToggle', sequence: 1, featureNum: 1, params: {}, trace: false };
		const messageContext: TMessageContext = {
			incident: EExecutionMessageType.ACTION,
			tag: mockTagImage,
			artifact
		};
		const logMessageElement = new LogMessageContent('Image artifact message', messageContext);
		document.body.appendChild(logMessageElement.element);

		const detailsElement = logMessageElement.element.querySelector('details.haibun-context-details') as HTMLDetailsElement;
		expect(detailsElement).not.toBeNull();
		if (!detailsElement) return;

		const artifactContainer = detailsElement.querySelector('.haibun-artifact-container.haibun-artifact-image') as HTMLElement;
		expect(artifactContainer).not.toBeNull();
		if (!artifactContainer) return;

		const initialTextContent = artifactContainer.textContent;
		expect(initialTextContent).toBe('Artifact is rendering...');

		detailsElement.open = true;
		detailsElement.dispatchEvent(new Event('toggle'));
		await new Promise(process.nextTick);

		const imgElement = artifactContainer.querySelector('img');
		expect(imgElement).not.toBeNull();
		if (!imgElement) return;
		expect(imgElement.src).toBe(imageBase64);
		expect(artifactContainer.textContent).not.toBe(initialTextContent);
	});
});
