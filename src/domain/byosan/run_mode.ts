const INTERACTIVE_RUN_SUFFIX = /-interactive-[a-z0-9]+$/i;

export function isInteractiveByosanRun(runId: string): boolean {
	return INTERACTIVE_RUN_SUFFIX.test(runId);
}
