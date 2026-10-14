# Server leases, trust boundary and hardening design

Date: 2026-10-14
Status: Draft, awaiting user review

## Problem

A read-only audit of `internal/` and `cmd/` found three correctness bugs in retention and the native engine, a trust-boundary gap on the HTTP API, secret leakage through error strings, and several smaller defects. `go vet` is clean apart from cgo warnings. Every item below was verified by reading the code; none was reproduced at runtime.

## Findings

### Correctness

1. **Stream lease is a boolean (ADR-0004 eviction protection).** `Acquire` sets the lease (`internal/application/service.go:2722-2725`, via `repo.SetLease`) and `Release` clears it and drops the error (`:2730-2734`). Every range request is its own Acquire/Release pair, so the first finisher clears protection while other streams are active. The general upsert also writes `leased=excluded.leased` from a row read earlier (`internal/adapters/sqlite/repository.go:779`), and `Downloads()` saves every row each poll (`service.go:2167`) as does `prepareManagedDownload` (`:2099`), so a live lease can be overwritten with `false`. Nothing resets leases at startup, so a crash mid-stream leaves `leased=1` and that download is protected from eviction and blocks removal (`service.go:2287`) until it is streamed again. `repo.SetLease` already exists as a targeted `UPDATE` (`repository.go:852-853`).
2. **Allocation admission is check-then-act.** `ensureAllocationRoom` (`service.go:1573`) runs before `engine.Add` (`:1605`); the only lock is per `releaseID:fileIndex`, so two `Prepare` calls for different releases can both pass against the same survey and overflow the cap that ADR-0004 says is rejected.
3. **One bad session entry disables the native engine.** `loadSession` returns on the first error (`internal/adapters/nativetorrent/client.go:224-270`) and `New` treats that as fatal (`:194-199`), so one stale selection index or failed `AddTorrent` aborts restore for every torrent after it.

### Trust boundary

4. **CORS `*` plus IP-only gating.** `corsAPI` sets `Access-Control-Allow-Origin: *` on every `/api/v1` route (`internal/adapters/httpapi/api.go:1414-1419`), and the only gate is the trusted-CIDR check on the client IP (`:1436-1458`), with no Host or Origin check. Any page open in a LAN browser can call the API from that browser's LAN address, including `PUT /api/v1/settings` (`api.go:189`). `ffmpegPath` and `ffprobePath` are validated only with `filepath.IsAbs` (`internal/platform/config/config.go:346`) and are then executed (`internal/adapters/mediaprobe/ffmpeg.go:31`, `:83`, `:113`; `api.go:1196`; `internal/adapters/httpapi/browserstream.go:35`). ADR-0005 accepts the LAN as trusted but not other websites acting from inside it.

### Secrets

5. **Credentials in error strings.** FileList's torrent download puts `passkey=` in the URL (`internal/adapters/filelist/client.go:124`) and returns the raw `outbound.Do` error (`:223-236`), a `*url.Error` that includes the full URL. TMDB does the same with `api_key=` (`internal/adapters/tmdb/client.go:127`). The errors reach job logs and API problem details.
6. **SubDL key crosses hosts on redirect.** `X-API-Key` is set at `internal/adapters/subtitles/providers.go:291`; Go strips only `Authorization`, `Www-Authenticate`, `Cookie`, `Cookie2` on cross-host redirects.

### Resource and lifecycle

7. **`event_journal` is never pruned.** `AppendEvent` runs on every `publish` (`repository.go:1129-1137`, `service.go:262-270`); `PruneJobLogs` handles only `job_logs` (`repository.go:1086-1092`, and its `perJob` argument is unused).
8. **Body leak on tail resume.** `completingAssetBody.Read` replaces `b.body` without closing the previous body (`internal/composition/container.go:667-671`), up to `maxAssetTailResumes` per download.
9. **Per-request prepare work.** Every `Acquire` runs `prepareManagedDownload` under the per-hash stream mutex (`service.go:2039-2052`), including a `session.setSelection` that rewrites `session.json` (`nativetorrent/client.go:621-625`). Listed for the lease work, which touches this function; broader optimization is out.
10. **Smaller verified defects.**
    - `browserStream` leaves ffmpeg blocked in `cmd.Wait()` when `copyFlush` fails and discards stderr (`api.go:1196-1212`).
    - `cmd/server/main.go:162-165` calls `os.Exit(1)` before deferred cleanup runs.
    - The SubDL search cache never evicts expired entries (`providers.go:133-138`, `:216`).
    - `acquireHashGate` blocks without honoring `ctx` (`nativetorrent/magnet.go:23-30`).
    - `Remove` runs `os.RemoveAll(filepath.Join(c.dataDir, hash))` with an unvalidated hash; an empty hash targets the data directory (`nativetorrent/client.go:752-754`).

## Decisions already made

- Q5: fix leases by refcounting in memory, updating the flag with a targeted statement, and resetting leases at startup.
- Q6: restrict CORS, validate Host, and constrain `ffmpegPath`/`ffprobePath`. This is a trust-model change and gets ADR-0012 (status proposed).
- Q7: strip secrets from outbound error strings.
- Q3: confirmed defects only. Perf work, the N+1 `Downloads()` poll, `Pieces()` cost, unbounded `sync.Map` keys and the media-info cache are out.

## Scope

In: items 1 to 8 and the five smaller defects in 10 that are one-line or local fixes (`browserStream` kill and log, `os.Exit` ordering, SubDL cache eviction, redirect header stripping, hash validation in `Remove`). The `acquireHashGate` context item and the engine-lock holding in `Add` are out unless a ticket finds them trivial.

Out: per-request prepare optimization beyond what the lease work touches, `Downloads()` N+1 writes, `Pieces()` cost, unbounded in-memory keys.

## Design

### Leases

- Add an in-memory lease table keyed by download id with a count. `Acquire` increments, `Release` decrements and clears the persisted flag only at zero. Retention and removal consult the table first and the persisted flag second.
- Remove `leased` from the `SaveDownload` upsert's `DO UPDATE SET` list so general saves can never touch it; the `INSERT` keeps the column default. Only `SetLease` writes it.
- On startup, before the service accepts requests, run `UPDATE downloads SET leased=0` and log the number of rows cleared.
- `Release` logs a `SetLease` error instead of dropping it, and a failed clear keeps the in-memory count authoritative.
- Concurrency: the table has its own mutex and no I/O under it.

### Admission

Serialize survey, reservation, `engine.Add` and row save behind one admission mutex in `Prepare`, held for the shortest span that covers the survey-to-save window. If holding it across `engine.Add` is too long, reserve the requested bytes in memory under the mutex and release the reservation after the row is saved or the add fails. The reservation counts against the Allocation for concurrent callers. Both satisfy the requirement that no interleaving can exceed the cap.

**Chosen: in-memory reservation.** `ensureAllocationRoom` takes `admissionMu` only for the survey, eviction and reservation, and counts `reservedBytes` as stored. The caller holds an `allocationReservation` and releases it by `defer` once the row is saved or the request fails. `engine.Add` and the metadata wait run outside the lock, so a slow add never stalls another stream's admission.

### Native session restore

`loadSession` logs and skips an entry that fails to parse, load or add, continues with the rest, and returns an error only for session-level failures (unreadable file). The log names the hash and the reason. Skipped entries stay in `session.json` so a transient failure heals on the next start.

### Trust boundary (see ADR-0012)

- Origin policy: same-origin requests pass. Cross-origin requests pass only if the `Origin` is on an allowlist built from the known clients (the Android WebView asset origin `https://appassets.androidplatform.net`, the Tizen and webOS packaged-app origins, and `null` where those packaged apps send it). The exact origin strings are measured from the packaged clients during implementation, not guessed.
- Endpoint tiers: administration endpoints (`/api/v1/settings` and any other write that TV clients do not use, per `PRODUCT.md`: provider credentials, dependency diagnostics, storage and network administration are browser-only) accept only same-origin requests. The client-facing endpoints keep the allowlist.
- Host validation: a request is rejected unless its Host is an IP literal inside a trusted CIDR, `localhost`, or a hostname on the server's configured list (default includes the advertised LAN name if one exists). This blocks DNS rebinding.
- `ffmpegPath` and `ffprobePath`: must be absolute, exist, be regular executable files, have a base name of `ffmpeg`/`ffprobe` (with `.exe` on Windows), and pass a `-version` probe whose first line starts with `ffmpeg version` or `ffprobe version`. Validation runs on save and at startup; a failure at startup falls back to the default resolution and logs.

### Secrets

Wrap outbound errors at the adapter boundary: unwrap `*url.Error` and return only the operation and underlying cause, never the URL. Apply to FileList and TMDB, and to any adapter that builds a query-string credential. Move TMDB's `api_key` into an `Authorization` header only if TMDB's API accepts it for the endpoints used; otherwise keep the query string and rely on the wrapping. For SubDL, disable cross-host redirects or strip `X-API-Key` in a `CheckRedirect` function.

### Resource fixes

- `event_journal`: prune by age with a floor on retained rows, run from the same schedule as `PruneJobLogs`. Fix the unused `perJob` argument or remove it.
- `completingAssetBody`: close the previous body before replacing it.
- SubDL cache: delete an expired entry on read and sweep at insert.
- `browserStream`: kill the process on copy error, capture stderr into the log.
- `main.go`: return from `main` through the deferred cleanup instead of calling `os.Exit` mid-function.
- `Remove`: reject an empty or malformed hash before building the path.

## Test strategy

Go tests next to the code:
- Leases: two overlapping Acquires and one Release keep the lease; a general `SaveDownload` after `SetLease(true)` does not clear it; startup reset clears stale leases and logs the count; removal and retention honor the table.
- Admission: two concurrent `Prepare` calls for different releases against a cap that fits one admit exactly one (run with `-race`).
- Session restore: a session with one bad entry between two good ones restores both good entries and reports the skipped one.
- Trust: table-driven handler tests for Origin and Host combinations (same-origin, allowlisted, `null`, foreign, rebinding Host, trusted CIDR IP Host), admin versus client endpoints, and preflight responses.
- Config validation: fake executables for the `-version` probe (accepted, wrong banner, missing, non-executable, relative path).
- Errors: an adapter test with an `httptest` server that fails and an assertion that the returned error text contains neither the passkey nor the API key.
- Journal: pruning keeps recent rows and removes old ones.
- Body leak: a fake body that records `Close` calls through a tail resume.

## Verification

Automated: `go vet ./...`, `go test -race ./...`. On the Pi (unverified here): a long stream with a second concurrent range request, then a forced restart mid-stream, then eviction pressure; TV clients (Tizen, Android, webOS) still reach the API after the CORS change. The origin strings and Host list are the part most likely to break a client, so each packaged client gets a smoke request against a build of the new server before the change ships. Mark all TV client checks unverified on hardware.

## Risks

- The origin allowlist can lock out a client whose origin string was guessed wrong. Mitigation: measure each client's real Origin and keep `null` allowed on the client-facing tier. `null` is also what a sandboxed iframe sends, so the admin tier (same-origin only) is what protects settings and executable paths.
- Host validation can block a household that reaches the server through a hostname nobody configured (for example a reverse proxy name). A settings field for extra allowed hostnames is part of the design.
- Removing `leased` from the upsert changes the repository contract; any other writer that relied on it must call `SetLease`.
- Holding an admission mutex across `engine.Add` can stall `Prepare` for slow adds.

## ADR and glossary impact

ADR-0012 records the CORS and Host trust change. ADR-0004 gains a note that a Stream lease is a refcount reset at startup. `GLOSSARY.md` gains Stream lease.
