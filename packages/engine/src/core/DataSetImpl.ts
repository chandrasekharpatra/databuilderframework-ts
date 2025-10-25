import { Data, DataSet } from '../types/index.js';

/**
 * Concrete implementation of the DataSet interface.
 * Manages a collection of data objects with type-safe access.
 */
export class DataSetImpl implements DataSet {
	private data: Map<string, Data> = new Map();

	/**
	 * Create a new DataSet instance.
	 * @param initialData Optional map of initial data to populate the dataset
	 */
	constructor(initialData?: Map<string, Data>) {
		if (initialData) {
			this.data = new Map(initialData);
		}
	}

	/**
	 * Get data of a specific type from the dataset.
	 * @param dataType The type identifier of the data to retrieve
	 * @returns The data object if found, undefined otherwise
	 */
	accessor<T extends Data>(dataType: string): T | undefined {
		return this.data.get(dataType) as T | undefined;
	}

	/**
	 * Check if the dataset contains data of a specific type.
	 * @param dataType The type identifier to check for
	 * @returns true if data exists, false otherwise
	 */
	contains(dataType: string): boolean {
		return this.data.has(dataType);
	}

	/**
	 * Get the total number of data objects in the dataset.
	 * @returns The number of data objects
	 */
	size(): number {
		return this.data.size;
	}

	/**
	 * Check if the dataset is empty.
	 * @returns true if no data objects exist, false otherwise
	 */
	isEmpty(): boolean {
		return this.data.size === 0;
	}

	/**
	 * Add a data object to the dataset.
	 * If data of the same type already exists, it will be replaced.
	 * @param data The data object to add
	 */
	add(data: Data): void {
		this.data.set(data.type, data);
	}

	/**
	 * Remove data of a specific type from the dataset.
	 * @param dataType The type identifier of the data to remove
	 * @returns true if data was removed, false if it didn't exist
	 */
	remove(dataType: string): boolean {
		return this.data.delete(dataType);
	}

	/**
	 * Get a copy of all data in the dataset.
	 * @returns A new Map containing all the data objects
	 */
	getAll(): Map<string, Data> {
		return new Map(this.data);
	}

	/**
	 * Get all data types currently in the dataset.
	 * @returns Array of all data type identifiers
	 */
	getDataTypes(): string[] {
		return Array.from(this.data.keys());
	}

	/**
	 * Clear all data from the dataset.
	 */
	clear(): void {
		this.data.clear();
	}

	/**
	 * Create a copy of this dataset.
	 * @returns A new DataSetImpl instance with the same data
	 */
	clone(): DataSetImpl {
		return new DataSetImpl(this.data);
	}

	/**
	 * Merge another dataset into this one.
	 * Data from the other dataset will overwrite existing data of the same type.
	 * @param other The dataset to merge into this one
	 */
	merge(other: DataSet): void {
		if (other instanceof DataSetImpl) {
			for (const [type, data] of other.data) {
				this.data.set(type, data);
			}
		} else {
			// If it's not a DataSetImpl, we can't access the internal data directly
			// This is a limitation, but maintains interface compatibility
			throw new Error('Can only merge with another DataSetImpl instance');
		}
	}

	/**
	 * Get a string representation of the dataset for debugging.
	 * @returns String describing the contents of the dataset
	 */
	toString(): string {
		const types = this.getDataTypes();
		return `DataSet(${types.length} items: [${types.join(', ')}])`;
	}
}
