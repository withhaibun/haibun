import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EExecutionMessageType, TMessageContext, TArtifactResolvedFeatures, TLogLevel, TLogArgs } from '@haibun/core/build/lib/interfaces/logger.js';
import { TResolvedFeature } from '@haibun/core/build/lib/defs.js';
import { getResolvedTestFeatures } from '@haibun/core/build/lib/test/resolvedTestFeatures.js';
import { defineGlobalMermaidAndDOMPurify, setupMessagesTestDOM, cleanupMessagesTestDOM, createMockTag } from '../test-utils.js';
import { LogMessageContent } from '../messages.js';

export type TLogEntry = {
    level: TLogLevel;
    message: TLogArgs;
    messageContext?: TMessageContext;
    timestamp: number;
};

describe('ResolvedFeaturesArtifactDisplay Rendering via LogMessageContent', () => {
    const TEST_START_TIME = Date.now();

    beforeEach(async () => {
        await defineGlobalMermaidAndDOMPurify();
        setupMessagesTestDOM(TEST_START_TIME);
    });

    afterEach(() => {
        cleanupMessagesTestDOM();
        vi.restoreAllMocks();
    });

    const createResolvedFeaturesArtifact = (resolvedFeatures: TResolvedFeature[], artifactPath = 'test.json'): TArtifactResolvedFeatures => ({
        artifactType: 'resolvedFeatures',
        resolvedFeatures,
        path: artifactPath
    });

    it.skip('should render resolved features artifact lazily with placeholder, and render SVG on open', async () => {
        const features = [{
            path: '/feature-1.feature',
            content: `Scenario: Feature one scenario\\ngwta1\\nis {env_var1}`,
        }];
        const resolvedFeatures = await getResolvedTestFeatures(features, []);
        const artifact = createResolvedFeaturesArtifact(resolvedFeatures, 'feat1.json');
        const mockTag = createMockTag();
        const context: TMessageContext = {
            incident: EExecutionMessageType.ACTION,
            tag: mockTag,
            artifacts: [artifact]
        };

        const logEntryData: TLogEntry = {
            level: 'info',
            message: 'Resolved Features',
            messageContext: context,
            timestamp: Date.now()
        };

        const logMessageContent = new LogMessageContent(logEntryData.message, logEntryData.messageContext);
        const logDisplayArea = document.getElementById('haibun-log-display-area');
        expect(logDisplayArea).not.toBeNull();
        logDisplayArea!.appendChild(logMessageContent.element);

        const details = logMessageContent.element.querySelector('.haibun-context-details') as HTMLDetailsElement;
        expect(details).not.toBeNull();

        // Get the container for the artifact display from within the details element's content
        // Adjusted selector based on console output: .haibun-artifact-container is a direct child of details
        const artifactContainer = details.querySelector('.haibun-artifact-container');
        expect(artifactContainer!, 'Artifact container should exist within details').not.toBeNull();

        expect(details.open).toBe(false);
        // Check that no SVG is rendered initially (when closed)
        expect(artifactContainer!.querySelector('svg'), 'SVG should not be present when details are closed initially').toBeNull();

        // Open the details element to trigger rendering
        details.open = true;
        const eventOwnerWindowOpen = details.ownerDocument.defaultView;
        if (!eventOwnerWindowOpen) {
            throw new Error("Element is not in a window, cannot create event for opening");
        }
        const toggleEventOpen = new eventOwnerWindowOpen.Event('toggle', { bubbles: true });
        details.dispatchEvent(toggleEventOpen);

        // Wait for any async rendering triggered by the event
        await new Promise(resolve => setTimeout(resolve, 500));

        // Check that an SVG is rendered when open
        let svgElement = artifactContainer!.querySelector('svg');
        expect(svgElement, 'SVG element should be present when details are open').not.toBeNull();
        expect(svgElement!.querySelector('g'), 'SVG should have content (g element) when details are open').not.toBeNull(); // Check for actual SVG content

        // Close the details element
        details.open = false;
        const eventOwnerWindowClose = details.ownerDocument.defaultView;
        if (!eventOwnerWindowClose) {
            throw new Error("Element is not in a window, cannot create event for closing");
        }
        const toggleEventClose = new eventOwnerWindowClose.Event('toggle', { bubbles: true });
        details.dispatchEvent(toggleEventClose);
        await new Promise(resolve => setTimeout(resolve, 100)); // Wait for potential cleanup

        // Check that the SVG is removed (or no longer present) when closed again
        svgElement = artifactContainer!.querySelector('svg');
        expect(svgElement, 'SVG should not be present when details are closed again').toBeNull();
    });
});
