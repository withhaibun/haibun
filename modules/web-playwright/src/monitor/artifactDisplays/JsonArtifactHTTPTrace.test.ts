/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { THTTPTraceContent } from '@haibun/core/lib/interfaces/logger.js';
import { setupMessagesTestDOM, createMockTag, defineGlobalMermaidAndDOMPurify, createMockHTTPTraceArtifact } from '../test-utils.js';

describe('JsonArtifactHTTPTrace', () => {
	const TEST_START_TIME = 1700000000000;

	beforeEach(async () => {
		await defineGlobalMermaidAndDOMPurify();
		setupMessagesTestDOM(TEST_START_TIME);
	});

	afterEach(() => {
		document.body.innerHTML = '';
		delete document.body.dataset.startTime;
	});

	const traceData: THTTPTraceContent = createMockHTTPTraceArtifact({
		//...
	});

	it('render a diagram when control is opened', async () => {
	});
});
