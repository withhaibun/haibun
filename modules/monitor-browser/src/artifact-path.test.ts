import { describe, it, expect } from 'vitest';

/**
 * Tests for artifact path transformation used in serialized HTML reports.
 * The regex converts baseRelativePath (featn-N[-slug]/subpath/file.ext) 
 * to featureRelativePath (./subpath/file.ext).
 */
describe('artifact path transformation', () => {
  // This regex matches the one in index.ts
  const transformPath = (artifactPath: string): string => {
    const match = artifactPath.match(/^featn-\d+(?:-[^/]*)?\/(.*)/);
    if (match) {
      return './' + match[1];
    }
    if (artifactPath.startsWith('./')) {
      return artifactPath;
    }
    return './' + artifactPath;
  };

  it('transforms simple featn path', () => {
    expect(transformPath('featn-0/image/test.png')).toBe('./image/test.png');
  });

  it('transforms featn path with slug', () => {
    expect(transformPath('featn-1-a11y-pass/html/report.html')).toBe('./html/report.html');
  });

  it('transforms featn path with complex slug', () => {
    expect(transformPath('featn-2-my-test-feature/video/recording.webm')).toBe('./video/recording.webm');
  });

  it('transforms featn path without subpath', () => {
    expect(transformPath('featn-0/file.png')).toBe('./file.png');
  });

  it('preserves paths already starting with ./', () => {
    expect(transformPath('./image/test.png')).toBe('./image/test.png');
  });

  it('adds ./ to paths without featn prefix', () => {
    expect(transformPath('image/test.png')).toBe('./image/test.png');
  });

  it('handles deeply nested paths', () => {
    expect(transformPath('featn-0-feature/a/b/c/file.txt')).toBe('./a/b/c/file.txt');
  });
});
