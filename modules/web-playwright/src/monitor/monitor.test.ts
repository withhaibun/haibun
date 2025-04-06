/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TLogLevel, TLogArgs, TMessageContext, EExecutionMessageType } from '@haibun/core/build/lib/interfaces/logger.js';
import { TTag, OK } from '@haibun/core/build/lib/defs.js'; // Added OK import

// We need to import the module to attach the receiveLogData function to the window
import './monitor.js';

// Mock dependencies from monitor.ts that might interfere or are not needed
vi.mock('mermaid', () => ({
    default: { // Assuming mermaid is a default export
        initialize: vi.fn(),
        contentLoaded: vi.fn(),
    }
}));

vi.mock('./mermaidDiagram.js', () => ({
    SequenceDiagramGenerator: vi.fn().mockImplementation(() => ({
        update: vi.fn(),
        processEvent: vi.fn(),
    }))
}));

vi.mock('./controls.js', () => ({
    setupControls: vi.fn()
}));

describe('Monitor Log Rendering (monitor.ts)', () => {
    const TEST_START_TIME = 1700000000000;
    let logArea: HTMLDivElement;

    // Helper to create a mock TTag
    const createMockTag = (key: string, sequence: number): TTag => ({
        key,
        sequence,
        featureNum: 1,
        params: {},
        trace: false
    });

    // Helper to simulate receiving log data
    const simulateLog = (level: TLogLevel, message: TLogArgs, context?: TMessageContext, timestampOffset = 0) => {
        const timestamp = TEST_START_TIME + timestampOffset;
        window.receiveLogData({ level, message, messageContext: context, timestamp });
    };

    beforeEach(() => {
        // Set up the DOM environment
        document.body.innerHTML = ''; // Clear body
        document.body.dataset.startTime = `${TEST_START_TIME}`;

        logArea = document.createElement('div');
        logArea.id = 'haibun-log-display-area';
        document.body.appendChild(logArea);

        // Reset window state if necessary (though receiveLogData should handle it)
        window.haibunLogData = [];
    });

    afterEach(() => {
        // Clean up DOM
        document.body.innerHTML = '';
        delete document.body.dataset.startTime;
        vi.clearAllMocks(); // Clear mocks
    });

    it('should add loader to STEP_START message summary and hide entry on STEP_END', () => {
        const startTag = createMockTag('stepStart', 1);
        const endTag = createMockTag('stepEnd', 3);

        // 1. Log STEP_START (assuming it creates a context with details)
        //    Need a realistic context for STEP_START that results in .haibun-log-message-summary
        const startContext: TMessageContext = {
            incident: EExecutionMessageType.STEP_START,
            tag: startTag,
            // Add minimal incidentDetails to trigger the detailed view in LogEntry
            incidentDetails: { step: { in: 'Given a step', seq: 1, path: 'f.feature', action: { actionName: 'a', stepperName: 's', step: { action: async () => OK } } } }
        };
        simulateLog('debug', 'Step 1 Start', startContext, 100);

        let logEntries = logArea.querySelectorAll('.haibun-log-entry');
        expect(logEntries).toHaveLength(1);
        const startEntry = logEntries[0];
        const messageContent = startEntry.querySelector('.haibun-message-content');
        const loader = messageContent?.querySelector('.haibun-loader'); // Loader should be inside message content

        expect(startEntry.classList.contains('haibun-step-start')).toBe(true); // Check marker class
        expect(messageContent).not.toBeNull();
        expect(loader).not.toBeNull(); // Loader should exist within message content
        expect(loader?.parentElement).toBe(messageContent); // Loader parent is message content
        expect(messageContent?.firstChild).toBe(loader); // Loader is prepended
        expect(startEntry.classList.contains('disappeared')).toBe(false); // Should be visible

        // 2. Log a regular message (should not affect the start entry)
        simulateLog('info', 'Regular message', undefined, 200);
        logEntries = logArea.querySelectorAll('.haibun-log-entry');
        expect(logEntries).toHaveLength(2);
        expect(startEntry.classList.contains('disappeared')).toBe(false); // Start entry still visible

        // 3. Log STEP_END
        const endContext: TMessageContext = { incident: EExecutionMessageType.STEP_END, tag: endTag };
        simulateLog('debug', 'Step 1 End', endContext, 300);

        logEntries = logArea.querySelectorAll('.haibun-log-entry');
        expect(logEntries).toHaveLength(3);
        // Check the start entry itself is now hidden
        expect(startEntry.classList.contains('disappeared')).toBe(true);
        // The loader inside it should also effectively be hidden
    });

     it('should hide the correct STEP_START entry when multiple steps run sequentially', () => {
        const startTag1 = createMockTag('stepStart1', 1);
        const endTag1 = createMockTag('stepEnd1', 2);
        const startTag2 = createMockTag('stepStart2', 3);
        const endTag2 = createMockTag('stepEnd2', 4);
         // Use contexts that generate the message summary
         const startContext1: TMessageContext = { incident: EExecutionMessageType.STEP_START, tag: startTag1, incidentDetails: { step: { in: 'Step 1', seq: 1, path: 'f.feature', action: { actionName: 'a', stepperName: 's', step: { action: async () => OK } } } } };
         const startContext2: TMessageContext = { incident: EExecutionMessageType.STEP_START, tag: startTag2, incidentDetails: { step: { in: 'Step 2', seq: 2, path: 'f.feature', action: { actionName: 'a', stepperName: 's', step: { action: async () => OK } } } } };

        // Step 1 Start
        simulateLog('debug', 'Step 1 Start', startContext1, 100);
        const entry1 = logArea.querySelector('.haibun-log-entry.haibun-step-start:not(.disappeared)');
        expect(entry1).not.toBeNull();
        expect(entry1?.querySelector('.haibun-message-content > .haibun-loader')).not.toBeNull(); // Check loader exists in message content

        // Step 1 End
        simulateLog('debug', 'Step 1 End', { incident: EExecutionMessageType.STEP_END, tag: endTag1 }, 200);
        expect(entry1?.classList.contains('disappeared')).toBe(true);

        // Step 2 Start
        simulateLog('debug', 'Step 2 Start', startContext2, 300);
        const entry2 = logArea.querySelector('.haibun-log-entry.haibun-step-start:not(.disappeared)'); // Should find the new one
        expect(entry2).not.toBeNull();
        expect(entry2).not.toBe(entry1); // Ensure it's a different entry element
        expect(entry2?.classList.contains('haibun-step-start')).toBe(true);
        expect(entry2?.classList.contains('disappeared')).toBe(false);
        expect(entry2?.querySelector('.haibun-message-content > .haibun-loader')).not.toBeNull(); // Check loader exists in message content

         // Check that entry1 is still disappeared
         expect(logArea.querySelectorAll('.haibun-log-entry.haibun-step-start.disappeared')).toHaveLength(1);


        // Step 2 End
        simulateLog('debug', 'Step 2 End', { incident: EExecutionMessageType.STEP_END, tag: endTag2 }, 400);
        expect(entry2?.classList.contains('disappeared')).toBe(true);

        // Ensure both start entries are now hidden
        expect(logArea.querySelectorAll('.haibun-log-entry.haibun-step-start.disappeared')).toHaveLength(2);
        expect(logArea.querySelectorAll('.haibun-log-entry.haibun-step-start:not(.disappeared)')).toHaveLength(0);
    });

     it('should handle STEP_END gracefully if no active STEP_START entry is found', () => {
        const endTag = createMockTag('stepEnd', 1);
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}); // Suppress console output for this test

        // Log STEP_END without a preceding STEP_START
        simulateLog('debug', 'Step End Orphan', { incident: EExecutionMessageType.STEP_END, tag: endTag }, 100);

        expect(logArea.querySelectorAll('.haibun-log-entry.haibun-step-start')).toHaveLength(0); // No start entry should exist
        expect(logArea.querySelectorAll('.haibun-log-entry.disappeared')).toHaveLength(0); // No entry should be hidden
        expect(consoleWarnSpy).toHaveBeenCalledWith('Received STEP_END but found no active STEP_START log entry to hide.');

        consoleWarnSpy.mockRestore(); // Restore console.warn
    });
});
