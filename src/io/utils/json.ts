export function cleanCodeBlock(text: string): string {
	const stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
	const firstBrace = stripped.indexOf("{");
	const firstBracket = stripped.indexOf("[");
	let start = -1;
	if (firstBrace !== -1 && firstBracket !== -1)
		start = Math.min(firstBrace, firstBracket);
	else if (firstBrace !== -1) start = firstBrace;
	else if (firstBracket !== -1) start = firstBracket;
	return start !== -1 ? stripped.slice(start).trim() : stripped;
}

export function repairJson(text: string): string {
	let cleaned = cleanCodeBlock(text);
	if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) return cleaned;
	let inString = false;
	let escaped = false;
	let lastValid = -1;
	const stack: string[] = [];
	for (let i = 0; i < cleaned.length; i++) {
		const c = cleaned[i];
		if (c === '"' && !escaped) inString = !inString;
		escaped = c === "\\" && !escaped;
		if (!inString) {
			if (c === "{") stack.push("}");
			else if (c === "[") stack.push("]");
			else if (c === "}" || c === "]") {
				if (stack.length > 0 && stack[stack.length - 1] === c) {
					stack.pop();
					if (stack.length === 0) lastValid = i;
				}
			}
		}
	}
	if (lastValid !== -1 && lastValid < cleaned.length - 1) {
		const rem = cleaned.slice(lastValid + 1).trim();
		if (rem.length > 0 && !rem.startsWith(",") && !rem.startsWith(":"))
			cleaned = cleaned.slice(0, lastValid + 1);
	}
	if (inString) cleaned += '"';
	while (stack.length > 0) cleaned += stack.pop();
	return cleaned.replace(/,\s*([}\]])/g, "$1");
}

export function parseLlmJson<T>(
	text: string,
	schema: { parse: (v: unknown) => T },
): T {
	const json = JSON.parse(repairJson(text));
	return schema.parse(json);
}
