/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// Import necessary types for mocking contexts
import { TArtifact, TExecutorMessageContext, TArtifactMessageContext, TArtifactDebugTopic } from '@haibun/core/build/lib/interfaces/logger.js';
import { TTag, TFeatureStep, TStepResult, TStepAction, TStepActionResult, OK } from '@haibun/core/build/lib/defs.js';
import { LogEntry } from './messages.js'; // Import the main class

// Mock the sequenceDiagramGenerator if its side effects are not desired during unit testing
vi.mock('./monitor.js', () => ({
    sequenceDiagramGenerator: {
        processEvent: vi.fn(),
        update: vi.fn(), // Mock other potential methods if needed
    }
}));

describe('Monitor Messages Logic (messages.ts)', () => {
    const TEST_START_TIME = 1700000000000; // Example fixed start time
    const BASE_TIMESTAMP = TEST_START_TIME + 500; // 0.5s after start

    beforeEach(() => {
        // Set up the DOM environment needed for tests
        document.body.innerHTML = ''; // Clear body
        document.body.dataset.startTime = `${TEST_START_TIME}`;
        // Add potential containers if needed by specific tests
        const logArea = document.createElement('div');
        logArea.id = 'haibun-log-display-area';
        document.body.appendChild(logArea);
    });

    afterEach(() => {
        // Clean up DOM
        document.body.innerHTML = '';
        delete document.body.dataset.startTime;
        vi.clearAllMocks(); // Clear mocks between tests
    });

    // --- LogEntry Class Tests ---
    describe('LogEntry Class', () => {

        it('should create a basic log entry element', () => {
            const level = 'info';
            const message = 'Basic message';
            const logEntry = new LogEntry(level, BASE_TIMESTAMP, message);
            const element = logEntry.element;

            expect(element).toBeInstanceOf(HTMLDivElement);
            expect(element.classList.contains('haibun-log-entry')).toBe(true);
            expect(element.classList.contains(`haibun-level-${level}`)).toBe(true);
            expect(element.dataset.time).toBe(`${BASE_TIMESTAMP}`);

            // Check for details summary
            const detailsSummary = element.querySelector('.haibun-log-details-summary');
            expect(detailsSummary).not.toBeNull();
            expect(detailsSummary?.tagName).toBe('SUMMARY');
            expect(detailsSummary?.innerHTML).toContain(level);
            expect(detailsSummary?.innerHTML).toContain('0:500s'); // Relative time

            // Check that message content now displays the original message
            const messageContent = element.querySelector('.haibun-message-content') as HTMLElement;
            expect(messageContent).not.toBeNull();
            expect(messageContent.classList.contains('haibun-simple-message')).toBe(true);
            expect(messageContent.textContent).toBe(message);
        });

        it('should display a modified summary message when context provides it', () => {
            const level = 'debug';
            const message = 'Action';
            // Create minimal valid mock objects based on definitions
            const mockTag: TTag = { key: 'test', sequence: 1, featureNum: 1, params: {}, trace: false };
            const mockStepAction: TStepAction = { actionName: 'testAction', stepperName: 'testStepper', step: { action: async () => OK } };
            const mockFeatureStep: TFeatureStep = { path: 'test.feature', in: 'Given something', seq: 1, action: mockStepAction };
            const mockActionResult: TStepActionResult = { ok: true, name: 'testAction' };
            const mockStepResult: TStepResult = { ok: true, actionResult: mockActionResult, in: 'Given something', path: 'test.feature', seq: 1 };

            // Provide a valid TExecutorMessageContext structure
            const context: TExecutorMessageContext = {
                tag: mockTag,
                topic: {
                    stage: 'Executor',
                    step: mockFeatureStep,
                    result: mockStepResult
                }
            };
            const logEntry = new LogEntry(level, BASE_TIMESTAMP + 100, message, context);
            const element = logEntry.element;

            const messageContent = element.querySelector('.haibun-message-content') as HTMLElement;
            expect(messageContent).not.toBeNull();
            expect(messageContent?.classList.contains('haibun-simple-message')).toBe(true);
            expect(messageContent?.textContent).toBe('Action Given something'); // Match mock data

            // Ensure no artifact details wrapper is present
            expect(element.querySelector('.haibun-artifact-details')).toBeNull();
        });

        it('should render an HTML artifact correctly', () => {
            const htmlContent = '&lt;p&gt;Test HTML&lt;/p&gt;';
            const artifact: TArtifact = { type: 'html', content: htmlContent };
            // Provide a valid TArtifactMessageContext
            const mockTagHtml: TTag = { key: 'html', sequence: 2, featureNum: 1, params: {}, trace: false };
            const mockTopicHtml: TArtifactDebugTopic = { stage: 'action', event: 'debug' };
            const context: TArtifactMessageContext = {
                tag: mockTagHtml,
                topic: mockTopicHtml,
                artifact
            };
            const logEntry = new LogEntry('info', BASE_TIMESTAMP, 'HTML Artifact', context);
            const element = logEntry.element;

            const details = element.querySelector('.haibun-artifact-details');
            expect(details).not.toBeNull();
            expect(details?.tagName).toBe('DETAILS');

            const messageSummary = details?.querySelector('.haibun-log-message-summary');
            expect(messageSummary).not.toBeNull();
            expect(messageSummary?.textContent).toContain('HTML Artifact');
            expect(messageSummary?.querySelector('.details-type')?.textContent).toBe('html');

            const iframe = details?.querySelector('iframe') as HTMLIFrameElement;
            expect(iframe).not.toBeNull();
            expect(iframe).toBeInstanceOf(HTMLIFrameElement);
            expect(iframe?.srcdoc).toBe(htmlContent);
        });

        it('should render an Image artifact correctly', () => {
            const imagePath = '/path/to/image.png';
            const artifact: TArtifact = { type: 'image', path: imagePath };
            // Provide a valid TArtifactMessageContext
            const mockTagImage: TTag = { key: 'image', sequence: 3, featureNum: 1, params: {}, trace: false };
            const mockTopicImage: TArtifactDebugTopic = { stage: 'action', event: 'debug' };
            const context: TArtifactMessageContext = {
                tag: mockTagImage,
                topic: mockTopicImage,
                artifact
            };
            const logEntry = new LogEntry('info', BASE_TIMESTAMP, 'Image Artifact', context);
            const element = logEntry.element;

            const details = element.querySelector('.haibun-artifact-details');
            expect(details).not.toBeNull();

            const messageSummary = details?.querySelector('.haibun-log-message-summary');
            expect(messageSummary?.textContent).toContain('Image Artifact');
            expect(messageSummary?.querySelector('.details-type')?.textContent).toBe('image');

            const img = details?.querySelector('img') as HTMLImageElement;
            expect(img).not.toBeNull();
            expect(img).toBeInstanceOf(HTMLImageElement);
            expect(img?.src).toContain(imagePath); // Note: src might be resolved to full URL by jsdom
            expect(img?.alt).toBe('Screen capture artifact');
        });

         it('should render a Video artifact in details when container is missing', () => {
            const videoPath = '/path/to/video.mp4';
            const artifact: TArtifact = { type: 'video', path: videoPath };
            // Provide a valid TArtifactMessageContext
            const mockTagVideo1: TTag = { key: 'video1', sequence: 4, featureNum: 1, params: {}, trace: false };
            const mockTopicVideo1: TArtifactDebugTopic = { stage: 'action', event: 'debug' };
            const context: TArtifactMessageContext = {
                tag: mockTagVideo1,
                topic: mockTopicVideo1,
                artifact
            };
            const logEntry = new LogEntry('info', BASE_TIMESTAMP, 'Video Artifact', context);
            const element = logEntry.element;

            const details = element.querySelector('.haibun-artifact-details');
            expect(details).not.toBeNull();

            const messageSummary = details?.querySelector('.haibun-log-message-summary');
            expect(messageSummary?.textContent).toContain('Video Artifact');
            expect(messageSummary?.querySelector('.details-type')?.textContent).toBe('video');

            const video = details?.querySelector('video') as HTMLVideoElement;
            expect(video).not.toBeNull();
            expect(video).toBeInstanceOf(HTMLVideoElement);
            expect(video?.src).toContain(videoPath);
            expect(video?.controls).toBe(true);

            // Ensure it wasn't placed elsewhere
            expect(document.querySelector('#haibun-video video')).toBeNull();
        });

        it('should render a Video artifact in #haibun-video container when present', () => {
            // Add the container for this test
            const videoContainer = document.createElement('div');
            videoContainer.id = 'haibun-video';
            document.body.appendChild(videoContainer);

            const videoPath = '/path/to/video.mp4';
            const artifact: TArtifact = { type: 'video', path: videoPath };
            // Provide a valid TArtifactMessageContext
            const mockTagVideo2: TTag = { key: 'video2', sequence: 5, featureNum: 1, params: {}, trace: false };
            const mockTopicVideo2: TArtifactDebugTopic = { stage: 'action', event: 'debug' };
            const context: TArtifactMessageContext = {
                tag: mockTagVideo2,
                topic: mockTopicVideo2,
                artifact
            };
            const logEntry = new LogEntry('info', BASE_TIMESTAMP, 'Video Artifact', context);
            const element = logEntry.element;

            // Should NOT be in the main log entry's details
            expect(element.querySelector('.haibun-artifact-details')).toBeNull();
            // Assert that the message content element is NOT appended in this case
            // Assert that the message content element exists and contains the summary message
            const messageContent = element.querySelector('.haibun-message-content') as HTMLElement;
            expect(messageContent).not.toBeNull();
            expect(messageContent.classList.contains('haibun-simple-message')).toBe(true);
            expect(messageContent.textContent).toBe('Video Artifact'); // Check for summary message

            // Should be in the dedicated container
            const video = document.querySelector('#haibun-video video') as HTMLVideoElement;
            expect(video).not.toBeNull();
            expect(video).toBeInstanceOf(HTMLVideoElement);
            expect(video?.src).toContain(videoPath);
            expect(video?.controls).toBe(true);
            expect(videoContainer.style.display).toBe('flex');

             // Cleanup specific to this test
             document.body.removeChild(videoContainer);
        });

         it('should render a Video Start artifact in the body', () => {
            const startTime = '12.345';
            const artifact: TArtifact = { type: 'video/start', content: startTime };
            // Provide a valid TArtifactMessageContext
            const mockTagVideoStart: TTag = { key: 'vstart', sequence: 6, featureNum: 1, params: {}, trace: false };
            const mockTopicVideoStart: TArtifactDebugTopic = { stage: 'action', event: 'debug' };
            const context: TArtifactMessageContext = {
                tag: mockTagVideoStart,
                topic: mockTopicVideoStart,
                artifact
            };
            const logEntry = new LogEntry('info', BASE_TIMESTAMP, 'Video Start', context);
            const element = logEntry.element;

            // Should NOT be in the main log entry's details
            expect(element.querySelector('.haibun-artifact-details')).toBeNull();
            // Assert that the message content element is NOT appended in this case
            // Assert that the message content element exists and contains the summary message
            const messageContent = element.querySelector('.haibun-message-content') as HTMLElement;
            expect(messageContent).not.toBeNull();
            expect(messageContent.classList.contains('haibun-simple-message')).toBe(true);
            expect(messageContent.textContent).toBe('Video Start'); // Check for summary message

            // Should be appended to the body
            const startSpan = document.body.querySelector('#haibun-video-start') as HTMLSpanElement;
            expect(startSpan).not.toBeNull();
            expect(startSpan?.tagName).toBe('SPAN');
            expect(startSpan?.dataset.start).toBe(startTime);
        });

        it('should render a JSON artifact correctly', () => {
            const jsonData = { key: 'value', nested: { num: 1 } };
            const artifact: TArtifact = { type: 'json', content: jsonData }; // Content can be object
            // Provide a valid TArtifactMessageContext
             // Or: const artifact: TArtifact = { type: 'json', content: jsonData }; // If content can be object
            const context: TArtifactMessageContext = {
                // Provide a full TTag mock
                tag: { key: 'json', sequence: 7, featureNum: 1, params: {}, trace: false },
                topic: { stage: 'action', event: 'debug' },
                artifact
            };
            const logEntry = new LogEntry('info', BASE_TIMESTAMP, 'JSON Artifact', context);
            const element = logEntry.element;

            const details = element.querySelector('.haibun-artifact-details');
            expect(details).not.toBeNull();

            const messageSummary = details?.querySelector('.haibun-log-message-summary');
            expect(messageSummary?.textContent).toContain('JSON Artifact');
            expect(messageSummary?.querySelector('.details-type')?.textContent).toBe('json');

            const pre = details?.querySelector('pre') as HTMLPreElement;
            expect(pre).not.toBeNull();
            expect(pre).toBeInstanceOf(HTMLPreElement);
            expect(pre?.classList.contains('haibun-message-details-json')).toBe(true);
            // Parse the text content to compare objects, ignoring whitespace differences
            expect(JSON.parse(pre?.textContent || '{}')).toEqual(jsonData);
        });

         // Mark test as async
         it('should render a Playwright Trace artifact and call sequenceDiagramGenerator', async () => {
            const { sequenceDiagramGenerator } = await import('./monitor.js'); // Get the mock
            const traceData = { event: 'trace', details: {} };
            const artifact: TArtifact = { type: 'json/playwright/trace', content: traceData };
            // Provide a valid TArtifactMessageContext
            const mockTagTrace: TTag = { key: 'trace', sequence: 8, featureNum: 1, params: {}, trace: false };
            const mockTopicTrace: TArtifactDebugTopic = { stage: 'action', event: 'debug' };
            const context: TArtifactMessageContext = {
                tag: mockTagTrace,
                topic: mockTopicTrace,
                artifact
            };
            const logEntry = new LogEntry('debug', BASE_TIMESTAMP, 'Trace Event', context);
            const element = logEntry.element;

            const details = element.querySelector('.haibun-artifact-details');
            expect(details).not.toBeNull();

            const messageSummary = details?.querySelector('.haibun-log-message-summary');
            expect(messageSummary?.textContent).toContain('Trace Event');
            expect(messageSummary?.querySelector('.details-type')?.textContent).toBe('⇄ Trace'); // Special label

            const pre = details?.querySelector('pre') as HTMLPreElement;
            expect(pre).not.toBeNull();
            expect(JSON.parse(pre?.textContent || '{}')).toEqual(traceData);

            // Verify mock was called
            expect(sequenceDiagramGenerator.processEvent).toHaveBeenCalledTimes(1);
            expect(sequenceDiagramGenerator.processEvent).toHaveBeenCalledWith(artifact);
        });

         // Test fallback rendering using a valid type that defaults to JSON display
         it('should render a generic JSON artifact using JsonArtifactDisplay', () => {
            const artifact: TArtifact = { type: 'json', content: { generic: true } };
            // Provide a valid TArtifactMessageContext
            const mockTagGeneric: TTag = { key: 'generic', sequence: 9, featureNum: 1, params: {}, trace: false };
            const mockTopicGeneric: TArtifactDebugTopic = { stage: 'action', event: 'debug' };
            const context: TArtifactMessageContext = {
                tag: mockTagGeneric,
                topic: mockTopicGeneric,
                artifact
            };
            const logEntry = new LogEntry('warn', BASE_TIMESTAMP, 'Generic JSON', context);
            const element = logEntry.element;

            const details = element.querySelector('.haibun-artifact-details');
            expect(details).not.toBeNull();

            const messageSummary = details?.querySelector('.haibun-log-message-summary');
            expect(messageSummary?.textContent).toContain('Generic JSON');
            // Label should default to the type or the JSON label if factory defaults to JsonArtifactDisplay
            expect(messageSummary?.querySelector('.details-type')?.textContent).toBe('json');

            // Fix redeclaration: rename variable
            const preElement = details?.querySelector('pre') as HTMLPreElement;
            // Removed duplicate/incorrect check for 'pre'
            expect(preElement).not.toBeNull();
            expect(JSON.parse(preElement?.textContent || '{}')).toEqual({ generic: true });
            // Removed duplicate/incorrect check for 'pre'
        });
    });

    // --- Helper Function Tests (Optional but good practice) ---
    // describe('Helper Functions', () => {
    //     it('calculateRelativeTime calculates correctly', () => { /* ... */ });
    //     it('formatTime formats correctly', () => { /* ... */ });
    //     it('getSummaryMessage returns correct message', () => { /* ... */ });
    //     it('getArtifact extracts artifact', () => { /* ... */ });
    // });

     // --- Factory Function Test ---
     // describe('createArtifactDisplay Factory', () => {
     //     it('should return correct ArtifactDisplay subclass for each type', () => { /* ... */ });
     // });

     // --- ArtifactDisplay Subclass Tests (More granular) ---
     // describe('ArtifactDisplay Subclasses', () => {
     //     describe('HtmlArtifactDisplay', () => { /* ... */ });
     //     describe('ImageArtifactDisplay', () => { /* ... */ });
     //     // etc.
     // });
});
