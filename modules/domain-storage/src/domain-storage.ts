import { TNamed, TFeatureStep, OK, AStepper, IHasOptions, TModuleOptions, TFeatureResult, TBaseOptions, TTag, TAnyFixme } from '@haibun/core/build/lib/defs.js';
import { stringOrError } from '@haibun/core/build/lib/util/index.js';
import { TMediaType, MEDIA_TYPES, MAPPED_MEDIA_TYPES } from './media-types.js';

export type TTrackResult = { meta: { title: string; startTime: string; startOffset: number }; result: TFeatureResult };
export type TMissingTracks = { error: string };

export type TCoding = TAnyFixme;

export const STORAGE_LOCATION = 'STORAGE_LOCATION';
export const STORAGE_ITEM = 'STORAGE_ITEM';

export type TPathed = {
	pathed: string;
};

export function isPathed(path: TPathedOrString): path is TPathed {
	return (<TPathed>path).pathed !== undefined;
}

export function actualPath(path: TPathedOrString): string {
	return isPathed(path) ? path.pathed : path;
}

export type TPathedOrString = TPathed | string;

export type TReviewLink = { link: string; title: string; date: string; results: { fail: number; success: number } };

export type TResolvePublishedReview = (link: string) => Promise<TReviewLink>;

export interface IGetPublishedReviews {
	getPublishedReviews: () => Promise<string[]>;
	endpoint: (path: string) => string;
}

export interface IWebReviewIndexer {
	getLatestPublished: TGetLatestPublished;
	resolvePublishedReview: TResolvePublishedReview;
	webContext: TWebContext;
}

// FIXME these belongs in domain-web
export type TWebContext = { [name: string]: string };
export type TGetLatestPublished = () => Promise<string[]>;

export interface IFile {
	name: string;
	isDirectory: boolean;
	isFile: boolean;
	created: number;
	size: number;
}

export interface ICreateStorageDestination {
	createStorageDestination(dest: string, params: TAnyFixme);
}

const DomainStorage = class DomainStorage extends AStepper implements IHasOptions {
	locator = (location: string) => `./${location}`;
	options = {
		BASE_DIRECTORY: {
			desc: 'base for file operations',
			parse: (input: string) => stringOrError(input),
		},
	};

	steps = {
		aLocation: {
			gwta: `a ${STORAGE_LOCATION} at {where}`,
			action: async ({ where }: TNamed, featureStep: TFeatureStep) => {
				return OK;
			},
		},
		anItem: {
			gwta: `A ${STORAGE_ITEM} {name}`,
			action: async ({ name }: TNamed) => {
				return OK;
			},
		},
	};
};

export default DomainStorage;

export type TLocationOptions = {
	tag: TTag;
	options: TBaseOptions;
	moduleOptions: TModuleOptions;
	mediaType: TMediaType;
};

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
