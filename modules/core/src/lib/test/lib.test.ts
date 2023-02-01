import { asBasedFeatures, asFeatures } from "./lib.js";

describe('asFeatures', () => {
    it('should add base to path', () => {
        expect(asFeatures([{ path: '/b/c.feature', content: '#' }])).toEqual([{ path: '/b/c.feature', name: '/b/c', type: 'feature', content: '#' }]);
    });
});
describe('asBasedFeatures', () => {
    it('should add base to path', () => {
        expect(asBasedFeatures('/a', [{ path: '/b/c.feature', content: '#' }])).toEqual([{ path: '/a/b/c.feature', name: '/b/c', type: 'feature', content: '#' }]);
    });
});