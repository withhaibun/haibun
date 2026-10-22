/** The files port a storage stepper keeps files through: a file system, or a volume in memory. */

/** A file or a directory as a storage lists it. */
export interface IFile {
	name: string;
	isDirectory: boolean;
	isFile: boolean;
	created: number;
	size: number;
}

/** The reads and writes a storage stepper makes of its files. */
export type TStorageFiles = {
	readFile(path: string, coding?: BufferEncoding): string | Buffer;
	rm(path: string): void;
	readdir(dir: string): Promise<string[]>;
	lstatToIFile(file: string): Promise<IFile>;
	writeFileBuffer(file: string, contents: Buffer): void;
	/** Writes a file only its owner reads, making its directory where it doesn't exist, and refuses a file that exists. */
	writePrivateFile(file: string, contents: string): void;
	mkdir(dir: string): void;
	mkdirp(dir: string): void;
	exists(path: string): boolean;
	/** Returns the path with each link in it followed. Throws where the path doesn't exist. */
	realpath(path: string): string;
};
