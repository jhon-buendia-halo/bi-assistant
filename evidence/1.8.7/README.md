# 1.8.7 — Restyle chat, visual panel, system logs and toasts (BA-148)

Web target, 2026-10-09, isolated compose project `qti-ba-141` on port 55433.

| Artifact | Shows |
|---|---|
| [e2e-results.txt](e2e-results.txt) | The full web suite: 44 passed, 2 skipped (desktop only). The web visual baseline `application-shell-web-linux.png` (regenerated in 1.8.3) still matches. |
| `session-chat-{light,dark}.png` | A streamed answer with "Data used" open, the composer (Careful / Deep analysis), the session list and the visual panel's empty state. |
| `system-logs-{light,dark}.png` | The system logs dialog over the dimmed app. |
| [check-specs.txt](check-specs.txt) | `python3 scripts/check-specs.py` passing after the spec sync. |

Unit tests: frontend `ng test` 89/90. Two `SessionChat` tests now assert token classes. The remaining failure (`App should support keyboard resizing`, 525 vs 548) also fails on unchanged `main`.

Fixed along the way:
- Toasts now sit in a "Notifications" region (`aria-live="polite"`) with a named "Dismiss notification" button.
- The cascade-layer order is declared first in `index.html`, so Angular's inlined critical CSS can't put `base` above `components`.

**Desktop not run:** the 2 desktop-only scenarios listed in [../1.8.5/README.md](../1.8.5/README.md). The desktop visual baseline (`-darwin.png`) is not regenerated.
