import { describe, it, expect } from 'vitest';

import { CAPTURE, DEFAULT_DEST } from '@haibun/core/build/lib/defs.js';
import { getDefaultWorld, getTestWorldWithOptions } from '@haibun/core/build/lib/test/lib.js';
import StorageFS from './storage-fs.js';
import { Timer } from '@haibun/core/build/lib/Timer.js';
import { EMediaTypes } from '@haibun/domain-storage/build/media-types.js';

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
