# The API trusts the household LAN by Origin and Host, not by client address alone

---
status: accepted (2026-10-15, amended 2026-10-15 to a LAN-open default); narrows the trust model that ADR-0005 extends
---

The server has no login and gates `/api/v1` on trusted CIDRs, and it answered every route with `Access-Control-Allow-Origin: *`. A browser on the household LAN therefore let any website call the API from the LAN address, including `PUT /api/v1/settings`, which sets `ffmpegPath` and `ffprobePath` to any absolute path that the server then executes. We keep the no-login, LAN-trusted model and stop treating "request came from a trusted address" as proof that the household meant it: the API now also checks the request's Origin, restricts cross-origin access to the LAN and the known clients, and keeps administration away from opaque and public origins. The server runs on the local network, so the default allows everything on it; strict allowlists exist for a public deployment.

- Host, default: no restriction. Any Host is accepted (IPs, mDNS names, router hostnames), so the server works under whatever name the LAN gives it. `TORRENT_TV_ALLOWED_HOSTS` (comma separated, unset by default), when set, is a strict Host allowlist and every other Host gets `403`. It is the public-deployment mode and the DNS-rebinding defence.
- Origin, client-facing endpoints, default: no `Origin` header passes (non-browser clients), as does the request's own origin, `null` (the Tizen and webOS packaged apps), `https://appassets.androidplatform.net` (Android TV WebView), and any http(s) origin whose host is `localhost`, a loopback, RFC1918 or link-local IP (including `::1`, `fc00::/7`, `fe80::/10`), or a single-label, `.local`, `.lan` or `.home.arpa` name. Other (public) origins get `403`. Allowed origins are echoed in `Access-Control-Allow-Origin` with `Vary: Origin`; the `*` wildcard is gone.
- Origin, `TORRENT_TV_ALLOWED_ORIGINS` set: the LAN default and the built-ins are switched off. Only absent, same-origin and the listed origins pass (list `null` and the Android origin if the packaged clients should keep working).
- Administration endpoints (`/api/v1/settings*`, `/api/v1/dependencies/*`, `/api/v1/updates/*`), default: `Origin` absent, same-origin, or a LAN origin. `null`, the Android asset origin and public origins are rejected. With `TORRENT_TV_ALLOWED_ORIGINS` set: absent or same-origin only. They are browser-only product features (`PRODUCT.md`), so no TV client loses access.
- `ffmpegPath` and `ffprobePath` must be absolute with a base name of `ffmpeg`/`ffprobe` (`.exe` on Windows). A value changed through the API must also name an existing executable regular file whose `-version` banner starts with `ffmpeg version`/`ffprobe version`. At startup a file-provided path with the wrong base name falls back to the default and logs a warning; the banner probe is not run at startup, so a stub that exists but is not ffmpeg is still tolerated there.

## Considered options

- **Keep `*` CORS and rely on the trusted CIDR** - rejected: the browser itself sits inside the trusted CIDR, so the check does not distinguish the household's own app from a page it happens to open.
- **Allowlist Host and Origin by default** - rejected (the first version of this ADR did this): the server runs on the household LAN under names nobody can enumerate (IP, mDNS, router DNS), and a default that returns `403` for them breaks working setups. The strict lists stay as opt-in environment variables.
- **Add authentication (token or login)** - rejected for now: it contradicts the appliance posture of ADR-0005 and needs a pairing flow on three TV platforms. Revisit if the server is ever exposed beyond the LAN.
- **Allowlist origins on every endpoint, with no admin tier** - rejected: packaged TV apps send `null` or a similar opaque origin, which a sandboxed iframe on any website also sends, so an origin allowlist alone cannot protect the endpoints that execute paths.
- **Remove the executable-path settings** - rejected: bare-metal installs need a custom ffmpeg location. Constraining the value keeps the setting.

## Consequences

- With no Host restriction, DNS rebinding is not blocked by default: a public page that rebinds its name to the server's LAN address is then same-origin from the browser's view and can use the whole API, including settings and the executable paths. The ffmpeg/ffprobe path constraints above are the remaining defence. This is accepted because the server is LAN-only and is never port-forwarded.
- A LAN-origin page (another device's web UI, a dev server on a private IP) can call the API from a browser on the LAN, including administration. This is the intended "everything on the local network works" behaviour.
- Public web origins cannot read or call the API from a browser that reaches the server by LAN address; `null` can reach client-facing endpoints only, which cannot change settings or executable paths.
- Anyone who exposes the server publicly should set `TORRENT_TV_ALLOWED_HOSTS` and `TORRENT_TV_ALLOWED_ORIGINS`, and should add authentication first (revisit the rejected option above).
- The packaged clients are allowed through `null` and the Android asset origin by default. Each client gets a smoke request against the server before release (not yet done on hardware).
