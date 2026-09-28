# ReviewPilot AI

**Get more 5-star reviews, reply in seconds.** A free, privacy-first review booster for local businesses.

## The problem

Local businesses live and die by Google reviews — but owners:
1. **Forget to ask** happy customers for reviews (the #1 reason businesses have few reviews).
2. **Struggle to reply** — staring at a blank box, or worse, replying defensively to a bad review.
3. **Nag customers** by asking twice, because nobody tracks who was already asked.

Agencies charge $99–$299/mo for review software. ReviewPilot AI does the core job for free.

## The solution

- **🔗 Review request link generator** — enter your business name + Google review URL → get a beautiful mobile-friendly ask page + a printable QR code for your counter, receipts, or packaging.
- **✍️ AI reply drafter** — paste any review + star rating → get 3 reply options (professional, friendly, witty) instantly. Works **100% offline via built-in smart templates** — no API key needed. If you set `OPENAI_API_KEY`, replies get AI-polished automatically.
- **🛡️ Anti-nag protection** — every ask is logged; customers asked within the last **14 days** are flagged so you never double-ask.
- **📥 CSV import** — import your customer list (`name,email,phone`), track ask status per customer.
- **📊 Dashboard** — customers, ask coverage, asks this week, reviews logged, average rating.

All data stays in the browser (localStorage). No accounts, no tracking, no fees.

## Pricing (suggested SaaS model)

| Plan | Price | For |
|---|---|---|
| Free | $0 | 1 location, 100 customers, core features |
| Pro | $29/mo | Unlimited customers, multi-location, review monitoring, SMS asks |
| Agency | $79/mo | 10 client businesses, white-label ask pages |

This repo is the free core — a solid foundation to upsell Pro features onto.

## Run it

Requirements: Node.js 18+ (no dependencies to install — zero `node_modules`).

```bash
node server.js
# → http://localhost:3000
```

Optional AI enhancement:
```bash
OPENAI_API_KEY=sk-... node server.js   # replies get GPT-polished; falls back to templates on any error
```

Custom port: `PORT=8080 node server.js`

## How it works

```
browser ──GET /──────────────▶ server.js (static index.html)
browser ──GET /ask?b=..&u=..─▶ server.js (static ask.html, mobile ask page)
browser ──POST /api/draft-reply {review, stars, business, name}
                                   │
                    ┌──────────────┴──────────────┐
                    │ OPENAI_API_KEY set?          │
                    ▼                              ▼
              GPT-4o-mini polish            local smart templates
              (3 tones, <60 words)          (lib/logic.js — offline)
                    └──────────────┬──────────────┘
                                   ▼
                    { tones: {professional, friendly, witty} }
```

Shared logic (`lib/logic.js`) runs in both Node and the browser: reply templates, CSV parsing, 14-day anti-nag math, dashboard stats, ask-URL builder.

## Project layout

```
reviewpilot-ai/
├── server.js            # zero-dep Node server + /api/draft-reply
├── lib/logic.js         # shared logic (Node + browser)
├── public/
│   ├── index.html       # dashboard app
│   ├── ask.html         # shareable mobile review-request page
│   ├── app.js           # frontend logic
│   ├── styles.css       # theme
│   └── vendor/
│       └── qrcode.min.js# MIT QR generator (vendored, works offline)
├── test/
│   ├── smoke.sh         # 10 smoke checks
│   └── e2e.sh           # 6 end-to-end flows
└── README.md
```

## Tests

```bash
npm test            # or: bash test/smoke.sh && bash test/e2e.sh
```

- `test/smoke.sh` — server boots, routes return 200, reply API returns 3 tones, QR lib loads, assets exist.
- `test/e2e.sh` — full flows: link generation, 5-star reply, 1-star recovery reply, anti-nag logic, CSV import, dashboard stats.

## License

MIT — use it, sell it, white-label it.
