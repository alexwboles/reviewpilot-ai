# ReviewPilot AI — Redesign Audit (2026-10-13)

## Competitors researched
- **Birdeye** — centralized review dashboard: KPI strip (total reviews, avg rating, sentiment), review stream with per-review reply status, sentiment/topic analysis, review-request campaigns, multi-location views.
- **Podium** — left sidebar app shell; dashboard shows total reviews, overall average rating, most productive review sites, recent review stream, employee leaderboard, response times; unified messaging inbox; SMS review requests with templates.
- **NiceJob / Broadly** — review-request funnel focus: ask page, reminder sequences, campaign stats.

## Visual gaps (current state)
1. Top-tab nav bar — review tools use a **left sidebar app shell** (Podium, Birdeye); top tabs read as a marketing page.
2. Dashboard is a generic card stack — competitors lead with a **reputation summary band**: big average-rating numeral, star row, review count, response rate.
3. No **star-distribution histogram** (Birdeye/Podium both show rating breakdown bars).
4. Recovery queue is a flat list — real tools use **kanban workflow columns** (Open → Contacted → Resolved).
5. Review log has no **star filtering** and no platform/replied status strip.
6. Brand block is small; the sidebar shell wants a compact mark + business name.

## Functional gaps closed in this pass
1. **Star-distribution histogram** computed from logged reviews on the dashboard (5-bar breakdown, like Birdeye).
2. **Recovery queue → 3-column kanban** (Open / Contacted / Resolved) with one-click advance buttons; counts per column.
3. **Star filter on the review stream** (All / 5 / 4 / 3 / 2 / 1) + replied-only toggle.
4. **Campaign stats on Get Reviews**: links generated, QR downloads, asks sent — tracked in localStorage, displayed as a stat strip.
5. Dashboard **reputation band**: avg rating numeral + stars, total reviews, response rate, asks-this-week — the four numbers a Birdeye user checks first.

## Identity concept (implemented)
"Reputation HQ" — Podium-style dark navy sidebar shell (sharp edges, icon + label nav), warm white workspace, amber/gold as the single tasteful accent (stars, rating). Reputation band with oversized rating numeral and star row; kanban recovery board; star-filtered review stream. System-ui + Georgia serif numeral for the rating figure. No rounded corners.
