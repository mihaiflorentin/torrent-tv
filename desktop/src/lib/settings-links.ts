// Deep links from the start-blocking banners to the exact settings tab
// that renders each key: the shared form reads its initial tab from the
// URL hash on mount, so a click must land the user on the tab owning the
// fix. The same mapping serves every banner (missing required, defaults
// in use, refused start) so the GUI never disagrees about where a
// setting lives.
export const TAB_BY_KEY: Record<string, string> = {
  downloadRoot: 'storage',
  fileListUsername: 'tracker',
  fileListPasskey: 'tracker',
  listenAddress: 'server',
};

// Human button labels for the mappable keys — the click affordance is the
// label, never a bare camelCase identifier.
export const LABEL_BY_KEY: Record<string, string> = {
  downloadRoot: 'Download root',
  fileListUsername: 'FileList username',
  fileListPasskey: 'FileList passkey',
  listenAddress: 'Listen address',
};

// One click path for every deep link: the hash is replaced BEFORE the
// view switches — SettingsPage reads the hash once, on mount, so the
// ordering is load-bearing. With no callback (standalone page) the hash
// still moves and the switch degrades to a no-op.
export function openSettingsTab(onOpenSettings: (() => void) | undefined, tab?: string) {
  if (tab) history.replaceState(null, '', `#${tab}`);
  onOpenSettings?.();
}
