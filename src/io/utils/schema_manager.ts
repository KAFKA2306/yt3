import path from "node:path";
import fs from "fs-extra";
import { ROOT } from "../base.js";
import { AgentLogger as Logger } from "./logger.js";

interface SchemaMetadata {
	version: string;
	description: string;
	timestamp: string;
}

interface ManagedSchema {
	schema: Record<string, unknown>;
	metadata: SchemaMetadata;
}

export class SchemaManager {
	private static readonly SCHEMA_DIR = path.join(ROOT, "config/schemas");
	private static cache = new Map<string, ManagedSchema>();

	static loadSchema(name: string): Record<string, unknown> {
		const cached = SchemaManager.cache.get(name);
		if (cached) return cached.schema;

		const filePath = path.join(SchemaManager.SCHEMA_DIR, `${name}.json`);
		if (!fs.existsSync(filePath)) {
			Logger.error(
				"SYSTEM",
				"SCHEMA",
				"NOT_FOUND",
				`Schema ${name} not found at ${filePath}`,
			);
			throw new Error(`Schema ${name} not found`);
		}

		const data = fs.readJsonSync(filePath);
		const managed: ManagedSchema = {
			schema: data.$schema
				? data
				: { ...data, $schema: "http://json-schema.org/draft-07/schema#" },
			metadata: {
				version: "v2",
				description: data.description || "",
				timestamp: new Date().toISOString(),
			},
		};

		SchemaManager.cache.set(name, managed);
		Logger.info("SYSTEM", "SCHEMA", "LOADED", `Loaded schema: ${name}`);
		return managed.schema;
	}

	static getAvailableSchemas(): string[] {
		if (!fs.existsSync(SchemaManager.SCHEMA_DIR)) {
			return [];
		}
		return fs
			.readdirSync(SchemaManager.SCHEMA_DIR)
			.filter((f) => f.endsWith(".json"))
			.map((f) => f.replace(".json", ""));
	}

	static registerSchema(name: string, schema: Record<string, unknown>): void {
		const schemaDir = SchemaManager.SCHEMA_DIR;
		fs.ensureDirSync(schemaDir);
		const filePath = path.join(schemaDir, `${name}.json`);

		const withMetadata = {
			...schema,
			$schema: schema.$schema || "http://json-schema.org/draft-07/schema#",
		};

		fs.writeJsonSync(filePath, withMetadata, { spaces: 2 });
		SchemaManager.cache.delete(name); // Invalidate cache
		Logger.info("SYSTEM", "SCHEMA", "REGISTERED", `Registered schema: ${name}`);
	}

	static validateAgainstSchema(
		data: unknown,
		schemaName: string,
	): { valid: boolean; errors?: string[] } {
		try {
			const schema = SchemaManager.loadSchema(schemaName);
			// Basic JSON Schema validation without external library
			if (typeof data !== "object" || data === null) {
				return { valid: false, errors: ["Data must be an object"] };
			}

			const obj = data as Record<string, unknown>;
			const required = (schema.required as string[]) || [];

			const missingFields = required.filter((field) => !(field in obj));
			if (missingFields.length > 0) {
				return {
					valid: false,
					errors: [`Missing required fields: ${missingFields.join(", ")}`],
				};
			}

			return { valid: true };
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			return { valid: false, errors: [msg] };
		}
	}

	static clearCache(): void {
		SchemaManager.cache.clear();
	}
}
