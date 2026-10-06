# The executive scope path — EPMO stage 2

Branch `stage2/executive-scope`, from `integration-20260920` at `a6cff5d`. Nothing pushed, `.env` untouched, the live database untouched, no applied migration edited. **No migration in this stage.** `app/report-figures.mjs` (built in parallel by another agent) was neither created nor touched.

---

## 1. The defect, stated as it was found

A chief executive who is not a member of a project cannot see it.

- `axesBoard` in `app/project-axes.mjs` reads `projects` through `JOIN project_members m ON m.project_id=p.id … AND m.user_id=?`.
- `pipelineBoard` in `app/pipeline-estimates.mjs` reads opportunities through `seller()` → `memberClients()`, i.e. only the client accounts the reader sits on the team of.

Neither had any `executive.view` branch. The most senior reader in the company therefore opened the portfolio board and the funnel and saw **nothing** — not "you are not permitted", but an empty company.

This is not a new privilege. `app/reports-more.mjs` already widens from membership to tenant scope on `exec(db,u)`:

- **R11** «تقدم المشاريع ومهامها» — `const all=exec(db,u)` drops the `EXISTS(SELECT 1 FROM project_members …)` clause.
- **R14** «ساعات العمل حسب المشروع» — the same `all` flag drops the `t.user_id=? OR manager_id=?` clause.

Stage 2 gives the board the branch its report-layer twins already have. The capability is the existing `executive.view`; no capability was invented.

## 2. What was built — two new functions, each with its own gate

### `executiveAxesBoard(db, supplied)` — `app/project-axes.mjs`

```js
export function executiveAxesBoard(db, supplied)
// → { environment, today, user_id, definitions, legacy_status, phases, work_package_statuses,
//     scope:'tenant', capability:'executive.view', projects:[{id,name,axes:{…8…}}], note }
```

Gated on `can(db,u,'executive.view')` → `403 not_permitted` otherwise. The same projection as `axesBoard`, without the `project_members` join.

The seam the brief named was real and was used: the nine calculators (`readinessAxis`, `executionAxis`, `acceptanceAxis`, `invoicingAxis`, `collectionAxis`, `supplierSettlementAxis`, `closureAxis`, `technicalOutstanding`, `financialOutstanding`) all take a **raw project row**, not a user. So the projection was lifted into one shared `axesRow(db, project)` and one `boardShell(u, projects, note, extra)`; both boards call them. There are not two projections that can drift.

**`axesBoard` is unchanged in behaviour and in shape.** It is not flagged, and no field was added to its output — `AXIS_STATE_NAMES` is exported as its own constant rather than folded into `AXES` or into the board payload, precisely so the existing payload stays byte-for-byte what it was.

### `portfolioForecast(db, supplied, {from, to})` — `app/pipeline-estimates.mjs`

```js
export function portfolioForecast(db, supplied, {from, to} = {})
// → { environment, today, from, to, user_id, scope:'tenant', capability:'executive.view',
//     warning:FORECAST_WARNING,
//     open_count, open_value_minor, weighted_minor, unweighted_count,
//     by_stage:[{code,name,sort_order,win_probability_bp,probability_basis,confirmed_on,
//                count,value_minor,weighted_minor}],
//     closed:{won_count,lost_count,won_value_minor,lost_value_minor,
//             win_rate_count_bp,win_rate_value_bp},
//     loss_reasons:[{code,name,count,value_minor}], note }
```

Gated on `executive.view` → `403 not_permitted` otherwise. Defaults: `to` = today (Riyadh), `from` = 365 days back — the same window `pipelineBoard` uses. `to < from` → `400 date_order`.

**`seller()` in `app/pipeline-shared.mjs` was not touched.** It guards `prepareStage`, `stageAction`, `addLossReason`, `lossReasonAction`, `createOpportunity` and `opportunityAction` as well; widening it would have widened writes. The read path was widened by adding a second function beside it, not by loosening the shared guard.

**Aggregates only — and the guarantee is structural, not a promise in a comment.** The query is:

```sql
SELECT stage_code, status, value_minor, loss_reason_id, closed_on FROM opportunities WHERE tenant_id=?
```

Five columns. `name`, `client_id`, `owner_id`, `next_step`, `decision_maker`, `budget_note` and `loss_comment` never leave the database on this path, so no later edit to the shape can leak one by accident. `opportunityView` — which joins client, owner, activities and the loss comment — is not called. Stage names, stage probability bases and loss-reason names **are** returned: those are configuration the action owner entered for the company, not deal data.

`win_rate_count_bp` and `win_rate_value_bp` are `null` when nothing closed in the window, never `0` — a zero would read as "we lost everything".

## 3. Where the fix surfaces

`executiveOverview` in `app/workspace.mjs` now carries a `portfolio` block, and `app/static/executive-ui.mjs` renders it.

`portfolio` is **`null` unless the reader holds `executive.view`.** The board's own door is still the role check `canReadExecutive` (see §5), so a department manager or HR who reads the board by role sees exactly the figures they saw before — the board did not widen for them. The new numbers are tied to the same capability as the two new functions.

The block (`portfolioSummary`) is counts and sums only, per the board's doctrine «أرقام مجمّعة للكيان، دون عناوين الطلبات أو أسماء أصحابها»:

| Field | Meaning |
|---|---|
| `projects`, `closed`, `in_closure` | portfolio size, finally closed, entered closure by any route |
| `running`, `on_hold` | execution axis |
| `blocked_start` | readiness axis: waiting on a client PO or the advance |
| `overdue_collection` | collection axis |
| `axes[]` | per axis: `{key, name, owner_role, states:[{state, name, count}]}` |
| `funnel` | the aggregate fields of `portfolioForecast`, `warning` included |

No project name, opportunity name, client name or person's name enters `portfolio` — asserted by scanning the serialised block for the seeded strings.

**Screen.** Existing vocabulary only: `ex-figure` tiles with `is-warn`/`is-late` tones, `ex-table` tables, `badge` chips, and CSS bars as `<span class="ex-bar"><i data-width="N"></i></span>` painted by `paintBars` in `app.mjs`. No charting library was added, and there is no inline `style=` — the strict CSP blocks it, and the test asserts its absence. Arabic throughout. `executiveBoard(data,{e,name,money})` now takes `money`; `app/static/app.mjs` passes the one it already imports from `operations.mjs`.

Axis states reach the screen named, from the new `AXIS_STATE_NAMES` map in `app/project-axes.mjs` (keyed per axis, because `not_started` in *execution* is not `not_started` in *acceptance*). The map lives with the axis definitions, not in the screen, so the screen has no vocabulary of its own that can drift from the engine.

## 4. Tests — `tests/executive-scope.test.mjs`, 4 tests

1. **The entity board.** A holder of `executive.view` with membership in **zero** projects (`SELECT COUNT(*) FROM project_members WHERE user_id='chief'` = 0) reads all three seeded projects through `executiveAxesBoard`; **the same user calling `axesBoard` reads none** — the proof that existing behaviour is intact. The two boards' axis keys and, for a shared project, the axis values are asserted equal.
2. **The gate.** A real project member without `executive.view` gets `403 not_permitted` from **both** new functions; so does the team manager. The chief, who has no `commercial.use`, is still refused by `pipelineBoard` — the widening is an aggregate read, not a back door — while passing his own gate on `portfolioForecast`.
3. **Redaction.** The funnel numbers are asserted literally (weighted 100,000.00 × 50 % = 5,000,000 minor; win rate 50 % by count, 60 % by value; loss reason `PRICE` 1 / 40,000.00), `FORECAST_WARNING` is present, and the serialised output is scanned for five distinctive seeded strings — two opportunity names, two client names and the loss comment — each of which must be absent. `pipelineBoard` is checked in the same test to still contain them, so the assertion proves redaction and not an empty fixture.
4. **The board and its screen.** `executiveOverview` carries `portfolio` for the capability holder and `null` for the HR reader, whose `totals` keys are unchanged; the rendered HTML contains both new sections, the forecast warning, `data-width` bars, no ` style="`, and none of the seeded strings.

**Counts. `npm test`: 1060 tests, 1054 pass, 0 fail, 6 skipped** (the six pre-existing `skip:` declarations in `tests/delivery-cycle.test.mjs`, untouched). **`npm run check`: 448 JavaScript modules syntax-checked, source hashes match, traceability 220 requirements / 22 domains.**

## 5. Found, not fixed — for a later stage

Every one of these is a board scoped to project membership or to an account team with **no `executive.view` path**. None was touched in this stage.

| Function | File | Scope today |
|---|---|---|
| `listProjects` | `app/projects.mjs:9` | `JOIN project_members` — the projects screen itself |
| `listStudio` | `app/studio.mjs:167` | `JOIN project_members` (R24/R25 already widen on `exec`; the screen does not) |
| `reviewBoard` | `app/review-rounds.mjs:180` | `JOIN project_members` |
| `capacityBoard` / `resourcingBoard` | `app/resourcing.mjs:43` | project list via `JOIN project_members` |
| `listApprovals` | `app/client-approvals.mjs:22` | `memberProjects` |
| `intakeBoard` | `app/project-intake.mjs:902` | `JOIN project_members` |
| `campaignsBoard` / `contentBoard` / `scopeBoard` | `app/campaigns.mjs:253` | `memberClients` |
| `clientReportsBoard` | `app/client-reports.mjs:195` | `memberClients` |
| `influencerCampaignsBoard` | `app/influencers.mjs:433` | `memberClients` |
| `mediaSpendBoard` and the plan boards | `app/media-spend.mjs:127,256,271` | `memberClients` (+ a `JOIN project_members` at `:138`) |
| project scope of global search | `app/search.mjs:57` | `EXISTS(… project_members …)` |

**A separate finding, of a different kind — worth a decision before the next stage.** `executiveOverview` gates on **`canReadExecutive(u) = ['admin','manager','hr'].includes(u.role)`**, a *role* check, while the route that serves it (`app/server.mjs:304`) gates on `access.require(db,u,'executive.view')`, a *capability* check. A holder of `executive.view` whose role is `employee` therefore passes the route and is then refused by the function with «اللوحة التنفيذية متاحة للمديرين ورأس المال البشري وإدارة المنصة». The synthetic chief executive in `tests/executive-scope.test.mjs` is given role `manager` for this reason, and the fixture says so in a comment. This was left alone deliberately: reconciling the two gates changes **who reads the existing board**, which is a scope decision for the owner and not part of this stage.
