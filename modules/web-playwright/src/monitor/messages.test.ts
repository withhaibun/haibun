/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TArtifact, TMessageContext, EExecutionMessageType, } from '@haibun/core/lib/interfaces/logger.js';
import { TFeatureStep, TStepResult, TStepAction, TStepActionResult, OK } from '@haibun/core/lib/defs.js';
import { LogEntry } from './messages.js';
import { TTag } from '@haibun/core/lib/ttag.js';
import { setupMessagesTestDOM, cleanupMessagesTestDOM, createMockTag } from './test-utils';

describe('Monitor Messages Logic (messages.ts)', () => {
	const TEST_START_TIME = 1700000000000;
	const BASE_TIMESTAMP = TEST_START_TIME + 500;

	beforeEach(() => {
		setupMessagesTestDOM(TEST_START_TIME);
	});

	afterEach(() => {
		cleanupMessagesTestDOM();
		vi.clearAllMocks();
	});

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

			const detailsSummary = element.querySelector('.haibun-log-details-summary');
			expect(detailsSummary).not.toBeNull();
			expect(detailsSummary?.tagName).toBe('SUMMARY');
			expect(detailsSummary?.innerHTML).toContain(level);
			expect(detailsSummary?.innerHTML).toContain('0:500s');

			const messageContent = element.querySelector('.haibun-message-content') as HTMLElement;
			expect(messageContent).not.toBeNull();
			expect(messageContent.classList.contains('haibun-simple-message')).toBe(true);

			const plainContent = messageContent.querySelector('.haibun-prose-plain');
			expect(plainContent).not.toBeNull();
			expect(plainContent?.textContent).toBe(message);

			const markdownContent = messageContent.querySelector('.haibun-prose-markdown');
			expect(markdownContent).not.toBeNull();
		});

		it('should render simple message as code block', () => {
			const level = 'info';
			const message = 'Some log message';
			const logEntry = new LogEntry(level, BASE_TIMESTAMP, message);
			const element = logEntry.element;

			const content = element.querySelector('.haibun-message-content');
			expect(content).not.toBeNull();
			expect(content?.classList.contains('haibun-simple-message')).toBe(true);

			const markdownContent = content?.querySelector('.haibun-prose-markdown');
			expect(markdownContent?.innerHTML).toContain('<pre><code');
			expect(markdownContent?.textContent).toContain('Some log message');
		});

		it('should render prose message as blockquote', () => {
			const level = 'info';
			const message = '> Some prose message';
			const logEntry = new LogEntry(level, BASE_TIMESTAMP, message);
			const element = logEntry.element;

			const content = element.querySelector('.haibun-message-content');
			expect(content).not.toBeNull();

			const markdownContent = content?.querySelector('.haibun-prose-markdown');
			expect(markdownContent?.innerHTML).toContain('<blockquote>');
			expect(markdownContent?.textContent).toContain('Some prose message');
		});



		it('should display a modified summary message when context provides it', () => {
			const level = 'info';
			const message = 'Given something';
			const mockTag: TTag = createMockTag();
			const context: TMessageContext = {
				incident: EExecutionMessageType.STEP_END,
				tag: mockTag,
				incidentDetails: {
					featureStep: { path: 'test.feature', in: message, seqPath: [1], action: { actionName: 'test', stepperName: 'test', step: { action: async () => Promise.resolve(OK) } } },
					actionResult: { ok: true, name: 'test' }
				}
			};
			const logEntry = new LogEntry(level, BASE_TIMESTAMP, message, context);
			const element = logEntry.element;

			const summary = element.querySelector('.haibun-log-message-summary');
			const messageContent = element.querySelector('.haibun-message-content');

			// The summary should show the message as-is
			expect(summary?.textContent).toContain('Given something');
			expect(summary?.querySelector('.haibun-log-label')?.textContent).toBe('test.feature:1');
			expect(messageContent?.classList.contains('haibun-simple-message')).toBe(false);
		});
		it('should render markdown in summary message', () => {
			const level = 'info';
			const message = '### Heading 3';
			const mockTag: TTag = createMockTag();
			const context: TMessageContext = {
				incident: EExecutionMessageType.STEP_END,
				tag: mockTag,
				incidentDetails: {
					featureStep: { path: 'test.feature', in: '### Heading 3', seqPath: [1], action: { actionName: 'test', stepperName: 'test', step: { action: async () => Promise.resolve(OK) } } },
					actionResult: { ok: true, name: 'test' }
				}
			};
			const logEntry = new LogEntry(level, BASE_TIMESTAMP, message, context);
			const element = logEntry.element;

			const summary = element.querySelector('.haibun-log-message-summary');
			const textContainer = summary?.querySelector('.haibun-log-message-text');

			expect(textContainer).not.toBeNull();
			const markdownContent = textContainer?.querySelector('.haibun-prose-markdown');
			expect(markdownContent?.innerHTML).toContain('<h3>Heading 3</h3>');

			const plainContent = textContainer?.querySelector('.haibun-prose-plain');
			expect(plainContent?.textContent).toBe('### Heading 3');
		}); it('should throw if artifact type is not recognized', () => {
			const artifact = <TArtifact>(<unknown>{ artifactType: 'notAThing' });
			const mockTagGeneric: TTag = createMockTag();
			const context: TMessageContext = {
				incident: EExecutionMessageType.ACTION,
				tag: mockTagGeneric,
				artifacts: [artifact]
			};
			expect(() => new LogEntry('warn', BASE_TIMESTAMP, 'Generic JSON', context)).toThrow();
		});
		it('should add haibun-log-step class to lowercase steps', () => {
			const level = 'info';
			const message = '✅ [1] given a step';
			const mockTag: TTag = createMockTag();
			const context: TMessageContext = {
				incident: EExecutionMessageType.STEP_END,
				tag: mockTag,
				incidentDetails: {
					featureStep: { path: 'test.feature', in: 'given a step', seqPath: [1], action: { actionName: 'test', stepperName: 'test', step: { action: async () => Promise.resolve(OK) } } },
					actionResult: { ok: true, name: 'test' }
				}
			};
			const logEntry = new LogEntry(level, BASE_TIMESTAMP, message, context);
			const element = logEntry.element;

			const summary = element.querySelector('.haibun-log-message-summary');
			const textContainer = summary?.querySelector('.haibun-log-message-text');

			expect(textContainer?.classList.contains('haibun-log-step')).toBe(true);
		});

		it('should NOT add haibun-log-step class to uppercase prose', () => {
			const level = 'info';
			const message = '✅ [1] Prose line';
			const mockTag: TTag = createMockTag();
			const context: TMessageContext = {
				incident: EExecutionMessageType.STEP_END,
				tag: mockTag,
				incidentDetails: {
					featureStep: { path: 'test.feature', in: 'Prose line', seqPath: [1], action: { actionName: 'test', stepperName: 'test', step: { action: async () => Promise.resolve(OK) } } },
					actionResult: { ok: true, name: 'test' }
				}
			};
			const logEntry = new LogEntry(level, BASE_TIMESTAMP, message, context);
			const element = logEntry.element;

			const summary = element.querySelector('.haibun-log-message-summary');
			const textContainer = summary?.querySelector('.haibun-log-message-text');

			expect(textContainer?.classList.contains('haibun-log-step')).toBe(false);
		});
	});
});
