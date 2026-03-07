import { EventDrivenAnalystAgent } from "./domain/agents/event_driven_analyst_agent.js";
import { ExecutiveReporterAgent } from "./domain/agents/executive_reporter_agent.js";
import { FundamentalAuditAgent } from "./domain/agents/fundamental_audit_agent.js";
import { MacroRegimeAnalystAgent } from "./domain/agents/macro_regime_analyst_agent.js";
import { RiskHedgingAgent } from "./domain/agents/risk_hedging_agent.js";
import { WhaleWatcherAgent } from "./domain/agents/whale_watcher_agent.js";
import { AssetStore, getRunIdDateString } from "./io/core.js";
import { AgentLogger } from "./io/utils/logger.js";

async function main() {
	const runId = process.env.RUN_ID || `report-${getRunIdDateString()}`;
	const store = new AssetStore(runId);
	AgentLogger.init();

	AgentLogger.info(
		"SYSTEM",
		"REPORT",
		"START",
		`Starting Executive Report Generation (RunID: ${runId})`,
	);

	const fundamentalAgent = new FundamentalAuditAgent(store);
	const macroAgent = new MacroRegimeAnalystAgent(store);
	const riskAgent = new RiskHedgingAgent(store);
	const eventAgent = new EventDrivenAnalystAgent(store);
	const whaleAgent = new WhaleWatcherAgent(store);
	const reporter = new ExecutiveReporterAgent(store);

	AgentLogger.info(
		"SYSTEM",
		"REPORT",
		"ANALYSTS",
		"Running all analyst agents in parallel...",
	);

	const [fundamental, macro, risk, event, whale] = await Promise.all([
		fundamentalAgent.run(),
		macroAgent.run(),
		riskAgent.run(),
		eventAgent.run(),
		whaleAgent.run(),
	]);

	const analystOutputs = {
		fundamental,
		macro,
		risk,
		event,
		whale,
	};

	AgentLogger.info(
		"SYSTEM",
		"REPORT",
		"REPORTER",
		"Synthesizing executive briefing...",
	);
	const report = await reporter.run(analystOutputs);

	AgentLogger.info(
		"SYSTEM",
		"REPORT",
		"SUCCESS",
		"Executive Report generated successfully",
		{
			context: { report_summary: report.executive_briefing.trade_ideas },
		},
	);

	console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
	AgentLogger.error("SYSTEM", "REPORT", "FAILED", err.message);
	process.exit(1);
});
