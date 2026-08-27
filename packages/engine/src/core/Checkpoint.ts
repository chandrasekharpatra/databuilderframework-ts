import { Data, DataSet } from '../types';
import { DataSetImpl } from './DataSetImpl';

/**
 * Current checkpoint format version.
 * Bump this if the checkpoint schema changes.
 */
export const CHECKPOINT_VERSION = 1;

/**
 * Serializable snapshot of a DataSet.
 * Can be safely JSON-stringified and stored for later resumption.
 */
export interface DataSetCheckpoint {
	/**
	 * Schema version of the checkpoint.
	 */
	readonly version: number;

	/**
	 * Data objects contained in the dataset at the time of checkpointing.
	 */
	readonly data: Data[];
}

/**
 * Create a serializable checkpoint from a DataSet.
 * @param dataSet The dataset to checkpoint
 * @returns A plain-object snapshot that can be persisted
 */
export function createCheckpoint(dataSet: DataSet): DataSetCheckpoint {
	return {
		version: CHECKPOINT_VERSION,
		data: Array.from(dataSet.values()),
	};
}

/**
 * Restore a DataSet from a checkpoint.
 * @param checkpoint The checkpoint to restore from
 * @returns A new DataSetImpl populated with the checkpointed data
 */
export function restoreFromCheckpoint(checkpoint: DataSetCheckpoint): DataSetImpl {
	const dataMap = new Map<string, Data>();

	for (const item of checkpoint.data) {
		dataMap.set(item.type, item);
	}

	return new DataSetImpl(dataMap);
}
