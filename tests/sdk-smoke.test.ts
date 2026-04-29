/**
 * SDK publish smoke test — runs against the *installed* @percolatorct/sdk package.
 *
 * Purpose: catch publish-time regressions (missing exports, bad tarball, files: glob
 * mistakes, dist/ not regenerated) that are invisible when pnpm uses a workspace link.
 *
 * This test does NOT make RPC calls. Everything is pure in-process computation so it
 * runs reliably in CI without any environment secrets.
 *
 * Pinned version: @percolatorct/sdk@2.0.4 (v12.19 mainnet alignment)
 * Update this comment when the workflow pins a new version.
 */

import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";

// ── 1. Named-export existence ─────────────────────────────────────────────────
// Every symbol the keeper actually imports must resolve without throwing.
//
// Sources:
//   liquidation.ts — fetchSlab, parseConfig, parseEngine, parseParams, parseAccount,
//                    parseUsedIndices, detectLayout, buildAccountMetas, buildIx,
//                    encodeLiquidateAtOracle, encodeKeeperCrank,
//                    ACCOUNTS_LIQUIDATE_AT_ORACLE, ACCOUNTS_KEEPER_CRANK,
//                    derivePythPushOraclePDA, DiscoveredMarket (type)
//   oracle.ts      — MarketConfig (type only)
//   adl.ts         — fetchSlab, parseEngine, parseConfig, parseAllAccounts,
//                    encodeExecuteAdl, ACCOUNTS_EXECUTE_ADL, buildAccountMetas,
//                    buildIx, derivePythPushOraclePDA, DiscoveredMarket (type)
//   crank.ts       — discoverMarkets, encodeKeeperCrank, encodeUpdateHyperpMark,
//                    buildAccountMetas, buildIx, derivePythPushOraclePDA,
//                    ACCOUNTS_KEEPER_CRANK, fetchSlab, parseHeader, parseConfig,
//                    parseEngine, parseParams, detectDexType, parseDexPool,
//                    DiscoveredMarket (type)
//   monitor.ts     — fetchSlab, parseEngine, parseConfig
//   crank-types.ts — DiscoveredMarket (type only)
import {
  // slab parsing
  fetchSlab,
  parseHeader,
  parseConfig,
  parseEngine,
  parseParams,
  parseAccount,
  parseUsedIndices,
  parseAllAccounts,
  detectLayout,
  detectSlabLayout,
  // instruction encoding
  encodeKeeperCrank,
  encodeLiquidateAtOracle,
  encodeExecuteAdl,
  encodeUpdateHyperpMark,
  // account meta helpers
  buildAccountMetas,
  buildIx,
  // ACCOUNTS_ constants
  ACCOUNTS_KEEPER_CRANK,
  ACCOUNTS_LIQUIDATE_AT_ORACLE,
  ACCOUNTS_EXECUTE_ADL,
  // PDA derivation
  derivePythPushOraclePDA,
  // market discovery
  discoverMarkets,
  detectDexType,
} from "@percolatorct/sdk";

// Type-only imports — these exercise the .d.ts surface without runtime cost.
import type {
  DiscoveredMarket,
  MarketConfig,
  EngineState,
  RiskParams,
  SlabLayout,
  AccountSpec,
  DexType,
} from "@percolatorct/sdk";

// ── 2. Constants / account specs ──────────────────────────────────────────────

describe("@percolatorct/sdk exports — account specs (keeper)", () => {
  it("ACCOUNTS_KEEPER_CRANK is a non-empty readonly array", () => {
    expect(Array.isArray(ACCOUNTS_KEEPER_CRANK)).toBe(true);
    expect(ACCOUNTS_KEEPER_CRANK.length).toBeGreaterThan(0);
  });

  it("ACCOUNTS_LIQUIDATE_AT_ORACLE is a non-empty readonly array", () => {
    expect(Array.isArray(ACCOUNTS_LIQUIDATE_AT_ORACLE)).toBe(true);
    expect(ACCOUNTS_LIQUIDATE_AT_ORACLE.length).toBeGreaterThan(0);
  });

  it("ACCOUNTS_EXECUTE_ADL is a non-empty readonly array", () => {
    expect(Array.isArray(ACCOUNTS_EXECUTE_ADL)).toBe(true);
    expect(ACCOUNTS_EXECUTE_ADL.length).toBeGreaterThan(0);
  });
});

// ── 3. encodeKeeperCrank round-trip ───────────────────────────────────────────

describe("@percolatorct/sdk exports — encodeKeeperCrank (keeper)", () => {
  it("encodeKeeperCrank is a function", () => {
    expect(typeof encodeKeeperCrank).toBe("function");
  });

  it("encodeKeeperCrank({callerIdx:0}) returns a non-empty Uint8Array", () => {
    const data = encodeKeeperCrank({ callerIdx: 0 });
    expect(data).toBeInstanceOf(Uint8Array);
    // 1 byte tag + 2 bytes callerIdx + 1 byte format_version = 4 bytes minimum
    expect(data.length).toBeGreaterThanOrEqual(4);
  });

  it("encodeKeeperCrank callerIdx is encoded at bytes 1-2 (little-endian)", () => {
    const data = encodeKeeperCrank({ callerIdx: 1 });
    // byte 0 = IX_TAG.KeeperCrank (5), bytes 1-2 = callerIdx LE
    expect(data[0]).toBe(5);
    expect(data[1]).toBe(1);
    expect(data[2]).toBe(0);
  });

  it("encodeKeeperCrank with candidates appends candidate bytes", () => {
    const withoutCandidates = encodeKeeperCrank({ callerIdx: 0 });
    const withCandidates = encodeKeeperCrank({
      callerIdx: 0,
      candidates: [{ idx: 7, policy: 0 }],
    });
    // With a candidate the payload must be longer
    expect(withCandidates.length).toBeGreaterThan(withoutCandidates.length);
  });
});

// ── 4. encodeLiquidateAtOracle round-trip ─────────────────────────────────────

describe("@percolatorct/sdk exports — encodeLiquidateAtOracle (keeper)", () => {
  it("encodeLiquidateAtOracle is a function", () => {
    expect(typeof encodeLiquidateAtOracle).toBe("function");
  });

  it("encodeLiquidateAtOracle({targetIdx:0}) returns a 3-byte Uint8Array", () => {
    const data = encodeLiquidateAtOracle({ targetIdx: 0 });
    expect(data).toBeInstanceOf(Uint8Array);
    // 1 byte tag + 2 bytes targetIdx = 3 bytes
    expect(data.length).toBe(3);
  });

  it("encodeLiquidateAtOracle tag byte is IX_TAG.LiquidateAtOracle (7)", () => {
    const data = encodeLiquidateAtOracle({ targetIdx: 42 });
    expect(data[0]).toBe(7);
    // targetIdx=42 in LE u16 = 0x2a 0x00
    expect(data[1]).toBe(42);
    expect(data[2]).toBe(0);
  });
});

// ── 5. encodeExecuteAdl round-trip ────────────────────────────────────────────

describe("@percolatorct/sdk exports — encodeExecuteAdl (keeper/adl)", () => {
  it("encodeExecuteAdl is a function", () => {
    expect(typeof encodeExecuteAdl).toBe("function");
  });

  it("encodeExecuteAdl({targetIdx:5}) returns a 3-byte Uint8Array", () => {
    const data = encodeExecuteAdl({ targetIdx: 5 });
    expect(data).toBeInstanceOf(Uint8Array);
    expect(data.length).toBe(3);
  });

  it("encodeExecuteAdl tag byte is IX_TAG.ExecuteAdl (50)", () => {
    const data = encodeExecuteAdl({ targetIdx: 0 });
    expect(data[0]).toBe(50);
  });
});

// ── 6. encodeUpdateHyperpMark round-trip ──────────────────────────────────────

describe("@percolatorct/sdk exports — encodeUpdateHyperpMark (keeper/crank)", () => {
  it("encodeUpdateHyperpMark is a function", () => {
    expect(typeof encodeUpdateHyperpMark).toBe("function");
  });

  it("encodeUpdateHyperpMark() returns a 1-byte Uint8Array with value 34", () => {
    const data = encodeUpdateHyperpMark();
    expect(data).toBeInstanceOf(Uint8Array);
    expect(data.length).toBe(1);
    expect(data[0]).toBe(34);
  });
});

// ── 7. PDA derivation ─────────────────────────────────────────────────────────

describe("@percolatorct/sdk exports — PDA derivation (keeper)", () => {
  it("derivePythPushOraclePDA is a function", () => {
    expect(typeof derivePythPushOraclePDA).toBe("function");
  });

  it("derivePythPushOraclePDA returns [PublicKey, number] for a 64-char hex feed id", () => {
    const feedId = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
    const [pda, bump] = derivePythPushOraclePDA(feedId);
    expect(pda).toBeInstanceOf(PublicKey);
    expect(typeof bump).toBe("number");
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  it("derivePythPushOraclePDA is deterministic", () => {
    const feedId = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
    const [a] = derivePythPushOraclePDA(feedId);
    const [b] = derivePythPushOraclePDA(feedId);
    expect(a.toBase58()).toBe(b.toBase58());
  });
});

// ── 8. buildIx round-trip ─────────────────────────────────────────────────────

describe("@percolatorct/sdk exports — buildIx (keeper)", () => {
  it("buildIx is a function", () => {
    expect(typeof buildIx).toBe("function");
  });

  it("buildIx constructs a TransactionInstruction with correct fields", () => {
    const DUMMY = new PublicKey("11111111111111111111111111111111");
    const data = encodeKeeperCrank({ callerIdx: 0 });
    const ix = buildIx({ programId: DUMMY, keys: [], data });
    expect(ix).toBeDefined();
    expect(ix.programId.toBase58()).toBe(DUMMY.toBase58());
    expect(Array.isArray(ix.keys)).toBe(true);
  });
});

// ── 9. buildAccountMetas ──────────────────────────────────────────────────────

describe("@percolatorct/sdk exports — buildAccountMetas (keeper)", () => {
  it("buildAccountMetas is a function", () => {
    expect(typeof buildAccountMetas).toBe("function");
  });
});

// ── 10. slab layout detection ────────────────────────────────────────────────

describe("@percolatorct/sdk exports — detectLayout / detectSlabLayout (keeper)", () => {
  it("detectLayout is a function", () => {
    expect(typeof detectLayout).toBe("function");
  });

  it("detectSlabLayout is a function", () => {
    expect(typeof detectSlabLayout).toBe("function");
  });

  it("detectLayout returns null for an unknown size", () => {
    expect(detectLayout(1)).toBeNull();
  });

  it("detectSlabLayout returns null for an unknown size", () => {
    expect(detectSlabLayout(1)).toBeNull();
  });

  it("detectSlabLayout returns a V12_19 layout for 96760 bytes (mainnet small)", () => {
    // v12.19 small slab — what the live mainnet program produces under --features small.
    // Wrapper anchor: percolator-prog post v12.19 upgrade (mainnet 2026-04-28).
    const layout = detectSlabLayout(96760);
    expect(layout).not.toBeNull();
    if (layout !== null) {
      expect(layout.maxAccounts).toBe(256);
      expect(layout.configLen).toBe(480);
      expect(layout.accountSize).toBe(360);
    }
  });
});

// ── 11. market discovery & dex oracle (shape-only, no network) ───────────────

describe("@percolatorct/sdk exports — market discovery / dex oracle (keeper)", () => {
  it("discoverMarkets is a function", () => {
    expect(typeof discoverMarkets).toBe("function");
  });

  it("detectDexType is a function", () => {
    expect(typeof detectDexType).toBe("function");
  });

  it("detectDexType returns null for system program (not a DEX)", () => {
    const SYSTEM = new PublicKey("11111111111111111111111111111111");
    expect(detectDexType(SYSTEM)).toBeNull();
  });
});

// ── 12. parse functions are functions ─────────────────────────────────────────

describe("@percolatorct/sdk exports — parse function shapes (keeper)", () => {
  it("fetchSlab is a function", () => {
    expect(typeof fetchSlab).toBe("function");
  });

  it("parseHeader is a function", () => {
    expect(typeof parseHeader).toBe("function");
  });

  it("parseConfig is a function", () => {
    expect(typeof parseConfig).toBe("function");
  });

  it("parseEngine is a function", () => {
    expect(typeof parseEngine).toBe("function");
  });

  it("parseParams is a function", () => {
    expect(typeof parseParams).toBe("function");
  });

  it("parseAccount is a function", () => {
    expect(typeof parseAccount).toBe("function");
  });

  it("parseUsedIndices is a function", () => {
    expect(typeof parseUsedIndices).toBe("function");
  });

  it("parseAllAccounts is a function", () => {
    expect(typeof parseAllAccounts).toBe("function");
  });
});
