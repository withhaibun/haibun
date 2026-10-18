/** The memory storage's composition root: the files of a volume in memory. */
import type { DirectoryJSON, IFs } from "memfs";
import type { TStorageFiles } from "@haibun/domain-storage/ports.js";
import { memoryFiles } from "./adapters/memory-files.js";

/** The files of a new volume in memory that holds `base`, and the volume. */
export const memoryStorage = (base: DirectoryJSON): TStorageFiles & { volume: IFs } => memoryFiles(base);
