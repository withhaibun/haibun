import { TTag, TTagValue } from '@haibun/core/build/lib/ttag.js';
import { TArtifact, TArtifactHTTPTrace, THTTPTraceContent, TLogArgs, TLogLevel, TMessageContext } from '@haibun/core/build/lib/interfaces/logger.js';
import { TLogEntry } from './monitor.js';
import { TAnyFixme } from '@haibun/core/build/lib/fixme.js';

/**
 * Helper function to set up JSDOM, DOMPurify, and Mermaid for Node.js environment
 * This is intended for use in Vitest/JSDOM environments where browser globals
 * and specific libraries like Mermaid need to be explicitly set up.
 */
export async function defineGlobalMermaidAndDOMPurify() {
	if (typeof window === 'undefined' || !(globalThis as Record<string, unknown>).DOMPurify || !(globalThis as Record<string, unknown>).mermaid) {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const { JSDOM } = require('jsdom');
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const createDOMPurify = require('dompurify');
		// Ensure a basic HTML structure is present for Mermaid and other DOM manipulations
		const { window: jsdomWindow } = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="haibun-log-display-area"></div></body></html>');

		global.window = jsdomWindow as unknown as Window & typeof globalThis;
		global.document = jsdomWindow.document;
		global.navigator = jsdomWindow.navigator;
		global.HTMLElement = jsdomWindow.HTMLElement;
		global.HTMLDetailsElement = jsdomWindow.HTMLDetailsElement;
		global.HTMLSpanElement = jsdomWindow.HTMLSpanElement;
		global.HTMLDivElement = jsdomWindow.HTMLDivElement;
		global.HTMLIFrameElement = jsdomWindow.HTMLIFrameElement;
		global.HTMLImageElement = jsdomWindow.HTMLImageElement;
		global.HTMLVideoElement = jsdomWindow.HTMLVideoElement;
		global.HTMLAudioElement = jsdomWindow.HTMLAudioElement;
		global.Event = jsdomWindow.Event;
        global.SVGElement = jsdomWindow.SVGElement; // Ensure SVGElement is globally available

		// Add any other missing HTML element types if errors occur during tests

		const domPurifyInstance = createDOMPurify(jsdomWindow);
		(globalThis as Record<string, unknown>).DOMPurify = domPurifyInstance;
		(jsdomWindow as unknown as Record<string, unknown>).DOMPurify = domPurifyInstance;

		// Dynamically import Mermaid to ensure it's loaded after JSDOM setup
		const mermaid = (await import('mermaid')).default;
		(globalThis as Record<string, unknown>).mermaid = mermaid;
		(jsdomWindow as unknown as Record<string, unknown>).mermaid = mermaid;

		// Initialize mermaid for testing
		// Note: securityLevel 'loose' might be needed if you're inserting complex HTML via Mermaid.
		// Adjust theme or other configs as necessary for your tests.
		mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'neutral' });

        // Mock getBBox for SVG elements in JSDOM
        // Conditional to avoid errors if SVGElement or its prototype is somehow not defined as expected
        if (jsdomWindow.SVGElement && jsdomWindow.SVGElement.prototype && typeof jsdomWindow.SVGElement.prototype.getBBox !== 'function') {
            jsdomWindow.SVGElement.prototype.getBBox = function () {
                return {
                    x: this.x?.baseVal?.value || 0,
                    y: this.y?.baseVal?.value || 0,
                    width: this.width?.baseVal?.value || 0,
                    height: this.height?.baseVal?.value || 0,
                    bottom: (this.y?.baseVal?.value || 0) + (this.height?.baseVal?.value || 0),
                    left: this.x?.baseVal?.value || 0,
                    right: (this.x?.baseVal?.value || 0) + (this.width?.baseVal?.value || 0),
                    top: this.y?.baseVal?.value || 0
                };
            };
        }

        // Fallback for Element.prototype if SVGElement.prototype.getBBox is not enough
        if (jsdomWindow.Element && jsdomWindow.Element.prototype && typeof jsdomWindow.Element.prototype.getBBox !== 'function') {
            (jsdomWindow.Element.prototype as TAnyFixme).getBBox = function () {
                 // A very basic mock. If this is hit, it means an element that is not an SVGElement (but used as one by mermaid) is calling getBBox.
                return { x: 0, y: 0, width: 0, height: 0, bottom: 0, left: 0, right: 0, top: 0 };
            };
        }
	}
}

/**
 * Sets up the DOM for testing monitor components.
 * @param testStartTime The fixed start time for the test.
 */
export function setupMessagesTestDOM(testStartTime: number): void {
	document.body.innerHTML = ''; // Clear body
	document.body.dataset.startTime = `${testStartTime}`;
	// Add potential containers if needed by specific tests
	const logArea = document.createElement('div');
	logArea.id = 'haibun-log-display-area';
	document.body.appendChild(logArea);
}

/**
 * Cleans up the DOM after testing monitor components.
 */
export function cleanupMessagesTestDOM(): void {
	document.body.innerHTML = '';
	delete document.body.dataset.startTime;
}


export const MOCK_MERMAID_CONTAINER_ID_PREFFIX = 'mermaid-container-';

/**
 * Creates a mock TTag object for testing purposes.
 * @returns A mock TTag object.
 */
export function createMockTag(): TTag {
	return {
		key: 'testKey',
		sequence: 1 as TTagValue,
		featureNum: 1 as TTagValue,
		params: {},
		trace: false
	};
}

/**
 * Creates a mock THTTPTraceContent object for testing purposes.
 */
export function createMockHTTPTraceArtifact(partialTrace: Partial<THTTPTraceContent>): THTTPTraceContent {
	return {
		requestingPage: 'testPageId',
		requestingURL: 'http://example.com/test',
		method: 'GET',
		headers: { accept: 'application/json' },
		status: 200,
		statusText: 'OK',
		...partialTrace,
	};
}

/**
 * Creates a mock TLogEntry object with an HTTP trace artifact for testing purposes.
 */
export function createMockLogEntryWithArtifact(traceContent: THTTPTraceContent, httpEvent: TArtifactHTTPTrace['httpEvent'], level: TLogLevel, message: TLogArgs, timestamp: number = Date.now()): TLogEntry {
	const artifact: TArtifactHTTPTrace = {
		trace: traceContent, artifactType: 'json/http/trace',
		httpEvent,
	};
	return {
		message,
		timestamp,
		level,
		messageContext: {
			artifact: artifact as TArtifact, // Cast to base TArtifact for the message context
		} as TMessageContext,
	};
}

/**
 * Sets up a basic DOM structure with a parent div for the generator and optionally a pre-existing mermaid container.
 * @param parentId The ID for the parent div.
 * @param generatorId The ID for the generator (used to construct mermaid container ID).
 * @param withExistingMermaidContainer If true, creates a mermaid container inside the parent.
 * @returns The created parent div.
 */
export function setupDOMWithGeneratorContainer(parentId: string, generatorId: string, withExistingMermaidContainer = false): HTMLDivElement {
	document.body.innerHTML = ''; // Clear body
	const parentDiv = document.createElement('div');
	parentDiv.id = parentId;
	document.body.appendChild(parentDiv);

	if (withExistingMermaidContainer) {
		const mermaidContainer = document.createElement('div');
		mermaidContainer.id = `${MOCK_MERMAID_CONTAINER_ID_PREFFIX}${generatorId}`;
		mermaidContainer.className = 'mermaid';
		parentDiv.appendChild(mermaidContainer);
	}
	return parentDiv;
}
