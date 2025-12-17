import { describe, it, expect } from 'vitest';

import { CAPTURE, DEFAULT_DEST } from '@haibun/core/lib/defs.js';
import { getDefaultWorld, getTestWorldWithOptions } from '@haibun/core/lib/test/lib.js';
import StorageFS from './storage-fs.js';
import { Timer } from '@haibun/core/lib/Timer.js';
import { EMediaTypes } from '@haibun/domain-storage/media-types.js';

const { key } = Timer;

describe('fs getCaptureLocation', () => {
	it('gets capture location', async () => {
		const storageFS = new StorageFS();
		const world = getDefaultWorld(0);
		const dir = await storageFS.getCaptureLocation({ ...world, mediaType: EMediaTypes.json }, 'test');
		expect(dir).toEqual(`./${CAPTURE}/default/${key}/seq-0/featn-0/test`);
	});
	it('gets options capture location', async () => {
		const storageFS = new StorageFS();
		const world = getTestWorldWithOptions();
		const dir = await storageFS.getCaptureLocation({ ...world, mediaType: EMediaTypes.json }, 'test');
		expect(dir).toEqual(`./${CAPTURE}/${DEFAULT_DEST}/${key}/seq-0/featn-0/test`);
	});
	it('gets relative capture location', async () => {
		const storageFS = new StorageFS();
		const world = getTestWorldWithOptions();
		const dir = await storageFS.getCaptureLocation({ ...world, mediaType: EMediaTypes.json }, 'test');
		expect(dir).toEqual(`./${CAPTURE}/${DEFAULT_DEST}/${key}/seq-0/featn-0/test`);
	});
});

describe('getArtifactBasePath', () => {
	it('returns base path without seq/featn', () => {
		const storageFS = new StorageFS();
		storageFS.world = getDefaultWorld(0);
		const basePath = storageFS.getArtifactBasePath();
		expect(basePath).toEqual(`./${CAPTURE}/default/${key}`);
		// Verify no seq/featn in path
		expect(basePath).not.toContain('seq-');
		expect(basePath).not.toContain('featn-');
	});
});

describe('saveArtifact', () => {
	it('with subpath returns correct paths', async () => {
		const storageFS = new StorageFS();
		storageFS.world = getDefaultWorld(0);

		const saved = await storageFS.saveArtifact('test.png', Buffer.from('fake-image'), EMediaTypes.image, 'image');

		// Feature-relative for serialized HTML
		expect(saved.featureRelativePath).toEqual('./image/test.png');

		// Base-relative for live server (includes seq/featn)
		expect(saved.baseRelativePath).toMatch(/^seq-0\/featn-0\/image\/test\.png$/);

		// Absolute path exists
		expect(storageFS.exists(saved.absolutePath)).toBe(true);

		// Cleanup
		storageFS.rm(saved.absolutePath);
	});

	it('without subpath returns correct paths', async () => {
		const storageFS = new StorageFS();
		storageFS.world = getDefaultWorld(0);

		const saved = await storageFS.saveArtifact('report.html', '<html></html>', EMediaTypes.html);

		// Feature-relative for serialized HTML (no subpath)
		expect(saved.featureRelativePath).toEqual('./report.html');

		// Base-relative for live server
		expect(saved.baseRelativePath).toMatch(/^seq-0\/featn-0\/report\.html$/);

		// Absolute path exists
		expect(storageFS.exists(saved.absolutePath)).toBe(true);

		// Cleanup
		storageFS.rm(saved.absolutePath);
	});
});
