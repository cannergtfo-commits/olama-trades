# Trade learnings (2026-10-26 risk-on session)

Machine-readable copy: `data/trade-learnings.json`.

## What we learned

| Cohort | n | Avg conf | Avg hold | Avg PnL |
|--------|---|----------|----------|---------|
| TP | 5 | 53.1 | ~185s | +16.7% |
| SL | 3 | 59.5 | ~80s | −48.8% |

Raw confluence did **not** separate winners (SL avg conf was higher). Flash dumps (NPC −84% in ~40s, SPAWN −33% in ~9s) overshot any modest SL tighten — **entry quality** is the lever. TP+10 / SL−25 kept unchanged.

## Rules applied

1. `minPatternScore` **68** (was 58)
2. Tightened `hasGoodSetup`: no mom+-only; prefer `hammer` / `bull_engulf` / `maru_bull` / `3soldiers`; soft-block `shoot_star` / `bear_engulf` / `maru_bear` / `3crows` / `hang_man`
3. Soft fade filter: `minPriceChange5mPct = -1` when 5m data exists
4. `minConfluenceSources = 1`, `preferGraduated = true`
5. Denylist SL mints from this session (NPC, Telurico, SPAWN)
6. Buy history notes now include pattern tags/score/bias/bond for the next pass

Portfolio caps unchanged: 90% max, 0.01 SOL reserve. `DRY_RUN=false`.
