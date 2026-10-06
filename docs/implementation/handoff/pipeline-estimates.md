# Handoff: pipeline-estimates

## 1. Files created (no existing file modified)

- `app/migrations/074-pipeline-estimates.sql`
- `app/pipeline-estimates.mjs`: opportunity pipeline (stages, probabilities, required fields, idle alerts, loss reasons, win/loss report)
- `app/estimates.mjs`: price cards, estimate matrix (role × deliverable), change orders, and the handoff to the commercial path
- `app/pipeline-shared.mjs`: small helpers shared by the two modules, so neither imports the other
- `app/static/pipeline-estimates-ui.mjs`: exports `pipelineUI` and `estimatesUI`
- `tests/pipeline-estimates.test.mjs` (pipeline) and `tests/pipeline-estimates-matrix.test.mjs` (estimates)

I read `commercial.mjs`, `agency.mjs`, `campaigns.mjs`, `profitability.mjs` and `access.mjs` and changed none of them. The modules import only `clientFor`, `memberClients` and `FAMILIES` from `agency.mjs`, which is how `campaigns.mjs` already applies client-team isolation. Nothing imports `profitability.mjs` or `commercial.mjs`.

## 2. Migration 074 and its tables

| Table | Contents | Rules enforced in SQL |
|---|---|---|
| `pipeline_stages` | Stage, win probability (bp), probability basis and confirmation date, required fields, idle threshold in days | Preparer ≠ approver (`CHECK`). An approved or rejected revision cannot be edited (`TRIGGER`). A change is a new revision. One approved revision and one draft per code. No deletes |
| `pipeline_loss_reasons` | Owner-defined list | The name is fixed after creation; a reason is deactivated, never deleted |
| `opportunities` | Opportunity linked to a client, with SAR value, stage and last-activity date | `CHECK`: lost ⇔ reason present, and the comment is ≥10 characters. A closed opportunity is final (`TRIGGER`). `version` +1. Same `tenant` as the client |
| `opportunity_stage_events` | Stage history with the requirements met at each move | Immutable |
| `opportunity_activities` | Logged activity (this is what resets the idle counter) | Open opportunities only. Immutable |
| `price_cards` | Dated price list: general or per client. Items are hourly role rates or per-unit deliverable prices | Preparer ≠ approver. Decided once. One live card per scope and effective date |
| `estimates` | Estimate or change order (`parent_estimate_id` plus the reason). Optional `scope_event_id` | Preparer ≠ approver. A decided estimate is final. A change order needs an approved parent for the same client |
| `estimate_lines` | Matrix line: role, job-category code, deliverable, hours ×100, sell rate and its origin (card or manual), cost rate or `NULL` with its source | Written only while the estimate is a draft. `cost_rate_minor` is never 0 (NULL means unavailable). A cost cannot exist without its source |
| `estimate_handoffs` | Links an approved estimate to the commercial case it was carried into | Approved estimates only, same tenant, immutable |

No rows are seeded into any table.

## 3. Routes for `app/server.mjs`

Every write runs in a transaction. The `/api` prefix is implied. `costRate` is defined in section 3.1.

| Method | Path | Function | Idempotency-Key |
|---|---|---|---|
| GET | `/api/pipeline?from=&to=` | `pipeline.pipelineBoard(db,u,{from,to})` (reads the query params) | — |
| POST | `/api/pipeline/stages` | `pipeline.prepareStage(db,u,input)` → `{id}` (also used for a "new revision") | Yes (`once`) |
| POST | `/api/pipeline/stages/:id/(approve_stage\|reject_stage\|retire_stage)` | `pipeline.stageAction(db,u,id,action,input)` | No |
| POST | `/api/pipeline/loss-reasons` | `pipeline.addLossReason(db,u,input)` → `{id}` | Yes |
| POST | `/api/pipeline/loss-reasons/:id/(deactivate_reason\|activate_reason)` | `pipeline.lossReasonAction(db,u,id,action,input)` | No |
| POST | `/api/pipeline/opportunities` | `pipeline.createOpportunity(db,u,input)` → `{id}` | Yes |
| POST | `/api/pipeline/opportunities/:id/(edit\|activity\|move\|win\|lose)` | `pipeline.opportunityAction(db,u,id,action,input)` | No |
| GET | `/api/estimates` | `estimates.estimatesBoard(db,u,{costRate})` | — |
| POST | `/api/estimates/price-cards` | `estimates.preparePriceCard(db,u,input)` → `{id}` | Yes |
| POST | `/api/estimates/price-cards/:id/(approve_card\|reject_card)` | `estimates.priceCardAction(db,u,id,action,input)` | No |
| POST | `/api/estimates` | `estimates.saveEstimate(db,u,input,{costRate})` → `{id}` (estimate or change order) | Yes |
| POST | `/api/estimates/:id/(edit\|submit\|withdraw\|approve\|reject\|handoff)` | `estimates.estimateAction(db,u,id,action,input,{costRate})` | No |
| POST | `/api/estimates/:id/to-quote` | composite route, defined in 3.2 | No |

The regex for ids is `[a-f0-9-]{36}`, as elsewhere in the server.

### 3.1 Wiring the cost rate (the coordinator connects `estimates.mjs` to `profitability.mjs`)

`estimates.mjs` does not import `profitability.mjs`. It accepts an optional `costRate` parameter with this contract:

```js
costRate({tenant_id, category_code, role_name, date}) => {rate_minor:int>0, source:string} | null
```

`category_code` is the `job_categories.code` value the estimator types on the line (or the one stored on the role in the price card). A suggested resolver at the call site in `server.mjs`, mirroring `rateAt` in `profitability.mjs` (approved revision in effect on that date):

```js
const costRate=({tenant_id,category_code,date})=>{const r=db.prepare("SELECT r.rate_minor,r.effective_from,c.name FROM category_cost_rates r JOIN job_categories c ON c.id=r.category_id AND c.tenant_id=r.tenant_id WHERE r.tenant_id=? AND c.code=? AND r.status='approved' AND r.effective_from<=? ORDER BY r.effective_from DESC LIMIT 1").get(tenant_id,category_code,date);return r?{rate_minor:r.rate_minor,source:`معدل فئة ${r.name} المعتمد من ${r.effective_from}`}:null;};
```

- If `costRate` is not passed, or it finds no rate, the line stays uncosted (`NULL`). The screen then says "الهامش غير محسوب لأن التكلفة غير متاحة" and computes no margin, per line or in total.
- A resolver that returns 0, or returns no source, is rejected with `500 cost_rate_resolver` rather than stored as a zero cost.
- The cost is resolved when the draft is saved and stored with its source, so rate changes after submission do not change the estimate.
- **Needs the owner's decision:** category rates carry the `costing.manage` / `profitability.view` capabilities, which are sensitive. Passing `costRate` to every `commercial.use` holder shows them the category rate on each line. I recommend passing it only when `can(db,u,'profitability.view')` holds, or once the owner approves showing category rates to salespeople. Without it the screen still works, honestly, with no margin shown.

### 3.2 Handing an approved estimate to the existing path (connection point with `commercial.mjs`)

Estimates do not create projects. `estimates.commercialPayload(db,u,id,input)` builds the payload for the existing action without calling it:

- base estimate → `{action:'save_quote', case_id, case_version, payload:{scope,currency:'SAR',valid_until,lines}}` (one quote line per deliverable, with its sell price and cost)
- change order → `{action:'create_change', …, payload:{scope,additional_price,additional_cost,extra_days,due_date,acceptance}}`

The payload is refused if the cost is unavailable, because commercial computes margin from `unit_cost` and a zero there would fake one. It is also refused for a negative change order, and when no tax rate is given (the user enters it; nothing is assumed).

The `/to-quote` route in one transaction:

```js
const h=estimates.commercialPayload(db,u,id,input);
if(!h.case_id)fail(409,'handoff_required','اربط التقدير بملف تجاري أولًا');
return commercial.commercialAction(db,u,h.case_id,h.action,{version:h.case_version,...h.payload});
```

From there the existing path applies unchanged: quote margin approval, then `register_contract`, then `create_project`, which creates the project and `commercial_project_baselines` (the project's budget baseline). The test `handoff: …` proves that the quote created this way carries the same net and margin as the estimate.

### 3.3 Scope guard → change order (`campaigns.mjs`, unchanged)

`estimatesBoard` returns `scope_candidates`: scope-guard events on the user's clients that are `over_scope=1`, have no decision or were decided as `change_request`, and have no change order yet, each with its approved parent estimates. The UI turns any of them into a change order in one click (`scope_event_id` plus the approved parent). The order links to the alert, and the alert then disappears from the list.

**For the coordinator:** the account owner's decision stays in the scope guard (`decideScope`). If you want a `change_request` decision to open a change order automatically, add a button or link in `scopeUI` pointing to the `estimates` module. The data is already in `scope_candidates`. I did not touch `campaigns-ui.mjs`.

## 4. Operation modules

- `operationModules`: `pipeline: pipelineUI`, `estimates: estimatesUI`, imported from `./pipeline-estimates-ui.mjs`.
- Add `'pipeline-estimates-ui'` to the static-asset allowlist in `server.mjs`.
- Navigation group: **Operations** (التشغيل), next to "المبيعات والتسليم" (commercial) and "ملفات العملاء" (clients). Capability: `commercial.use` (scoped to the user's department), plus membership in the client's account team.

## 5. "Awaiting my decision" inbox

Both boards return `awaiting_me` in the same shape as `costRatesBoard`:
- `pipelineBoard(...).awaiting_me`: stage revisions awaiting approval by someone other than their preparer (`approve_stage`)
- `estimatesBoard(...).awaiting_me`: estimates and change orders awaiting approval (`approve_estimate`, with "الهامش غير محسوب" in the title when that applies), and price cards (`approve_card`)
- Optional: `stale_mine` in `pipelineBoard` is a list of the user's stale opportunities, suitable as an inbox notice

## 6. What I did not build, and what needs a decision

- **Who owns the procedure:** stage definitions, loss reasons and price cards are open to any `commercial.use` holder, with approval by someone other than the preparer. If the owner wants a specific procedure owner, that needs a new capability key in `access.mjs`, which I did not add.
- Loss reasons need no approval (they are a taxonomy, not a number). Their names are fixed so older reports keep their meaning.
- **The weighted forecast uses today's probability.** Approving a new probability revision changes the whole forecast immediately. It is labelled "تقدير لا إيراد" (an estimate, not revenue) and is not stored or passed to any financial report.
- **Whether estimate approval should follow a fixed line of authority:** today, any team member other than the preparer who holds `commercial.use` can approve. The binding margin approval still happens in the commercial path with the direct manager.
- Estimates are SAR only (the contract's rule). The commercial path allows USD/EUR, but no currency conversion was built here.
- Overhead (`overhead_rates`) is not included in the line cost. The estimate margin is direct margin. Including overhead is an owner decision, and the cost contract could return an all-in rate.
- Nothing is sent to clients, and there is no external CRM integration. The screens say so.
- No new CSS classes are needed.

## 7. Test results

```
node --test tests/pipeline-estimates.test.mjs tests/pipeline-estimates-matrix.test.mjs
✔ price cards: no default price exists, cards are dated and approved by someone else, and a client card replaces the general list
✔ estimate matrix: without a cost source the margin is declared unavailable, never computed on zero cost
✔ estimate matrix: with an external cost rate the margin shows line by line and in total, and a partly costed matrix has no total margin
✔ estimates: the preparer cannot approve, a decided estimate is final, versions are checked, and isolation holds
✔ change orders: a separate estimate on an approved one shows what changed and by how much, and a scope-guard alert becomes a change order
✔ handoff: an approved costed estimate becomes the payload of the existing commercial quote path, which then carries the same margin
✔ pipeline: stage probabilities are entered with their basis and approved by someone else, and nothing exists until the owner defines it
✔ pipeline: a stage cannot be entered before its required fields are met, and the weighted forecast is labelled an estimate, not revenue
✔ pipeline: an idle opportunity turns stale for its owner after the stage threshold, and a logged activity resets the counter
✔ pipeline: closing lost demands a listed reason and a comment, a closed opportunity is final, and win/loss is reported by reason, sector and service
✔ pipeline: capability, client team and tenant isolation, and optimistic versions
ℹ pass 11  ℹ fail 0
```

Neighbouring tests, run by name with mine (`agency`, `campaigns`, `commercial`, `profitability`, `migrations`, `access`, `access-reviews`, `legacy-access`): 55 tests total, 55 passed and 0 failed. I did not run `npm test` in full, per the contract.
I also checked the UI against real boards for two roles: every rendered button opens a valid form, and there is no `style=` and no unescaped value.
