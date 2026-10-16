import { Component, h } from 'preact';
import type { ComponentType, FunctionComponent } from 'preact';
import { useRef } from 'preact/hooks';

// Tiny local memo: preact/compat is not part of the bundle, and a D-pad press or an event-stream tick must not
// re-diff dozens of poster cards whose props did not change. Props are compared shallowly, by identity.
export function shallowEqual(a: object, b: object): boolean {
  if (a === b) return true;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) if (!Object.prototype.hasOwnProperty.call(right, key) || left[key] !== right[key]) return false;
  return true;
}

export function memo<P extends object>(component: FunctionComponent<P>, equal: (a: P, b: P) => boolean = shallowEqual): ComponentType<P> {
  class Memo extends Component<P> {
    shouldComponentUpdate(next: P) { return !equal(this.props, next); }
    render() { return h(component as FunctionComponent<P>, this.props); }
  }
  (Memo as { displayName?: string }).displayName = `Memo(${component.name || 'Component'})`;
  return Memo as unknown as ComponentType<P>;
}

/** A callback whose identity never changes but which always runs the latest closure, so memoized children keep their props. */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn);
  latest.current = fn;
  const stable = useRef<((...args: A) => R) | null>(null);
  if (!stable.current) stable.current = (...args: A) => latest.current(...args);
  return stable.current;
}
