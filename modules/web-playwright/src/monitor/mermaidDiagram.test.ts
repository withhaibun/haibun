/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SequenceDiagramGenerator } from './mermaidDiagram.js';
import { THTTPTraceContent } from '@haibun/core/build/lib/interfaces/artifacts.js';

// Use vi.hoisted to declare the mock function before vi.mock runs
const { mockMermaidRun } = vi.hoisted(() => {
	return { mockMermaidRun: vi.fn() }
});

// Mock the mermaid library using the hoisted mock function
vi.mock('mermaid', () => ({
	default: { // Assuming mermaid is imported as default
		run: mockMermaidRun,
		initialize: vi.fn(),
		// Add other necessary mocked methods/properties if needed
	}
}));

describe('SequenceDiagramGenerator', () => {
	let generator: SequenceDiagramGenerator;
	let container: HTMLDivElement;

	beforeEach(() => {
		// Setup DOM element
		container = document.createElement('div');
		container.id = 'sequence-diagram';
		document.body.appendChild(container);

		generator = new SequenceDiagramGenerator();
		vi.clearAllMocks(); // Clear mocks before each test
	});

	afterEach(() => {
		// Cleanup DOM
		// Find the container by ID again, as it might have been removed by a test
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
			requestingPage: 'about:blank', // Use about:blank
			requestingURL: 'http://example.com/api',
			method: 'GET',
			status: 200,
			statusText: 'OK',
			headers: {
				"user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
			}
		};
		generator.processEvent(mockEvent); // This sets needsUpdate = true

		await generator.update();

		// Check if container has the mermaid pre tag
		const preElement = container.querySelector('pre.mermaid');
		expect(preElement).not.toBeNull();
		// Define the exact expected output string
		// Expect alias based on hostname 'example.com' + counter 1
		const expectedDiagram = `sequenceDiagram
participant examplecom1 as example.com 1
participant examplecom as example.com
examplecom1->>examplecom: GET http://example.com/api
Note right of examplecom1: User-Agent: Mozilla/5.0 #40;X11#59; Linux x86_64#41; AppleWebKit/537.36 #40;KHTML#44; like Gecko#41; Chrome/134.0.0.0 Safari/537.36
examplecom-->>examplecom1: 200 OK`;
		// Compare the exact text content (trimming potential whitespace)
		expect(preElement?.textContent?.trim()).toBe(expectedDiagram);

		// Check if mermaid.run was called
		expect(mockMermaidRun).toHaveBeenCalledTimes(1);
		expect(mockMermaidRun).toHaveBeenCalledWith({ nodes: [preElement] });

		// Check if needsUpdate is reset
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect((generator as any).needsUpdate).toBe(false); // Access private member for testing
	});

	it('should handle errors during mermaid.run and display the error', async () => {
		// Simulate the actual error seen in jsdom environment
		const internalErrorMessage = '(textElem._groups || textElem)[0][0].getBBox is not a function';
		mockMermaidRun.mockRejectedValueOnce(new Error(internalErrorMessage)); // Simulate internal error

		// Simulate processing an event
		const mockEvent: THTTPTraceContent = { requestingURL: 'http://test.com' }
		generator.processEvent(mockEvent);

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

		// Simulate processing an event
		const mockEvent: THTTPTraceContent = { requestingPage: 'p1', requestingURL: 'http://test.com' };
		generator.processEvent(mockEvent);

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
		// Simulate processing an event
		const mockEvent: THTTPTraceContent = { requestingPage: 'p1', requestingURL: 'http://test.com' }
		generator.processEvent(mockEvent);

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
		generator.processEvent(mockEvent);
		await generator.update();

		const preElement = container.querySelector('pre.mermaid');
		expect(preElement).not.toBeNull();

		// Expect alias based on hostname 'quotes.com' + counter 1
		const expectedDiagram = `sequenceDiagram
participant quotescom1 as quotes.com 1
participant quotescom as quotes.com
quotescom1->>quotescom: GET http://quotes.com/search?q='test'
Note right of quotescom1: Referer: http://source.com/'origin'
Note right of quotescom1: User-Agent: Mozilla/5.0 #40;X11#59; Linux x86_64#41; AppleWebKit/537.36 #40;KHTML#44; like Gecko#41; Chrome/134.0.0.0 Safari/537.36
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
		generator.processEvent(mockEvent);
		await generator.update();

		const preElement = container.querySelector('pre.mermaid');
		expect(preElement).not.toBeNull();

		// Expect interaction with the 'Internal' participant
		const expectedDiagram = `sequenceDiagram
participant Page1 as Browser Page 1
participant InternalAlias as Internal
Page1->>InternalAlias: GET about:blank
Note right of Page1: User-Agent: Mozilla/5.0 Test Agent
InternalAlias-->>Page1: 200 OK`;

		expect(preElement?.textContent?.trim()).toBe(expectedDiagram);
		expect(mockMermaidRun).toHaveBeenCalledTimes(1); // Mermaid should still be called to render the diagram
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
		generator.processEvent(mockEvent);
		await generator.update();

		const preElement = container.querySelector('pre.mermaid');
		expect(preElement).not.toBeNull();

		// Expect interaction with the 'Invalid URL' participant
		const expectedDiagram = `sequenceDiagram
participant Page1 as Browser Page 1
participant InvalidURLAlias as Invalid URL
Page1->>InvalidURLAlias: POST invalid-url-string
InvalidURLAlias-->>Page1: 400 Bad Request`;

		expect(preElement?.textContent?.trim()).toBe(expectedDiagram);
		expect(mockMermaidRun).toHaveBeenCalledTimes(1); // Mermaid should still be called to render the diagram
	});
});
