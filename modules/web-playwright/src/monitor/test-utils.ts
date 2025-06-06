import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import mermaid from 'mermaid';
import { THTTPTraceContent } from '@haibun/core/build/lib/interfaces/logger.js';
import { TAnyFixme } from '@haibun/core/build/lib/fixme.js';
import { TTag, TTagValue } from '@haibun/core/build/lib/ttag.js';

export function defineGlobalMermaidAndDOMPurify() {
	const jsdom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
		url: 'http://localhost',
		runScripts: 'dangerously',
		pretendToBeVisual: true,
	});
	const jsdomWindow = jsdom.window;

	global.window = jsdomWindow as unknown as Window & typeof globalThis;
	global.document = jsdomWindow.document;
	global.navigator = jsdomWindow.navigator;
	global.HTMLElement = jsdomWindow.HTMLElement;
	global.HTMLDivElement = jsdomWindow.HTMLDivElement;
	global.HTMLDetailsElement = jsdomWindow.HTMLDetailsElement;
	global.HTMLSummaryElement = jsdomWindow.HTMLSummaryElement;
	global.Event = jsdomWindow.Event;
	global.CustomEvent = jsdomWindow.CustomEvent;
	global.Node = jsdomWindow.Node;
	global.XMLSerializer = jsdomWindow.XMLSerializer;
	global.DOMParser = jsdomWindow.DOMParser;

	const purifyInstance = createDOMPurify(jsdomWindow as TAnyFixme);

	(jsdomWindow as TAnyFixme).DOMPurify = purifyInstance;
	(globalThis as TAnyFixme).DOMPurify = purifyInstance;
	(global as TAnyFixme).DOMPurify = purifyInstance;

	mermaid.initialize({
		startOnLoad: false,
		securityLevel: 'antiscript',
		theme: 'neutral',
		flowchart: {
			htmlLabels: true,
			useMaxWidth: false,
		},
		dompurifyConfig: {},
	});
}

export function setupMessagesTestDOM(testStartTime: number): void {
	document.body.innerHTML = '';
	document.body.dataset.startTime = `${testStartTime}`;
	const logArea = document.createElement('div');
	logArea.id = 'haibun-log-display-area';
	document.body.appendChild(logArea);
}

export function cleanupMessagesTestDOM(): void {
	document.body.innerHTML = '';
	delete document.body.dataset.startTime;
}

export const MOCK_MERMAID_CONTAINER_ID_PREFFIX = 'mermaid-container-';

export function createMockTag(): TTag {
	return {
		key: 'testKey',
		sequence: 1 as TTagValue,
		featureNum: 1 as TTagValue,
		params: {},
		trace: false
	};
}

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
