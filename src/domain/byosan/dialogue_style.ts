import { z } from "zod";
import { loadConfig } from "../../io/core.js";

const DialogueStyleSchema = z.object({
	prompt_heading: z.string().min(1),
	guidance: z.array(z.string().min(1)).min(1),
});

export type DialogueStyle = z.infer<typeof DialogueStyleSchema>;

export function loadDialogueStyle(): DialogueStyle {
	return DialogueStyleSchema.parse(
		(loadConfig("byosan_money") as unknown as { dialogue_style: unknown })
			.dialogue_style,
	);
}

export function renderDialogueStylePrompt(style: DialogueStyle): string {
	return [
		style.prompt_heading,
		...style.guidance.map((rule) => `- ${rule}`),
	].join("\n");
}
