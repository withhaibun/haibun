/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TArtifactHTML, TMessageContext, EExecutionMessageType } from '@haibun/core/build/lib/interfaces/logger.js';
import { LogMessageContent } from '../messages.js';
import { TTag } from '@haibun/core/build/lib/ttag.js';
import { setupMessagesTestDOM, cleanupMessagesTestDOM } from '../test-utils.js';

describe('HtmlArtifactDisplay', () => {
	const TEST_START_TIME = 1700000000000;

	beforeEach(() => {
		setupMessagesTestDOM(TEST_START_TIME);
		document.body.innerHTML = '';
	});

	afterEach(() => {
		cleanupMessagesTestDOM();
		vi.clearAllMocks();
	});

	it('should render an HTML artifact correctly and lazily via LogMessageContent', async () => {
		const htmlContent = '<p>Test HTML</p>';
		const artifact: TArtifactHTML = { artifactType: 'html', html: htmlContent };
		const mockTagHtml: TTag = { key: 'html', sequence: 2, featureNum: 1, params: {}, trace: false };
		const context: TMessageContext = {
			incident: EExecutionMessageType.ACTION,
			tag: mockTagHtml,
			artifact
		};
		const logMessageContent = new LogMessageContent('HTML Artifact', context);
		const element = logMessageContent.element;
		document.body.appendChild(element);

		const details = element.querySelector('.haibun-context-details') as HTMLDetailsElement;
		expect(details).not.toBeNull();
		expect(details?.tagName).toBe('DETAILS');

		const messageSummary = details?.querySelector('.haibun-log-message-summary');
		expect(messageSummary).not.toBeNull();
		expect(messageSummary?.textContent).toContain('HTML Artifact');
		expect(messageSummary?.querySelector('.details-type')?.textContent).toBe('html');

		const artifactContainer = details?.querySelector('.haibun-artifact-container.haibun-artifact-html') as HTMLElement;
		expect(artifactContainer).not.toBeNull();
		expect(artifactContainer.textContent).toBe('Artifact is loading...');

		let iframe = artifactContainer?.querySelector('iframe') as HTMLIFrameElement;
		expect(iframe).toBeNull();

		details.open = true;
		details.dispatchEvent(new Event('toggle'));

		await new Promise(process.nextTick);

		expect(artifactContainer.innerHTML).toContain('<p>Test HTML</p>');
		expect(artifactContainer.textContent).not.toBe('Artifact is loading...');

		iframe = artifactContainer?.querySelector('iframe') as HTMLIFrameElement;
		expect(iframe).not.toBeNull();
		expect(iframe).toBeInstanceOf(HTMLIFrameElement);
		expect(iframe?.srcdoc).toBe(htmlContent);
	});
});
