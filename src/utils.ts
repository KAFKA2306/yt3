
import yaml from "js-yaml";

export function cleanCodeBlock(text: string): string {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/i);
    if (match && match[1]) {
        return match[1].trim();
    }
    return text.trim();
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
