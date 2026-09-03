# AI Platform — Future Plan (Phase 3+)

*Not started. Written as a reference for when this work begins — see
`CLAUDE.md`'s "Suggested next task" for what's active right now.*

## Why this exists

The goal is an AI layer on top of the QA Inspection App, covering three
genuinely different capabilities:

1. A chat assistant that answers natural-language questions about real
   inspection data.
2. Anomaly detection / predictive quality on measurement history.
3. Computer vision for visual defect detection from photos.

These are three separate systems with different infrastructure, cost,
and risk profiles — not one project. They should be built one at a time,
in the order below, not simultaneously. Each needs its own scoping/plan
pass (via Claude Code's plan mode) when its turn comes; this document is
the map, not the detailed implementation plan for any one of them.

**Recommended order: Chat Assistant → Anomaly Detection → Computer
Vision.** Reasoning for that order is under each section below.

---

## 1. Chat Assistant (recommended starting point)

**What it does**: engineers/QC ask questions in plain language about
real data already in the system — "which Insulet parts failed most this
month?", "how's the Cpk on part 40673 trending?", "show me this week's
rejected inspections" — and get answers grounded in the actual database,
not a generic LLM guess.

**Why first**: the data model is already well-organized for this
(clients → parts → inspections → measurements), so this is mostly a
matter of connecting an LLM to what already exists — it doesn't need a
large volume of historical data to be useful, unlike the other two.

**How it would work**: an LLM (Claude API is the natural fit given the
existing ecosystem) using tool-use/function-calling against the app's
*existing* REST endpoints (`GET /api/inspections/analytics`, `GET /api/
drawings/:id/analytics`, etc.) — the model decides which read-only query
to run, it doesn't invent data or run arbitrary SQL. A new `POST /api/ai/
chat` backend route holds the conversation loop and tool definitions; a
new chat page/panel on the frontend (likely reachable from Engineer
Dashboard, matching who currently uses `PartAnalyticsSection`).

**Requirements to resolve before starting:**
- An Anthropic API key and a real answer to the cost question (pay-per-
  token — needs a usage/budget expectation, not just "get a key").
- **Must be strictly read-only** — the tool definitions given to the
  model must never include any create/update/delete/sign endpoint. This
  is the main safety requirement, not prompt-injection risk (this is an
  internal tool over internal data, not exposed to untrusted content).
- Which roles get access — likely Engineer/QC/Admin, matching who
  already uses the analytics dashboard; Operators probably don't need
  this given their narrower In-Process-only scope (see CLAUDE.md).
- Decide the query surface: expose the assistant to the *same* data a
  logged-in user could already see through the UI (respecting existing
  role-based access), never more.

**Rough shape of the work**: backend chat route + tool-use loop wired to
existing analytics endpoints, a chat UI, role gating, and a way to show
the user *what data backed an answer* (e.g., which endpoint/query ran)
so it's trustworthy for a QA context, not a black box.

---

## 2. Anomaly Detection / Predictive Quality

**What it does**: flag a batch/point that's *trending* toward
out-of-tolerance before it actually fails a reading — going beyond the
static Cpk badge and UCL/LCL control limits already built in
`RunChart.jsx`.

**Why second, and why it has to wait**: this needs real accumulated
batch history per part to mean anything — exactly the same prerequisite
already noted in `CLAUDE.md`'s "Suggested next task" for finishing the
Engineer Dashboard rework. Don't start this until there's meaningfully
more real production data than exists right now (the app only went live
for real inspections on 2026-09-03).

**Important distinction**: "AI" here doesn't necessarily mean an ML
model. Two tiers, worth doing in this order:

- **Tier 1 — rule-based SPC** (no ML needed): classic control-chart
  pattern rules (Western Electric / Nelson rules — e.g. "7 consecutive
  batches trending the same direction," "2 of 3 points beyond 2σ") run
  directly against the batch data `RunChart.jsx` already computes. This
  is a natural, low-risk extension of the existing Needs Attention panel
  (`Home.jsx`) — same alert mechanism, smarter trigger condition.
- **Tier 2 — real predictive ML** (forecasting where a process is
  headed, not just flagging a known pattern): a much bigger lift with
  real data-science work (model selection, training, validation) that
  this app has zero infrastructure for today. Only worth considering
  once Tier 1 is live and real data volume actually supports it.

**Requirements to resolve before starting**: how much real batch history
is "enough" (a concrete threshold, not a vibe) before Tier 1 rules would
produce meaningful signal instead of noise on this company's actual
production cadence.

---

## 3. Computer Vision for Defect Detection

**What it does**: analyze photos of the *physical part* to catch visual
defects automatically.

**Why last**: this is a fundamentally different, much larger project —
**the app currently has no photo-capture workflow of the manufactured
part at all.** `balloon_drawings` stores the technical drawing image
(the reference the balloon points are numbered against), not photos of
what came off the line. Everything below is currently missing, not just
unbuilt-but-planned:

- A capture flow (camera access from shop-floor tablets/phones, storage,
  association with a specific inspection/sample).
- A definition of what "defect" even means visually, per part type — a
  threaded fitting's defects look nothing like a machined bracket's, so
  this isn't one universal model.
- A choice of approach: general-purpose vision reasoning (Claude can
  accept and reason about images directly, no training needed, but
  accuracy on subtle/domain-specific defects is unproven) vs. a
  specialized trained model (needs a real dataset of labeled
  good/defective photos, which almost certainly doesn't exist yet in
  curated form).

**This section needs its own discovery phase before any implementation
plan is written** — starting with: does the company have (or can it
collect) enough real defect photos to evaluate either approach, and what
would the shop-floor capture workflow actually look like physically.

---

## Open decisions (revisit when starting each phase)

- [ ] Anthropic API budget/usage expectation (Chat Assistant)
- [ ] Which roles get chat access (Chat Assistant)
- [ ] Real-data volume threshold before Tier 1 SPC rules go live (Anomaly Detection)
- [ ] Whether a devoted ML phase (Tier 2) is ever worth it, given team size (Anomaly Detection)
- [ ] Feasibility of a labeled defect-photo dataset; shop-floor capture workflow (Computer Vision)
