import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { ExecutionStatisticsCollector } from '../src/core/ExecutionStatisticsCollector.js';

describe('ExecutionStatisticsCollector', () => {
	let collector: ExecutionStatisticsCollector;

	beforeEach(() => {
		collector = new ExecutionStatisticsCollector();
		// Mock Date.now to have predictable timing
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('Basic Operations', () => {
		test('should start with empty statistics', () => {
			const stats = collector.getCurrentStats();

			expect(stats.buildersExecuted).toBe(0);
			expect(stats.builderExecutionTimes?.size).toBe(0);
			expect(stats.skipCount).toBe(0);
			expect(stats.parallelExecution).toBe(false);
			expect(stats.parallelLevels).toBeUndefined();
			expect(stats.maxConcurrency).toBeUndefined();
		});

		test('should record execution start and completion', () => {
			const startTime = Date.now();
			collector.startExecution();

			vi.advanceTimersByTime(1000); // Advance 1 second

			const finalStats = collector.stopExecution();

			expect(finalStats.totalExecutionTime).toBe(1000);
			expect(finalStats.buildersExecuted).toBe(0);
		});

		test('should reset statistics on start', () => {
			collector.recordBuilderExecution('user', 100);

			const statsBefore = collector.getCurrentStats();
			expect(statsBefore.buildersExecuted).toBe(1);

			collector.startExecution(); // Should reset

			const statsAfter = collector.getCurrentStats();
			expect(statsAfter.buildersExecuted).toBe(0);
			expect(statsAfter.builderExecutionTimes?.size).toBe(0);
		});
	});

	describe('Builder Statistics', () => {
		test('should record single builder execution', () => {
			collector.startExecution();

			collector.recordBuilderExecution('user', 500);

			const stats = collector.getCurrentStats();

			expect(stats.buildersExecuted).toBe(1);
			expect(stats.builderExecutionTimes?.get('user')).toBe(500);
		});

		test('should record multiple builder executions', () => {
			collector.startExecution();

			collector.recordBuilderExecution('user', 300);
			collector.recordBuilderExecution('profile', 200);

			const stats = collector.getCurrentStats();

			expect(stats.buildersExecuted).toBe(2);
			expect(stats.builderExecutionTimes?.get('user')).toBe(300);
			expect(stats.builderExecutionTimes?.get('profile')).toBe(200);
		});

		test('should track skipped builders', () => {
			collector.startExecution();

			collector.recordBuilderExecution('user', 100);
			collector.recordSkippedBuilder();
			collector.recordSkippedBuilder();

			const stats = collector.getCurrentStats();

			expect(stats.buildersExecuted).toBe(1);
			expect(stats.skipCount).toBe(2);
		});

		test('should get specific builder stats', () => {
			collector.startExecution();

			collector.recordBuilderExecution('user', 100);
			collector.recordBuilderExecution('profile', 200);
			collector.recordBuilderExecution('settings', 300);

			const builderStats = collector.getBuilderStats(['user', 'profile', 'nonexistent']);

			expect(builderStats.size).toBe(2);
			expect(builderStats.get('user')).toBe(100);
			expect(builderStats.get('profile')).toBe(200);
			expect(builderStats.has('nonexistent')).toBe(false);
		});
	});

	describe('Performance Metrics', () => {
		test('should calculate average execution time', () => {
			collector.startExecution();

			collector.recordBuilderExecution('user', 100);
			collector.recordBuilderExecution('profile', 200);
			collector.recordBuilderExecution('settings', 300);

			const avgTime = collector.getAverageBuilderTime();

			expect(avgTime).toBe(200); // (100 + 200 + 300) / 3
		});

		test('should return zero average for no builders', () => {
			collector.startExecution();

			const avgTime = collector.getAverageBuilderTime();

			expect(avgTime).toBe(0);
		});

		test('should find slowest builder', () => {
			collector.startExecution();

			collector.recordBuilderExecution('fast', 50);
			collector.recordBuilderExecution('slow', 500);
			collector.recordBuilderExecution('medium', 200);

			const slowest = collector.getSlowestBuilder();

			expect(slowest).toEqual({
				dataType: 'slow',
				executionTime: 500,
			});
		});

		test('should find fastest builder', () => {
			collector.startExecution();

			collector.recordBuilderExecution('fast', 50);
			collector.recordBuilderExecution('slow', 500);
			collector.recordBuilderExecution('medium', 200);

			const fastest = collector.getFastestBuilder();

			expect(fastest).toEqual({
				dataType: 'fast',
				executionTime: 50,
			});
		});

		test('should return null for slowest/fastest when no builders', () => {
			collector.startExecution();

			expect(collector.getSlowestBuilder()).toBeNull();
			expect(collector.getFastestBuilder()).toBeNull();
		});
	});

	describe('Sequential Execution', () => {
		test('should set sequential execution by default', () => {
			collector.startExecution();

			const stats = collector.getCurrentStats();

			expect(stats.parallelExecution).toBe(false);
			expect(stats.parallelLevels).toBeUndefined();
			expect(stats.maxConcurrency).toBeUndefined();
		});

		test('should explicitly set sequential execution', () => {
			collector.startExecution();
			collector.setSequentialExecution();

			const stats = collector.getCurrentStats();

			expect(stats.parallelExecution).toBe(false);
			expect(stats.parallelLevels).toBeUndefined();
			expect(stats.maxConcurrency).toBeUndefined();
		});

		test('should handle sequential execution in final stats', () => {
			collector.startExecution();

			collector.recordBuilderExecution('user', 100);
			collector.recordBuilderExecution('profile', 200);

			vi.advanceTimersByTime(500);

			const finalStats = collector.stopExecution();

			expect(finalStats.parallelExecution).toBe(false);
			expect(finalStats.totalExecutionTime).toBe(500);
			expect(finalStats.buildersExecuted).toBe(2);
		});
	});

	describe('Parallel Execution', () => {
		test('should set parallel execution info', () => {
			collector.startExecution();
			collector.setParallelExecutionInfo(3, 2);

			const stats = collector.getCurrentStats();

			expect(stats.parallelExecution).toBe(true);
			expect(stats.parallelLevels).toBe(3);
			expect(stats.maxConcurrency).toBe(2);
		});

		test('should include parallel info in final stats', () => {
			collector.startExecution();
			collector.setParallelExecutionInfo(2, 3);

			collector.recordBuilderExecution('user', 100);
			collector.recordBuilderExecution('profile', 150);

			vi.advanceTimersByTime(200); // Less than sum of builder times

			const finalStats = collector.stopExecution();

			expect(finalStats.parallelExecution).toBe(true);
			expect(finalStats.parallelLevels).toBe(2);
			expect(finalStats.maxConcurrency).toBe(3);
			expect(finalStats.totalExecutionTime).toBe(200);
		});

		test('should calculate parallel efficiency', () => {
			collector.startExecution();
			collector.setParallelExecutionInfo(2, 2);

			collector.recordBuilderExecution('user', 100);
			collector.recordBuilderExecution('profile', 150);

			vi.advanceTimersByTime(200); // Total builder time is 250ms, actual time is 200ms

			const efficiency = collector.getParallelEfficiency();

			expect(efficiency).not.toBeNull();
			expect(efficiency!.estimatedSequentialTime).toBe(250);
			expect(efficiency!.timeSaved).toBe(50); // 250 - 200
			expect(efficiency!.efficiency).toBe(0.2); // 50 / 250
		});

		test('should return null efficiency for sequential execution', () => {
			collector.startExecution();
			collector.setSequentialExecution();

			collector.recordBuilderExecution('user', 100);

			const efficiency = collector.getParallelEfficiency();

			expect(efficiency).toBeNull();
		});
	});

	describe('Execution Summary', () => {
		test('should provide comprehensive summary for sequential execution', () => {
			collector.startExecution();

			collector.recordBuilderExecution('user', 100);
			collector.recordBuilderExecution('profile', 200);
			collector.recordSkippedBuilder();

			const summary = collector.getExecutionSummary();

			expect(summary.totalBuilders).toBe(3);
			expect(summary.executedBuilders).toBe(2);
			expect(summary.skippedBuilders).toBe(1);
			expect(summary.averageTime).toBe(150);
			expect(summary.slowest).toEqual({ dataType: 'profile', executionTime: 200 });
			expect(summary.fastest).toEqual({ dataType: 'user', executionTime: 100 });
			expect(summary.parallelInfo).toBeUndefined();
		});

		test('should provide comprehensive summary for parallel execution', () => {
			collector.startExecution();
			collector.setParallelExecutionInfo(2, 3);

			collector.recordBuilderExecution('user', 100);
			collector.recordBuilderExecution('profile', 150);

			vi.advanceTimersByTime(200);

			const summary = collector.getExecutionSummary();

			expect(summary.totalBuilders).toBe(2);
			expect(summary.executedBuilders).toBe(2);
			expect(summary.skippedBuilders).toBe(0);
			expect(summary.parallelInfo).toBeDefined();
			expect(summary.parallelInfo!.levels).toBe(2);
			expect(summary.parallelInfo!.maxConcurrency).toBe(3);
			expect(summary.parallelInfo!.efficiency).not.toBeNull();
		});

		test('should handle empty execution summary', () => {
			collector.startExecution();

			const summary = collector.getExecutionSummary();

			expect(summary.totalBuilders).toBe(0);
			expect(summary.executedBuilders).toBe(0);
			expect(summary.skippedBuilders).toBe(0);
			expect(summary.averageTime).toBe(0);
			expect(summary.slowest).toBeNull();
			expect(summary.fastest).toBeNull();
		});
	});

	describe('Reset and State Management', () => {
		test('should reset statistics manually', () => {
			collector.recordBuilderExecution('user', 100);
			collector.recordSkippedBuilder();
			collector.setParallelExecutionInfo(2, 3);

			collector.reset();

			const stats = collector.getCurrentStats();
			expect(stats.buildersExecuted).toBe(0);
			expect(stats.builderExecutionTimes?.size).toBe(0);
			expect(stats.skipCount).toBe(0);
			expect(stats.parallelExecution).toBe(false);
			expect(stats.parallelLevels).toBeUndefined();
			expect(stats.maxConcurrency).toBeUndefined();
		});

		test('should handle multiple execution cycles', () => {
			// First execution
			collector.startExecution();
			collector.recordBuilderExecution('user', 100);
			const firstStats = collector.stopExecution();
			expect(firstStats.buildersExecuted).toBe(1);

			// Second execution (startExecution should reset)
			collector.startExecution();
			collector.recordBuilderExecution('profile', 200);
			const secondStats = collector.stopExecution();

			expect(secondStats.buildersExecuted).toBe(1);
			expect(secondStats.builderExecutionTimes.get('user')).toBeUndefined();
			expect(secondStats.builderExecutionTimes.get('profile')).toBe(200);
		});
	});

	describe('Edge Cases', () => {
		test('should handle statistics before execution start', () => {
			const stats = collector.getCurrentStats();

			expect(stats.buildersExecuted).toBe(0);
			expect(stats.builderExecutionTimes?.size).toBe(0);
			expect(stats.parallelExecution).toBe(false);
		});

		test('should handle zero execution time', () => {
			collector.startExecution();
			const stats = collector.stopExecution(); // Stop immediately

			expect(stats.totalExecutionTime).toBe(0);
		});

		test('should handle overwriting builder execution times', () => {
			collector.startExecution();

			collector.recordBuilderExecution('user', 100);
			collector.recordBuilderExecution('user', 200); // Overwrite

			const stats = collector.getCurrentStats();

			expect(stats.buildersExecuted).toBe(2); // Count increases each time
			expect(stats.builderExecutionTimes?.get('user')).toBe(200); // But time is overwritten
		});

		test('should handle very large execution times', () => {
			collector.startExecution();

			collector.recordBuilderExecution('user', Number.MAX_SAFE_INTEGER);

			const slowest = collector.getSlowestBuilder();
			expect(slowest?.executionTime).toBe(Number.MAX_SAFE_INTEGER);
		});

		test('should handle parallel efficiency with zero actual time', () => {
			collector.startExecution();
			collector.setParallelExecutionInfo(1, 1);

			collector.recordBuilderExecution('user', 100);
			// Don't advance timers, so actual time is 0

			const efficiency = collector.getParallelEfficiency();

			expect(efficiency).not.toBeNull();
			expect(efficiency!.estimatedSequentialTime).toBe(100);
			expect(efficiency!.timeSaved).toBe(100); // All time saved
		});
	});

	describe('Statistics Immutability', () => {
		test('should return copies of execution times map', () => {
			collector.startExecution();
			collector.recordBuilderExecution('user', 100);

			const stats1 = collector.getCurrentStats();
			const stats2 = collector.getCurrentStats();

			expect(stats1.builderExecutionTimes).not.toBe(stats2.builderExecutionTimes);
			expect(stats1.builderExecutionTimes?.get('user')).toBe(stats2.builderExecutionTimes?.get('user'));
		});

		test('should return immutable final statistics', () => {
			collector.startExecution();
			collector.recordBuilderExecution('user', 100);

			const finalStats = collector.stopExecution();

			// Modify after getting final stats shouldn't affect returned object
			collector.recordBuilderExecution('profile', 200);

			expect(finalStats.buildersExecuted).toBe(1);
			expect(finalStats.builderExecutionTimes.size).toBe(1);
		});
	});
});
