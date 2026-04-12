# CONTEXT.md — Coder (keeper workspace)
Last updated: 2026-03-30 11:28 BST

## Current Task
- **Task:** PERC-8276 — ADL T11: Keeper two-phase crank + ADL instruction
- **Branch:** feature/PERC-8276-adl-service
- **Status:** IN REVIEW — PR#42 open
- **PR:** https://github.com/dcccrypto/percolator-keeper/pull/42
- **What's done:** AdlService scaffolded + wired into index.ts + 12 unit tests
- **What's remaining:** Wait for anchor T8 (PERC-8273) + T10 (PERC-8275); then enable ADL_ENABLED=true in Railway

## WIP State
- Files edited: src/services/adl.ts (new), src/services/crank-types.ts (new), src/index.ts (modified), tests/services/adl.test.ts (new)
- All 121 tests passing
- Branch pushed, PR open

## Key Decisions
- Feature-flagged via ADL_ENABLED=true env var — safe to deploy without activating
- MarketCrankState extracted to crank-types.ts to avoid circular dep adl.ts ↔ crank.ts
- PnL% ranking (pnl/capital) determines ADL priority, not absolute PnL
- ADL_MAX_TX_PER_SCAN=10 default cap per market per cycle (prevents runaway)
- Two-phase on-chain split (T5/PERC-8270) lives in Rust — no keeper change needed until T5 ships

## Next Action (next session)
1. Check if PR#42 has QA + Security approval → merge
2. Check if anchor T8 (PERC-8273) is done → if yes, update adl.ts with final interface
3. After T10 devnet upgrade done (PERC-8275): set ADL_ENABLED=true in Railway devnet
4. Pick up next backlog task

## Previous PRs (reference)
- PR#1924: percolator-launch — historySince proxy route fix (in QA review)
