/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TArtifactImage, TMessageContext, EExecutionMessageType } from '@haibun/core/build/lib/interfaces/logger.js';
import { LogMessageContent } from '../messages.js';
import { TTag } from '@haibun/core/build/lib/ttag.js';
import { setupMessagesTestDOM, cleanupMessagesTestDOM } from '../test-utils.js';

describe('ImageArtifactDisplay Rendering', () => {
    const TEST_START_TIME = 1700000000000;

    beforeEach(() => {
        setupMessagesTestDOM(TEST_START_TIME);
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
        expect(artifactContainer.textContent).toBe('Artifact is loading...');

        let img = artifactContainer?.querySelector('img') as HTMLImageElement;
        expect(img).toBeNull(); // Should not be rendered yet

        // Open the details
        details.open = true;
        details.dispatchEvent(new Event('toggle'));

        // Wait for async rendering due to the toggle listener
        await new Promise(resolve => setTimeout(resolve, 0));

        // Artifact container should now have the image
        const renderedArtifactContainer = details?.querySelector('.haibun-artifact-container.haibun-artifact-image') as HTMLElement;
        expect(renderedArtifactContainer).not.toBeNull();
        img = renderedArtifactContainer?.querySelector('img') as HTMLImageElement;
        expect(img).not.toBeNull();
        expect(img).toBeInstanceOf(HTMLImageElement);
        expect(img?.src).toContain(imagePath);
        expect(img?.alt).toBe('Screen capture artifact'); // Check alt text
    });
});
