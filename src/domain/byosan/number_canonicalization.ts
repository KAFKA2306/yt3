export const BYOSAN_NUMBER_PATTERN =
	/\d+(?:,\d{3})*(?:\.\d+)?(?:万|億|兆)(?:(?:\d{1,3}(?:,\d{3})*)|\d{4,})?|\d+(?:,\d{3})*(?:\.\d+)?/gu;

export function canonicalNumber(token: string): string {
	const match =
		/^([\d,]+(?:\.\d+)?)(万|億|兆)?((?:\d{1,3}(?:,\d{3})*)|\d{4,})?$/u.exec(
			token,
		);
	if (!match) return Number(token.replaceAll(",", "")).toString();
	const base = Number((match[1] ?? "0").replaceAll(",", ""));
	const multiplier =
		match[2] === "兆"
			? 1e12
			: match[2] === "億"
				? 1e8
				: match[2] === "万"
					? 1e4
					: 1;
	const remainder = Number((match[3] ?? "0").replaceAll(",", ""));
	return (base * multiplier + remainder).toString();
}

export function canonicalNumberTokens(text: string): string[] {
	return (text.normalize("NFKC").match(BYOSAN_NUMBER_PATTERN) ?? []).map(
		canonicalNumber,
	);
}
