import { Data, DataBuilder, DataBuilderMeta } from '../types/index.js';

/**
 * Error thrown when attempting to register a duplicate builder.
 */
export class DuplicateBuilderError extends Error {
	constructor(dataType: string) {
		super(`Builder for data type '${dataType}' is already registered`);
		this.name = 'DuplicateBuilderError';
	}
}

/**
 * Error thrown when attempting to access a builder that doesn't exist.
 */
export class BuilderNotFoundError extends Error {
	constructor(dataType: string) {
		super(`No builder found for data type '${dataType}'`);
		this.name = 'BuilderNotFoundError';
	}
}

/**
 * Registry for managing data builders.
 * Handles registration, lookup, and metadata extraction for builders.
 */
export class BuilderRegistry {
	private builders: Map<string, DataBuilder<any>> = new Map();

	/**
	 * Register a data builder with the registry.
	 * @param builder The builder to register
	 * @param allowOverwrite Whether to allow overwriting existing builders (default: false)
	 * @throws DuplicateBuilderError if a builder for the same data type is already registered and allowOverwrite is false
	 */
	register<T extends Data>(builder: DataBuilder<T>, allowOverwrite: boolean = false): void {
		if (this.builders.has(builder.provides) && !allowOverwrite) {
			throw new DuplicateBuilderError(builder.provides);
		}
		this.builders.set(builder.provides, builder);
	}

	/**
	 * Unregister a data builder from the registry.
	 * @param dataType The data type of the builder to unregister
	 * @returns true if a builder was unregistered, false if none existed
	 */
	unregister(dataType: string): boolean {
		return this.builders.delete(dataType);
	}

	/**
	 * Get a registered builder by data type.
	 * @param dataType The data type to look up
	 * @returns The builder if found, undefined otherwise
	 */
	get<T extends Data>(dataType: string): DataBuilder<T> | undefined {
		return this.builders.get(dataType) as DataBuilder<T> | undefined;
	}

	/**
	 * Get a registered builder by data type, throwing an error if not found.
	 * @param dataType The data type to look up
	 * @returns The builder
	 * @throws BuilderNotFoundError if the builder is not found
	 */
	getRequired<T extends Data>(dataType: string): DataBuilder<T> {
		const builder = this.get<T>(dataType);
		if (!builder) {
			throw new BuilderNotFoundError(dataType);
		}
		return builder;
	}

	/**
	 * Check if a builder is registered for the given data type.
	 * @param dataType The data type to check
	 * @returns true if a builder is registered, false otherwise
	 */
	has(dataType: string): boolean {
		return this.builders.has(dataType);
	}

	/**
	 * Get all registered builders.
	 * @returns A copy of the builders map
	 */
	getAll(): Map<string, DataBuilder<any>> {
		return new Map(this.builders);
	}

	/**
	 * Get metadata for all registered builders.
	 * @returns Array of builder metadata
	 */
	getAllMetadata(): DataBuilderMeta[] {
		return Array.from(this.builders.values()).map((builder) => ({
			name: builder.constructor.name,
			provides: builder.provides,
			consumes: builder.consumes,
		}));
	}

	/**
	 * Get metadata for a specific builder.
	 * @param dataType The data type to get metadata for
	 * @returns Builder metadata if found, undefined otherwise
	 */
	getMetadata(dataType: string): DataBuilderMeta | undefined {
		const builder = this.get(dataType);
		if (!builder) {
			return undefined;
		}

		return {
			name: builder.constructor.name,
			provides: builder.provides,
			consumes: builder.consumes,
		};
	}

	/**
	 * Get all data types that are provided by registered builders.
	 * @returns Array of data types
	 */
	getProvidedTypes(): string[] {
		return Array.from(this.builders.keys());
	}

	/**
	 * Get all data types that are consumed by registered builders.
	 * @returns Array of unique data types that are consumed
	 */
	getConsumedTypes(): string[] {
		const consumedTypes = new Set<string>();

		for (const builder of this.builders.values()) {
			for (const consumedType of builder.consumes) {
				consumedTypes.add(consumedType);
			}
		}

		return Array.from(consumedTypes);
	}

	/**
	 * Find builders that provide the given data types.
	 * @param dataTypes The data types to find builders for
	 * @returns Map of data type to builder, only includes types that have builders
	 */
	findBuilders(dataTypes: string[]): Map<string, DataBuilder<any>> {
		const result = new Map<string, DataBuilder<any>>();

		for (const dataType of dataTypes) {
			const builder = this.get(dataType);
			if (builder) {
				result.set(dataType, builder);
			}
		}

		return result;
	}

	/**
	 * Find missing builders for the given data types.
	 * @param dataTypes The data types to check
	 * @returns Array of data types that don't have registered builders
	 */
	findMissingBuilders(dataTypes: string[]): string[] {
		return dataTypes.filter((dataType) => !this.has(dataType));
	}

	/**
	 * Clear all registered builders.
	 */
	clear(): void {
		this.builders.clear();
	}

	/**
	 * Get the number of registered builders.
	 * @returns The number of builders
	 */
	size(): number {
		return this.builders.size;
	}

	/**
	 * Check if the registry is empty.
	 * @returns true if no builders are registered, false otherwise
	 */
	isEmpty(): boolean {
		return this.builders.size === 0;
	}

	/**
	 * Register multiple builders at once.
	 * @param builders Array of builders to register
	 * @param allowOverwrite Whether to allow overwriting existing builders
	 * @throws DuplicateBuilderError if any builder conflicts and allowOverwrite is false
	 */
	registerMany(builders: DataBuilder<any>[], allowOverwrite: boolean = false): void {
		for (const builder of builders) {
			this.register(builder, allowOverwrite);
		}
	}

	/**
	 * Create a subset registry containing only builders for the specified data types.
	 * @param dataTypes The data types to include in the subset
	 * @returns A new BuilderRegistry containing only the specified builders
	 */
	createSubset(dataTypes: string[]): BuilderRegistry {
		const subset = new BuilderRegistry();

		for (const dataType of dataTypes) {
			const builder = this.get(dataType);
			if (builder) {
				subset.register(builder, true); // Allow overwrite in subset
			}
		}

		return subset;
	}

	/**
	 * Check if builders are available for the given target types and their dependencies.
	 * This only verifies builder existence, not dependency cycles or correctness.
	 * @param targetTypes The data types that need to be built
	 * @returns Object containing availability check results
	 */
	checkBuilderAvailability(targetTypes: string[]): {
		isValid: boolean;
		missingBuilders: string[];
		satisfiableTypes: string[];
	} {
		const visited = new Set<string>();
		const missing = new Set<string>();
		const satisfiable = new Set<string>();

		const checkDependencies = (dataType: string) => {
			if (visited.has(dataType)) {
				return;
			}
			visited.add(dataType);

			const builder = this.get(dataType);
			if (!builder) {
				missing.add(dataType);
				return;
			}

			satisfiable.add(dataType);

			// Recursively check dependencies
			for (const consumedType of builder.consumes) {
				checkDependencies(consumedType);
			}
		};

		for (const targetType of targetTypes) {
			checkDependencies(targetType);
		}

		return {
			isValid: missing.size === 0,
			missingBuilders: Array.from(missing),
			satisfiableTypes: Array.from(satisfiable),
		};
	}

	/**
	 * Get a string representation of the registry for debugging.
	 * @returns String describing the registry contents
	 */
	toString(): string {
		const builderCount = this.size();
		const providedTypes = this.getProvidedTypes();
		return `BuilderRegistry(${builderCount} builders: [${providedTypes.join(', ')}])`;
	}
}
