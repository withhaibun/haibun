import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { findHaibunWorkspace, loadBackgroundsFromPath } from './workspace-discovery.js';

describe('workspace-discovery', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'haibun-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  function createFiles(files: string[]) {
    for (const f of files) {
      const fullPath = path.join(tmpDir, f);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, '', 'utf8');
    }
  }

  function createDirs(dirs: string[]) {
    for (const d of dirs) {
      const fullPath = path.join(tmpDir, d);
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }

  describe('findHaibunWorkspace', () => {
    it('finds workspace from feature file in features/ folder', () => {
      createDirs(['project/features', 'project/backgrounds']);
      createFiles(['project/config.json']);
      // File doesn't strictly need to exist for this function normally, but let's be consistent
      createFiles(['project/features/test.feature']);

      const featurePath = path.join(tmpDir, 'project/features/test.feature');
      const result = findHaibunWorkspace(featurePath, fs);

      expect(result).not.toBeNull();
      expect(result!.base).toBe(path.join(tmpDir, 'project'));
      expect(result!.configPath).toBe(path.join(tmpDir, 'project/config.json'));
      expect(result!.backgroundsPath).toBe(path.join(tmpDir, 'project/backgrounds'));
    });

    it('finds workspace from nested features/ subfolder', () => {
      createDirs(['project/features/subfolder', 'project/backgrounds']);
      createFiles(['project/features/subfolder/test.feature']);

      const featurePath = path.join(tmpDir, 'project/features/subfolder/test.feature');
      const result = findHaibunWorkspace(featurePath, fs);

      expect(result).not.toBeNull();
      expect(result!.base).toBe(path.join(tmpDir, 'project'));
      expect(result!.backgroundsPath).toBe(path.join(tmpDir, 'project/backgrounds'));
    });

    it('returns null when no features/ parent found', () => {
      createFiles(['other/path/test.feature']);
      const featurePath = path.join(tmpDir, 'other/path/test.feature');

      const result = findHaibunWorkspace(featurePath, fs);
      expect(result).toBeNull();
    });

    it('handles missing config.json', () => {
      createDirs(['project/features', 'project/backgrounds']);
      createFiles(['project/features/test.feature']);

      const featurePath = path.join(tmpDir, 'project/features/test.feature');
      const result = findHaibunWorkspace(featurePath, fs);

      expect(result).not.toBeNull();
      expect(result!.configPath).toBeNull();
      expect(result!.backgroundsPath).toBe(path.join(tmpDir, 'project/backgrounds'));
    });

    it('handles missing backgrounds folder', () => {
      createDirs(['project/features']);
      createFiles(['project/config.json', 'project/features/test.feature']);

      const featurePath = path.join(tmpDir, 'project/features/test.feature');
      const result = findHaibunWorkspace(featurePath, fs);

      expect(result).not.toBeNull();
      expect(result!.configPath).toBe(path.join(tmpDir, 'project/config.json'));
      expect(result!.backgroundsPath).toBeNull();
    });

    it('finds workspace from background file', () => {
      createDirs(['project/features', 'project/backgrounds']);
      createFiles(['project/backgrounds/test.bg.feature']);
      createFiles(['project/features/placeholdertokeepdir.feature']);

      const bgPath = path.join(tmpDir, 'project/backgrounds/test.bg.feature');
      const result = findHaibunWorkspace(bgPath, fs);

      expect(result).not.toBeNull();
      expect(result!.base).toBe(path.join(tmpDir, 'project'));
    });
  });

  describe('loadBackgroundsFromPath', () => {
    it('loads background files from directory', async () => {
      const bgDir = 'project/backgrounds';
      const bgFile = path.join(bgDir, 'test.feature');
      createDirs([bgDir]);

      const fullPath = path.join(tmpDir, bgFile);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, 'set x to "y"', 'utf8');

      const backgrounds = await loadBackgroundsFromPath(path.join(tmpDir, bgDir), fs);

      expect(backgrounds).toHaveLength(1);
      expect(backgrounds[0].content).toBe('set x to "y"');
      expect(backgrounds[0].name).toBe('test');
    });

    it('returns empty array for non-existent path', async () => {
      const backgrounds = await loadBackgroundsFromPath(path.join(tmpDir, 'nonexistent'), fs);
      expect(backgrounds).toHaveLength(0);
    });
  });
});
