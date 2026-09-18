# The download root is never a required-at-start setting; it is created and verified instead

---
status: accepted (2026-09-18); supersedes the download-root clause of the required-settings guard
---

A startup once crashed because the default download root was unwritable, and the
fix then treated any `downloadRoot` not explicitly provided by file or
environment as a missing required setting, refusing to start (`MissingRequired`).
That guard asked users for a value the UI already showed as set — the built-in
default — and refused GUI starts with "required settings missing: downloadRoot"
even though the only real question is whether the path is usable. The decision
now: `requiredKeys` shrinks to the FileList credentials (and those only gate
while `fileListEnabled` is on — a disabled tracker with empty credentials is a
valid setup), and the download root is handled at start by
`EnsureNativePathsWritable`: create the directory when missing, write-probe it,
and refuse with a labeled error ("cannot create download root <path>: …") only
when creation or the probe fails. This mirrors what the native engine itself
does at construction, so headless serve and the GUI supervisor fail identically
and never panic — the error surfaces in the GUI/web alert surfaces. Because a
default-valued root is now legitimate, `Store.DefaultsInUse` reports the keys
still at their built-in defaults (`downloadRoot`, `listenAddress`) so the
Settings page can nudge the operator to customize them without blocking
startup; every settings name in a GUI message deep-links to the tab that
renders it.

Considered options: keeping the refusal (safe but demands a value the user
cannot distinguish from "already set"), and demoting the default root to a
warning only without any writability check (reopens the original crash). The
chosen middle — auto-create, verify, refuse with a labeled error — keeps the
original protection while making the default path work untouched.
