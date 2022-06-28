import { WorkspaceContext } from '@haibun/core/build/lib/contexts';
import { IHasDomains, TNamed, TVStep, OK, AStepper, TFromDomain, TFileTypeDomain, IHasOptions, TExtraOptions, TFeatureResult, TOptions, TTag, TWorld } from '@haibun/core/build/lib/defs';
import { stringOrError } from '@haibun/core/build/lib/util';

export type TTrackResult = { meta: { title: string, startTime: string, startOffset: number }, result: TFeatureResult };
export type TMissingTracks = { error: string };

export const STORAGE_LOCATION = 'STORAGE_LOCATION';
export const STORAGE_ITEM = 'STORAGE_ITEM';

export const storageLocation: TFileTypeDomain = {
  name: STORAGE_LOCATION, fileType: STORAGE_LOCATION, is: 'string', validate: (content: string) => {
    return undefined;
  }
};

export interface ICreateStorageDestination {
  createStorageDestination(dest: string, params: any)
}

export const storageItem: TFromDomain = { name: STORAGE_ITEM, from: STORAGE_LOCATION, is: 'string' };

const DomainStorage = class DomainStorage extends AStepper implements IHasDomains, IHasOptions {
  domains = [
    storageLocation,
    storageItem,
  ];
  locator = (location: string) => `http://localhost:8123/${location}`;
  options = {
    BASE_DIRECTORY: {
      desc: 'run browsers without a window (true or false)',
      parse: (input: string) => stringOrError(input)
    }
  }
  steps = {
    aLocation: {
      gwta: `a ${STORAGE_LOCATION} at {where}`,
      action: async ({ where }: TNamed, vstep: TVStep) => {
        const location = vstep.source.name;
        return OK;
      },
    },
    anItem: {
      gwta: `A ${STORAGE_ITEM} {name}`,
      action: async ({ name }: TNamed) => {
        return OK;
      },
      build: async ({ name }: TNamed, a: TVStep, workspace: WorkspaceContext) => {
        workspace.getBuilder().addControl(name);
        return { ...OK };
      },
    },
  };
};

export default DomainStorage;

const MAPPED_MEDIA_TYPES = {
  webm: 'video'
}

const MEDIA_TYPES: { [type: string]: string } = {
  html: 'text/html',
  json: 'json',
  'video': 'video/mp4'
}


export const enum EMediaTypes {
  html = 'html',
  video = 'video',
  json = 'json',
  image = 'image'
}

export type TMediaType = EMediaTypes;

export type TLocationOptions = {
  tag: TTag,
  options: TOptions,
  extraOptions: TExtraOptions,
  mediaType: TMediaType
}

export interface ITrackResults {
  writeTracksFile(loc: TLocationOptions, title: string, result: TFeatureResult, startTime: Date, startOffset: number): any;
}

export interface IReviewResult {
  writeReview(loc: TLocationOptions, result: TTrackResult | TMissingTracks, allStartTime: number): any;
}

export interface IPublishResults {
  publishResults(world: TWorld): any;
}

export function guessMediaExt(file: string) {
  const ext = file.replace(/.*\./, '').toLowerCase();
  return MAPPED_MEDIA_TYPES[ext] || ext;
}

export function guessMediaType(file: string) {
  const ext = guessMediaExt(file);
  const mediaType = MEDIA_TYPES[ext] || ext.toUpperCase().replace(/[^A-Z]/g, '');
  return <TMediaType>mediaType;
}
