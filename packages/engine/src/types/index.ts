/**
 * Base interface for all data types in the framework.
 * Every piece of data must have a unique type identifier.
 */
export interface Data {
	readonly type: string;
}

/**
 * Interface for accessing and managing a collection of data objects.
 * Provides type-safe access to data by type identifier.
 */
export interface DataSet {
	/**
	 * Get data of a specific type from the dataset.
	 * @param dataType The type identifier of the data to retrieve
	 * @returns The data object if found, undefined otherwise
	 */
	accessor<T extends Data>(dataType: string): T | undefined;

	/**
	 * Check if the dataset contains data of a specific type.
	 * @param dataType The type identifier to check for
	 * @returns true if data exists, false otherwise
	 */
	contains(dataType: string): boolean;

	/**
	 * Get the total number of data objects in the dataset.
	 * @returns The number of data objects
	 */
	size(): number;

	/**
	 * Check if the dataset is empty.
	 * @returns true if no data objects exist, false otherwise
	 */
	isEmpty(): boolean;
}

/**
 * Interface for builders that create data objects.
 * Builders define what data they produce and what data they need as input.
 */
export interface DataBuilder<T extends Data> {
	/**
	 * The type of data this builder produces.
	 */
	readonly provides: string;

	/**
	 * The types of data this builder requires as input.
	 */
	readonly consumes: string[];

	/**
	 * Build the data object using the provided dataset.
	 * @param dataSet The dataset containing input data
	 * @returns Promise that resolves to the built data object
	 */
	build(dataSet: DataSet): Promise<T>;
}

/**
 * Metadata about a data builder for dependency analysis.
 */
export interface DataBuilderMeta {
	/**
	 * A human-readable name for the builder.
	 */
	readonly name: string;

	/**
	 * The type of data this builder produces.
	 */
	readonly provides: string;

	/**
	 * The types of data this builder requires as input.
	 */
	readonly consumes: string[];
}

/**
 * Configuration for a data processing flow.
 * Defines what data should be produced and provides metadata about the flow.
 */
export interface DataFlow {
	/**
	 * A unique name for this data flow.
	 */
	readonly name: string;

	/**
	 * Optional description of what this flow accomplishes.
	 */
	readonly description?: string;

	/**
	 * The types of data that this flow should produce.
	 * The engine will ensure all these data types are built.
	 */
	readonly targetData: string[];
}

/**
 * Context object passed to the execution engine.
 * Contains all the information needed to execute a data flow.
 */
export interface ExecutionContext {
	/**
	 * The data flow configuration to execute.
	 */
	readonly dataFlow: DataFlow;

	/**
	 * Initial data that is already available before execution begins.
	 */
	readonly initialData: DataSet;

	/**
	 * Map of available builders keyed by the data type they produce.
	 */
	readonly builders: Map<string, DataBuilder<any>>;
}
