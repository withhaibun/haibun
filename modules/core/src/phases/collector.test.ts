import { TFileSystem } from '../lib/util/index.js';
import { getFeaturesAndBackgrounds, shouldProcess } from './collector.js';

class MockFS {
    files: object;
    constructor(files: object) {
        this.files = files;
    }

    existsSync(where: string) {
        return !!this.files[where]
    }
    readFileSync(where: string) {
        const e = where.split('/');
        const h = e.slice(0, 3).join('/');
        return this.files[h][e[3]];
    }
    statSync(where: string) {
        return { isDirectory: () => !!this.files[where] }
    }
    readdirSync(where: string): string[] {
        return Object.keys(this.files[where] || {});
    }
}

const nfs = (files: object) => <TFileSystem>(new MockFS(files) as unknown);

describe('getFeaturesAndBackgrounds', () => {
    it('directory does not exist', async () => {
        expect(() => getFeaturesAndBackgrounds('/', [], { existsSync: () => false })).toThrow();
    });
    it('no features or backgrounds', async () => {
        expect(() => getFeaturesAndBackgrounds('/', [], { existsSync: () => true })).toThrow();
    });
    it('no features', async () => {
        expect(() => getFeaturesAndBackgrounds('/0', [], nfs({ '/0/backgrounds': { 'a.feature': '#' } }))).toThrow();
    });
    it('gets features', async () => {
        expect(getFeaturesAndBackgrounds('/0', [], nfs({ '/0/features': { 'a.feature': '#' } }))).toEqual({ features: [{ path: '/features/a.feature', name: '/0/features/a', type: 'feature', content: '#' }], backgrounds: [] });
    });
    it('gets features and backgrounds', async () => {
        expect(getFeaturesAndBackgrounds('/0', [], nfs({ '/0/features': { 'a.feature': '#' }, '/0/backgrounds': { 'a.feature': '#' } }))).toEqual({
            backgrounds: [{ path: '/backgrounds/a.feature', name: '/0/backgrounds/a', type: 'feature', content: '#' }]
            , features: [{ path: '/features/a.feature', name: '/0/features/a', type: 'feature', content: '#' }]
        });
    });

    it('multi-base no features or backgrounds', async () => {
        expect(() => getFeaturesAndBackgrounds('/,x', [], { existsSync: () => true })).toThrow();
    });
    it('multi-base gets features', async () => {
        expect(getFeaturesAndBackgrounds('/0,/1', [], nfs({ '/0/features': { 'a.feature': '#' }, '/1/features': { 'b.feature': '#' } }))).toEqual({
            features: [{ path: '/features/a.feature', name: '/0/features/a', type: 'feature', content: '#' }, { path: '/features/b.feature', name: '/1/features/b', type: 'feature', content: '#' }]
            , backgrounds: []
        });
    });
    it('multi-base no features', async () => {
        expect(() => getFeaturesAndBackgrounds('/0,/1', [], nfs({ '/0/backgrounds': { 'a.feature': '#' }, '/1/backgrounds': { 'a.feature': '#' } }))).toThrow();
    });
    it('multi-base no features or backgrounds from first dir', async () => {
        expect(() => getFeaturesAndBackgrounds('/0,/1', [], nfs({ '/1/backgrounds': { 'a.feature': '#' } }))).toThrow();
    });
    it('multi-base no features or backgrounds from second dir', async () => {
        expect(() => getFeaturesAndBackgrounds('/0,/1', [], nfs({ '/0/backgrounds': { 'a.feature': '#' } }))).toThrow();
    });
    it('multi-base get features and backgrounds', async () => {
        expect(getFeaturesAndBackgrounds('/0,/1', [], nfs({ '/0/backgrounds': { 'a.feature': '#' }, '/1/features': { 'b.feature': '#' } })))
            .toEqual({
                features: [{ path: '/features/b.feature', name: '/1/features/b', type: 'feature', content: '#' }, ],
                backgrounds: [{ path: '/backgrounds/a.feature', name: '/0/backgrounds/a', type: 'feature', content: '#' }, ]
            });
    });
});

describe('shouldProcess', () => {
    it('should process no type & filter', () => {
        expect(shouldProcess('hi.feature', undefined, undefined)).toBe(true);
    });
    it('should process matching filter', () => {
        expect(shouldProcess('hi.feature', undefined, ['hi'])).toBe(true);
    });
    it('should not process wrong type', () => {
        expect(shouldProcess('hi.feature', 'wrong', undefined)).toBe(false);
    });
    it('should not process wrong filter', () => {
        expect(shouldProcess('hi.feature', undefined, ['wrong'])).toBe(false);
    });
    it('should not process root filter', () => {
        expect(shouldProcess('/root/hi.feature', undefined, ['root'])).toBe(false);
    });
    it('should process upper root filter', () => {
        expect(shouldProcess('/root/root.feature', undefined, ['root'])).toBe(true);
    });
});
