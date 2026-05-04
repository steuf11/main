import { estimateRaydiumOutput, RAYDIUM_POOLS } from "../src/raydium-client";

describe("Raydium Client", () => {
  describe("RAYDIUM_POOLS registry", () => {
    it("has SOL/USDC pool registered", () => {
      expect(RAYDIUM_POOLS["SOL/USDC"]).toBeDefined();
      expect(typeof RAYDIUM_POOLS["SOL/USDC"]).toBe("string");
      expect(RAYDIUM_POOLS["SOL/USDC"].length).toBeGreaterThan(20);
    });

    it("all pool IDs are non-empty strings", () => {
      for (const [pair, id] of Object.entries(RAYDIUM_POOLS)) {
        expect(typeof id).toBe("string");
        expect(id.length).toBeGreaterThan(20);
      }
    });
  });

  describe("estimateRaydiumOutput", () => {
    it("deducts fee from gross output", () => {
      // 100 USDC → SOL at price 0.01 SOL/USDC, 0.25% fee
      const out = estimateRaydiumOutput(100, 0.01, 0.0025);
      const gross = 100 * 0.01; // 1 SOL
      expect(out).toBeLessThan(gross);
      expect(out).toBeCloseTo(gross * (1 - 0.0025), 5);
    });

    it("returns 0 for 0 input", () => {
      expect(estimateRaydiumOutput(0, 100, 0.0025)).toBe(0);
    });

    it("returns gross output when fee is 0", () => {
      const gross = 100 * 79.5;
      expect(estimateRaydiumOutput(100, 79.5, 0)).toBeCloseTo(gross, 5);
    });

    it("handles high fee rates correctly", () => {
      // 1% fee
      const out = estimateRaydiumOutput(1000, 1, 0.01);
      expect(out).toBeCloseTo(990, 1);
    });

    it("never returns a negative value for valid inputs", () => {
      const out = estimateRaydiumOutput(100, 50, 0.9999);
      expect(out).toBeGreaterThanOrEqual(0);
    });
  });
});
