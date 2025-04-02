import { describe, it, expect } from 'vitest';
import * as TFileSystemJs from './workspace-lib.js';

describe('workspace', () => {
  it('finds workspace root', () => {
    expect(TFileSystemJs.workspaceRoot.endsWith('/haibun')).toBeTruthy();
  });
});

const rel = (pat) => pat.replace(`${TFileSystemJs.workspaceRoot}/`, '');

describe('getModuleLocation', () => {
  it('finds step module location', () => {
    expect(rel(TFileSystemJs.getModuleLocation('test'))).toBe('../../steps/test');
  });
  it('finds module location for scoped module', () => {
    expect(rel(TFileSystemJs.getModuleLocation('./src/test.js'))).toBe('src/test.js');
  });
  it('finds module location for scoped module with tilde', () => {
    expect(rel(TFileSystemJs.getModuleLocation('~@haibun/test'))).toBe('node_modules/@haibun/test');
  });
});
