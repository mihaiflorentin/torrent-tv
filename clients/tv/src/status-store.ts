import { useEffect, useState } from 'preact/hooks';

// The status line ("Server connected", "A background job was updated.") changes on every event-stream tick.
// It lives outside App's state so a tick re-renders one small span, never the catalog tree, and a repeated
// message is a no-op.
export interface StatusStore { get(): string; set(value: string): void; subscribe(listener: () => void): () => void }

export function createStatusStore(initial = ''): StatusStore {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) { if (next === value) return; value = next; Array.from(listeners).forEach(listener => listener()); },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

export function useStatus(store: StatusStore | undefined, fallback = ''): string {
  const [value, setValue] = useState(() => store ? store.get() : fallback);
  useEffect(() => {
    if (!store) return;
    setValue(store.get());
    return store.subscribe(() => setValue(store.get()));
  }, [store]);
  return store ? value : fallback;
}
