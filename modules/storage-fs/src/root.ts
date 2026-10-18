/** The file system storage's composition root: the files of the file system. */
import type { TStorageFiles } from "@haibun/domain-storage/ports.js";
import { fileSystemFiles } from "./adapters/file-system.js";

export const fileSystemStorage = (): TStorageFiles => fileSystemFiles;
