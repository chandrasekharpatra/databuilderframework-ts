import { Data, DataBuilder, DataSet } from '../types/index';

/**
 * Error thrown when required data is not found in the dataset.
 */
export class RequiredDataNotFoundError extends Error {
	constructor(dataType: string, builderName: string) {
		super(`Required data of type '${dataType}' not found in dataset for builder '${builderName}'`);
		this.name = 'RequiredDataNotFoundError';
	}
}

/**
 * Abstract base class for data builders that provides common functionality.
 * Subclasses only need to implement the build method and define their provides/consumes properties.
 */
export abstract class AbstractDataBuilder<T extends Data> implements DataBuilder<T> {
	/**
	 * The type of data this builder produces.
	 * Must be implemented by subclasses.
	 */
	abstract readonly provides: string;

	/**
	 * The types of data this builder requires as input.
	 * Must be implemented by subclasses.
	 */
	abstract readonly consumes: string[];

	/**
	 * Build the data object using the provided dataset.
	 * Must be implemented by subclasses.
	 * @param dataSet The dataset containing input data
	 * @returns Promise that resolves to the built data object
	 */
	abstract build(dataSet: DataSet): Promise<T>;

	/**
	 * Get required data from the dataset.
	 * Throws an error if the data is not found.
	 * @param dataSet The dataset to search
	 * @param dataType The type of data to retrieve
	 * @returns The data object
	 * @throws RequiredDataNotFoundError if the data is not found
	 */
	protected require<U extends Data>(dataSet: DataSet, dataType: string): U {
		const data = dataSet.accessor<U>(dataType);
		if (!data) {
			throw new RequiredDataNotFoundError(dataType, this.constructor.name);
		}
		return data;
	}

	/**
	 * Get optional data from the dataset.
	 * Returns undefined if the data is not found.
	 * @param dataSet The dataset to search
	 * @param dataType The type of data to retrieve
	 * @returns The data object if found, undefined otherwise
	 */
	protected optional<U extends Data>(dataSet: DataSet, dataType: string): U | undefined {
		return dataSet.accessor<U>(dataType);
	}

	/**
	 * Check if specific data exists in the dataset.
	 * @param dataSet The dataset to check
	 * @param dataType The type of data to check for
	 * @returns true if the data exists, false otherwise
	 */
	protected has(dataSet: DataSet, dataType: string): boolean {
		return dataSet.contains(dataType);
	}

	/**
	 * Validate that all required data types are present in the dataset.
	 * @param dataSet The dataset to validate
	 * @param requiredTypes The data types that must be present
	 * @throws RequiredDataNotFoundError if any required data is missing
	 */
	protected validateRequiredData(dataSet: DataSet, requiredTypes: string[]): void {
		for (const dataType of requiredTypes) {
			if (!dataSet.contains(dataType)) {
				throw new RequiredDataNotFoundError(dataType, this.constructor.name);
			}
		}
	}

	/**
	 * Validate that this builder's consumed data types are present in the dataset.
	 * @param dataSet The dataset to validate
	 * @throws RequiredDataNotFoundError if any consumed data is missing
	 */
	protected validateConsumedData(dataSet: DataSet): void {
		this.validateRequiredData(dataSet, this.consumes);
	}

	/**
	 * Get multiple data objects from the dataset.
	 * @param dataSet The dataset to search
	 * @param dataTypes The types of data to retrieve
	 * @returns Map of data type to data object (only includes found data)
	 */
	protected getMultiple<U extends Data>(dataSet: DataSet, dataTypes: string[]): Map<string, U> {
		const result = new Map<string, U>();

		for (const dataType of dataTypes) {
			const data = dataSet.accessor<U>(dataType);
			if (data) {
				result.set(dataType, data);
			}
		}

		return result;
	}

	/**
	 * Get all consumed data objects from the dataset.
	 * Only returns data that is actually present in the dataset.
	 * @param dataSet The dataset to search
	 * @returns Map of data type to data object
	 */
	protected getConsumedData<U extends Data>(dataSet: DataSet): Map<string, U> {
		return this.getMultiple<U>(dataSet, this.consumes);
	}

	/**
	 * Create a data object with the provided type and additional properties.
	 * This is a utility method to help with creating properly typed data objects.
	 * @param type The data type identifier
	 * @param properties Additional properties for the data object
	 * @returns The created data object
	 */
	protected createData<U extends Data>(type: string, properties: Omit<U, 'type'>): U {
		return { type, ...properties } as U;
	}

	/**
	 * Get a string representation of this builder for debugging and logging.
	 * @returns String representation of the builder
	 */
	toString(): string {
		return `${this.constructor.name}(provides: ${this.provides}, consumes: [${this.consumes.join(', ')}])`;
	}

	/**
	 * Get metadata about this builder.
	 * @returns Builder metadata object
	 */
	getMetadata(): { name: string; provides: string; consumes: string[] } {
		return {
			name: this.constructor.name,
			provides: this.provides,
			consumes: [...this.consumes], // Create a copy to prevent mutation
		};
	}
}

/**
 * Abstract base class for builders that don't require any input data.
 * These are typically source builders that generate initial data.
 */
export abstract class SourceDataBuilder<T extends Data> extends AbstractDataBuilder<T> {
	/**
	 * Source builders consume no data.
	 */
	readonly consumes: string[] = [];

	/**
	 * Build the data object without any input dependencies.
	 * @param dataSet The dataset (not used by source builders but required by interface)
	 * @returns Promise that resolves to the built data object
	 */
	abstract build(dataSet: DataSet): Promise<T>;
}

/**
 * Abstract base class for builders that transform a single input data type.
 * This is a common pattern for data transformation builders.
 */
export abstract class TransformDataBuilder<TInput extends Data, TOutput extends Data> extends AbstractDataBuilder<TOutput> {
	/**
	 * The type of input data this transformer requires.
	 */
	abstract readonly inputType: string;

	/**
	 * Transform builders consume exactly one data type.
	 */
	get consumes(): string[] {
		return [this.inputType];
	}

	/**
	 * Transform the input data into the output data.
	 * @param input The input data object
	 * @returns Promise that resolves to the transformed data object
	 */
	abstract transform(input: TInput): Promise<TOutput>;

	/**
	 * Build the data object by transforming the required input.
	 * @param dataSet The dataset containing input data
	 * @returns Promise that resolves to the built data object
	 */
	async build(dataSet: DataSet): Promise<TOutput> {
		const input = this.require<TInput>(dataSet, this.inputType);
		return this.transform(input);
	}
}

/**
 * Abstract base class for builders that combine multiple input data types.
 * This is useful for aggregation or merging operations.
 */
export abstract class CombineDataBuilder<T extends Data> extends AbstractDataBuilder<T> {
	/**
	 * Combine multiple input data objects into a single output.
	 * @param inputs Map of data type to data object
	 * @returns Promise that resolves to the combined data object
	 */
	abstract combine(inputs: Map<string, Data>): Promise<T>;

	/**
	 * Build the data object by combining all consumed data.
	 * @param dataSet The dataset containing input data
	 * @returns Promise that resolves to the built data object
	 */
	async build(dataSet: DataSet): Promise<T> {
		this.validateConsumedData(dataSet);
		const inputs = this.getConsumedData(dataSet);
		return this.combine(inputs);
	}
}
