import { describe, expect, it } from "vitest";
import {
  feedRawToNumber,
  moveBps,
  oracleRawToNumber,
  priceRawToProb,
  probToPriceRaw,
  rawToNumber,
  secToNs,
  sizeToQuantityRaw,
} from "../src/units.js";
import { NETWORKS, feedSymbol, venueInfo } from "../src/venues.js";

// Every expected value below comes from docs/verification/*.log.
describe("units against logged values", () => {
  it("testnet fill price 520000 at 6 dp is 0.52 (indexerprobe.log candle openPrice)", () => {
    expect(priceRawToProb("520000", 6)).toBe(0.52);
  });
  it("testnet fill price 980000 at 6 dp is 0.98 (indexerprobe.log first fill)", () => {
    expect(priceRawToProb("980000", 6)).toBe(0.98);
  });
  it("mainnet fill price 155000000000000000 at 18 dp is 0.155 (indexerprobe.log mainnet fill)", () => {
    expect(priceRawToProb("155000000000000000", 18)).toBe(0.155);
  });
  it("oracle opening answer 248937 is 2489.37 (probe2.log openingAnswer)", () => {
    expect(oracleRawToNumber("248937")).toBe(2489.37);
  });
  it("oracle strike 8117664 is 81176.64 (probe2.log BTC/300s question text)", () => {
    expect(oracleRawToNumber("8117664")).toBe(81176.64);
  });
  it("feed spot 2489325000000000000000 is 2489.325 (probe4.log ETH/USDC M1 open)", () => {
    expect(feedRawToNumber("2489325000000000000000")).toBe(2489.325);
  });
  it("feed spot 81285825000000000000000 is 81285.825 (probe2.log fetchPrice raw)", () => {
    expect(feedRawToNumber("81285825000000000000000")).toBe(81285.825);
  });
  it("rawToNumber handles values smaller than one unit", () => {
    expect(rawToNumber("5", 6)).toBe(0.000005);
    expect(rawToNumber(0n, 18)).toBe(0);
  });
});

describe("grid snapping", () => {
  it("snaps 0.05 onto the testnet tick grid exactly (tick 1000 at 6 dp)", () => {
    expect(probToPriceRaw(0.05, 6, 1000n)).toBe(50000n);
  });
  it("snaps 0.05 onto the mainnet tick grid exactly (tick 1e15 at 18 dp) — the float-drift gotcha", () => {
    expect(probToPriceRaw(0.05, 18, 1_000_000_000_000_000n)).toBe(50_000_000_000_000_000n);
  });
  it("rejects probabilities outside (0,1)", () => {
    expect(() => probToPriceRaw(0, 6, 1000n)).toThrow();
    expect(() => probToPriceRaw(1, 6, 1000n)).toThrow();
  });
  it("floors size to the lot grid and can return zero", () => {
    expect(sizeToQuantityRaw(5, 6, 1000n)).toBe(5_000_000n);
    expect(sizeToQuantityRaw(0.0004, 6, 1000n)).toBe(0n);
    expect(sizeToQuantityRaw(0.0015, 6, 1000n)).toBe(1000n);
  });
});

describe("helpers", () => {
  it("moveBps", () => {
    expect(moveBps(2514.2637, 2489.37)).toBeCloseTo(100, 6);
    expect(moveBps(2489.37, 2489.37)).toBe(0);
  });
  it("secToNs", () => {
    expect(secToNs(1788459060)).toBe(1788459060000000000n);
  });
  it("venue lookup is case-insensitive and feed symbols are pairs", () => {
    expect(venueInfo("testnet", NETWORKS.testnet.defaultVenueId.toUpperCase())?.operatorId).toBe(2);
    expect(feedSymbol("btc")).toBe("BTC/USDC");
  });
});
