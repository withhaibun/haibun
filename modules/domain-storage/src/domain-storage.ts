import type { TModuleOptions, TBaseOptions } from "@haibun/core/lib/world.js";
import { stringOrError } from "@haibun/core/lib/util/index.js";
import { AStepper, IHasOptions } from "@haibun/core/lib/astepper.js";
import { TTag } from "@haibun/core/lib/ttag.js";

export interface IFile {
	name: string;
	isDirectory: boolean;
	isFile: boolean;
	created: number;
	size: number;
}

const DomainStorage = class DomainStorage extends AStepper implements IHasOptions {
	description = "Storage domain types and file operations base";

	locator = (location: string) => `./${location}`;
	options = {
		BASE_DIRECTORY: {
			desc: "base for file operations",
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
};
