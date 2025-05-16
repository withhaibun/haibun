/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TArtifact, TMessageContext, TArtifactVideo, TArtifactVideoStart, TArtifactJSON, TArtifactHTTPTrace, TArtifactHTML, TArtifactImage, THTTPTraceContent, EExecutionMessageType } from '@haibun/core/build/lib/interfaces/logger.js'; // Updated imports
import { TFeatureStep, TStepResult, TStepAction, TStepActionResult, OK } from '@haibun/core/build/lib/defs.js';
import { LogEntry } from './messages.js'; // Import the main class
import { TTag } from '@haibun/core/build/lib/ttag.js';

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
			const mockStepAction: TStepAction = { actionName: 'testAction', stepperName: 'testStepper', step: { action: async () => Promise.resolve(OK) } };
			const mockFeatureStep: TFeatureStep = { path: 'test.feature', in: 'Given something', seq: 1, action: mockStepAction };
			const mockActionResult: TStepActionResult = { ok: true, name: 'testAction' };
			const mockStepResult: TStepResult = { ok: true, actionResult: mockActionResult, in: 'Given something', path: 'test.feature', seq: 1 };

			// Provide a valid TMessageContext structure for STEP_END
			const context: TMessageContext = {
				incident: EExecutionMessageType.STEP_END,
				tag: mockTag,
				incidentDetails: {
					step: mockFeatureStep,
					result: mockStepResult
				}
			};
			const logEntry = new LogEntry(level, BASE_TIMESTAMP + 100, message, context);
			const element = logEntry.element;

			const messageContent = element.querySelector('.haibun-message-content') as HTMLElement;
			expect(messageContent).not.toBeNull();
			// Check that the context details wrapper exists
			const details = element.querySelector('.haibun-context-details');
			expect(details).not.toBeNull();
			const summary = details?.querySelector('.haibun-log-message-summary');
			expect(summary?.textContent).toContain('Action Given something'); // Check summary text part
			// Check the label span specifically for the incident type string
			expect(summary?.querySelector('.details-type')?.textContent).toBe('STEP END'); // Expect spaces, original casing
			// Ensure the simple message class is NOT present on the main content div
			expect(messageContent?.classList.contains('haibun-simple-message')).toBe(false);

			// Ensure no artifact details wrapper is present
			// Check for incident details pre tag within the context details
			expect(details?.querySelector('pre.haibun-message-details-json')).not.toBeNull();
			// Ensure incident type div is NOT present anymore
			expect(details?.querySelector('.haibun-incident-type')).toBeNull();
		});

		it('should render an HTML artifact correctly', () => {
			const htmlContent = '&lt;p&gt;Test HTML&lt;/p&gt;';
			const artifact: TArtifactHTML = { artifactType: 'html', html: htmlContent };
			// Provide a valid TArtifactMessageContext
			const mockTagHtml: TTag = { key: 'html', sequence: 2, featureNum: 1, params: {}, trace: false };
			const context: TMessageContext = {
				incident: EExecutionMessageType.ACTION, // Standard incident for artifacts
				tag: mockTagHtml,
				artifact
			};
			const logEntry = new LogEntry('info', BASE_TIMESTAMP, 'HTML Artifact', context);
			const element = logEntry.element;

			// Look for the main context wrapper, then the artifact inside
			const details = element.querySelector('.haibun-context-details');
			expect(details).not.toBeNull();
			expect(details?.tagName).toBe('DETAILS');

			const messageSummary = details?.querySelector('.haibun-log-message-summary');
			expect(messageSummary).not.toBeNull();
			expect(messageSummary?.textContent).toContain('HTML Artifact');
			expect(messageSummary?.querySelector('.details-type')?.textContent).toBe('html'); // Artifact type used as label

			const iframe = details?.querySelector('iframe') as HTMLIFrameElement;
			expect(iframe).not.toBeNull();
			expect(iframe).toBeInstanceOf(HTMLIFrameElement);
			expect(iframe?.srcdoc).toBe(htmlContent);
		});

		it('should render an Image artifact correctly', () => {
			const imagePath = '/path/to/image.png';
			const artifact: TArtifactImage = { artifactType: 'image', path: imagePath };
			const mockTagImage: TTag = { key: 'image', sequence: 3, featureNum: 1, params: {}, trace: false };
			const context: TMessageContext = {
				incident: EExecutionMessageType.ACTION, // Standard incident for artifacts
				tag: mockTagImage,
				artifact
			};
			const logEntry = new LogEntry('info', BASE_TIMESTAMP, 'Image Artifact', context);
			const element = logEntry.element;

			// Look for the main context wrapper, then the artifact inside
			const details = element.querySelector('.haibun-context-details');
			expect(details).not.toBeNull();

			const messageSummary = details?.querySelector('.haibun-log-message-summary');
			expect(messageSummary?.textContent).toContain('Image Artifact');
			expect(messageSummary?.querySelector('.details-type')?.textContent).toBe('image'); // Artifact type used as label

			const img = details?.querySelector('img') as HTMLImageElement;
			expect(img).not.toBeNull();
			expect(img).toBeInstanceOf(HTMLImageElement);
			expect(img?.src).toContain(imagePath); // Note: src might be resolved to full URL by jsdom
			expect(img?.alt).toBe('Screen capture artifact');
		});

		it('should render a Video artifact in details when container is missing', () => {
			const videoPath = '/path/to/video.mp4';
			const artifact: TArtifactVideo = { artifactType: 'video', path: videoPath };
			// Provide a valid TArtifactMessageContext
			const mockTagVideo1: TTag = { key: 'video1', sequence: 4, featureNum: 1, params: {}, trace: false };
			const context: TMessageContext = {
				incident: EExecutionMessageType.ACTION, // Standard incident for artifacts
				tag: mockTagVideo1,
				artifact
			};
			const logEntry = new LogEntry('info', BASE_TIMESTAMP, 'Video Artifact', context);
			const element = logEntry.element;

			// Look for the main context wrapper, then the artifact inside
			const details = element.querySelector('.haibun-context-details');
			expect(details).not.toBeNull();

			const messageSummary = details?.querySelector('.haibun-log-message-summary');
			expect(messageSummary?.textContent).toContain('Video Artifact');
			expect(messageSummary?.querySelector('.details-type')?.textContent).toBe('video'); // Artifact type used as label

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
			const artifact: TArtifactVideo = { artifactType: 'video', path: videoPath };
			// Provide a valid TArtifactMessageContext
			const mockTagVideo2: TTag = { key: 'video2', sequence: 5, featureNum: 1, params: {}, trace: false };
			const context: TMessageContext = {
				incident: EExecutionMessageType.ACTION, // Standard incident for artifacts
				tag: mockTagVideo2,
				artifact
			};
			const logEntry = new LogEntry('info', BASE_TIMESTAMP, 'Video Artifact', context);
			const element = logEntry.element;

			// Details wrapper SHOULD exist because context is provided
			const details = element.querySelector('.haibun-context-details');
			expect(details).not.toBeNull();
			// But the video element should NOT be inside the details wrapper
			expect(details?.querySelector('video')).toBeNull();

			// Should have the simple message class now
			const messageContent = element.querySelector('.haibun-message-content') as HTMLElement;
			expect(messageContent).not.toBeNull();
			expect(messageContent.classList.contains('haibun-simple-message')).toBe(true);
			// Check text content includes both summary and label, as LogMessageSummary is still rendered inside details
			expect(messageContent.textContent).toContain('Video Artifact');
			expect(messageContent.textContent).toContain('video');

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
			const startTime = 1245;
			const artifact: TArtifactVideoStart = { artifactType: 'video/start', start: startTime };
			// Provide a valid TArtifactMessageContext
			const mockTagVideoStart: TTag = { key: 'vstart', sequence: 6, featureNum: 1, params: {}, trace: false };
			const context: TMessageContext = {
				incident: EExecutionMessageType.ACTION, // Standard incident for artifacts
				tag: mockTagVideoStart,
				artifact
			};
			const logEntry = new LogEntry('info', BASE_TIMESTAMP, 'Video Start', context);
			const element = logEntry.element;

			// Should NOT have artifact details inside the main context details
			expect(element.querySelector('.haibun-context-details .haibun-artifact-details')).toBeNull();
			// Details wrapper SHOULD exist because context is provided
			const details = element.querySelector('.haibun-context-details');
			expect(details).not.toBeNull();
			// But the start span element should NOT be inside the details wrapper
			expect(details?.querySelector('#haibun-video-start')).toBeNull();

			// Should have the simple message class now
			const messageContent = element.querySelector('.haibun-message-content') as HTMLElement;
			expect(messageContent).not.toBeNull();
			expect(messageContent.classList.contains('haibun-simple-message')).toBe(true);
			// Check text content includes both summary and label
			expect(messageContent.textContent).toContain('Video Start');
			expect(messageContent.textContent).toContain('video/start');

			// Should be appended to the body
			const startSpan = document.body.querySelector('#haibun-video-start') as HTMLSpanElement;
			expect(startSpan).not.toBeNull();
			expect(startSpan?.tagName).toBe('SPAN');
			expect(startSpan?.dataset.start).toBe(`${startTime}`);
		});

		it('should render a JSON artifact correctly', () => {
			const jsonData = { key: 'value', nested: { num: 1 } };
			const artifact: TArtifactJSON = { artifactType: 'json', json: jsonData }; // Content can be object
			// Provide a valid TArtifactMessageContext
			// Or: const artifact: TArtifact = { artifactType: 'json', content: jsonData }; // If content can be object
			const context: TMessageContext = {
				incident: EExecutionMessageType.ACTION, // Standard incident for artifacts
				tag: { key: 'json', sequence: 7, featureNum: 1, params: {}, trace: false },
				artifact
			};
			const logEntry = new LogEntry('info', BASE_TIMESTAMP, 'JSON Artifact', context);
			const element = logEntry.element;

			// Look for the main context wrapper, then the artifact inside
			const details = element.querySelector('.haibun-context-details');
			expect(details).not.toBeNull();

			const messageSummary = details?.querySelector('.haibun-log-message-summary');
			expect(messageSummary?.textContent).toContain('JSON Artifact');
			expect(messageSummary?.querySelector('.details-type')?.textContent).toBe('json'); // Artifact type used as label

			const pre = details?.querySelector('pre') as HTMLPreElement;
			expect(pre).not.toBeNull();
			expect(pre).toBeInstanceOf(HTMLPreElement);
			expect(pre?.classList.contains('haibun-message-details-json')).toBe(true);
			// Find the root details element created by disclosureJson and parse its data attribute
			const jsonRootDetails = pre?.querySelector('details.json-root-details') as HTMLElement;
			expect(jsonRootDetails).not.toBeNull();
			expect(JSON.parse(jsonRootDetails?.dataset.rawJson || '{}')).toEqual(jsonData);
		});

		it('should render a Playwright Trace artifact and call sequenceDiagramGenerator', async () => {
			const { sequenceDiagramGenerator } = await import('./monitor.js'); // Get the mock
			const traceData: THTTPTraceContent = {
				frameURL: 'http://example.com/frame',
				requestingPage: 'http://example.com/page',
				requestingURL: 'http://example.com/frame on http://example.com/page',
				method: 'GET',
				headers: { 'Content-Type': 'application/json' },
				postData: { key: 'value' },
				status: 200,
				statusText: 'OK'
			};
			const artifact: TArtifactHTTPTrace = { artifactType: 'json/http/trace', httpEvent: 'request', trace: traceData }; // Use 'request' instead of 'route' to trigger processEvent
			const mockTagTrace: TTag = { key: 'trace', sequence: 8, featureNum: 1, params: {}, trace: false };
			const context: TMessageContext = {
				incident: EExecutionMessageType.ACTION, // Standard incident for artifacts
				tag: mockTagTrace,
				artifact
			};
			const logEntry = new LogEntry('debug', BASE_TIMESTAMP, 'Trace Event', context);
			const element = logEntry.element;

			// Look for the main context wrapper, then the artifact inside
			const details = element.querySelector('.haibun-context-details');
			expect(details).not.toBeNull();

			const messageSummary = details?.querySelector('.haibun-log-message-summary');
			expect(messageSummary?.textContent).toContain('Trace Event');
			expect(messageSummary?.querySelector('.details-type')?.textContent).toBe('⇄ Trace'); // Specific artifact label used

			const pre = details?.querySelector('pre.haibun-message-details-json') as HTMLPreElement;
			expect(pre).not.toBeNull();
			// Find the root details element created by disclosureJson and parse its data attribute
			const jsonRootDetails = pre?.querySelector('details.json-root-details') as HTMLElement;
			expect(jsonRootDetails).not.toBeNull();
			expect(JSON.parse(jsonRootDetails?.dataset.rawJson || '{}')).toEqual(traceData);

			expect(sequenceDiagramGenerator.processEvent).toHaveBeenCalledTimes(1);
			expect(sequenceDiagramGenerator.processEvent).toHaveBeenCalledWith(artifact.trace, 'request'); // Expect 'request'
		});

		it('should throw if artifact type is not recognized', () => {
			const artifact = <TArtifact>(<unknown>{ artifactType: 'notAThing' });
			const mockTagGeneric: TTag = { key: 'generic', sequence: 9, featureNum: 1, params: {}, trace: false };
			const context: TMessageContext = {
				incident: EExecutionMessageType.ACTION, // Standard incident for artifacts
				tag: mockTagGeneric,
				artifact
			};
			expect(() => new LogEntry('warn', BASE_TIMESTAMP, 'Generic JSON', context)).toThrow();
		});
	});
});

