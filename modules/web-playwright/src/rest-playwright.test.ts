import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { jwtVerify } from 'jose';
import { createApiKeyJwt, restSteps } from './rest-playwright.js';
import type WebPlaywright from './web-playwright.js';

const decodeBase64Url = (segment: string) => Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

const decodeJwt = (token: string) => {
	const [headerPart, payloadPart] = token.split('.');
	return { header: JSON.parse(decodeBase64Url(headerPart)), payload: JSON.parse(decodeBase64Url(payloadPart)) };
};

describe('createApiKeyJwt', () => {
	it('binds issuer/method/endpoint, derives kid from the hex api key, and verifies with jose', async () => {
		const apiKey = 'a'.repeat(64);
		const before = Math.floor(Date.now() / 1000);
		const token = await createApiKeyJwt({ issuer: 'tenant-1', apiKey, method: 'get', endpoint: 'https://api.example.com/resource' });
		const { header, payload } = decodeJwt(token);

		expect(header.alg).toBe('HS256');
		expect(header.kid).toBe(createHash('sha256').update(apiKey).digest('hex'));
		expect(payload.iss).toBe('tenant-1');
		expect(payload.htm).toBe('GET');
		expect(payload.htu).toBe('https://api.example.com/resource');
		expect(payload.iat).toBeGreaterThanOrEqual(before);
		expect(payload.exp - payload.iat).toBe(300);

		// Independently verify with jose itself, exactly as a real server would.
		const { payload: verified } = await jwtVerify(token, Buffer.from(apiKey, 'hex'));
		expect(verified.iss).toBe('tenant-1');
	});

	it('drops query string and fragment from htu, keeping only protocol + host + path', async () => {
		const token = await createApiKeyJwt({
			issuer: 't',
			apiKey: 'b'.repeat(64),
			method: 'get',
			endpoint: 'https://api.example.com/credential-design?searchTerm=foo#frag',
		});
		const { payload } = decodeJwt(token);
		expect(payload.htu).toBe('https://api.example.com/credential-design');
	});

	it('respects a custom ttlSeconds', async () => {
		const token = await createApiKeyJwt({ issuer: 't', apiKey: 'c'.repeat(64), method: 'post', endpoint: 'https://x.example.com/y', ttlSeconds: 60 });
		const { payload } = decodeJwt(token);
		expect(payload.exp - payload.iat).toBe(60);
	});

	it('rejects verification with the wrong key', async () => {
		const apiKey = 'd'.repeat(64);
		const token = await createApiKeyJwt({ issuer: 't', apiKey, method: 'get', endpoint: 'https://x.example.com/y' });
		await expect(jwtVerify(token, Buffer.from('e'.repeat(64), 'hex'))).rejects.toThrow();
	});
});

describe('restFilterPropertyRequestWithApiKeyJwt', () => {
	const fakeMethodFeatureStep = { action: { stepValuesMap: { method: { term: 'delete' } } } } as unknown as Parameters<
		ReturnType<typeof restSteps>['restFilterPropertyRequestWithApiKeyJwt']['action']
	>[1];

	it('mints a fresh, request-bound token per filtered item rather than reusing one header', async () => {
		const headersSet: Record<string, string>[] = [];
		const requestedUrls: string[] = [];
		const mockWebPlaywright = {
			setExtraHTTPHeaders: async (headers: Record<string, string>) => {
				headersSet.push(headers);
			},
			getLastResponse: () => ({ filtered: [{ id: 'one' }, { id: 'two' }] }),
			withPageFetch: async (endpoint: string) => {
				requestedUrls.push(endpoint);
				return { status: 200 };
			},
		} as unknown as WebPlaywright;

		const result = await restSteps(mockWebPlaywright).restFilterPropertyRequestWithApiKeyJwt.action(
			{ property: 'id', endpoint: 'https://x.example.com/thing', status: '200', issuer: 't', apiKey: 'a'.repeat(64) },
			fakeMethodFeatureStep
		);

		expect(result.ok).toBe(true);
		expect(requestedUrls).toEqual(['https://x.example.com/thing/one', 'https://x.example.com/thing/two']);
		expect(headersSet).toHaveLength(2);

		const htus = headersSet.map(({ Authorization }) => decodeJwt(Authorization.replace('Bearer ', '')).payload.htu);
		expect(htus).toEqual(['https://x.example.com/thing/one', 'https://x.example.com/thing/two']);
	});
});

describe('addApiKeyJwtAuthorizationHeaderWithTtl', () => {
	const setup = () => {
		const headersSet: Record<string, string>[] = [];
		const mockWebPlaywright = {
			setExtraHTTPHeaders: async (headers: Record<string, string>) => {
				headersSet.push(headers);
			},
		} as unknown as WebPlaywright;
		return { headersSet, step: restSteps(mockWebPlaywright).addApiKeyJwtAuthorizationHeaderWithTtl };
	};

	it.each(['not-a-number', '0', '-5', '1.5'])('rejects an invalid ttl of %s', async (ttl) => {
		const { headersSet, step } = setup();
		const result = await step.action({ issuer: 't', apiKey: 'a'.repeat(64), method: 'get', endpoint: 'https://x.example.com/y', ttl });
		expect(result.ok).toBe(false);
		expect(headersSet).toHaveLength(0);
	});

	it('accepts a positive integer ttl', async () => {
		const { headersSet, step } = setup();
		const result = await step.action({ issuer: 't', apiKey: 'a'.repeat(64), method: 'get', endpoint: 'https://x.example.com/y', ttl: '60' });
		expect(result.ok).toBe(true);
		expect(headersSet).toHaveLength(1);
	});
});
