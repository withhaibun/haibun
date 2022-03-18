import { CAPTURE } from '@haibun/core/build/lib/defs';
import { getDefaultWorld, getTestWorldWithOptions } from '@haibun/core/build/lib/test/lib';
import { EMediaTypes } from '@haibun/domain-storage';
import StorageFS from './storage-fs';

describe('getCaptureDir', () => {
    it('gets capture dir', async () => {
        const storageFS = new StorageFS();
        const { world } = getDefaultWorld(0);
        const dir = await storageFS.getCaptureDir({...world, mediaType: EMediaTypes.json}, 'test');
        expect(dir).toEqual(`./${CAPTURE}/default/loop-0/seq-0/featn-0/mem-0/test`);
    });
    it('gets options capture dir', async () => {
        const storageFS = new StorageFS();
        const world = getTestWorldWithOptions({ options: { DEST: 'foo' }, extraOptions: {} });
        const dir = await storageFS.getCaptureDir({...world, mediaType: EMediaTypes.json}, 'test');
        expect(dir).toEqual(`./${CAPTURE}/foo/loop-0/seq-0/featn-0/mem-0/test`);
    });
});