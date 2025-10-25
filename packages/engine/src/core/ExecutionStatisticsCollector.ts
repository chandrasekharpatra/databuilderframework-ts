/**
 * Statistics about the execution process.
 */
export interface ExecutionStats {
	/**
	 * Total number of builders executed.
	 */
	readonly buildersExecuted: number;

	/**
	 * Total execution time in milliseconds.
	 */
	readonly totalExecutionTime: number;

	/**
	 * Execution time for each builder in milliseconds.
	 */
	readonly builderExecutionTimes: Map<string, number>;

	/**
	 * Number of data objects that were already present and didn't need to be built.
	 */
	readonly skipCount: number;

	/**
	 * Whether parallel execution was used.
	 */
	readonly parallelExecution: boolean;

	/**
	 * Number of parallel execution levels (only relevant for parallel execution).
	 */
	readonly parallelLevels?: number;

	/**
	 * Maximum number of builders executed concurrently in any level.
	 */
	readonly maxConcurrency?: number;
}

/**
 * Tracks timing and execution statistics during data flow execution.
 * Provides methods to start/stop timers and collect execution metrics.
 */
export class ExecutionStatisticsCollector {
	private startTime: number = 0;
	private builderExecutionTimes: Map<string, number> = new Map();
	private buildersExecuted: number = 0;
	private skipCount: number = 0;
	private parallelExecution: boolean = false;
	private parallelLevels?: number;
	private maxConcurrency?: number;

	/**
	 * Start timing the overall execution.
	 */
	startExecution(): void {
		this.startTime = Date.now();
		this.reset();
	}

	/**
	 * Stop timing the overall execution and return the final statistics.
	 * @returns Complete execution statistics
	 */
	stopExecution(): ExecutionStats {
		const totalExecutionTime = Date.now() - this.startTime;

		return {
			buildersExecuted: this.buildersExecuted,
			totalExecutionTime,
			builderExecutionTimes: new Map(this.builderExecutionTimes),
			skipCount: this.skipCount,
			parallelExecution: this.parallelExecution,
			parallelLevels: this.parallelLevels,
			maxConcurrency: this.maxConcurrency,
		};
	}

	/**
	 * Record the execution time for a specific builder.
	 * @param dataType The data type the builder produces
	 * @param executionTime The time it took to execute the builder in milliseconds
	 */
	recordBuilderExecution(dataType: string, executionTime: number): void {
		this.builderExecutionTimes.set(dataType, executionTime);
		this.buildersExecuted++;
	}

	/**
	 * Record that a builder was skipped because its data already existed.
	 */
	recordSkippedBuilder(): void {
		this.skipCount++;
	}

	/**
	 * Set parallel execution metadata.
	 * @param parallelLevels Number of parallel execution levels
	 * @param maxConcurrency Maximum number of builders executed concurrently
	 */
	setParallelExecutionInfo(parallelLevels: number, maxConcurrency: number): void {
		this.parallelExecution = true;
		this.parallelLevels = parallelLevels;
		this.maxConcurrency = maxConcurrency;
	}

	/**
	 * Mark execution as sequential (default).
	 */
	setSequentialExecution(): void {
		this.parallelExecution = false;
		this.parallelLevels = undefined;
		this.maxConcurrency = undefined;
	}

	/**
	 * Reset all statistics to initial state.
	 */
	reset(): void {
		this.builderExecutionTimes.clear();
		this.buildersExecuted = 0;
		this.skipCount = 0;
		this.parallelExecution = false;
		this.parallelLevels = undefined;
		this.maxConcurrency = undefined;
	}

	/**
	 * Get current statistics without stopping the execution timer.
	 * @returns Current statistics snapshot
	 */
	getCurrentStats(): Partial<ExecutionStats> {
		return {
			buildersExecuted: this.buildersExecuted,
			builderExecutionTimes: new Map(this.builderExecutionTimes),
			skipCount: this.skipCount,
			parallelExecution: this.parallelExecution,
			parallelLevels: this.parallelLevels,
			maxConcurrency: this.maxConcurrency,
		};
	}

	/**
	 * Get execution statistics for specific builders.
	 * @param dataTypes The data types to get statistics for
	 * @returns Map of data type to execution time, only includes executed builders
	 */
	getBuilderStats(dataTypes: string[]): Map<string, number> {
		const result = new Map<string, number>();

		for (const dataType of dataTypes) {
			const time = this.builderExecutionTimes.get(dataType);
			if (time !== undefined) {
				result.set(dataType, time);
			}
		}

		return result;
	}

	/**
	 * Get the average execution time for builders.
	 * @returns Average execution time in milliseconds, or 0 if no builders executed
	 */
	getAverageBuilderTime(): number {
		if (this.builderExecutionTimes.size === 0) {
			return 0;
		}

		const totalTime = Array.from(this.builderExecutionTimes.values()).reduce((sum, time) => sum + time, 0);

		return totalTime / this.builderExecutionTimes.size;
	}

	/**
	 * Get the slowest builder execution.
	 * @returns Object with data type and execution time of the slowest builder, or null if none executed
	 */
	getSlowestBuilder(): { dataType: string; executionTime: number } | null {
		if (this.builderExecutionTimes.size === 0) {
			return null;
		}

		let slowestType = '';
		let slowestTime = 0;

		for (const [dataType, time] of this.builderExecutionTimes) {
			if (time > slowestTime) {
				slowestTime = time;
				slowestType = dataType;
			}
		}

		return { dataType: slowestType, executionTime: slowestTime };
	}

	/**
	 * Get the fastest builder execution.
	 * @returns Object with data type and execution time of the fastest builder, or null if none executed
	 */
	getFastestBuilder(): { dataType: string; executionTime: number } | null {
		if (this.builderExecutionTimes.size === 0) {
			return null;
		}

		let fastestType = '';
		let fastestTime = Number.MAX_VALUE;

		for (const [dataType, time] of this.builderExecutionTimes) {
			if (time < fastestTime) {
				fastestTime = time;
				fastestType = dataType;
			}
		}

		return { dataType: fastestType, executionTime: fastestTime };
	}

	/**
	 * Calculate estimated time savings from parallel execution.
	 * @returns Object with sequential time estimate and time saved
	 */
	getParallelEfficiency(): {
		estimatedSequentialTime: number;
		timeSaved: number;
		efficiency: number;
	} | null {
		if (!this.parallelExecution || this.builderExecutionTimes.size === 0) {
			return null;
		}

		const totalBuilderTime = Array.from(this.builderExecutionTimes.values()).reduce((sum, time) => sum + time, 0);

		const actualTime = Date.now() - this.startTime;
		const timeSaved = Math.max(0, totalBuilderTime - actualTime);
		const efficiency = totalBuilderTime > 0 ? timeSaved / totalBuilderTime : 0;

		return {
			estimatedSequentialTime: totalBuilderTime,
			timeSaved,
			efficiency,
		};
	}

	/**
	 * Get a detailed execution summary.
	 * @returns Object with comprehensive execution information
	 */
	getExecutionSummary(): {
		totalBuilders: number;
		executedBuilders: number;
		skippedBuilders: number;
		averageTime: number;
		slowest: { dataType: string; executionTime: number } | null;
		fastest: { dataType: string; executionTime: number } | null;
		parallelInfo?: {
			levels: number;
			maxConcurrency: number;
			efficiency: { estimatedSequentialTime: number; timeSaved: number; efficiency: number } | null;
		};
	} {
		return {
			totalBuilders: this.buildersExecuted + this.skipCount,
			executedBuilders: this.buildersExecuted,
			skippedBuilders: this.skipCount,
			averageTime: this.getAverageBuilderTime(),
			slowest: this.getSlowestBuilder(),
			fastest: this.getFastestBuilder(),
			parallelInfo: this.parallelExecution
				? {
						levels: this.parallelLevels || 0,
						maxConcurrency: this.maxConcurrency || 0,
						efficiency: this.getParallelEfficiency(),
					}
				: undefined,
		};
	}
}
