/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TArtifact, TMessageContext, EExecutionMessageType, } from '@haibun/core/build/lib/interfaces/logger.js';
import { TFeatureStep, TStepResult, TStepAction, TStepActionResult, OK } from '@haibun/core/build/lib/defs.js';
import { LogEntry } from './messages.js';
import { TTag } from '@haibun/core/build/lib/ttag.js';
import { setupMessagesTestDOM, cleanupMessagesTestDOM } from './test-utils.js';

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
			expect(messageContent.textContent).toBe(message);
		});

		it('should display a modified summary message when context provides it', () => {
			const level = 'debug';
			const message = 'Action';
			const mockTag: TTag = { key: 'test', sequence: 1, featureNum: 1, params: {}, trace: false };
			const mockStepAction: TStepAction = { actionName: 'testAction', stepperName: 'testStepper', step: { action: async () => Promise.resolve(OK) } };
			const mockFeatureStep: TFeatureStep = { path: 'test.feature', origin: 'test.feature', in: 'Given something', seq: 1, action: mockStepAction };
			const mockActionResult: TStepActionResult = { ok: true, name: 'testAction' };
			const mockStepResult: TStepResult = { ok: true, actionResult: mockActionResult, in: 'Given something', path: 'test.feature', seq: 1 };

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
			const details = element.querySelector('.haibun-context-details');
			expect(details).not.toBeNull();
			const summary = details?.querySelector('.haibun-log-message-summary');
			expect(summary?.textContent).toContain('Action Given something');
			expect(summary?.querySelector('.details-type')?.textContent).toBe('STEP END');
			expect(messageContent?.classList.contains('haibun-simple-message')).toBe(false);

			expect(details?.querySelector('pre.haibun-message-details-json')).not.toBeNull();
			expect(details?.querySelector('.haibun-incident-type')).toBeNull();
		});

		it('should throw if artifact type is not recognized', () => {
			const artifact = <TArtifact>(<unknown>{ artifactType: 'notAThing' });
			const mockTagGeneric: TTag = { key: 'generic', sequence: 9, featureNum: 1, params: {}, trace: false };
			const context: TMessageContext = {
				incident: EExecutionMessageType.ACTION,
				tag: mockTagGeneric,
				artifact
			};
			expect(() => new LogEntry('warn', BASE_TIMESTAMP, 'Generic JSON', context)).toThrow();
		});
	});
});

