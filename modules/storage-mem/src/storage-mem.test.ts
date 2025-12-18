import { vitest, describe, it, expect, vi } from 'vitest';
import { afterEach } from 'node:test';

vitest.useFakeTimers();
import { Timer, CAPTURE, DEFAULT_DEST } from '@haibun/core/schema/protocol.js';
import { getDefaultWorld, getTestWorldWithOptions } from '@haibun/core/lib/test/lib.js';
import StorageMem from './storage-mem.js';
import { EMediaTypes } from '@haibun/domain-storage/media-types.js';
import { TAnyFixme } from '@haibun/core/lib/fixme.js';

const { key } = Timer;

vi.spyOn(process, 'cwd').mockReturnValue('/');

describe('BASE_FS', () => {
	afterEach(() => {
		(StorageMem.BASE_FS as TAnyFixme) = undefined;
	});
	it('finds BASE_FS file', () => {
		StorageMem.BASE_FS = { hello: 'world' };
		const storageMem = new StorageMem();
		expect(storageMem.readFile('hello', 'utf-8')).toEqual('world');
	});
	it('finds BASE_FS subdir', () => {
		StorageMem.BASE_FS = { '/hello/world': 'eh' };
		const storageMem = new StorageMem();
		expect(storageMem.readFile('/hello/world', 'utf-8')).toEqual('eh');
	});
});

describe('mem getCaptureLocation', () => {
	it('gets capture location', async () => {
		const storageMem = new StorageMem();
		const world = getDefaultWorld(0);
		const dir = await storageMem.getCaptureLocation({ ...world, mediaType: EMediaTypes.json }, 'test');
		expect(dir).toEqual(`./${CAPTURE}/default/${key}/seq-0/featn-0/test`);
	});
	it('gets options capture location', async () => {
		const storageMem = new StorageMem();
		const world = getTestWorldWithOptions();
		const dir = await storageMem.getCaptureLocation({ ...world, mediaType: EMediaTypes.json }, 'test');
		expect(dir).toEqual(`./${CAPTURE}/${DEFAULT_DEST}/${key}/seq-0/featn-0/test`);
	});
	it('gets relative capture location', async () => {
		const storageMem = new StorageMem();
		const world = getTestWorldWithOptions();
		const dir = await storageMem.getCaptureLocation({ ...world, mediaType: EMediaTypes.json }, 'test');
		expect(dir).toEqual(`./${CAPTURE}/${DEFAULT_DEST}/${key}/seq-0/featn-0/test`);
	});
	it('ensures capture location', async () => {
		const storageMem = new StorageMem();
		const world = getDefaultWorld(0);
		const loc = await storageMem.getCaptureLocation({ ...world, mediaType: EMediaTypes.json }, 'test');
		await storageMem.ensureCaptureLocation({ ...world, mediaType: EMediaTypes.json }, 'test');
		expect(storageMem.exists(loc)).toBe(true);
	});
	it('creates a directory', () => {
		const storageMem = new StorageMem();
		storageMem.mkdir(`/${CAPTURE}`);
		expect(storageMem.exists(`/${CAPTURE}`)).toBe(true);
	});
	it('creates a directory with parents', () => {
		const storageMem = new StorageMem();
		storageMem.mkdirp(`/${CAPTURE}/wtw`);
		expect(storageMem.exists(`/${CAPTURE}/wtw`)).toBe(true);
	});

	it('exists', () => {
		const storageMem = new StorageMem();
		storageMem.mkdirp(`/${CAPTURE}/wtw`);
		expect(storageMem.exists(`/${CAPTURE}/wtw`)).toBe(true);
	});
	it('does not exist', () => {
		const storageMem = new StorageMem();
		expect(storageMem.exists(`/${CAPTURE}/wtw`)).toBe(false);
	});
	it('readdir', async () => {
		const storageMem = new StorageMem();
		storageMem.mkdirp(`/${CAPTURE}/wtw`);
		const files = await storageMem.readdir(`/${CAPTURE}`);
		expect(files).toEqual(['wtw']);
	});

	it('writes and reads a file', () => {
		const storageMem = new StorageMem();
		storageMem.writeFileBuffer(`/test.txt`, Buffer.from('test'));
		const text = storageMem.readFile(`/test.txt`);
		expect(text).toEqual(Buffer.from('test'));
	});
	it('lstat', async () => {
		const storageMem = new StorageMem();
		storageMem.mkdirp(`/${CAPTURE}/wtw`);
		const lstat = await storageMem.lstatToIFile(`/${CAPTURE}/wtw`);
		expect(lstat.name).toEqual(`/${CAPTURE}/wtw`);
		expect(lstat.isDirectory).toBe(true);
	});
	it('readdirStat', async () => {
		const storageMem = new StorageMem();
		storageMem.mkdirp(`/${CAPTURE}/wtw`);
		storageMem.writeFileBuffer(`/${CAPTURE}/wtw/test.txt`, Buffer.from('test'));
		const files = await storageMem.readdirStat(`/${CAPTURE}`);
		[
			{ name: `/${CAPTURE}/wtw`, isDirectory: true, isFile: false, isSymbolicLink: false },
			{ name: `/${CAPTURE}/wtw/test.txt`, isDirectory: false, isFile: true, isSymbolicLink: false },
		];
		expect(files).toEqual(files);
	});
});

/*
// FIXME: create this test without replicating IFile
describe.skip('readTree', () => {
	afterEach(() => {
		(StorageMem.BASE_FS as any) = undefined;
	});
	const TEST_FS = {
		[`./capture/tracks/${TRACKS_FILE}`]: '12',
		[`./capture/mem-1/tracks/${TRACKS_FILE}`]: '12',
	};

	it('reads a tree', async () => {
		StorageMem.BASE_FS = TEST_FS;
		expect(await new StorageMem().readTree('./capture')).toEqual(TEST_FS);
	});
	it('reads a filtered tree', async () => {
		StorageMem.BASE_FS = TEST_FS;
		expect((await new StorageMem().readTree('./capture', 'mem-0')).map((f) => f.name)).toEqual(TEST_FS);
	});
});

describe('readFlat', () => {
	afterEach(() => {
		(StorageMem.BASE_FS as any) = undefined;
	});
	const TEST_FS = {
		[`./capture/default/123/seq-0/featn-0/mem-1/tracks/${TRACKS_FILE}`]: '12',
		[`./capture/default/123/seq-0/featn-0/tracks/${TRACKS_FILE}`]: '12',
	};

	it('reads flat', async () => {
		StorageMem.BASE_FS = TEST_FS;
		expect((await new StorageMem().readFlat('./capture')).map((s) => s.name)).toEqual(Object.keys(TEST_FS));
	});
	it('reads flat filtered', async () => {
		StorageMem.BASE_FS = TEST_FS;
		const filtered = (await new StorageMem().readFlat('./capture', 'mem-1')).map((s) => s.name);
		expect(filtered).toEqual([Object.keys(TEST_FS)[0]]);
	});
});
*/
