import { describe, test, expect, beforeEach } from 'vitest';
import { DataFlowEngine, ExecutionMode } from '../src/core/DataFlowEngine.js';
import { AbstractDataBuilder, SourceDataBuilder, TransformDataBuilder, CombineDataBuilder } from '../src/builders/AbstractDataBuilder.js';
import { Data, DataBuilder, DataSet } from '../src/types/index.js';

// Performance test data interfaces
interface PerformanceData extends Data {
	readonly type: string;
	id: number;
	processingTime: number;
	size: number;
}

interface ComputeResult extends Data {
	readonly type: 'compute';
	inputId: number;
	result: number;
	computeTime: number;
}

interface AggregateResult extends Data {
	readonly type: 'aggregate';
	totalInputs: number;
	totalResult: number;
	averageTime: number;
}

// Performance test builders with configurable delays

class FastSourceBuilder extends SourceDataBuilder<PerformanceData> {
	readonly provides: string;
	private delay: number;

	constructor(dataType: string, delay: number = 1) {
		super();
		this.provides = dataType;
		this.delay = delay;
	}

	async build(dataSet: DataSet): Promise<PerformanceData> {
		const start = performance.now();
		await new Promise((resolve) => setTimeout(resolve, this.delay));
		const end = performance.now();

		return this.createData<PerformanceData>(this.provides, {
			id: Math.floor(Math.random() * 1000),
			processingTime: end - start,
			size: 100,
		});
	}
}

class SlowSourceBuilder extends SourceDataBuilder<PerformanceData> {
	readonly provides: string;
	private delay: number;

	constructor(dataType: string, delay: number = 50) {
		super();
		this.provides = dataType;
		this.delay = delay;
	}

	async build(dataSet: DataSet): Promise<PerformanceData> {
		const start = performance.now();
		await new Promise((resolve) => setTimeout(resolve, this.delay));
		const end = performance.now();

		return this.createData<PerformanceData>(this.provides, {
			id: Math.floor(Math.random() * 1000),
			processingTime: end - start,
			size: 1000,
		});
	}
}

class ComputeTransformer extends TransformDataBuilder<PerformanceData, ComputeResult> {
	readonly provides: string;
	readonly inputType: string;
	private computeDelay: number;

	constructor(inputDataType: string, outputDataType: string, computeDelay: number = 10) {
		super();
		this.provides = outputDataType;
		this.inputType = inputDataType;
		this.computeDelay = computeDelay;
	}

	async transform(input: PerformanceData): Promise<ComputeResult> {
		const start = performance.now();

		// Simulate computational work
		let result = 0;
		for (let i = 0; i < 1000; i++) {
			result += Math.sin(i) * Math.cos(i);
		}

		await new Promise((resolve) => setTimeout(resolve, this.computeDelay));
		const end = performance.now();

		return this.createData<ComputeResult>(this.provides, {
			inputId: input.id,
			result,
			computeTime: end - start,
		});
	}
}

class AggregateCombiner extends CombineDataBuilder<AggregateResult> {
	readonly provides = 'aggregate';
	readonly consumes: string[];
	private aggregateDelay: number;

	constructor(inputTypes: string[], aggregateDelay: number = 5) {
		super();
		this.consumes = inputTypes;
		this.aggregateDelay = aggregateDelay;
	}

	async combine(inputs: Map<string, Data>): Promise<AggregateResult> {
		const start = performance.now();

		let totalResult = 0;
		let totalTime = 0;
		let count = 0;

		for (const [type, data] of inputs) {
			if (data.type === 'compute') {
				const compute = data as ComputeResult;
				totalResult += compute.result;
				totalTime += compute.computeTime;
				count++;
			}
		}

		await new Promise((resolve) => setTimeout(resolve, this.aggregateDelay));
		const end = performance.now();

		return this.createData<AggregateResult>('aggregate', {
			totalInputs: count,
			totalResult,
			averageTime: count > 0 ? totalTime / count : 0,
		});
	}
}

// Utility function to measure execution time
async function measureExecutionTime<T>(operation: () => Promise<T>): Promise<{ result: T; duration: number }> {
	const start = performance.now();
	const result = await operation();
	const end = performance.now();
	return { result, duration: end - start };
}

// Utility function to calculate performance metrics
interface PerformanceMetrics {
	totalTime: number;
	parallelEfficiency: number;
	speedup: number;
	buildersExecuted: number;
	parallelLevels: number;
	maxConcurrency: number;
}

function calculateMetrics(sequentialTime: number, parallelTime: number, parallelStats: any): PerformanceMetrics {
	const speedup = sequentialTime / parallelTime;
	const idealSpeedup = parallelStats.maxConcurrency || 1;
	const parallelEfficiency = speedup / idealSpeedup;

	return {
		totalTime: parallelTime,
		parallelEfficiency,
		speedup,
		buildersExecuted: parallelStats.buildersExecuted,
		parallelLevels: parallelStats.parallelLevels,
		maxConcurrency: parallelStats.maxConcurrency,
	};
}

describe('Performance Tests', () => {
	let engine: DataFlowEngine;

	beforeEach(() => {
		engine = new DataFlowEngine();
	});

	describe('Basic Performance Characteristics', () => {
		test('should measure sequential vs parallel execution for independent builders', async () => {
			// Create multiple independent slow builders
			const builderCount = 5;
			const builderDelay = 30; // milliseconds
			const builders = [];

			for (let i = 0; i < builderCount; i++) {
				builders.push(new SlowSourceBuilder(`slow${i}`, builderDelay));
			}

			builders.forEach((builder) => engine.registerBuilder(builder));
			const targetTypes = builders.map((b) => b.provides);

			// Measure sequential execution
			const { result: sequentialResult, duration: sequentialTime } = await measureExecutionTime(async () => {
				return engine.executeSimpleWithOptions(targetTypes, undefined, {
					mode: ExecutionMode.SEQUENTIAL,
				});
			});

			// Clear and re-register for parallel test
			engine.clearBuilders();
			builders.forEach((builder) => engine.registerBuilder(builder));

			// Measure parallel execution
			const { result: parallelResult, duration: parallelTime } = await measureExecutionTime(async () => {
				return engine.executeSimpleWithOptions(targetTypes, undefined, {
					mode: ExecutionMode.PARALLEL,
				});
			});

			// Verify results are equivalent
			targetTypes.forEach((type) => {
				expect(sequentialResult.dataSet.contains(type)).toBe(true);
				expect(parallelResult.dataSet.contains(type)).toBe(true);
			});

			// Performance assertions
			expect(parallelTime).toBeLessThan(sequentialTime);
			const speedup = sequentialTime / parallelTime;
			expect(speedup).toBeGreaterThan(2); // Should be significantly faster

			// Parallel execution should be more efficient
			expect(parallelResult.stats.parallelExecution).toBe(true);
			expect(sequentialResult.stats.parallelExecution).toBe(false);

			console.log(
				`Sequential: ${sequentialTime.toFixed(2)}ms, Parallel: ${parallelTime.toFixed(2)}ms, Speedup: ${speedup.toFixed(2)}x`,
			);
		});

		test('should show minimal overhead for sequential execution of fast builders', async () => {
			// Create fast builders
			const builderCount = 10;
			const builders = [];

			for (let i = 0; i < builderCount; i++) {
				builders.push(new FastSourceBuilder(`fast${i}`, 1));
			}

			builders.forEach((builder) => engine.registerBuilder(builder));
			const targetTypes = builders.map((b) => b.provides);

			// Measure execution time
			const { result, duration } = await measureExecutionTime(async () => {
				return engine.executeSimpleWithOptions(targetTypes, undefined, {
					mode: ExecutionMode.SEQUENTIAL,
				});
			});

			// For fast builders, overhead should be minimal
			expect(duration).toBeLessThan(100); // Should complete quickly
			expect(result.stats.buildersExecuted).toBe(builderCount);

			// Verify all data was built
			targetTypes.forEach((type) => {
				expect(result.dataSet.contains(type)).toBe(true);
			});
		});

		test('should handle mixed fast and slow builders efficiently', async () => {
			// Create mixed builders
			const fastBuilders = [new FastSourceBuilder('fast1', 2), new FastSourceBuilder('fast2', 3)];
			const slowBuilders = [new SlowSourceBuilder('slow1', 40), new SlowSourceBuilder('slow2', 45)];

			[...fastBuilders, ...slowBuilders].forEach((builder) => engine.registerBuilder(builder));
			const allTargets = [...fastBuilders, ...slowBuilders].map((b) => b.provides);

			// Test parallel execution
			const { result, duration } = await measureExecutionTime(async () => {
				return engine.executeSimpleWithOptions(allTargets, undefined, {
					mode: ExecutionMode.PARALLEL,
				});
			});

			// Parallel execution should be dominated by slowest builder
			expect(duration).toBeLessThan(100); // But still reasonable
			expect(result.stats.parallelExecution).toBe(true);
			expect(result.stats.buildersExecuted).toBe(4);

			// All data should be present
			allTargets.forEach((type) => {
				expect(result.dataSet.contains(type)).toBe(true);
			});
		});
	});

	describe('Scalability Tests', () => {
		test('should scale linearly with sequential execution', async () => {
			const builderCounts = [5, 10, 15];
			const results: { count: number; time: number; timePerBuilder: number }[] = [];

			for (const count of builderCounts) {
				engine.clearBuilders();

				// Create builders
				const builders = [];
				for (let i = 0; i < count; i++) {
					builders.push(new FastSourceBuilder(`builder${i}`, 5));
				}

				builders.forEach((builder) => engine.registerBuilder(builder));
				const targets = builders.map((b) => b.provides);

				// Measure execution
				const { duration } = await measureExecutionTime(async () => {
					return engine.executeSimpleWithOptions(targets, undefined, {
						mode: ExecutionMode.SEQUENTIAL,
					});
				});

				results.push({
					count,
					time: duration,
					timePerBuilder: duration / count,
				});
			}

			// Check that time per builder remains relatively stable (linear scaling)
			const timePerBuilderVariance =
				Math.max(...results.map((r) => r.timePerBuilder)) - Math.min(...results.map((r) => r.timePerBuilder));

			expect(timePerBuilderVariance).toBeLessThan(10); // Should be relatively stable

			console.log('Scalability Results:', results);
		});

		test('should maintain efficiency with increasing parallelism', async () => {
			const parallelCounts = [2, 4, 8];
			const results: { count: number; time: number; efficiency: number }[] = [];

			for (const count of parallelCounts) {
				engine.clearBuilders();

				// Create independent builders with moderate delay
				const builders = [];
				for (let i = 0; i < count; i++) {
					builders.push(new SlowSourceBuilder(`parallel${i}`, 25));
				}

				builders.forEach((builder) => engine.registerBuilder(builder));
				const targets = builders.map((b) => b.provides);

				// Measure parallel execution
				const { result, duration } = await measureExecutionTime(async () => {
					return engine.executeSimpleWithOptions(targets, undefined, {
						mode: ExecutionMode.PARALLEL,
					});
				});

				// Calculate theoretical vs actual time
				const theoreticalSequentialTime = count * 25; // If run sequentially
				const efficiency = theoreticalSequentialTime / (duration * count);

				results.push({
					count,
					time: duration,
					efficiency,
				});

				expect(result.stats.parallelExecution).toBe(true);
				expect(result.stats.maxConcurrency).toBe(count);
			}

			// Efficiency should remain reasonable even with more parallelism
			results.forEach((result) => {
				expect(result.efficiency).toBeGreaterThan(0.7); // At least 70% efficient
			});

			console.log('Parallel Efficiency Results:', results);
		});
	});

	describe('Complex Dependency Performance', () => {
		test('should optimize parallel execution with dependencies', async () => {
			// Create a dependency chain: sources -> computations -> aggregation
			const sourceBuilder1 = new FastSourceBuilder('source1', 5);
			const sourceBuilder2 = new FastSourceBuilder('source2', 5);
			const sourceBuilder3 = new FastSourceBuilder('source3', 5);

			const compute1 = new ComputeTransformer('source1', 'compute1', 15);
			const compute2 = new ComputeTransformer('source2', 'compute2', 15);
			const compute3 = new ComputeTransformer('source3', 'compute3', 15);

			// Note: We need different output types for each compute to avoid conflicts
			const compute1Builder = new ComputeTransformer('source1', 'compute1', 15);
			const compute2Builder = new ComputeTransformer('source2', 'compute2', 15);
			const compute3Builder = new ComputeTransformer('source3', 'compute3', 15);

			const aggregator = new AggregateCombiner(['compute1', 'compute2', 'compute3'], 10);

			// Register all builders
			engine.registerBuilder(sourceBuilder1);
			engine.registerBuilder(sourceBuilder2);
			engine.registerBuilder(sourceBuilder3);
			engine.registerBuilder(compute1Builder);
			engine.registerBuilder(compute2Builder);
			engine.registerBuilder(compute3Builder);
			engine.registerBuilder(aggregator);

			// Test sequential execution
			const { result: seqResult, duration: seqTime } = await measureExecutionTime(async () => {
				return engine.executeSimpleWithOptions(['aggregate'], undefined, {
					mode: ExecutionMode.SEQUENTIAL,
				});
			});

			// Clear and re-register for parallel test
			engine.clearBuilders();
			engine.registerBuilder(sourceBuilder1);
			engine.registerBuilder(sourceBuilder2);
			engine.registerBuilder(sourceBuilder3);
			engine.registerBuilder(compute1Builder);
			engine.registerBuilder(compute2Builder);
			engine.registerBuilder(compute3Builder);
			engine.registerBuilder(aggregator);

			// Test parallel execution
			const { result: parResult, duration: parTime } = await measureExecutionTime(async () => {
				return engine.executeSimpleWithOptions(['aggregate'], undefined, {
					mode: ExecutionMode.PARALLEL,
				});
			});

			// Verify results
			expect(seqResult.dataSet.contains('aggregate')).toBe(true);
			expect(parResult.dataSet.contains('aggregate')).toBe(true);

			// Parallel should be faster due to concurrent source and compute operations
			expect(parTime).toBeLessThan(seqTime);

			// Check execution statistics
			expect(parResult.stats.parallelExecution).toBe(true);
			expect(parResult.stats.parallelLevels).toBeGreaterThan(1);
			expect(parResult.stats.maxConcurrency).toBeGreaterThan(1);

			const speedup = seqTime / parTime;
			expect(speedup).toBeGreaterThan(1.5); // Should show meaningful improvement

			console.log(
				`Complex Dependencies - Sequential: ${seqTime.toFixed(2)}ms, Parallel: ${parTime.toFixed(2)}ms, Speedup: ${speedup.toFixed(2)}x`,
			);
		});

		test('should handle deep dependency chains efficiently', async () => {
			// Create a deep chain: level1 -> level2 -> level3 -> level4 -> level5
			const levels = 5;
			const builders = [];

			for (let i = 1; i <= levels; i++) {
				if (i === 1) {
					// Root builder
					builders.push(new FastSourceBuilder(`level${i}`, 10));
				} else {
					// Dependent builder
					class LevelTransformer extends TransformDataBuilder<PerformanceData, PerformanceData> {
						readonly provides = `level${i}`;
						readonly inputType = `level${i - 1}`;

						async transform(input: PerformanceData): Promise<PerformanceData> {
							await new Promise((resolve) => setTimeout(resolve, 8));
							return this.createData<PerformanceData>(`level${i}`, {
								id: input.id + 1,
								processingTime: input.processingTime + 8,
								size: input.size * 1.1,
							});
						}
					}
					builders.push(new LevelTransformer());
				}
			}

			builders.forEach((builder) => engine.registerBuilder(builder));

			// Test execution
			const { result, duration } = await measureExecutionTime(async () => {
				return engine.executeSimpleWithOptions([`level${levels}`], undefined, {
					mode: ExecutionMode.SEQUENTIAL,
				});
			});

			// Deep chains should still execute efficiently
			expect(duration).toBeLessThan(200); // Reasonable time for deep chain
			expect(result.dataSet.contains(`level${levels}`)).toBe(true);
			expect(result.stats.buildersExecuted).toBe(levels);

			// Verify data transformation
			const finalData = result.dataSet.accessor<PerformanceData>(`level${levels}`);
			expect(finalData?.id).toBeGreaterThan(1); // Should have been incremented
		});
	});

	describe('Concurrency Control', () => {
		test('should respect maxConcurrency limits', async () => {
			// Create many independent builders
			const builderCount = 8;
			const maxConcurrency = 3;
			const builders = [];

			for (let i = 0; i < builderCount; i++) {
				builders.push(new SlowSourceBuilder(`concurrent${i}`, 30));
			}

			builders.forEach((builder) => engine.registerBuilder(builder));
			const targets = builders.map((b) => b.provides);

			// Test with concurrency limit
			const { result, duration } = await measureExecutionTime(async () => {
				return engine.executeSimpleWithOptions(targets, undefined, {
					mode: ExecutionMode.PARALLEL,
					maxConcurrency,
				});
			});

			// All builders should complete
			expect(result.stats.buildersExecuted).toBe(builderCount);
			targets.forEach((type) => {
				expect(result.dataSet.contains(type)).toBe(true);
			});

			// Time should be roughly: ceil(builderCount / maxConcurrency) * builderDelay
			const expectedMinTime = Math.ceil(builderCount / maxConcurrency) * 25; // Conservative estimate
			expect(duration).toBeGreaterThan(expectedMinTime);

			console.log(`Concurrency Control - ${builderCount} builders with max ${maxConcurrency}: ${duration.toFixed(2)}ms`);
		});

		test('should handle resource contention gracefully', async () => {
			// Create builders that might contend for resources
			const builderCount = 10;
			const builders = [];

			for (let i = 0; i < builderCount; i++) {
				class ResourceIntensiveBuilder extends SourceDataBuilder<PerformanceData> {
					readonly provides = `resource${i}`;

					async build(dataSet: DataSet): Promise<PerformanceData> {
						const start = performance.now();

						// Simulate resource-intensive work
						const iterations = 10000;
						let result = 0;
						for (let j = 0; j < iterations; j++) {
							result += Math.random() * Math.sin(j) * Math.cos(j);
						}

						const end = performance.now();

						return this.createData<PerformanceData>(`resource${i}`, {
							id: i,
							processingTime: end - start,
							size: result,
						});
					}
				}
				builders.push(new ResourceIntensiveBuilder());
			}

			builders.forEach((builder) => engine.registerBuilder(builder));
			const targets = builders.map((b) => b.provides);

			// Test parallel execution with resource contention
			const { result, duration } = await measureExecutionTime(async () => {
				return engine.executeSimpleWithOptions(targets, undefined, {
					mode: ExecutionMode.PARALLEL,
					maxConcurrency: 4,
				});
			});

			// Should complete successfully despite contention
			expect(result.stats.buildersExecuted).toBe(builderCount);
			expect(duration).toBeLessThan(1000); // Should still be reasonable

			// Verify all data was created
			targets.forEach((type) => {
				expect(result.dataSet.contains(type)).toBe(true);
			});
		});
	});

	describe('Memory and Resource Efficiency', () => {
		test('should handle large numbers of builders efficiently', async () => {
			const largeBuilderCount = 50;
			const builders = [];

			// Create many lightweight builders
			for (let i = 0; i < largeBuilderCount; i++) {
				builders.push(new FastSourceBuilder(`large${i}`, 2));
			}

			builders.forEach((builder) => engine.registerBuilder(builder));
			const targets = builders.map((b) => b.provides);

			// Test execution
			const { result, duration } = await measureExecutionTime(async () => {
				return engine.executeSimpleWithOptions(targets, undefined, {
					mode: ExecutionMode.PARALLEL,
					maxConcurrency: 10,
				});
			});

			// Should handle large numbers efficiently
			expect(result.stats.buildersExecuted).toBe(largeBuilderCount);
			expect(duration).toBeLessThan(500); // Should still be fast

			// Verify all data exists
			targets.forEach((type) => {
				expect(result.dataSet.contains(type)).toBe(true);
			});

			console.log(`Large Scale Test - ${largeBuilderCount} builders: ${duration.toFixed(2)}ms`);
		});

		test('should maintain performance with data accumulation', async () => {
			// Test multiple executions to check for memory leaks or performance degradation
			const executionCount = 5;
			const builderCount = 10;
			const times: number[] = [];

			for (let exec = 0; exec < executionCount; exec++) {
				engine.clearBuilders();

				// Create fresh builders for each execution
				const builders = [];
				for (let i = 0; i < builderCount; i++) {
					builders.push(new FastSourceBuilder(`exec${exec}_builder${i}`, 3));
				}

				builders.forEach((builder) => engine.registerBuilder(builder));
				const targets = builders.map((b) => b.provides);

				// Measure execution
				const { duration } = await measureExecutionTime(async () => {
					return engine.executeSimpleWithOptions(targets, undefined, {
						mode: ExecutionMode.PARALLEL,
					});
				});

				times.push(duration);
			}

			// Times should remain consistent (no significant degradation)
			const avgTime = times.reduce((sum, time) => sum + time, 0) / times.length;
			const maxDeviation = Math.max(...times.map((time) => Math.abs(time - avgTime)));

			expect(maxDeviation).toBeLessThan(avgTime * 0.5); // Within 50% of average

			console.log(`Consistency Test - Average: ${avgTime.toFixed(2)}ms, Max Deviation: ${maxDeviation.toFixed(2)}ms`);
		});
	});

	describe('Performance Regression Detection', () => {
		test('should provide consistent timing for benchmark scenarios', async () => {
			// Standard benchmark scenario
			const sourceBuilders = [
				new FastSourceBuilder('bench1', 5),
				new FastSourceBuilder('bench2', 5),
				new SlowSourceBuilder('bench3', 25),
			];

			class BenchComputeTransformer1 extends ComputeTransformer {
				readonly provides = 'benchCompute1';
				constructor() {
					super('bench1', 'benchCompute1');
				}
			}

			class BenchComputeTransformer2 extends ComputeTransformer {
				readonly provides = 'benchCompute2';
				constructor() {
					super('bench2', 'benchCompute2');
				}
			}

			const computeBuilders = [new BenchComputeTransformer1(), new BenchComputeTransformer2()];

			const aggregator = new AggregateCombiner(['benchCompute1', 'benchCompute2'], 5);

			// Register builders
			sourceBuilders.forEach((builder) => engine.registerBuilder(builder));
			computeBuilders.forEach((builder) => engine.registerBuilder(builder));
			engine.registerBuilder(aggregator);

			// Run multiple times to get consistent measurement
			const runs = 3;
			const times: number[] = [];

			for (let i = 0; i < runs; i++) {
				const { duration } = await measureExecutionTime(async () => {
					return engine.executeSimpleWithOptions(['aggregate'], undefined, {
						mode: ExecutionMode.PARALLEL,
					});
				});
				times.push(duration);
			}

			const avgTime = times.reduce((sum, time) => sum + time, 0) / times.length;
			const variance = times.reduce((sum, time) => sum + Math.pow(time - avgTime, 2), 0) / times.length;
			const stdDev = Math.sqrt(variance);

			// Performance should be consistent (low variance)
			expect(stdDev).toBeLessThan(avgTime * 0.3); // Standard deviation < 30% of average

			// Benchmark result for regression tracking
			console.log(`Benchmark Result - Average: ${avgTime.toFixed(2)}ms ± ${stdDev.toFixed(2)}ms`);

			// Expected performance characteristics (these serve as regression detection)
			expect(avgTime).toBeLessThan(100); // Should complete within 100ms
			expect(avgTime).toBeGreaterThan(20); // But should take some meaningful time
		});
	});
});
