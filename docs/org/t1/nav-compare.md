# ت1 — القائمة الجانبية قبل وبعد

Before: shell at `37cef8b`. After: working tree (2026-09-26). Both measured by `scripts/org-nav-measure.mjs` on a read-only copy of the M0 backup (sha256 `cbaa2d416c5a169cb65cb6416b3bc2c13e2cb7f6656b471eba2b40cd3fbaa115`, unchanged before and after each run).

One row per distinct old menu (role + identical entry set, as in the T0 inventory). "Before" is the old sidebar (= reach). "After" is the visible sidebar entries in the new shell, excluding the hidden «كل شاشاتك» block, min–max across the menu's accounts. Reach after must contain every key reached before.

| # | Role | Departments | Accounts | Before | After (sidebar) | Budget | Within budget | ≤12 | Reach before | Reach after | Reach ⊇ before |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | admin | ops | 1 | 69 | 8 | 9 | yes | yes | 69 | 69 | yes |
| 2 | employee | ops | 2 | 32 | 7 | 8 | yes | yes | 32 | 33 | yes |
| 3 | employee | creative | 1 | 31 | 8 | 8 | yes | yes | 31 | 32 | yes |
| 4 | employee | creative | 1 | 47 | 8 | 8 | yes | yes | 47 | 48 | yes |
| 5 | hr | hr | 1 | 68 | 8 | 8 | yes | yes | 68 | 68 | yes |
| 6 | it | it | 1 | 50 | 8 | 8 | yes | yes | 50 | 50 | yes |
| 7 | manager | creative, brand, campaigns-audit, ceo-office, comms, it, marketing, pr, production | 12 | 71 | 9 | 9 | yes | yes | 71 | 71 | yes |
| 8 | manager | grc, procurement | 2 | 72 | 9 | 9 | yes | yes | 72 | 72 | yes |
| 9 | manager | epmo | 1 | 78 | 9 | 9 | yes | yes | 78 | 78 | yes |
| 10 | manager | business-dev | 1 | 79 | 9 | 9 | yes | yes | 79 | 79 | yes |
| 11 | manager | accounts | 1 | 80 | 9 | 9 | yes | yes | 80 | 80 | yes |
| 12 | manager | ceo-office | 1 | 85 | 9 | 9 | yes | yes | 85 | 85 | yes |
| 13 | manager | finance | 1 | 96 | 9 | 9 | yes | yes | 96 | 96 | yes |
| 14 | manager | hr | 1 | 127 | 9 | 9 | yes | yes | 127 | 127 | yes |
| 15 | pm | creative | 1 | 66 | 8 | 8 | yes | yes | 66 | 66 | yes |

Accounts: 28 before, 28 after. Old menus with «أخرى»: 28 accounts before, 0 after. Within budget: 15/15 menus. ≤12: 15/15. Reach kept: 15/15.

Three accounts carry `must_change_password`; both runs measure the menu they get after changing it. Account identifiers are role ids; no personal names.
