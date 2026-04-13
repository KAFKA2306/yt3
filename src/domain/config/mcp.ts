export interface McpServerConfig {
	command: string;
	args?: string[];
	env?: Record<string, string>;
}
export interface McpConfig {
	servers: {
		context7?: McpServerConfig;
		figma?: McpServerConfig;
		pptx?: McpServerConfig;
		arxiv?: McpServerConfig;
	};
}
