/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest';
import { setupMessagesTestDOM, cleanupMessagesTestDOM, defineGlobalMermaidAndDOMPurify, createMockTag as createMockTagFromUtil } from './test-utils.js';
import { renderLogEntry, TLogEntry as MonitorTLogEntry } from './monitor.js';
import { EExecutionMessageType, TLogLevel, TLogArgs, TMessageContext, TArtifact, TArtifactJSON } from '@haibun/core/build/lib/interfaces/logger.js';
import { TTag } from '@haibun/core/build/lib/ttag.js';

// Helper type for the optional context in simulateLog, using core types
interface SimulateLogContextOptions {
    tag?: TTag;
    incident?: EExecutionMessageType;
    incidentDetails?: TMessageContext['incidentDetails'];
    artifact?: TArtifact;
    // For TMessageContext, caller and stepper are not direct properties.
    // They might be part of incidentDetails or structured differently if needed for specific tests.
}

// Helper to simulate log messages by calling renderLogEntry
const simulateLog = (level: TLogLevel, messageText: TLogArgs, contextIn?: SimulateLogContextOptions, timestampOverride?: number) => {
    const messageContext: TMessageContext | undefined = contextIn ? {
        tag: contextIn.tag,
        incident: contextIn.incident || EExecutionMessageType.ACTION, // Default incident to ACTION
        incidentDetails: contextIn.incidentDetails,
        artifact: contextIn.artifact,
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
        setupMessagesTestDOM(Date.now()); // Pass current time or a fixed time
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

            // incidentDetails structure needs to be based on actual usage if specific details are tested.
            // For now, keeping it minimal or using TAnyFixme if complex.
            const startContext1: SimulateLogContextOptions = {
                tag: startTag1,
                incident: EExecutionMessageType.STEP_START,
                incidentDetails: { step: { in: 'Given a step 1', seq: 1, path: 'f.feature' } } // Example, adjust to actual TStepDetails if available/needed
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

    describe('JSON Disclosure', () => {
        it('should display JSON in a closed details element initially, show placeholder, and render on toggle', async () => {
            const jsonData = { key: 'value', nested: { num: 123 } };
            // Conforms to TArtifactJSON from logger.d.ts
            const artifactPayload: TArtifactJSON = { artifactType: 'json', json: jsonData };

            const messageContextForJson: SimulateLogContextOptions = {
                incident: EExecutionMessageType.ACTION,
                incidentDetails: { summary: 'JSON artifact data' }, // summary for the log message itself
                artifact: artifactPayload
            };

            simulateLog('info', 'JSON Data', messageContextForJson);

            const logEntry = logDisplayArea.querySelector('.haibun-log-entry');
            expect(logEntry).not.toBeNull();
            expect(logEntry!.textContent).toContain('JSON Data');

            const detailsElement = logEntry!.querySelector('details');
            expect(detailsElement).not.toBeNull();
            expect(detailsElement!.open).toBe(false);

            const summaryInDetails = detailsElement!.querySelector('summary');
            // Default summary for JSON is usually 'JSON Artifact' or similar, or from artifact.name if provided in TArtifactJSON (it's not standard)
            // For now, let's assume a generic one for now, or update if LogMessageContent has a specific logic for TArtifactJSON summary.
            expect(summaryInDetails?.textContent).toContain('json'); // Default name from artifactType

            const artifactContainer = detailsElement!.querySelector('.haibun-artifact-container');
            expect(artifactContainer).not.toBeNull();
            expect(artifactContainer!.textContent).toBe('Artifact is loading...');

            let preElement = artifactContainer!.querySelector('pre');
            expect(preElement).toBeNull();

            detailsElement!.open = true;
            detailsElement!.dispatchEvent(new Event('toggle'));
            await vi.dynamicImportSettled();

            expect(artifactContainer!.textContent).not.toBe('Artifact is loading...');
            preElement = artifactContainer!.querySelector('pre');
            expect(preElement).not.toBeNull();

            // The disclosureJson utility creates a root <details> element with the raw JSON in a data attribute.
            const jsonRootDetails = preElement!.querySelector('details.json-root-details') as HTMLElement;
            expect(jsonRootDetails).not.toBeNull();
            expect(jsonRootDetails.dataset.rawJson).toBeDefined();
            expect(JSON.parse(jsonRootDetails.dataset.rawJson!)).toEqual(jsonData);
        });
    });
});
