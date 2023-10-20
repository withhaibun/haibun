import { WorkspaceContext } from '@haibun/core/build/lib/contexts.js'
import { IHasDomains, TNamed, TVStep, OK, AStepper, TFromDomain, TFileTypeDomain, IHasOptions, TExtraOptions, TFeatureResult, TOptions, TTag, TAnyFixme } from '@haibun/core/build/lib/defs.js';
import { TLogHistory } from '@haibun/core/build/lib/interfaces/logger.js';
import { stringOrError } from '@haibun/core/build/lib/util/index.js';

export type TTrackResult = { meta: { title: string, startTime: string, startOffset: number }, result: TFeatureResult };
export type TMissingTracks = { error: string };

export type TCoding = TAnyFixme;

export const STORAGE_LOCATION = 'STORAGE_LOCATION';
export const STORAGE_ITEM = 'STORAGE_ITEM';


export type TReviewLink = { link: string; title: string; date: string; results: { fail: number; success: number } }

export type TResolvePublishedReview = (link: string) => Promise<TReviewLink>;


export interface IGetPublishedReviews {
  getPublishedReviews: () => Promise<string[]>
}

export interface IWebReviewIndexer { getLatestPublished: TGetLatestPublished, resolvePublishedReview: TResolvePublishedReview, webContext: TWebContext }


export const storageLocation: TFileTypeDomain = {
  name: STORAGE_LOCATION, fileType: STORAGE_LOCATION, is: 'string', validate: (content: string) => {
    return undefined;
  }
};

// FIXME these belongs in domain-web
export type TWebContext = { [name: string]: string }
export type TGetLatestPublished = () => Promise<string[]>;

export interface IFile {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  created: number;
}

export interface ICreateStorageDestination {
  createStorageDestination(dest: string, params: TAnyFixme)
}

export const storageItem: TFromDomain = { name: STORAGE_ITEM, from: STORAGE_LOCATION, is: 'string' };

const DomainStorage = class DomainStorage extends AStepper implements IHasDomains, IHasOptions {
  domains = [
    storageLocation,
    storageItem,
  ];
  locator = (location: string) => `./${location}`;
  options = {
    BASE_DIRECTORY: {
      desc: 'base for file operations',
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
  js: 'text/javascript',
  javascript: 'text/javascript',
  css: 'text/css',
  html: 'text/html',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  ogg: 'audio/ogg',
  pdf: 'application/pdf',
  webm: 'video/webm',
  weba: 'audio/webm',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
}

export const enum EMediaTypes {
  html = 'html',
  video = 'video',
  json = 'json',
  image = 'image',
  javascript = 'js'
}

const MEDIA_TYPES: { [type: string]: string } = {
  html: 'text/html',
  json: 'json',
  video: 'video/mp4',
  js: 'javascript',
}

export type TMediaType = EMediaTypes;

export type TLocationOptions = {
  tag: TTag,
  options: TOptions,
  extraOptions: TExtraOptions,
  mediaType: TMediaType
}

export interface ITrackResults {
  writeTracksFile(loc: TLocationOptions, title: string, result: TFeatureResult, startTime: Date, startOffset: number, logHistory: TLogHistory[]): TAnyFixme;
}

/** 
 * Normalize the extension. This should probably be reconsidered.
 */
export function guessMediaExt(file: string) {
  const ext = getExtension(file);
  return MEDIA_TYPES[ext] || ext;
}

/**
 * Assign a mime type based on the extension  
 */
export function guessMediaType(file: string) {
  const ext = getExtension(file);
  const mediaType = MAPPED_MEDIA_TYPES[ext] || 'application/octet-stream';
  return <TMediaType>mediaType;
}

function getExtension(file: string) {
  return file.replace(/.*\./, '').toLowerCase();
}