import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { scaffoldHaibun } from "./scaffold"

const TMPDIR = '/tmp/haibun-scaffold-test/';
const out = (...a: any[]) => undefined;

beforeEach(() => {
    rmSync(TMPDIR, { recursive: true, force: true });
    mkdirSync(TMPDIR);
});
afterAll(() => {
    rmSync(TMPDIR, { recursive: true, force: true });
});

describe('scaffold', () => {
    it('throws for empty directory', async () => {
        expect(() => scaffoldHaibun(TMPDIR, out)).toThrow();
    });
    it('creates from basic', async () => {
        const ppkg = require(path.join(process.cwd(), '..', '..', 'package.json'));

        writeFileSync(`${TMPDIR}/package.json`, JSON.stringify({ name: 'test' }));
        expect(() => scaffoldHaibun(TMPDIR, out)).not.toThrow();
        const pkg = JSON.parse(readFileSync(`${TMPDIR}/package.json`, 'utf-8'));
        expect(readdirSync(TMPDIR).sort()).toEqual(['package.json', 'src', 'tsconfig.json', 'jest.config.ts'].sort());
        expect(pkg.dependencies['@haibun/core']).toBeDefined();
        expect(pkg.devDependencies.jest).toEqual(ppkg.devDependencies.jest);
        expect(readdirSync(path.join(TMPDIR, 'src'))).toEqual(['lib', 'test-stepper.test.ts', 'test-stepper.ts']);
        expect(readdirSync(path.join(TMPDIR, 'src/lib'))).toEqual(['test.test.ts', 'test.ts']);
    });
});