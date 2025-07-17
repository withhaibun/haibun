/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest';
import { setupMessagesTestDOM, cleanupMessagesTestDOM, defineGlobalMermaidAndDOMPurify, createMockTag as createMockTagFromUtil } from './test-utils.js';
import { renderLogEntry, TLogEntry as MonitorTLogEntry } from './monitor.js';
import { EExecutionMessageType, TLogLevel, TLogArgs, TMessageContext, TArtifact } from '@haibun/core/lib/interfaces/logger.js';
import { TTag } from '@haibun/core/lib/ttag.js';

interface SimulateLogContextOptions {
	tag?: TTag;
	incident?: EExecutionMessageType;
	incidentDetails?: TMessageContext['incidentDetails'];
	artifacts?: TArtifact[];
}

const simulateLog = (level: TLogLevel, messageText: TLogArgs, contextIn?: SimulateLogContextOptions, timestampOverride?: number) => {
	const messageContext: TMessageContext | undefined = contextIn ? {
		tag: contextIn.tag,
		incident: contextIn.incident || EExecutionMessageType.ACTION,
		incidentDetails: contextIn.incidentDetails,
		artifacts: contextIn.artifacts,
	} : undefined;

	const logEntryData: MonitorTLogEntry = {
		level,
		message: messageText,
		messageContext,
		timestamp: timestampOverride || Date.now(),
	};
	renderLogEntry(logEntryData);
};

describe('Monitor Web App', () => {
	let logDisplayArea: HTMLElement;


	beforeAll(async () => {
		await defineGlobalMermaidAndDOMPurify();
	});

	beforeEach(() => {
		setupMessagesTestDOM(Date.now());
		logDisplayArea = document.getElementById('haibun-log-display-area')!;
	});

	afterEach(() => {
		cleanupMessagesTestDOM();
	});

	describe('Basic Logging', () => {
		it('should display simple log messages', () => {
			simulateLog('info', 'Test message 1');
			simulateLog('error', 'Test error 2');
			const logEntries = logDisplayArea.querySelectorAll('.haibun-log-entry');
			expect(logEntries).toHaveLength(2);
			expect(logEntries[0].textContent).toContain('Test message 1');
			expect(logEntries[1].textContent).toContain('Test error 2');
		});
	});

	describe('Step Start/End Handling', () => {
		it('should add and remove "disappeared" class for step start/end messages', async () => {
			const startTag1 = createMockTagFromUtil();
			const endTag1 = createMockTagFromUtil();
			const startTag2 = createMockTagFromUtil();
			const endTag2 = createMockTagFromUtil();

			const startContext1: SimulateLogContextOptions = {
				tag: startTag1,
				incident: EExecutionMessageType.STEP_START,
				incidentDetails: { step: { in: 'Given a step 1', seq: 1, path: 'f.feature' } }
			};
			const startContext2: SimulateLogContextOptions = {
				tag: startTag2,
				incident: EExecutionMessageType.STEP_START,
				incidentDetails: { step: { in: 'Given a step 2', seq: 2, path: 'f.feature' } }
			};

			simulateLog('debug', 'Step 1 Start', startContext1);
			const entry1 = logDisplayArea.querySelector('.haibun-log-entry.haibun-step-start:not(.disappeared)');
			expect(entry1).not.toBeNull();
			expect(entry1?.textContent).toContain('Step 1 Start');

			simulateLog('debug', 'Step 1 End', { incident: EExecutionMessageType.STEP_END, tag: endTag1 });
			await vi.dynamicImportSettled();
			expect(entry1?.classList.contains('disappeared')).toBe(true);

			simulateLog('debug', 'Step 2 Start', startContext2);
			const entry2 = logDisplayArea.querySelector('.haibun-log-entry.haibun-step-start:not(.disappeared)');
			expect(entry2).not.toBeNull();
			expect(entry2?.textContent).toContain('Step 2 Start');
			expect(logDisplayArea.querySelectorAll('.haibun-log-entry.haibun-step-start.disappeared')).toHaveLength(1);

			simulateLog('debug', 'Step 2 End', { incident: EExecutionMessageType.STEP_END, tag: endTag2 });
			await vi.dynamicImportSettled();
			expect(entry2?.classList.contains('disappeared')).toBe(true);
			expect(logDisplayArea.querySelectorAll('.haibun-log-entry.haibun-step-start.disappeared')).toHaveLength(2);
			expect(logDisplayArea.querySelectorAll('.haibun-log-entry.haibun-step-start:not(.disappeared)')).toHaveLength(0);
		});

		it('should handle orphan step end messages gracefully', async () => {
			const endTag = createMockTagFromUtil();
			simulateLog('debug', 'Step End Orphan', { incident: EExecutionMessageType.STEP_END, tag: endTag });
			await vi.dynamicImportSettled();
			expect(logDisplayArea.querySelector('.haibun-log-entry')?.textContent).toContain('Step End Orphan');
			expect(logDisplayArea.querySelectorAll('.haibun-log-entry.haibun-step-start')).toHaveLength(0);
			expect(logDisplayArea.querySelectorAll('.haibun-log-entry.disappeared')).toHaveLength(0);
		});
	});

});
