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

	it('should render JSON artifact', async () => {
		const jsonData = { key: 'value', nested: { num: 1, bool: true } };
		const artifact: TArtifactJSON = { artifactType: 'json', json: jsonData };
		const messageContext: TMessageContext = {
			incident: EExecutionMessageType.ACTION,
			artifacts: [artifact],
			tag: createMockTag()
		};

		const logMessageContent = new LogMessageContent(MOCK_MESSAGE, messageContext);
		document.body.appendChild(logMessageContent.element);

		const artifactContainer = logMessageContent.element.querySelector('.haibun-artifact-container.haibun-artifact-json') as HTMLElement;
		expect(artifactContainer).not.toBeNull();
		// Simulate open and render
		const detailsElement = logMessageContent.element.querySelector('details.haibun-context-details') as HTMLDetailsElement;
		detailsElement.open = true;
		detailsElement.dispatchEvent(new Event('toggle'));
		await Promise.resolve();
		const pre = artifactContainer.querySelector('pre.haibun-message-details-json');
		expect(pre).not.toBeNull();
		expect(pre!.firstElementChild).not.toBeNull();
		expect(pre!.firstElementChild?.tagName).toBe('DIV');
	});

	it('JsonArtifactDisplay.deriveLabel should return artifactType (direct call for unit testing)', () => {
		const artifact: TArtifactJSON = { artifactType: 'json', json: { data: 'test' } };
		const display = new JsonArtifactDisplay(artifact);
		expect(display.artifactType).toBe('json');
	});
});
