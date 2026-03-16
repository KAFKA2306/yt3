# Polymarket Quant Trading Bot Skill (2026 Protocol)

Quant-grade automated trading pipeline for Prediction Markets (Polymarket). This skill implements a sequential 6-step agent swarm controlled by deterministic risk logic and Bayesian probability updating.

## Pipeline Architecture (SEQUENTIAL / MCP ENHANCED / DOMAIN INTEL)

1. **Scan (SEQUENTIAL)**: Filter 300+ active markets for liquidity, volume, and spread anomalies. Identify mispriced events.
2. **Research (MCP ENHANCED)**: Parallel NLP analysis of Twitter/Reddit/RSS. Compare "Narrative Odds" with "Market Odds".
3. **Predict (DOMAIN INTEL)**: Hybrid XGBoost + LLM calculation of `p_model` (True Probability).
4. **Risk (CONTEXT-AWARE)**: Deterministic verification of position sizing using Fractional Kelly and VaR (Value at Risk).
5. **Execute (SEQUENTIAL)**: On-chain order execution via CLOB API with slippage monitoring.
6. **Compound (ITERATIVE)**: Automated post-mortem analysis of losses to update the Knowledge Base.

## Core Quants Logic (DETERMINISTIC)

### Edge Detection
- **Expected Value (EV)**: `EV = p_model * b - (1 - p_model)` (b = decimal odds - 1)
- **Market Edge**: `edge = p_model - p_mkt`. Execute ONLY if `edge > 0.04`.
- **Bayesian Update**: `P(H|E) = P(E|H) * P(H) / P(E)` for real-time news integration.
- **Accuracy Metric**: Maintain `Brier Score` per market category.

### Position Sizing
- **Full Kelly**: `f* = (p_model * b - (1 - p_model)) / b`
- **Fractional Kelly**: `f = alpha * f*` (alpha = 0.25 to 0.5)
- **VaR 95%**: `VaR = mu - 1.645 * sigma`
- **Max Drawdown (MDD)**: Block all new trades if `MDD > 0.08`.

## Strict Rules
- NEVER use LLM for math or risk calculations.
- Kelly Criterion MUST be verified by deterministic script before Execution.
- All news sentiment MUST be quantified into probability deltas.
- Cumulative exposure MUST NOT exceed `max_exposure` defined in config.

## Triggers
- "polymarket trade", "start quant bot", "scan prediction markets", "evaluate event probability", "check betting edge"
