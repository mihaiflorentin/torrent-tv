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

/** A television's browser: Samsung Tizen, LG webOS or an Android TV WebView. Measured on a 2023 Samsung (Tizen 9, Chromium 120),
    a modern TV engine still stalls 300-1000 ms per frame under a blurred full-screen layer and focus motion, so every TV takes the lean path. */
const TV_USER_AGENT = /SMART-TV|SmartTV|Tizen|Web0S|webOS|NetCast|Android TV|; wv\)/i;

/** True on a TV engine (any version) or an old Chromium; false on a desktop or phone browser and when the engine does not say (the full look is the default). */
export function detectLeanGraphics(userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''): boolean {
  if (TV_USER_AGENT.test(userAgent)) return true;
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
