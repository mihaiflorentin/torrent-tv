export interface FeaturePresence {
  abortController?: boolean;
}

export interface Capabilities {
  supportsAbortController: boolean;
}

export function detectCapabilities(features?: FeaturePresence): Capabilities {
  const runtimeSupportsAbortController = typeof AbortController === 'function';
  return { supportsAbortController: features?.abortController ?? runtimeSupportsAbortController };
}

/** Chromium builds before this major version run on the TV generations (2018-2020) whose GPUs cannot afford a blurred full-screen layer or eager artwork. */
export const LEAN_GRAPHICS_BELOW_CHROMIUM = 70;

/** True on an old TV engine, from its Chromium major; false when the engine is modern or does not say (the full look is the default). */
export function detectLeanGraphics(userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''): boolean {
  const match = /(?:Chrome|Chromium)\/(\d+)/.exec(userAgent);
  return match ? Number(match[1]) < LEAN_GRAPHICS_BELOW_CHROMIUM : false;
}

/** The root class the stylesheet keys its cheap path on: motion plays on capable engines and snaps on lean ones. */
export const LEAN_GRAPHICS_CLASS = 'lean-graphics';

/** Marks the document root as lean (an old TV engine) or clears the mark; call once before the first render. */
export function applyGraphicsClass(root: { classList: { toggle(name: string, force?: boolean): boolean } } = document.documentElement, userAgent?: string): boolean {
  const lean = detectLeanGraphics(userAgent);
  root.classList.toggle(LEAN_GRAPHICS_CLASS, lean);
  return lean;
}
