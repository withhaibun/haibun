import { FeatureExecutor } from '../phases/Executor.js';
import { asExpandedFeatures, getDefaultWorld, getTestEnv, testWithDefaults } from '../lib/test/lib.js';
import TestSteps from '../lib/test/TestSteps.js';
import Haibun from './haibun.js';
import { AStepper, IHasDomains, OK, } from '../lib/defs.js';
import { createSteppers } from '../lib/util/index.js';
import { Resolver } from '../phases/Resolver.js';
import Builder from '../phases/Builder.js';
import TestStepsWithOptions from '../lib/test/TestStepsWithOptions.js';

describe('prose', () => {
  it('finds prose', async () => {
    const { world, vstep, steppers } = await getTestEnv(['haibun'], 'A sentence.', getDefaultWorld(0).world);
    const res = await FeatureExecutor.doFeatureStep(steppers, vstep, world);

    expect(res.ok).toBe(true);
    expect(res.actionResults[0].name).toBe('prose');
  });
  it('mixed prose', async () => {
    const feature = {
      path: '/features/test.feature',
      content: `Haibun prose allows mixing text descriptions with a functional test.
When I have a test
Then it passes
Prose sections are indicated by the presence of punctuation at the end of paragraphs.`,
    };
    const result = await testWithDefaults([feature], [Haibun, TestSteps]);

    expect(result.ok).toBe(true);

    expect(result.results?.length).toBe(1);
  });
});


describe('forEvery', () => {
  class TestStepsWithDomains extends TestSteps implements IHasDomains {
    domains = [{ name: 'widget', fileType: 'widget', is: 'string', validate: () => undefined }];
    locator = (name: string) => name;
  }

  it('does not find afterEvery', async () => {
    const feature = { path: '/features/test.feature', content: `After every widget, Then the wtw` };
    const res = await testWithDefaults([feature], [TestStepsWithDomains, Haibun]);
    expect(res.ok).toBe(false);
    expect(res.failure.stage).toBe('Resolve');
  })
  it('finds afterEvery', async () => {
    const { world } = getDefaultWorld(0);
    const features = asExpandedFeatures([{ path: '/features/test.feature', content: `After every widget, passes` }]);
    const steppers = await createSteppers([TestStepsWithDomains, Haibun]);
    const builder = new Builder(steppers, world);
    const resolver = new Resolver(steppers, world, builder);
    const res = await resolver.resolveStepsFromFeatures(features);
    expect(res[0].vsteps.length).toBe(2);
  })
  it('finds afterEvery and passes', async () => {
    const feature = { path: '/features/test.feature', content: `After every widget, passes` };
    const res = await testWithDefaults([feature], [TestStepsWithDomains, Haibun]);
    expect(res.ok).toBe(true);
  })
  it('finds afterEvery and fails', async () => {
    const feature = { path: '/features/test.feature', content: `After every widget, fails` };
    const res = await testWithDefaults([feature], [TestStepsWithDomains, Haibun]);
    expect(res.ok).toBe(false);
    expect(res.failure.stage).toBe('Execute');
  })
  it('calls event', async () => {
    const feature = { path: '/features/test.feature', content: `After every widget, passes` };
    let s = 0;
    class TestSetsVar extends AStepper implements IHasDomains {
      domains = [{ name: 'widget', fileType: 'widget', is: 'string', validate: () => undefined }];
      locator = (name: string) => name;
      steps = {
        passes: {
          exact: 'passes',
          action: async () => {
            s = 2;
            return OK;
          }
        }
      }
    }
    const res = await testWithDefaults([feature], [TestSetsVar, Haibun]);
    expect(res.ok).toBe(true);
    expect(s).toBe(2);
  })
})