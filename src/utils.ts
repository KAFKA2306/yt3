
import yaml from "js-yaml";

export function cleanCodeBlock(text: string): string {
    return (text ?? "").trim().replace(/^```[a-z]*\n/, "").replace(/```$/, "").trim();
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
