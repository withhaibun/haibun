/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SequenceDiagramGenerator } from './mermaidDiagram.js';
import { THTTPTraceContent } from '@haibun/core/build/lib/interfaces/artifacts.js';
import { TAnyFixme } from '@haibun/core/build/lib/defs.js';

// Use vi.hoisted to declare the mock function before vi.mock runs
const { mockMermaidRun } = vi.hoisted(() => {
	return { mockMermaidRun: vi.fn() }
});

// Mock the mermaid library using the hoisted mock function
vi.mock('mermaid', () => ({
	default: {
		run: mockMermaidRun,
		initialize: vi.fn(),
	}
}));

describe('SequenceDiagramGenerator', () => {
	let generator: SequenceDiagramGenerator;
	let container: HTMLDivElement;

	beforeEach(() => {
		container = document.createElement('div');
		container.id = 'sequence-diagram';
		document.body.appendChild(container);

		generator = new SequenceDiagramGenerator();
		vi.clearAllMocks();
	});

	afterEach(() => {
		const containerInBody = document.getElementById('sequence-diagram');
		if (containerInBody) {
			document.body.removeChild(containerInBody);
		}
	});

	it('should not call mermaid.run if needsUpdate is false', async () => {
		await generator.update();
		expect(mockMermaidRun).not.toHaveBeenCalled();
	});

	it('should generate diagram, insert into container, and call mermaid.run when needsUpdate is true', async () => {
		// Simulate processing an event to set needsUpdate = true
		const mockEvent: THTTPTraceContent = {
			requestingPage: 'about:blank',
			requestingURL: 'http://example.com/api',
			method: 'GET',
			status: 200,
			statusText: 'OK',
			headers: {
				"user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
			}
		};
		generator.processEvent(mockEvent, 'request'); // Add httpEvent

		await generator.update();

		// Check if container has the mermaid pre tag
		const preElement = container.querySelector('pre.mermaid');
		expect(preElement).not.toBeNull();
		const expectedDiagram = `sequenceDiagram
participant examplecom1 as example.com 1
participant examplecom as example.com
examplecom1->>examplecom: GET http://example.com/api
examplecom-->>examplecom1: 200 OK`;
		expect(preElement?.textContent?.trim()).toBe(expectedDiagram);

		expect(mockMermaidRun).toHaveBeenCalledTimes(1);
		expect(mockMermaidRun).toHaveBeenCalledWith({ nodes: [preElement] });

		expect((generator as TAnyFixme).needsUpdate).toBe(false); // Access private member for testing
	});

	it('should handle errors during mermaid.run and display the error', async () => {
		const internalErrorMessage = '(textElem._groups || textElem)[0][0].getBBox is not a function';
		mockMermaidRun.mockRejectedValueOnce(new Error(internalErrorMessage)); // Simulate internal error

		const mockEvent: THTTPTraceContent = { requestingURL: 'http://test.com' }
		generator.processEvent(mockEvent, 'request'); // Add httpEvent

		await generator.update();

		// Check if error message is displayed
		const preElement = container.querySelector('pre');
		expect(preElement).not.toBeNull();
		// Check if error message and diagram definition are displayed
		expect(preElement?.textContent).toContain('Error rendering Mermaid diagram:');
		expect(preElement?.textContent).toContain(internalErrorMessage);
		expect(preElement?.textContent).toContain('--- Diagram Definition ---');
		// Check if the diagram definition itself is present (basic check)
		expect(preElement?.textContent).toContain('sequenceDiagram');
		expect(preElement?.textContent).toContain('participant testcom as test.com');

		// Check if needsUpdate is reset even after error
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect((generator as any).needsUpdate).toBe(false);
	});

	it('should handle non-Error objects thrown during mermaid.run', async () => {
		const errorObject = { details: 'Simulated non-Error rejection for testing mermaid.run' };
		mockMermaidRun.mockRejectedValueOnce(errorObject); // Simulate non-Error rejection

		const mockEvent: THTTPTraceContent = { requestingPage: 'p1', requestingURL: 'http://test.com' };
		generator.processEvent(mockEvent, 'request'); // Add httpEvent

		await generator.update();

		// Check if error message is displayed (using String(e))
		const preElement = container.querySelector('pre');
		expect(preElement).not.toBeNull();
		// Check if error message, stringified error object, and diagram definition are displayed
		expect(preElement?.textContent).toContain('Error rendering Mermaid diagram:');
		expect(preElement?.textContent).toContain(String(errorObject));
		expect(preElement?.textContent).toContain('--- Diagram Definition ---');
		// Check if the diagram definition itself is present (basic check)
		expect(preElement?.textContent).toContain('sequenceDiagram');
		expect(preElement?.textContent).toContain('participant testcom as test.com');

		// Check if needsUpdate is reset
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect((generator as any).needsUpdate).toBe(false);
	});

	it('should warn if container is not found and reset needsUpdate', async () => {
		const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { }); // Spy on console.warn

		const containerToRemove = document.getElementById('sequence-diagram');
		expect(containerToRemove).not.toBeNull(); // Verify it exists initially from beforeEach
		if (containerToRemove) {
			document.body.removeChild(containerToRemove);
		}
		expect(document.getElementById('sequence-diagram')).toBeNull(); // Verify removal worked

		const mockEvent: THTTPTraceContent = { requestingPage: 'p1', requestingURL: 'http://test.com' }
		generator.processEvent(mockEvent, 'request'); // Add httpEvent

		await generator.update();

		// Check if mermaid.run was not called
		expect(mockMermaidRun).not.toHaveBeenCalled();
		// Check if console.warn was called
		expect(consoleWarnSpy).toHaveBeenCalledWith("Sequence diagram container not found.");
		// Check if needsUpdate is reset
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect((generator as any).needsUpdate).toBe(false);

		consoleWarnSpy.mockRestore(); // Restore console.warn
	});
	it('should correctly sanitize messages with quotes', async () => {
		const mockEvent: THTTPTraceContent = {
			requestingPage: 'about:blank', // Use about:blank
			requestingURL: 'http://quotes.com/search?q="test"',
			method: 'GET',
			status: 200,
			statusText: 'OK "Success"',
			headers: {
				referer: 'http://source.com/"origin"',
				"user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
			}
		};
		// Test sanitation for both request and response parts of the diagram
		generator.processEvent(mockEvent, 'request');
		await generator.update();

		const preElement = container.querySelector('pre.mermaid');
		expect(preElement).not.toBeNull();

		// Expect alias based on hostname 'quotes.com' + counter 1
		const expectedDiagram = `sequenceDiagram
participant quotescom1 as quotes.com 1
participant quotescom as quotes.com
quotescom1->>quotescom: GET http://quotes.com/search?q...'test'
Note right of quotescom1: Referer: http://source.com...rigin'
quotescom-->>quotescom1: 200 OK 'Success'`;
			expect(preElement?.textContent?.trim()).toBe(expectedDiagram);
		expect(mockMermaidRun).toHaveBeenCalledTimes(1);
	});
	it('should handle requestingURL about:blank correctly', async () => {
		const mockEvent: THTTPTraceContent = {
			requestingPage: 'about:blank',
			requestingURL: 'about:blank', // URL is about:blank
			method: 'GET',
			status: 200,
			statusText: 'OK',
			headers: {
				"user-agent": "Mozilla/5.0 Test Agent"
			}
		}
		generator.processEvent(mockEvent, 'request'); // Add httpEvent
		await generator.update();

		const preElement = container.querySelector('pre.mermaid');
		expect(preElement).not.toBeNull();

		// Expect only the initial diagram type, as processEvent returns early for about:blank
		// Participant is added before filtering, so it will appear even if no interactions are logged.
		// For about:blank, hostname is "", alias remains "UnknownAlias", name becomes "".
		const expectedDiagram = `sequenceDiagram
participant UnknownAlias as`;

		expect(preElement?.textContent?.trim()).toBe(expectedDiagram);
		// Mermaid might still be called, but the diagram is minimal
		expect(mockMermaidRun).toHaveBeenCalledTimes(1);
	});

	it('should handle invalid requestingURL correctly', async () => {
		const mockEvent: THTTPTraceContent = {
			requestingPage: 'pageInvalid',
			requestingURL: 'invalid-url-string', // Invalid URL
			method: 'POST',
			status: 400,
			statusText: 'Bad Request',
			headers: {}
		}
		// Test invalid URL for both request and response parts
		generator.processEvent(mockEvent, 'request');
		await generator.update();

		const preElement = container.querySelector('pre.mermaid');
		expect(preElement).not.toBeNull();

		// Expect interaction with the 'Invalid URL' participant
		const expectedDiagram = `sequenceDiagram
participant Page1 as Browser Page 1
participant InvalidURLAlias as Unknown
Page1->>InvalidURLAlias: POST invalid-url-string
InvalidURLAlias-->>Page1: 400 Bad Request`;

		expect(preElement?.textContent?.trim()).toBe(expectedDiagram);
		// Called once for request, once for response in the original logic, but now only once
		expect(mockMermaidRun).toHaveBeenCalledTimes(1);
	});
});
// Import the filterEvent function directly for testing
// Note: Vitest might require a specific way to import non-exported functions if it's not exported.
// Assuming it's exported or we adjust the import/test structure if needed.
// For now, let's assume we can import it or test it via the generator.
// We'll need to export filterEvent from mermaidDiagram.ts first.

// Let's modify mermaidDiagram.ts to export filterEvent
/*
// In mermaidDiagram.ts add:
export function filterEvent(...) { ... }
*/
// Then import it here:
import { skipEvent } from './mermaidDiagram.js';


describe('skipEvent', () => {
	const defaultFilters = {
		request: { accept: ['application/json'] },
		response: { type: ['application/json'] },
	};

	const baseTrace: THTTPTraceContent = {
		requestingPage: 'page1',
		requestingURL: 'http://example.com/data',
		method: 'GET',
		status: 200,
		statusText: 'OK',
		headers: {},
	};

	it('should return false if serverName is missing', () => {
		// skipEvent returns true if the event should be skipped
		const result = skipEvent(defaultFilters, 'request', null, baseTrace);
		expect(result).toBe(true); // Should skip if serverName is null
	});

	it('should return false if requestingURL is about:blank', () => {
		const trace = { ...baseTrace, requestingURL: 'about:blank' };
		const result = skipEvent(defaultFilters, 'request', 'example.com', trace);
		expect(result).toBe(true); // Should skip if URL is about:blank
	});

	// --- Request Filtering ---
	it('should return true for request with Accept: application/json', () => {
		const trace = { ...baseTrace, headers: { accept: 'application/json' } };
		const result = skipEvent(defaultFilters, 'request', 'example.com', trace);
		expect(result).toBe(false); // Should NOT skip if Accept matches
	});

	it('should return false for request with Accept: text/html', () => {
		const trace = { ...baseTrace, headers: { accept: 'text/html' } };
		const result = skipEvent(defaultFilters, 'request', 'example.com', trace);
		expect(result).toBe(true); // Should skip if Accept doesn't match
	});

	it('should return true for request with missing Accept header (passes filter)', () => {
		// The current filter logic only filters *out* if the header exists and doesn't match.
		// If the header is missing, it doesn't fail the check.
		const trace = { ...baseTrace, headers: {} }; // No accept header
		const result = skipEvent(defaultFilters, 'request', 'example.com', trace);
		expect(result).toBe(false); // Should NOT skip if Accept header is missing
	});

	// --- Response Filtering ---
	it('should return true for response with Content-Type: application/json', () => {
		const trace = { ...baseTrace, headers: { 'content-type': 'application/json' } };
		const result = skipEvent(defaultFilters, 'response', 'example.com', trace);
		expect(result).toBe(false); // Should NOT skip if Content-Type matches
	});

	it('should return false for response with Content-Type: text/plain', () => {
		const trace = { ...baseTrace, headers: { 'content-type': 'text/plain' } };
		const result = skipEvent(defaultFilters, 'response', 'example.com', trace);
		expect(result).toBe(true); // Should skip if Content-Type doesn't match
	});

	it('should return true for response with missing Content-Type header (passes filter)', () => {
		// Similar to Accept, if Content-Type is missing, it passes the filter.
		const trace = { ...baseTrace, headers: {} }; // No content-type header
		const result = skipEvent(defaultFilters, 'response', 'example.com', trace);
		expect(result).toBe(false); // Should NOT skip if Content-Type header is missing
	});

	it('should return true for non-request/response httpEvent types', () => {
		// The filter only applies specific header checks for 'request' and 'response'
		const trace = { ...baseTrace, headers: { accept: 'text/html', 'content-type': 'text/plain' } };
		// Using 'route' as an example of another event type
		// skipEvent returns true for unknown event types
		const result = skipEvent(defaultFilters, 'route', 'example.com', trace);
		expect(result).toBe(true); // Should skip for unknown event types
	});
});
