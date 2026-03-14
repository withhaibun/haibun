import { describe, it, expect } from 'vitest';
import { pickLocatorDomain } from './web-playwright.js';
import { DOMAIN_STRING } from '@haibun/core/lib/domain-types.js';
import { DOMAIN_PAGE_LOCATOR, DOMAIN_PAGE_TEST_ID, DOMAIN_PAGE_LABEL, DOMAIN_PAGE_PLACEHOLDER } from './domains.js';

describe('pickLocatorDomain', () => {
	it('prefers string over page-locator for union domains', () => {
		expect(pickLocatorDomain([DOMAIN_PAGE_LOCATOR, DOMAIN_STRING])).toBe(DOMAIN_STRING);
	});

	it('prefers string over page-locator regardless of order', () => {
		expect(pickLocatorDomain([DOMAIN_STRING, DOMAIN_PAGE_LOCATOR])).toBe(DOMAIN_STRING);
	});

	it('returns page-locator when string is not in the union', () => {
		expect(pickLocatorDomain([DOMAIN_PAGE_LOCATOR])).toBe(DOMAIN_PAGE_LOCATOR);
	});

	it('returns specific locator domain when no string domain', () => {
		expect(pickLocatorDomain([DOMAIN_PAGE_TEST_ID, DOMAIN_PAGE_LOCATOR])).toBe(DOMAIN_PAGE_TEST_ID);
	});

	it('returns string over any specific locator domain', () => {
		expect(pickLocatorDomain([DOMAIN_PAGE_LABEL, DOMAIN_STRING])).toBe(DOMAIN_STRING);
		expect(pickLocatorDomain([DOMAIN_PAGE_PLACEHOLDER, DOMAIN_STRING])).toBe(DOMAIN_STRING);
	});

	it('returns first part as fallback for unknown domains', () => {
		expect(pickLocatorDomain(['unknown-domain', 'other'])).toBe('unknown-domain');
	});
});
