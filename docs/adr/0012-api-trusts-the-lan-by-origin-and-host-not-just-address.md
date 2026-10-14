# The API trusts the household LAN by Origin and Host, not by client address alone

---
status: proposed (2026-10-14); narrows the trust model that ADR-0005 extends
---

The server has no login and gates `/api/v1` on trusted CIDRs, and it answered every route with `Access-Control-Allow-Origin: *`. A browser on the household LAN therefore let any website call the API from the LAN address, including `PUT /api/v1/settings`, which sets `ffmpegPath` and `ffprobePath` to any absolute path that the server then executes. We keep the no-login, LAN-trusted model and stop treating "request came from a trusted address" as proof that the household meant it: the API now also checks the request's Host, restricts cross-origin access to the known clients, and limits administration to same-origin requests.

- Host: accepted only when it is an IP literal inside a trusted CIDR, `localhost`, or a hostname on the configured list. This blocks DNS rebinding.
- Origin: same-origin requests pass. Cross-origin requests pass only from an allowlist of the packaged clients (Android WebView asset origin, the Tizen and webOS app origins, and `null` where those apps send it), and only on client-facing endpoints.
- Administration endpoints (settings, provider credentials, dependency and storage administration) accept same-origin requests only. They are browser-only products features already (`PRODUCT.md`), so no TV client loses access.
- `ffmpegPath` and `ffprobePath` must name an existing executable regular file whose base name is `ffmpeg`/`ffprobe` and whose `-version` banner matches.

## Considered options

- **Keep `*` CORS and rely on the trusted CIDR** - rejected: the browser itself sits inside the trusted CIDR, so the check does not distinguish the household's own app from a page it happens to open.
- **Add authentication (token or login)** - rejected for now: it contradicts the appliance posture of ADR-0005 and needs a pairing flow on three TV platforms. Revisit if the server is ever exposed beyond the LAN.
- **Allowlist origins on every endpoint, with no admin tier** - rejected: packaged TV apps send `null` or a similar opaque origin, which a sandboxed iframe on any website also sends, so an origin allowlist alone cannot protect the endpoints that execute paths.
- **Remove the executable-path settings** - rejected: bare-metal installs need a custom ffmpeg location. Constraining the value keeps the setting.

## Consequences

- The exact origin strings of the packaged clients must be measured and kept in the allowlist; a client whose origin changes (for example a new WebView host) loses API access until the list is updated. Each client gets a smoke request against the server before release.
- A household that reaches the server through a reverse proxy name or a new hostname must add it to the Host list, or requests are rejected with `403`.
- Client-facing endpoints still accept `null`-origin requests, so a malicious page that knows the server address can still reach them from inside the LAN. The protection is that those endpoints cannot change settings or executable paths.
- The server is still never port-forwarded; this change reduces what a LAN browser can be made to do, it does not make exposure beyond the LAN safe.
