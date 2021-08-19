import { BASE_TYPES, TWorld } from './defs';

export const isBaseType = (type: string) => BASE_TYPES.includes(type);
export const getStepShared = (type: string, world: TWorld) => {
  // FIXME hokey
  if (type === 'feature' || isBaseType(type)) {
    return world.shared;
  }
  const source = world.domains.find((d) => d.name === type);

  if (!source || !source.shared) {
    throw Error(`no shared for ${type}, ${source}}`);
  }
  return source.shared;
};
