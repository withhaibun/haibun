import * as steps from './features';

describe('expandBackgrounds', () => {
  test('simple', async () => {
    const features = {
      f1: { feature: 'f1_step' },
    };
    const expected = { f1: { feature: 'f1_step' } };

    const res = await steps.expandBackgrounds(features);

    expect(res).toEqual(expected);
  });
  test('simple node', async () => {
    const features = {
      l1: { feature: 'l1f1_step' },
    };
    const expected = {
      l1: { feature: 'l1f1_step' },
    };
    const res = await steps.expandBackgrounds(features);

    expect(res).toEqual(expected);
  });
  test('expands node', async () => {
    const features = {
      l1: {
        l1f1: { feature: 'l1f1_step' },
      },
    };
    const expected = {
      l1: {
        l1f1: { feature: 'l1f1_step' },
      },
    };
    const res = await steps.expandBackgrounds(features);

    expect(res).toEqual(expected);
  });
  test('hierarchical', async () => {
    const features = {
      f1: { feature: 'f1_step' },
      l1: {
        l1f1: { feature: 'l1f1_step' },
      },
    };
    const expected = {
      f1: { feature: 'f1_step' },
      l1: {
        l1f1: { feature: 'f1_step\nl1f1_step' },
      },
    };
    const res = await steps.expandBackgrounds(features);

    expect(res).toEqual(expected);
  });
  test('multiple hierarchical', async () => {
    const features = {
      f1: { feature: 'f1_step' },
      l1: {
        l1f1: { feature: 'l1f1_step' },
      },
      l2: {
        l2f1: { feature: 'l2f1_step' },
      },
    };
    const expected = {
      f1: { feature: 'f1_step' },
      l1: {
        l1f1: { feature: 'f1_step\nl1f1_step' },
      },
      l2: {
        l2f1: { feature: 'f1_step\nl2f1_step' },
      },
    };
    const res = await steps.expandBackgrounds(features);

    expect(res).toEqual(expected);
  });
});

describe('find feature', () => {
  const features = {
    l0: { feature: 'l0_feature' },
    f1l1: {
      l1: { feature: 'l1_feature' },
    },
  };
  test('finds feature', () => {
    const res = steps.findFeature('l0', features);
    expect(res).toEqual({ feature: 'l0_feature' });
  });
  test('finds l1 feature', () => {
    const res = steps.findFeature('l1', features);
    expect(res).toEqual({ feature: 'l1_feature' });
  });
});

describe('expand features', () => {
  test('applies backgrounds', async () => {
    const features = {
      f1: { feature: ' includes b1' },
    };
    const backgrounds = {
      b1: { feature: 'result' },
    };
    const res = await steps.expandFeatures(features, backgrounds);
    expect(res).toEqual({ f1: { feature: 'result' } });
  });
  test('applies backgrounds hierarchical', async () => {
    const features = {
      l1: {
        f1: { feature: ' includes b1' },
      },
    };
    const backgrounds = {
      l1: {
        b1: { feature: 'result' },
      },
    };
    const res = await steps.expandFeatures(features, backgrounds);
    expect(res).toEqual({ l1: { f1: { feature: 'result' } } });
  });
});
