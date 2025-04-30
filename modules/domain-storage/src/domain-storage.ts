import { TModuleOptions, TBaseOptions } from '@haibun/core/build/lib/defs.js';
import { stringOrError } from '@haibun/core/build/lib/util/index.js';
import { TMediaType, MEDIA_TYPES, MAPPED_MEDIA_TYPES } from './media-types.js';
import { AStepper, IHasOptions } from '@haibun/core/build/lib/astepper.js';
import { TTag } from '@haibun/core/build/lib/ttag.js';

export const STORAGE_LOCATION = 'STORAGE_LOCATION';
export const STORAGE_ITEM = 'STORAGE_ITEM';

export interface IFile {
	name: string;
	isDirectory: boolean;
	isFile: boolean;
	created: number;
	size: number;
}

const DomainStorage = class DomainStorage extends AStepper implements IHasOptions {
	locator = (location: string) => `./${location}`;
	options = {
		BASE_DIRECTORY: {
			desc: 'base for file operations',
			parse: (input: string) => stringOrError(input),
		},
	};

	steps = {};
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
