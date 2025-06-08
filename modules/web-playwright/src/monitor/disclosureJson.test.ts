import { beforeEach, describe, expect, it } from 'vitest';

import { JSDOM } from 'jsdom';
import { disclosureJson } from './disclosureJson';

describe('disclosureJson', () => {
	let dom: JSDOM;
	let document: Document;
	interface TestWindow extends Window {
		requestAnimationFrame: (callback: FrameRequestCallback) => number;
		cancelAnimationFrame: (id: number) => void;
	}
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	let windowObject: TestWindow;

	beforeEach(() => {
		dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: "dangerously", resources: "usable" });
		document = dom.window.document;
		windowObject = dom.window as TestWindow;

		(global as typeof globalThis & { document: Document }).document = document;
		(global as typeof globalThis & { window: Window }).window = dom.window;
		(global as typeof globalThis & { requestAnimationFrame: (callback: FrameRequestCallback) => number }).requestAnimationFrame = dom.window.requestAnimationFrame;
		(global as typeof globalThis & { cancelAnimationFrame: (id: number) => void }).cancelAnimationFrame = dom.window.cancelAnimationFrame;
		(global as typeof globalThis & { HTMLElement: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
		(global as typeof globalThis & { HTMLTextAreaElement: typeof HTMLTextAreaElement }).HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
		(global as typeof globalThis & { HTMLDetailsElement: typeof HTMLDetailsElement }).HTMLDetailsElement = dom.window.HTMLDetailsElement;
		(global as typeof globalThis & { HTMLSpanElement: typeof HTMLSpanElement }).HTMLSpanElement = dom.window.HTMLSpanElement;
	});

	it('should return an HTMLElement for valid JSON object input', () => {
		const jsonData = { key: 'value', number: 123, bool: true, nested: { a: 1 } };
		const result = disclosureJson(jsonData);
		expect(result).toBeDefined();
		expect(result).toBeInstanceOf(dom.window.HTMLElement);
		expect(result?.tagName).toBe('DIV');
	});

	it('should return an HTMLElement for a simple primitive value (string)', () => {
		const jsonData = "a simple string";
		const result = disclosureJson(jsonData);
		expect(result).toBeDefined();
		expect(result).toBeInstanceOf(dom.window.HTMLElement);
		expect(result?.tagName).toBe('DIV');
		expect(result?.classList.contains('json-root-primitive')).toBe(true);
	});

	it('should return an HTMLElement for a simple primitive value (number)', () => {
		const jsonData = 12345;
		const result = disclosureJson(jsonData);
		expect(result).toBeDefined();
		expect(result).toBeInstanceOf(dom.window.HTMLElement);
		expect(result?.tagName).toBe('DIV');
		expect(result?.classList.contains('json-root-primitive')).toBe(true);
	});

	it('should return an HTMLElement for a simple primitive value (boolean)', () => {
		const jsonData = true;
		const result = disclosureJson(jsonData);
		expect(result).toBeDefined();
		expect(result).toBeInstanceOf(dom.window.HTMLElement);
		expect(result?.tagName).toBe('DIV');
		expect(result?.classList.contains('json-root-primitive')).toBe(true);
	});

	it('should return an HTMLElement for null input', () => {
		const jsonData = null;
		const result = disclosureJson(jsonData);
		expect(result).toBeDefined();
		expect(result).toBeInstanceOf(dom.window.HTMLElement);
		expect(result?.tagName).toBe('DIV');
		expect(result?.classList.contains('json-root-primitive')).toBe(true);
	});

	it('should return an HTMLElement for an empty object', () => {
		const jsonData = {};
		const result = disclosureJson(jsonData);
		expect(result).toBeDefined();
		expect(result).toBeInstanceOf(dom.window.HTMLElement);
		expect(result?.tagName).toBe('DIV');
		expect(result?.classList.contains('json-root-simple-aggregate')).toBe(true);
	});

	it('should return an HTMLElement for an empty array', () => {
		const jsonData = [];
		const result = disclosureJson(jsonData);
		expect(result).toBeDefined();
		expect(result).toBeInstanceOf(dom.window.HTMLElement);
		expect(result?.tagName).toBe('DIV');
		expect(result?.classList.contains('json-root-simple-aggregate')).toBe(true);
	});

	it('should return an HTMLElement for an array of primitives', () => {
		const jsonData = [1, "two", true, null];
		const result = disclosureJson(jsonData);
		expect(result).toBeDefined();
		expect(result).toBeInstanceOf(dom.window.HTMLElement);
		expect(result?.tagName).toBe('DIV');
		expect(result?.classList.contains('json-root-simple-aggregate')).toBe(true);
	});
});
