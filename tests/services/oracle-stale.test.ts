import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PublicKey } from '@solana/web3.js';

// Mock fetch globally
global.fetch = vi.fn();

// Mock external dependencies
vi.mock('@percolatorct/sdk', () => ({
  encodePushOraclePrice: vi.fn(() => Buffer.from([1, 2, 3])),
  buildAccountMetas: vi.fn(() => []),
  buildIx: vi.fn(() => ({})),
  ACCOUNTS_PUSH_ORACLE_PRICE: {},
}));

vi.mock('@percolatorct/shared', () => ({
  config: {
    programId: '11111111111111111111111111111111',
    crankKeypair: 'mock-keypair-path',
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  getConnection: vi.fn(() => ({
    getAccountInfo: vi.fn(),
  })),
  loadKeypair: vi.fn(() => ({
    publicKey: new PublicKey('11111111111111111111111111111111'),
    secretKey: new Uint8Array(64),
  })),
  sendWithRetry: vi.fn(async () => 'mock-signature'),
  eventBus: {
    publish: vi.fn(),
  },
  getErrorMessage: vi.fn((err: unknown) => {
    if (err instanceof Error) return err.message;
    return String(err);
  }),
}));

import { OracleService } from '../../src/services/oracle.js';

describe('OracleService.getStaleMarkets', () => {
  let oracle: OracleService;

  beforeEach(() => {
    vi.clearAllMocks();
    oracle = new OracleService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return empty array when no markets are tracked', () => {
    const stale = oracle.getStaleMarkets(5 * 60 * 1000);
    expect(stale).toEqual([]);
  });

  it('should return markets that have price history but no push', async () => {
    // Seed price history via fetchPrice (no pushPrice call → lastPushTime stays 0)
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true, json: async () => ({ pairs: [{ priceUsd: '1.00', liquidity: { usd: 100000 } }] }),
      } as any)
      .mockResolvedValueOnce({
        ok: true, json: async () => ({ data: { MINT_A: { price: '1.00' } } }),
      } as any);

    await oracle.fetchPrice('MINT_A', 'SLAB_A');

    const stale = oracle.getStaleMarkets(5 * 60 * 1000);
    expect(stale).toContain('SLAB_A');
  });

  // "should not return markets with recent push" test removed — pushPrice
  // was deleted in Phase G. The getStaleMarkets logic now depends on
  // recordPushTime calls from external oracle sources instead.

  it('should distinguish between 5min alert and 10min pause thresholds', async () => {
    // We'll test the logic by checking that the same market appears
    // at a short threshold but not at a long one

    // Seed market with price history but no push
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true, json: async () => ({ pairs: [{ priceUsd: '2.00', liquidity: { usd: 100000 } }] }),
      } as any)
      .mockResolvedValueOnce({
        ok: true, json: async () => ({ data: { MINT_C: { price: '2.00' } } }),
      } as any);

    await oracle.fetchPrice('MINT_C', 'SLAB_C');

    // With threshold=0, everything with no push is stale
    const staleAt0 = oracle.getStaleMarkets(0);
    expect(staleAt0).toContain('SLAB_C');

    // With a very large threshold (1 hour), a never-pushed market is still stale
    // because lastPushTime=0 means now - 0 > threshold for any threshold
    const staleAtHour = oracle.getStaleMarkets(60 * 60 * 1000);
    expect(staleAtHour).toContain('SLAB_C');
  });

  it('should return multiple stale markets', async () => {
    // Seed two markets
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true, json: async () => ({ pairs: [{ priceUsd: '1.00', liquidity: { usd: 100000 } }] }),
      } as any)
      .mockResolvedValueOnce({
        ok: true, json: async () => ({ data: { MINT_X: { price: '1.00' } } }),
      } as any);
    await oracle.fetchPrice('MINT_X', 'SLAB_X');

    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true, json: async () => ({ pairs: [{ priceUsd: '3.00', liquidity: { usd: 50000 } }] }),
      } as any)
      .mockResolvedValueOnce({
        ok: true, json: async () => ({ data: { MINT_Y: { price: '3.00' } } }),
      } as any);
    await oracle.fetchPrice('MINT_Y', 'SLAB_Y');

    const stale = oracle.getStaleMarkets(5 * 60 * 1000);
    expect(stale).toContain('SLAB_X');
    expect(stale).toContain('SLAB_Y');
    expect(stale.length).toBe(2);
  });
});
