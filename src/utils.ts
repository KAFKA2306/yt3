
import yaml from "js-yaml";

export function cleanCodeBlock(text: string): string {
    let cleaned = text.trim();
    if (cleaned.startsWith("```")) {
        const lines = cleaned.split("\n");
        if (lines.length > 1) {
            cleaned = lines.slice(1).join("\n");
        }
        cleaned = cleaned.replace(/```$/, "");
        if (cleaned.endsWith("```")) {
            cleaned = cleaned.substring(0, cleaned.length - 3);
        }
    }
    return cleaned.trim();
}

type Parser<T> = (text: string) => T;

export function parseLlmContent<T>(text: string, parser: Parser<T>): T {
    return parser(cleanCodeBlock(text));
}

export function parseLlmJson<T>(text: string): T {
    return parseLlmContent(text, (t) => JSON.parse(t) as T);
}

export function parseLlmYaml<T>(text: string): T {
    return parseLlmContent(text, (t) => yaml.load(t) as T);
}
