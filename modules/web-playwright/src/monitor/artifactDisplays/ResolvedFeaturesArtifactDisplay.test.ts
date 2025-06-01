import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EExecutionMessageType, TMessageContext, TArtifactResolvedFeatures, TLogLevel, TLogArgs } from '@haibun/core/build/lib/interfaces/logger.js';
import { TResolvedFeature } from '@haibun/core/build/lib/defs.js';
import { getResolvedTestFeatures } from '@haibun/core/build/lib/test/resolvedTestFeatures.js';
import { setupMessagesTestDOM, cleanupMessagesTestDOM, createMockTag, defineGlobalMermaidAndDOMPurify } from '../test-utils.js';
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

    it('should render resolved features artifact lazily with placeholder, and render SVG on open', async () => {
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
            artifact
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
        expect(details.open).toBe(false);

        const artifactContainer = details.querySelector('.haibun-artifact-container');
        expect(artifactContainer).not.toBeNull();

        expect(artifactContainer!.textContent).toBe('Artifact is loading...');
        let svgElement = artifactContainer!.querySelector('svg');
        expect(svgElement).toBeNull();

        details.open = true;
        details.dispatchEvent(new Event('toggle'));

        await new Promise(resolve => setTimeout(resolve, 500));

        expect(artifactContainer!.textContent).not.toBe('Artifact is loading...');

        svgElement = artifactContainer!.querySelector('svg');
        expect(svgElement).not.toBeNull();
        expect(svgElement!.querySelector('g')).not.toBeNull();

        details.open = false;
        details.dispatchEvent(new Event('toggle'));
        await new Promise(resolve => setTimeout(resolve, 0));

        svgElement = artifactContainer!.querySelector('svg');
        expect(svgElement).not.toBeNull();
        expect(artifactContainer!.textContent).not.toBe('Artifact is loading...');
    });
});
