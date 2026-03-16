import { GammaAPI } from "../src/io/polymarket/gamma_api";
import { Scanner } from "../src/domain/polymarket/scanner";
import { ResearchEngine } from "../src/domain/polymarket/researcher";
import { Predictor } from "../src/domain/polymarket/predictor";
import { RiskManager } from "../src/domain/polymarket/risk_manager";

async function findEdge() {
    console.log("🔍 Scanning Polymarket for High-Edge Opportunities...");

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

    // 1. Scan (Real Data)
    const rawMarkets = await gamma.getMarkets();
    const filtered = scanner.filterMarkets(rawMarkets, 1000, 500, 0.05);
    console.log(`Scan: Found ${filtered.length} liquid markets`);

    const results = [];

    // Limit to top 5 for speed in this demonstration
    for (const m of filtered.slice(0, 5)) {
        console.log(`\nAnalyzing: "${m.question}" (Price: ${m.lastPrice.toFixed(2)})`);

        // 2. Research (Web-AI)
        const sentiment = await researcher.analyzeSentiment(m.question);

        // 3. Predict
        const prediction = predictor.calculateTrueProbability(m.lastPrice, sentiment, 0);
        const edge = prediction.p_model - m.lastPrice;

        console.log(`- Model True Prob: ${prediction.p_model.toFixed(4)}`);
        console.log(`- Detected Edge: ${edge.toFixed(4)}`);

        if (edge > 0.04) {
            const size = risk.calculateKelly(prediction.p_model, 1 / m.lastPrice);
            console.log(`💎 EDGE DETECTED! Recommended Size: ${size.toFixed(2)}`);
            results.push({
                question: m.question,
                price: m.lastPrice,
                p_model: prediction.p_model,
                edge,
                size
            });
        }
    }

    console.log("\n--- Final Results ---");
    if (results.length === 0) {
        console.log("No significant edge found in top 5 markets.");
    } else {
        results.forEach(r => {
            console.log(`[${r.edge.toFixed(4)}] ${r.question} (Price: ${r.price.toFixed(2)})`);
        });
    }
}

findEdge().catch(console.error);
