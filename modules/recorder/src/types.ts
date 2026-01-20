/**
 * Types for browser interaction recording
 */

export type TInteractionType = 'click' | 'input' | 'navigation' | 'keypress';

export interface TClickInteraction {
  type: 'click';
  tagName: string;
  text?: string;
  ariaLabel?: string;
  role?: string;
  name?: string;
  id?: string;
  href?: string;
  placeholder?: string;
}

export interface TInputInteraction {
  type: 'input';
  value: string;
  name?: string;
  placeholder?: string;
  label?: string;
  ariaLabel?: string;
  id?: string;
}

export interface TNavigationInteraction {
  type: 'navigation';
  url: string;
}

export interface TKeypressInteraction {
  type: 'keypress';
  key: string;
}

export type TInteraction =
  | TClickInteraction
  | TInputInteraction
  | TNavigationInteraction
  | TKeypressInteraction;

export interface TRecordedStep {
  timestamp: number;
  interaction: TInteraction;
  generatedStep: string;
}
