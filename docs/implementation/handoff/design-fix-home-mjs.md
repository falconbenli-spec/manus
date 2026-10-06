# design-fix-home-mjs — fixer handoff

File touched: `app/home.mjs` only. (This handoff file is the only other file written.)

## Defect
Hero (`a.sig-eye` / `p.sig-census`, fed by `/api/inbox/count`) said «13 بانتظار قرارك» while the home tile «ما ينتظر قراري» said 0 and its block said «لا شيء ينتظر قرارك الآن.» — all three link to `#inbox`.

Verified by reading the code, and reproduced on an in-memory DB (`seed` + the four demo seeds that `tests/inbox.test.mjs` uses): before the change `inbox(db,manager).total` = 10 while the `decisions` card = 0. Cause: `home.mjs` counted only workflow requests with `needs_me`; `inbox.mjs` aggregates every screen.

## What was done
- `home.mjs` now imports `inbox` from `./inbox.mjs` (no import cycle: `inbox.mjs` does not import `home.mjs`) and reads it with the user's own identity.
- Card `decisions` value = request decisions + the items of every non-request inbox group. For every non-admin role this equals `inbox.total` exactly (the inbox `requests` group is the same `needs_me` filter). `inbox()` is called directly, not the 20-second `inboxCount` cache, so the tile can never be staler than the list under it.
- The sentence «لا شيء ينتظر قرارك الآن.» lives in `app/static/home-ui.mjs`, which is frozen for me. So instead of changing the sentence, `home.decisions` now carries, after the request rows, one row per inbox group that has waiting decisions: title = the screen name, `service_name` = «N بانتظار قرارك في هذه الشاشة», `status_name` = up to three distinct action labels, `age_days` = the oldest item in the group, `link` = the group's own screen. The existing `decisionRow` renders it without a UI change, so the block is only empty when the inbox is empty.
- `manager.pending_approvals`, `manager.oldest_approval` and the `pending_approvals` card remain request-only (unchanged semantics, asserted by `tests/home.test.mjs`).

## Not done / known limits
- If every item in a group has no recorded date, the group row shows «منذ 0 يوم» (the frozen UI row always prints the age). Not seen in the demo data (all ages were real numbers); a proper fix needs `home-ui.mjs`.
- Admin: `inbox.mjs` skips workflow requests for admin. If an admin ever has `needs_me` requests, the tile counts them (it matches its own list) and would exceed the hero number by that amount. Not observed in seeds (admin: inbox 2, card 2).
- `/api/home` now walks the inbox sources on each load (measured 16–46 ms per user on the demo-seeded in-memory DB).
- Not run in a browser; no screenshot taken. Port 3600 and `work/` untouched. No commit.

## Checks run (literal results)
- `node --check app/home.mjs` → OK.
- `node --test tests/home.test.mjs tests/security-hr-documents.test.mjs tests/inbox.test.mjs` → tests 10, pass 10, fail 0. (The first two are the only tests that import `app/home.mjs`.)
- Probe on demo-seeded in-memory DB after the change — `inbox.total` / card / rows: manager 10/10/5, hr 5/5/3, outsider 2/2/1, admin 2/2/1, employee 0/0/0, it 0/0/0, external 0/0/0. Rendered block through `homeUI.render`: five `<li>` rows, no `style=` attribute in the output.
- Full test suite: NOT run.
