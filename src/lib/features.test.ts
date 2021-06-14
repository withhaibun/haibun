import * as steps from './features';

describe('expandBackgrounds', () => {
  test('simple', async () => {
    const features = [{ path: '/f1', feature: 'f1_step' }];

    const res = await steps.expandBackgrounds(features);

    expect(res).toEqual(features);
  });
  test('hierarchical', async () => {
    const features = [
      { path: '/f1', feature: 'f1_step' },
      { path: '/f1/l1f1', feature: 'l1f1_step' },
    ];
    const expected = [
      { path: '/f1', feature: 'f1_step' },
      { path: '/f1/l1f1', feature: 'f1_step\nl1f1_step' },
    ];
    const res = await steps.expandBackgrounds(features);

    expect(res).toEqual(expected);
  });
  test('multiple hierarchical', async () => {
    const features = [
      { path: '/f1', feature: 'f1_step' },
      { path: '/l1/l1f1', feature: 'l1_step' },
      { path: '/l2/l2f1', feature: 'l2_step' },
    ];
    const expected = [
      { path: '/f1', feature: 'f1_step' },
      { path: '/l1/l1f1', feature: 'f1_step\nl1_step' },
      { path: '/l2/l2f1', feature: 'f1_step\nl2_step' },
    ];
    const res = await steps.expandBackgrounds(features);

    expect(res).toEqual(expected);
  });
});

describe('find feature', () => {
  const features = [
    { path: '/l0', feature: 'l0_feature' },
    { path: '/l0/l1', feature: 'l1_feature' },
  ];
  test('does not find partial feature', () => {
    const res = steps.findFeature('0', features);
    expect(res).toEqual([]);
  });
  test('finds feature', () => {
    const res = steps.findFeature('l0', features);
    expect(res).toEqual([{ path: '/l0', feature: 'l0_feature' }]);
  });
  test('finds l1 feature', () => {
    const res = steps.findFeature('l1', features);
    expect(res).toEqual([{ path: '/l0/l1', feature: 'l1_feature' }]);
  });
  test('finds multiple', () => {
    const res = steps.findFeature('l1', [...features, {path:'/l1/l1', feature: 'l1_l1_feature'}]);
    expect(res).toEqual([{ path: '/l0/l1', feature: 'l1_feature' }, {path:'/l1/l1', feature: 'l1_l1_feature'}]);
  });
});

describe('expand features', () => {
  test('applies backgrounds', async () => {
    const features = [{ path: '/f1', feature: 'Backgrounds: b1\nextant' }];
    const backgrounds = [{ path: '/b1', feature: 'result' }];
    const res = await steps.expandFeatures(features, backgrounds);
    
    expect(res).toEqual([{ path: '/f1', feature: '\nresult\n\nextant' }]);
  });
  test('applies backgrounds hierarchical', async () => {
    const features = [{ path: '/l1/f1', feature: 'Backgrounds: b2' }];
    const backgrounds = [
        {path: '/l1/b1',  feature: 'non-result' },
        {path: '/l2/b2',  feature: 'result' },
    ];
    const res = await steps.expandFeatures(features, backgrounds);
    expect(res).toEqual([{ path: '/l1/f1', feature: '\nresult\n' } ]);
  });
});
