/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TArtifactJSON, TMessageContext, EExecutionMessageType } from '@haibun/core/build/lib/interfaces/logger.js';
import { JsonArtifactDisplay } from './JsonArtifactDisplay.js';
import { LogMessageContent } from '../messages.js';
import { setupMessagesTestDOM, cleanupMessagesTestDOM, createMockTag } from '../test-utils.js';
import { disclosureJson } from '../disclosureJson';

vi.mock('../disclosureJson', () => ({
	disclosureJson: vi.fn(() => {
		const div = document.createElement('div');
		div.className = 'mocked-json-content-default';
		div.textContent = 'Mocked JSON Output by default';
		return div;
	}),
}));

describe('JsonArtifactDisplay Rendering within LogMessageContent', () => {
	const TEST_START_TIME = 1700000000000;
	const MOCK_MESSAGE = 'Test Log Message';

	beforeEach(() => {
		setupMessagesTestDOM(TEST_START_TIME);
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanupMessagesTestDOM();
	});

	it('should only render JSON artifact when <details> in LogMessageContent is opened', async () => {
		const jsonData = { key: 'value', nested: { num: 1, bool: true } };
		const artifact: TArtifactJSON = { artifactType: 'json', json: jsonData };
		const messageContext: TMessageContext = {
			incident: EExecutionMessageType.ACTION,
			artifact: artifact,
			tag: createMockTag()
		};

		const logMessageContent = new LogMessageContent(MOCK_MESSAGE, messageContext);
		document.body.appendChild(logMessageContent.element);

		const detailsElement = logMessageContent.element.querySelector('details.haibun-context-details') as HTMLDetailsElement;
		expect(detailsElement).not.toBeNull();

		const summaryElement = detailsElement.querySelector('summary.haibun-log-message-summary .details-type');
		expect(summaryElement?.textContent).toBe('json');

		const artifactContainer = detailsElement?.querySelector('.haibun-artifact-container.haibun-artifact-json') as HTMLElement;
		expect(artifactContainer).not.toBeNull();
		expect(artifactContainer.textContent).toBe('Artifact is rendering...');

		expect(artifactContainer.querySelector('pre')).toBeNull();
		expect(artifactContainer.querySelector('details.json-root-details')).toBeNull();

		detailsElement.open = true;
		detailsElement.dispatchEvent(new Event('toggle'));

		await new Promise(resolve => setTimeout(resolve, 0));

		const renderedArtifactContainer = detailsElement?.querySelector('.haibun-artifact-container.haibun-artifact-json') as HTMLElement;
		expect(renderedArtifactContainer).not.toBeNull();
		expect(renderedArtifactContainer.textContent).not.toBe('Artifact is rendering...');


		const preElement = renderedArtifactContainer.querySelector('pre.haibun-message-details-json');
		expect(preElement).not.toBeNull();
		expect(preElement!.firstElementChild).not.toBeNull();
		expect(preElement!.firstElementChild?.tagName).toBe('DIV');
	});

	it('rendering should be idempotent when triggered via LogMessageContent toggle', async () => {
		const jsonData = { key: 'value' };
		const artifact: TArtifactJSON = { artifactType: 'json', json: jsonData };
		const messageContext: TMessageContext = {
			incident: EExecutionMessageType.ACTION,
			artifact: artifact,
			tag: createMockTag()
		};
		const logMessageContent = new LogMessageContent(MOCK_MESSAGE, messageContext);
		document.body.appendChild(logMessageContent.element);

		const detailsElement = logMessageContent.element.querySelector('details.haibun-context-details') as HTMLDetailsElement;
		const artifactContainer = detailsElement?.querySelector('.haibun-artifact-container.haibun-artifact-json') as HTMLElement;
		expect(artifactContainer).not.toBeNull();

		detailsElement.open = true;
		detailsElement.dispatchEvent(new Event('toggle'));
		await new Promise(resolve => setTimeout(resolve, 0));

		const firstRenderPre = artifactContainer?.querySelector('pre.haibun-message-details-json');
		expect(firstRenderPre).not.toBeNull();
		expect(firstRenderPre!.firstElementChild).not.toBeNull();
		expect(firstRenderPre!.firstElementChild?.tagName).toBe('DIV');
		expect(artifactContainer.textContent).not.toBe('Artifact is rendering...');

		detailsElement.open = false;
		detailsElement.dispatchEvent(new Event('toggle'));
		await new Promise(resolve => setTimeout(resolve, 0));

		const afterClosePre = artifactContainer?.querySelector('pre.haibun-message-details-json');
		expect(afterClosePre).not.toBeNull();
		expect(afterClosePre!.firstElementChild).not.toBeNull();
		expect(afterClosePre!.firstElementChild?.tagName).toBe('DIV');
		expect(artifactContainer.textContent).not.toBe('Artifact is rendering...');

		detailsElement.open = true;
		detailsElement.dispatchEvent(new Event('toggle'));
		await new Promise(resolve => setTimeout(resolve, 0));

		const afterReopenPre = artifactContainer?.querySelector('pre.haibun-message-details-json');
		expect(afterReopenPre).not.toBeNull();
		expect(afterReopenPre!.firstElementChild).not.toBeNull();
		expect(afterReopenPre!.firstElementChild?.tagName).toBe('DIV');
		const allRenderedRoots = artifactContainer.querySelectorAll('pre.haibun-message-details-json > div');
		expect(allRenderedRoots.length).toBe(1);
	});

	it('JsonArtifactDisplay.deriveLabel should return artifactType (direct call for unit testing)', () => {
		const artifact: TArtifactJSON = { artifactType: 'json', json: { data: 'test' } };
		const display = new JsonArtifactDisplay(artifact);
		expect(display.artifactType).toBe('json');
	});
});

describe('JsonArtifactDisplay', () => {
	const TEST_START_TIME = 1700000000000;

	beforeEach(() => {
		setupMessagesTestDOM(TEST_START_TIME);
		vi.mocked(disclosureJson).mockClear();
	});

	afterEach(() => {
		cleanupMessagesTestDOM();
	});

	it('renders JSON artifact within LogMessageContent after toggle', async () => {
		const mockJsonContent = document.createElement('div');
		mockJsonContent.textContent = 'Mock JSON Content';
		vi.mocked(disclosureJson).mockReturnValue(mockJsonContent);

		const jsonData = { key: 'value', nested: { num: 1, bool: true } };
		const artifact: TArtifactJSON = { artifactType: 'json', json: jsonData };
		const messageContext: TMessageContext = {
			incident: EExecutionMessageType.ACTION,
			artifact: artifact,
			tag: createMockTag()
		};

		const logMessageElement = new LogMessageContent('Msg', messageContext);
		document.body.appendChild(logMessageElement.element);

		const detailsElement = logMessageElement.element.querySelector('details.haibun-context-details') as HTMLDetailsElement;
		expect(detailsElement).not.toBeNull();
		if (!detailsElement) return;

		const artifactContainer = detailsElement.querySelector('.haibun-artifact-container');
		expect(artifactContainer).not.toBeNull();
		if (!artifactContainer) return;

		const initialText = artifactContainer.textContent;

		detailsElement.open = true;
		detailsElement.dispatchEvent(new Event('toggle'));

		await new Promise(process.nextTick);

		expect(vi.mocked(disclosureJson)).toHaveBeenCalledWith(artifact.json);
		const renderedPre = artifactContainer.querySelector('pre.haibun-message-details-json');
		expect(renderedPre).not.toBeNull();
		if (!renderedPre) return;
		expect(renderedPre.firstChild).toBe(mockJsonContent);
		expect(artifactContainer.textContent).not.toBe(initialText);
	});

});
