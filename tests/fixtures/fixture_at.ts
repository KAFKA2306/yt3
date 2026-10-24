export function fixtureAt<T>(values: readonly T[], index: number): T {
	const value = values[index];
	if (value === undefined) throw new Error(`fixture index ${index} is missing`);
	return value;
}
