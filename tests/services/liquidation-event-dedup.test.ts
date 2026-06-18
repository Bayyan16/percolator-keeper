/**
 * Regression coverage for issue #218:
 * LaserStream event-driven liquidation must use the same per-cycle dedup and
 * per-owner rate cap as the polling liquidation path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@solana/web3.js", async () => ({
  ...(await vi.importActual("@solana/web3.js")),
}));

vi.mock("@percolatorct/sdk", () => ({
  fetchSlab: vi.fn(),
  parseConfig: vi.fn(),
  parseEngine: vi.fn(),
  parseParams: vi.fn(),
  parseAccount: vi.fn(),
  parseUsedIndices: vi.fn(),
  detectLayout: vi.fn(),
  buildIx: vi.fn(() => ({})),
  encodePermissionlessCrank: vi.fn(() => Buffer.from([1])),
  CrankAction: { Liquidate: 1 },
  isV17Account: vi.fn(() => false),
  parsePortfolioV17: vi.fn(),
}));

vi.mock("@percolatorct/shared", () => ({
  config: { crankKeypair: "mock" },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  sendWarningAlert: vi.fn(),
  getConnection: vi.fn(() => ({})),
  getFallbackConnection: vi.fn(() => ({})),
  loadKeypair: vi.fn(() => ({
    publicKey: {
      toBase58: () => "11111111111111111111111111111111",
      equals: () => false,
    },
    secretKey: new Uint8Array(64),
  })),
  sendWithRetry: vi.fn(),
  pollSignatureStatus: vi.fn(),
  getRecentPriorityFees: vi.fn(async () => ({
    priorityFeeMicroLamports: 5000,
    computeUnitLimit: 200000,
  })),
  checkTransactionSize: vi.fn(),
  eventBus: { publish: vi.fn() },
  acquireToken: vi.fn(async () => {}),
  backoffMs: vi.fn(() => 100),
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock("../../src/lib/keeper-send.js", async () => {
  const { KeeperBudget } = await vi.importActual<typeof import("../../src/lib/budget.js")>(
    "../../src/lib/budget.js",
  );
  return {
    keeperSend: vi.fn(),
    sharedBudget: new KeeperBudget(),
  };
});

vi.mock("../../src/lib/oracle-account.js", () => ({
  resolveExternalOracleAccount: vi.fn(async () => ({
    toBase58: () => "Oracle11111111111111111111111111111111",
  })),
}));

import { LiquidationService } from "../../src/services/liquidation.js";

function makeLoader() {
  let cb: ((update: { pubkey: string }) => void) | undefined;
  return {
    loader: {
      onAccount: vi.fn((fn: (update: { pubkey: string }) => void) => {
        cb = fn;
        return vi.fn();
      }),
    },
    emit(pubkey: string) {
      cb?.({ pubkey });
    },
  };
}

function makeMarket(slabKey: string) {
  return {
    slabAddress: { toBase58: () => slabKey },
    programId: { toBase58: () => "Program11111111111111111111111111111111" },
    config: {
      indexFeedId: { toBytes: () => new Uint8Array(32) },
      oracleAuthority: { toBase58: () => "Oracle11111111111111111111111111111111" },
    },
    params: { maintenanceMarginBps: 500n },
    header: { admin: { toBase58: () => "Admin111111111111111111111111111111111" } },
  };
}

function makeCandidate(
  slabKey: string,
  accountIdx: number,
  owner = "Owner111111111111111111111111111111111",
) {
  return {
    slabAddress: slabKey,
    accountIdx,
    owner,
    positionSize: 1n,
    capital: 0n,
    pnl: 0n,
    marginRatio: 0,
    maintenanceMarginBps: 500n,
    scanPriceE6: 1_000_000n,
  };
}

describe("LiquidationService LaserStream event dedup guards", () => {
  let svc: LiquidationService;

  beforeEach(() => {
    vi.useFakeTimers();
    process.env.KEEPER_USE_LASERSTREAM = "true";
  });

  afterEach(() => {
    svc?.stop();
    delete process.env.KEEPER_USE_LASERSTREAM;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not re-liquidate a candidate already reserved by the polling path", async () => {
    const slabKey = "MarketEventDedup11111111111111111111111111";
    const market = makeMarket(slabKey);
    const markets = new Map([[slabKey, { market }]]);
    const candidate = makeCandidate(slabKey, 0);
    const { loader, emit } = makeLoader();

    svc = new LiquidationService({ fetchPrice: vi.fn() } as any, 60_000, loader as any);

    vi.spyOn(svc, "scanMarket").mockResolvedValue([candidate] as any);
    const liquidateSpy = vi.spyOn(svc, "liquidate").mockResolvedValue("sig-1");

    await svc.scanAndLiquidateAll(markets as any);
    expect(liquidateSpy).toHaveBeenCalledTimes(1);

    svc.start(() => markets as any);
    emit(slabKey);

    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();

    expect(liquidateSpy).toHaveBeenCalledTimes(1);
  });

  it("enforces MAX_LIQ_PER_OWNER_PER_CYCLE on the event-driven path", async () => {
    const slabKey = "MarketOwnerCap1111111111111111111111111111";
    const market = makeMarket(slabKey);
    const markets = new Map([[slabKey, { market }]]);
    const owner = "OwnerCap11111111111111111111111111111111";
    const { loader, emit } = makeLoader();

    svc = new LiquidationService({ fetchPrice: vi.fn() } as any, 60_000, loader as any);

    vi.spyOn(svc, "scanMarket").mockResolvedValue(
      [0, 1, 2, 3, 4].map((idx) => makeCandidate(slabKey, idx, owner)) as any,
    );
    const liquidateSpy = vi.spyOn(svc, "liquidate").mockResolvedValue("sig-1");

    svc.start(() => markets as any);
    emit(slabKey);

    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();

    expect(liquidateSpy).toHaveBeenCalledTimes(3);
  });
});
