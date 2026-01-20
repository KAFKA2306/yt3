
import yaml from "js-yaml";

export function cleanCodeBlock(text: any): string {
    const s = typeof text === "string" ? text : JSON.stringify(text);
    const match = s.match(/```(?:json|yaml|)\s*([\s\S]*?)\s*```/i);
    return (match ? match[1] : s).trim();
}

export function parseLlmJson<T>(text: any): T {
    try {
        return JSON.parse(cleanCodeBlock(text)) as T;
    } catch (e) {
        console.error("JSON Parse Error:", e);
        return {} as T;
    }
}

export function parseLlmYaml<T>(text: any): T {
    try {
        return yaml.load(cleanCodeBlock(text)) as T;
    } catch (e) {
        console.error("YAML Parse Error:", e);
        return {} as T;
    }
}
