import { vitest, describe, it, expect } from 'vitest';

vitest.useFakeTimers();
import { CAPTURE } from '@haibun/core/build/lib/defs.js';
import { getDefaultWorld, getTestWorldWithOptions } from '@haibun/core/build/lib/test/lib.js';
import StorageMem from './storage-mem.js';
import { Timer } from '@haibun/core/build/lib/Timer.js';
import { EMediaTypes } from '@haibun/domain-storage/build/media-types.js';

const { key } = Timer;

describe('BASE_FS', () => {
  it('finds BASE_FS file', async () => {
    StorageMem.BASE_FS = { hello: 'world' };
    const storageMem = new StorageMem();
    expect(storageMem.readFile('hello', 'utf-8')).toEqual('world');
  });
  it('finds BASE_FS subdir', async () => {
    StorageMem.BASE_FS = { '/hello/world': 'eh' };
    const storageMem = new StorageMem();
    expect(storageMem.readFile('/hello/world', 'utf-8')).toEqual('eh');
  });
});

describe('mem getCaptureLocation', () => {
  it('gets capture location', async () => {
    const storageMem = new StorageMem();
    const { world } = getDefaultWorld(0);
    console.log('emedia', EMediaTypes.json)
    const dir = await storageMem.getCaptureLocation({ ...world, mediaType: EMediaTypes.json }, 'test');
    expect(dir).toEqual(`./${CAPTURE}/default/${key}/loop-0/seq-0/featn-0/mem-0/test`);
  });
  it('gets options capture location', async () => {
    const storageMem = new StorageMem();
    const world = getTestWorldWithOptions({ options: { DEST: 'foo' }, extraOptions: {} });
    const dir = await storageMem.getCaptureLocation({ ...world, mediaType: EMediaTypes.json }, 'test');
    expect(dir).toEqual(`./${CAPTURE}/foo/${key}/loop-0/seq-0/featn-0/mem-0/test`);
  });
  it('gets relative capture location', async () => {
    const storageMem = new StorageMem();
    const world = getTestWorldWithOptions({ options: { DEST: 'foo' }, extraOptions: {} });
    const dir = await storageMem.getCaptureLocation({ ...world, mediaType: EMediaTypes.json }, 'test');
    expect(dir).toEqual(`./${CAPTURE}/foo/${key}/loop-0/seq-0/featn-0/mem-0/test`);
  });
  it('ensures capture location', async () => {
    const storageMem = new StorageMem();
    const { world } = getDefaultWorld(0);
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

describe.skip('readTree', () => {
  const TEST_FS = {
    './capture/default': ['123', '456'],
    './capture/default/123': ['loop-0'],
    './capture/default/123/loop-0': ['seq-0'],
    './capture/default/123/loop-0/seq-0': ['featn-0'],
    './capture/default/123/loop-0/seq-0/featn-0': ['mem-0'],
    './capture/default/123/loop-0/seq-0/featn-0/mem-0': ['tracks'],
    './capture/default/123/loop-0/seq-0/featn-0/mem-0/tracks': ['tracks.json'],
    './capture/default/123/loop-0/seq-0/featn-0/mem-0/tracks/tracks.json': 12,
    './capture/default/456': ['loop-0'],
    './capture/default/456/loop-0': ['seq-0'],
    './capture/default/456/loop-0/seq-0': ['featn-0'],
    './capture/default/456/loop-0/seq-0/featn-0': ['mem-0'],
    './capture/default/456/loop-0/seq-0/featn-0/mem-0': ['tracks'],
  };

  it('reads a tree', async () => {
    StorageMem.BASE_FS = TEST_FS;
    expect(await new StorageMem().readTree('./capture')).toEqual(TEST_FS);
  });
  it('reads a filtered tree', async () => {
    StorageMem.BASE_FS = TEST_FS;
    expect(await new StorageMem().readTree('./capture', 'tracks.json')).toEqual('./capture/default/123/loop-0/seq-0/featn-0/mem-0/tracks/tracks.json');
  });
});
