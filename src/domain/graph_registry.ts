export type WorkflowPhase =
	| "problem-exploration"
	| "solution-convergence"
	| "implementation-planning"
	| "code-generation"
	| "code-review"
	| "testing"
	| "documentation"
	| "debugging";

export interface GraphNodeMetadata {
	name: string;
	phase: WorkflowPhase;
	type: "agent" | "orchestrator";
	description?: string;
}

export const NODE_METADATA: Record<string, GraphNodeMetadata> = {
	research: {
		name: "research",
		phase: "problem-exploration",
		type: "agent",
		description: "Trend discovery and problem analysis",
	},
	strategy: {
		name: "strategy",
		phase: "solution-convergence",
		type: "agent",
		description: "Strategic insight extraction and solution evaluation",
	},
	content: {
		name: "content",
		phase: "implementation-planning",
		type: "agent",
		description: "Script and metadata synthesis",
	},
	media: {
		name: "media",
		phase: "code-generation",
		type: "agent",
		description: "Audio and video asset generation",
	},
	publish: {
		name: "publish",
		phase: "code-review",
		type: "agent",
		description: "Upload and publish to YouTube and social channels",
	},
	notebooklm: {
		name: "notebooklm",
		phase: "code-generation",
		type: "agent",
		description: "NotebookLM video generation",
	},
	parallel_research: {
		name: "parallel_research",
		phase: "solution-convergence",
		type: "agent",
		description: "Parallel financial & web research post-NotebookLM",
	},
	memory: {
		name: "memory",
		phase: "debugging",
		type: "agent",
		description: "Run results persistence and memory update",
	},
};

export function getNodeMetadata(
	nodeName: string,
): GraphNodeMetadata | undefined {
	return NODE_METADATA[nodeName];
}

export function getNodesByPhase(phase: WorkflowPhase): GraphNodeMetadata[] {
	return Object.values(NODE_METADATA).filter((node) => node.phase === phase);
}

export function getAllPhases(): WorkflowPhase[] {
	const phases = new Set<WorkflowPhase>();
	for (const node of Object.values(NODE_METADATA)) {
		phases.add(node.phase);
	}
	return Array.from(phases);
}
