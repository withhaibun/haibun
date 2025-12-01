import { describe, it, expect } from 'vitest';
import * as TFileSystemJs from './workspace-lib.js';

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('workspace', () => {
  it('finds workspace root', () => {
    const pkgPath = join(TFileSystemJs.workspaceRoot, 'package.json');
    expect(existsSync(pkgPath)).toBe(true);
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.name).toBe('haibun');
  });
});

const rel = (pat: string) => pat.replace(`${TFileSystemJs.workspaceRoot}/`, '');

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
