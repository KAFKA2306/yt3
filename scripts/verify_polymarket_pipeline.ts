import { Scanner } from "../src/domain/polymarket/scanner";
import { ResearchEngine } from "../src/domain/polymarket/researcher";
import { Predictor } from "../src/domain/polymarket/predictor";
import { RiskManager } from "../src/domain/polymarket/risk_manager";
import { Executor } from "../src/domain/polymarket/executor";
import { LearningLoop } from "../src/domain/polymarket/learning_loop";
import { GammaAPI } from "../src/io/polymarket/gamma_api";

async function verify() {
    console.log("🚀 Starting Polymarket Quant Bot Verification...");

    const gamma = new GammaAPI();
    const scanner = new Scanner();
    const researcher = new ResearchEngine();
    const predictor = new Predictor();
    const risk = new RiskManager({
        alpha: 0.25,
        maxExposure: 1000,
        dailyVaRLimit: 100,
        maxDrawdownLimit: 0.08,
        minEdge: 0.04,
    });
    const executor = new Executor();
    const learner = new LearningLoop();

    // 1. Scan
    const rawMarkets = await gamma.getMarkets();
    const filtered = scanner.filterMarkets(rawMarkets, 100000, 50000, 0.02);
    console.log(`Scan: Found ${filtered.length} viable markets`);

    for (const m of filtered) {
        // 2. Research
        const sentiment = await researcher.analyzeSentiment(m.question);

        // 3. Predict
        const prediction = predictor.calculateTrueProbability(m.lastPrice, sentiment, 0);
        const edge = prediction.p_model - m.lastPrice;
        console.log(`Predict: Edge detected: ${edge.toFixed(4)}`);

        // 4. Risk
        const size = risk.calculateKelly(prediction.p_model, 1 / m.lastPrice);
        const allowed = risk.checkTrade(edge, size, 0, 0, 0);

        if (allowed) {
            console.log(`Risk: Approved! Position size: ${size.toFixed(2)}`);

            // 5. Execute
            await executor.executeOrder(m.id, "BUY", size, m.lastPrice);

            // 6. Compound
            learner.recordTrade({ m, prediction, size }, "WIN");
        } else {
            console.log("Risk: Rejected (Edge too small or risk limit hit)");
        }
    }

    console.log("✅ Verification Complete!");
}

verify().catch(console.error);
