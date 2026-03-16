import { describe, expect, it } from "bun:test";
import { RiskManager } from "./risk_manager";

describe("RiskManager", () => {
	const config = {
		alpha: 0.5,
		maxExposure: 1000,
		dailyVaRLimit: 100,
		maxDrawdownLimit: 0.08,
		minEdge: 0.04,
	};
	const rm = new RiskManager(config);

	it("calculates fractional kelly correctly", () => {
		const p = 0.6;
		const odds = 2.0; // b = 1
		// f* = (0.6 * 1 - 0.4) / 1 = 0.2
		// f = 0.2 * 0.5 = 0.1
		expect(rm.calculateKelly(p, odds)).toBeCloseTo(0.1);
	});

	it("calculates VaR correctly", () => {
		const mu = 50;
		const sigma = 10;
		// VaR = 50 - 1.645 * 10 = 33.55
		expect(rm.calculateVaR(mu, sigma)).toBeCloseTo(33.55);
	});

	it("blocks trades below min edge", () => {
		expect(rm.checkTrade(0.03, 10, 0, 0, 0)).toBe(false);
	});

	it("blocks trades exceeding max exposure", () => {
		expect(rm.checkTrade(0.05, 1001, 0, 0, 0)).toBe(false);
	});

	it("blocks trades when MDD limit is hit", () => {
		expect(rm.checkTrade(0.05, 10, 0, 0.09, 0)).toBe(false);
	});
});
