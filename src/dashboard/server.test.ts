import { describe, expect, it } from "bun:test";

// Escape function from server.ts
function escape(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

describe("XSS Protection", () => {
	it("should escape script tags", () => {
		const input = '<script>alert("XSS")</script>';
		const output = escape(input);
		expect(output).toBe("&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;");
	});

	it("should escape img tags with onerror", () => {
		const input = '<img src=x onerror="alert(1)">';
		const output = escape(input);
		expect(output).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
	});

	it("should escape svg onload events", () => {
		const input = '<svg onload="alert(1)">';
		const output = escape(input);
		expect(output).toBe("&lt;svg onload=&quot;alert(1)&quot;&gt;");
	});

	it("should escape onclick handlers", () => {
		const input = '<span onclick="alert(1)">Hacker</span>';
		const output = escape(input);
		expect(output).toBe(
			"&lt;span onclick=&quot;alert(1)&quot;&gt;Hacker&lt;/span&gt;",
		);
	});

	it("should escape all special characters", () => {
		const testCases = [
			{ input: "&", expected: "&amp;" },
			{ input: "<", expected: "&lt;" },
			{ input: ">", expected: "&gt;" },
			{ input: '"', expected: "&quot;" },
			{ input: "'", expected: "&#39;" },
		];

		for (const { input, expected } of testCases) {
			expect(escape(input)).toBe(expected);
		}
	});

	it("should escape ampersand first to avoid double escaping", () => {
		const input = "&<>";
		const output = escape(input);
		expect(output).toBe("&amp;&lt;&gt;");
	});
});
