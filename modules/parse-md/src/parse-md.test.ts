import { TVStep } from '@haibun/core/build/lib/defs';
import { getDefaultWorld } from '@haibun/core/build/lib/TestSteps';
import ParseMD from './parse-md';

describe('parseMD', () => {
  const { world } = getDefaultWorld(0);
  const base = process.cwd() + '/test/conformance/';
  world.options.base = base;
  const pmd = new ParseMD(world);
  const res = pmd.steps.conformance;

  res.action({ where: `/${base}/input/input.html` }, {} as TVStep);
});
