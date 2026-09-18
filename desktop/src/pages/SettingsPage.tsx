import { useEffect, useState } from 'preact/hooks';
import { Settings } from '@torrent-tv/web/settings';
import { UpdateSection, type UpdateController } from '@torrent-tv/web/portal';
import { sharedApi } from '@torrent-tv/web/shared-api';
import type { Settings as SettingsRecord } from '../bindings/github.com/mihaiflorentin/torrent-tv/internal/platform/config/models';
import type { SchemaField, SettingsView } from '../bindings/github.com/mihaiflorentin/torrent-tv/internal/adapters/httpapi/models';
import {
  DefaultsInUse,
  LoadSettings,
  MissingRequired,
  RestartServer,
  SaveSettings,
  SettingsSchema,
} from '../bindings/github.com/mihaiflorentin/torrent-tv/internal/gui/bindings';
import { openExternal, usePortal, useServerState } from '../lib/state';
import { LABEL_BY_KEY, TAB_BY_KEY } from '../lib/settings-links';

// Settings page: the shared web Settings component with the bindings as the
// PRIMARY save transport (works while the server is stopped — that is the
// point). LoadSettings/SettingsSchema also come from the bindings; only the
// Test and Maintenance tabs still talk HTTP to the live server, so a stopped
// server gets the explanatory note inside those tabs. Nothing here gates the
// server: FileList credentials are advisory (the banner says what degrades),
// and the server auto-starts on launch Go-side.
//
// Portal parity with web: the Account tab exists only while the snapshot
// says accounts are enabled (an outage or a disabled server unmounts the
// whole group with zero trace; the stored settings are untouched), and the
// update section renders only while THIS embedded server is running — the
// controls must never pretend a stopped (or different) server is live.
export function SettingsPage({ updates }: { updates: UpdateController }) {
  const server = useServerState();
  const portal = usePortal();
  const [value, setValue] = useState<SettingsView | null>(null);
  const [fields, setFields] = useState<SchemaField[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [defaultsInUse, setDefaultsInUse] = useState<string[]>([]);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [restartRequired, setRestartRequired] = useState(false);
  // Bumped when a deep-link needs the shared component to remount so its
  // tab re-initializes from the URL hash.
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [view, schema, missingKeys, defaults] = await Promise.all([
          LoadSettings(),
          SettingsSchema(),
          MissingRequired().catch(() => []),
          DefaultsInUse().catch(() => []),
        ]);
        if (!alive) return;
        setValue(view);
        setFields(schema ?? []);
        setMissing(missingKeys ?? []);
        setDefaultsInUse(defaults ?? []);
      } catch (e) {
        if (alive) setLoadError((e as Error).message);
      }
    })();
    return () => { alive = false };
  }, []);

  // Primary transport: the save bar routes the submitted body through
  // SaveSettings (Go store: restart diff + auto-start). A thrown error takes
  // the component's normal error path (onError below). onSaved then only
  // syncs the local copy of the saved values.
  async function saveTransport(out: Record<string, unknown>) {
    // The shared form emits the fields it renders; the Go side JSON-decodes
    // the payload into config.Settings, so omitted keys fall back to the
    // stored file values — the cast marks that bridge contract.
    const result = await SaveSettings(out as unknown as SettingsRecord);
    setRestartRequired(result.restartRequired);
    setMissing(await MissingRequired().catch(() => []) ?? []);
    setDefaultsInUse(await DefaultsInUse().catch(() => []) ?? []);
    return result;
  }

  function onSaved(saved: Record<string, unknown>) {
    setSaveError('');
    setValue(current => (current ? { ...current, ...saved } as SettingsView : current));
  }

  function focusTab(tab: string) {
    // The shared component reads its initial tab from the URL hash.
    history.replaceState(null, '', `#${tab}`);
    setFormKey(key => key + 1);
  }

  async function restart() {
    setSaveError('');
    try {
      await RestartServer();
      setRestartRequired(false);
    } catch (e) {
      setSaveError((e as Error).message);
    }
  }

  // One-click fix from the warning card: persist the toggle without
  // touching anything else, then re-derive the advisories and remount the
  // form so its state matches the stored file.
  async function turnOffFileList() {
    if (!value) return;
    try {
      await SaveSettings({ ...value, fileListEnabled: false } as unknown as SettingsRecord);
      setValue(current => (current ? { ...current, fileListEnabled: false } as SettingsView : current));
      setMissing(await MissingRequired().catch(() => []) ?? []);
      setDefaultsInUse(await DefaultsInUse().catch(() => []) ?? []);
      setFormKey(key => key + 1);
    } catch (e) {
      setSaveError((e as Error).message);
    }
  }

  return (
    <section class="desktop-settings">
      {missing.length > 0 && (
        <div class="status-card status-card--warning" role="status">
          <p class="status-eyebrow">Needs attention</p>
          <p class="status-title">FileList is on, but its credentials are missing.</p>
          <p class="status-body">FileList searches fail until they are set. The server starts either way.</p>
          <div class="status-actions">
            {missing.map(key => (
              <button
                key={key}
                type="button"
                class="status-link"
                aria-label={`Open ${LABEL_BY_KEY[key] ?? key} setting`}
                onClick={() => focusTab(TAB_BY_KEY[key] ?? 'tracker')}
              >
                {LABEL_BY_KEY[key] ?? key}
              </button>
            ))}
            <button type="button" class="status-link" onClick={() => void turnOffFileList()}>
              Turn off FileList
            </button>
          </div>
        </div>
      )}
      {defaultsInUse.length > 0 && (
        <div class="status-card status-card--info" role="note">
          <p class="status-eyebrow">Defaults in use</p>
          <p class="status-title">{defaultsInUse.map(key => LABEL_BY_KEY[key] ?? key).join(defaultsInUse.length === 2 ? ' and ' : ', ')} {defaultsInUse.length === 1 ? 'is' : 'are'} still on the built-in default.</p>
          <div class="status-actions">
            {defaultsInUse.map(key => (
              <button
                key={key}
                type="button"
                class="status-link"
                aria-label={`Open ${LABEL_BY_KEY[key] ?? key} setting`}
                onClick={() => focusTab(TAB_BY_KEY[key] ?? 'server')}
              >
                {LABEL_BY_KEY[key] ?? key}
              </button>
            ))}
          </div>
        </div>
      )}
      {saveError && (
        <div class="status-card status-card--danger" role="alert">
          <p class="status-eyebrow">Save failed</p>
          <p class="status-title">{saveError}</p>
        </div>
      )}
      {restartRequired && (
        <div class="status-card status-card--info" role="status">
          <p class="status-eyebrow">Restart to apply</p>
          <p class="status-title">Settings saved. Core settings changed, so the server needs a restart.</p>
          <div class="status-actions">
            <button type="button" class="status-link" onClick={() => void restart()}>Restart the server</button>
          </div>
        </div>
      )}
      {loadError
        ? <div class="status-card status-card--danger" role="alert"><p class="status-eyebrow">Load failed</p><p class="status-title">Could not load settings: {loadError}</p></div>
        : value
          ? <Settings
            key={formKey}
            value={value as unknown as Record<string, unknown>}
            fields={fields}
            save={saveTransport}
            onSaved={onSaved}
            onError={message => setSaveError(message)}
            serverLive={server.state === 'running'}
            accountsEnabled={portal.snapshot?.accountsEnabled === true}
            updateSection={server.state === 'running' && portal.status
              ? <UpdateSection client={sharedApi()} status={portal.status} connected={portal.connected} failure={portal.failure} controller={updates} openExternal={openExternal} />
              : null}
          />
          : <p class="supporting">Loading settings…</p>}
    </section>
  );
}
