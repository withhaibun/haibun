// Core types that replace the domain system, used in vars and modules like filesystem, web
export const WEB_PAGE = 'webpage';
export const WEB_CONTROL = 'webcontrol';
export const SELECTOR = 'selector';

// Basic type validation if needed
export type TValidator = (content: string) => string | undefined;

// Simple dependency system to replace IRequireDomains
export interface IDependencies {
  requires?: string[];
}

// Simplified context system to replace domain contexts
export interface ISharedContext {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  getCurrent(type: string): string;
}

// Type constants
export const BASE_TYPES = ['string', WEB_CONTROL, WEB_PAGE, SELECTOR];