import { beforeEach, describe, expect, test, vi } from 'vitest';
import { BuilderRegistry } from '../src/core/BuilderRegistry';
import { DataSetImpl } from '../src/core/DataSetImpl';
import { ExecutionPlanner } from '../src/core/ExecutionPlanner';
import { ExecutionStatisticsCollector } from '../src/core/ExecutionStatisticsCollector';
import {
	BuilderExecutionError,
	ExecutionStrategyFactory,
	ParallelExecutionStrategy,
	SequentialExecutionStrategy
} from '../src/core/ExecutionStrategy';
import { Data, DataBuilder, DataSet, ExecutionContext } from '../src/types';

// Test data interfaces
interface User extends Data {
	readonly type: 'user';
	id: number;
	name: string;
	email: string;
}

interface Profile extends Data {
	readonly type: 'profile';
	userId: number;
	displayName: string;
	avatar: string;
}

interface UserStats extends Data {
	readonly type: 'userStats';
	userId: number;
	loginCount: number;
	lastSeen: Date;
}

interface Report extends Data {
	readonly type: 'report';
	profileId: number;
	statsId: number;
	summary: string;
}

// Mock builders for testing
class UserBuilder implements DataBuilder<User> {
	readonly provides = 'user';
	readonly consumes: string[] = [];

	async build(dataSet: DataSet): Promise<User> {
		// Add small delay to test timing
		await new Promise((resolve) => setTimeout(resolve, 10));
		return {
			type: 'user',
			id: 1,
			name: 'John Doe',
			email: 'john@example.com',
		};
	}
}

class ProfileBuilder implements DataBuilder<Profile> {
	readonly provides = 'profile';
	readonly consumes = ['user'];

	async build(dataSet: DataSet): Promise<Profile> {
		const user = dataSet.accessor<User>('user');
		if (!user) {
			throw new Error('User data not found');
		}
		await new Promise((resolve) => setTimeout(resolve, 15));
		return {
			type: 'profile',
			userId: user.id,
			displayName: `${user.name} (Profile)`,
			avatar: 'default.png',
		};
	}
}

class UserStatsBuilder implements DataBuilder<UserStats> {
	readonly provides = 'userStats';
	readonly consumes = ['user'];

	async build(dataSet: DataSet): Promise<UserStats> {
		const user = dataSet.accessor<User>('user');
		if (!user) {
			throw new Error('User data not found');
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
		return {
			type: 'userStats',
			userId: user.id,
			loginCount: 5,
			lastSeen: new Date(),
		};
	}
}

class ReportBuilder implements DataBuilder<Report> {
	readonly provides = 'report';
	readonly consumes = ['profile', 'userStats'];

	async build(dataSet: DataSet): Promise<Report> {
		const profile = dataSet.accessor<Profile>('profile');
		const stats = dataSet.accessor<UserStats>('userStats');
		if (!profile || !stats) {
			throw new Error('Required data not found');
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
		return {
			type: 'report',
			profileId: profile.userId,
			statsId: stats.userId,
			summary: `Report for ${profile.displayName}`,
		};
	}
}

// Test builders for error scenarios
class FailingBuilder implements DataBuilder<Data> {
	readonly provides = 'failing';
	readonly consumes: string[] = [];

	async build(dataSet: DataSet): Promise<Data> {
		throw new Error('Intentional failure for testing');
	}
}

class SlowBuilder implements DataBuilder<Data> {
	readonly provides = 'slow';
	readonly consumes: string[] = [];

	async build(dataSet: DataSet): Promise<Data> {
		await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second delay
		return { type: 'slow' };
	}
}

// Independent builders for parallel testing
class IndependentBuilder1 implements DataBuilder<Data> {
	readonly provides = 'independent1';
	readonly consumes: string[] = [];

	async build(dataSet: DataSet): Promise<Data> {
		await new Promise((resolve) => setTimeout(resolve, 30));
		return { type: 'independent1' };
	}
}

class IndependentBuilder2 implements DataBuilder<Data> {
	readonly provides = 'independent2';
	readonly consumes: string[] = [];

	async build(dataSet: DataSet): Promise<Data> {
		await new Promise((resolve) => setTimeout(resolve, 40));
		return { type: 'independent2' };
	}
}

class DependentBuilder implements DataBuilder<Data> {
	readonly provides = 'dependent';
	readonly consumes = ['independent1', 'independent2'];

	async build(dataSet: DataSet): Promise<Data> {
		const dep1 = dataSet.accessor('independent1');
		const dep2 = dataSet.accessor('independent2');
		if (!dep1 || !dep2) {
			throw new Error('Dependencies not found');
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
		return { type: 'dependent' };
	}
}

describe('ExecutionStrategy', () => {
	let registry: BuilderRegistry;
	let statsCollector: ExecutionStatisticsCollector;
	let planner: ExecutionPlanner;
	let context: ExecutionContext;

	beforeEach(() => {
		registry = new BuilderRegistry();
		statsCollector = new ExecutionStatisticsCollector();
		planner = new ExecutionPlanner(registry);
		context = {
			dataFlow: { name: 'test', targetData: [] },
			initialData: new DataSetImpl(),
			builders: new Map(),
		};
	});

	describe('SequentialExecutionStrategy', () => {
		let strategy: SequentialExecutionStrategy;

		beforeEach(() => {
			strategy = new SequentialExecutionStrategy(registry, statsCollector);
		});

		test('should identify itself correctly', () => {
			expect(strategy.getStrategyName()).toBe('sequential');
		});

		test('should execute single builder sequentially', async () => {
			const userBuilder = new UserBuilder();
			registry.register(userBuilder);

			const plan = planner.createExecutionPlan(['user']);
			const result = await strategy.execute(context, plan);

			expect(result.dataSet.contains('user')).toBe(true);
			expect(result.executionOrder).toEqual(['user']);
			expect(result.stats.buildersExecuted).toBe(1);
			expect(result.stats.parallelExecution).toBe(false);
		});

		test('should execute dependency chain sequentially', async () => {
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);

			const plan = planner.createExecutionPlan(['profile']);
			const result = await strategy.execute(context, plan);

			expect(result.dataSet.contains('user')).toBe(true);
			expect(result.dataSet.contains('profile')).toBe(true);
			expect(result.executionOrder).toEqual(['user', 'profile']);

			const user = result.dataSet.accessor<User>('user');
			const profile = result.dataSet.accessor<Profile>('profile');
			expect(profile?.userId).toBe(user?.id);
		});

		test('should execute complex dependency tree sequentially', async () => {
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();
			const statsBuilder = new UserStatsBuilder();
			const reportBuilder = new ReportBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);
			registry.register(statsBuilder);
			registry.register(reportBuilder);

			const plan = planner.createExecutionPlan(['report']);
			const result = await strategy.execute(context, plan);

			expect(result.dataSet.contains('user')).toBe(true);
			expect(result.dataSet.contains('profile')).toBe(true);
			expect(result.dataSet.contains('userStats')).toBe(true);
			expect(result.dataSet.contains('report')).toBe(true);
			expect(result.executionOrder).toEqual(['user', 'profile', 'userStats', 'report']);
		});

		test('should skip builders for existing data', async () => {
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);

			// Pre-populate with user data
			const existingUser: User = { type: 'user', id: 999, name: 'Existing User', email: 'existing@example.com' };
			(context.initialData as DataSetImpl).add(existingUser);

			const plan = planner.createExecutionPlan(['profile']);
			const result = await strategy.execute(context, plan);

			expect(result.dataSet.contains('user')).toBe(true);
			expect(result.dataSet.contains('profile')).toBe(true);

			const user = result.dataSet.accessor<User>('user');
			expect(user?.id).toBe(999); // Should use existing user, not build new one
			expect(user?.name).toBe('Existing User');
		});

		test('should handle builder timeout', async () => {
			const slowBuilder = new SlowBuilder();
			registry.register(slowBuilder);

			const plan = planner.createExecutionPlan(['slow']);

			await expect(strategy.execute(context, plan, { builderTimeout: 100 })).rejects.toThrow('timed out after 100ms');
		});

		test('should handle builder failure with continueOnError=false', async () => {
			const failingBuilder = new FailingBuilder();
			registry.register(failingBuilder);

			const plan = planner.createExecutionPlan(['failing']);

			await expect(strategy.execute(context, plan, { continueOnError: false })).rejects.toThrow(BuilderExecutionError);
		});

		test('should handle builder failure with continueOnError=true', async () => {
			const userBuilder = new UserBuilder();
			const failingBuilder = new FailingBuilder();

			registry.register(userBuilder);
			registry.register(failingBuilder);

			const plan = planner.createExecutionPlan(['user', 'failing']);

			// Mock console.warn to avoid test output
			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

			const result = await strategy.execute(context, plan, { continueOnError: true });

			expect(result.dataSet.contains('user')).toBe(true);
			expect(result.dataSet.contains('failing')).toBe(false);
			expect(consoleSpy).toHaveBeenCalled();

			consoleSpy.mockRestore();
		});

		test('should collect execution statistics', async () => {
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);

			const plan = planner.createExecutionPlan(['profile']);
			const result = await strategy.execute(context, plan);

			expect(result.stats.buildersExecuted).toBe(2);
			expect(result.stats.parallelExecution).toBe(false);
			expect(result.stats.totalExecutionTime).toBeGreaterThan(0);
			expect(result.stats.builderExecutionTimes.size).toBe(2);
		});
	});

	describe('ParallelExecutionStrategy', () => {
		let strategy: ParallelExecutionStrategy;

		beforeEach(() => {
			strategy = new ParallelExecutionStrategy(registry, statsCollector);
		});

		test('should identify itself correctly', () => {
			expect(strategy.getStrategyName()).toBe('parallel');
		});

		test('should execute independent builders in parallel', async () => {
			const independent1 = new IndependentBuilder1();
			const independent2 = new IndependentBuilder2();

			registry.register(independent1);
			registry.register(independent2);

			const plan = planner.createExecutionPlan(['independent1', 'independent2']);

			const startTime = Date.now();
			const result = await strategy.execute(context, plan);
			const endTime = Date.now();
			const executionTime = endTime - startTime;

			expect(result.dataSet.contains('independent1')).toBe(true);
			expect(result.dataSet.contains('independent2')).toBe(true);
			expect(result.stats.parallelExecution).toBe(true);

			// Should complete faster than sequential execution (both builders take 30ms + 40ms = 70ms sequentially)
			// In parallel, it should take around max(30ms, 40ms) = 40ms (plus overhead)
			expect(executionTime).toBeLessThan(60); // Give some buffer for overhead
		});

		test('should execute complex parallel scenario correctly', async () => {
			const independent1 = new IndependentBuilder1();
			const independent2 = new IndependentBuilder2();
			const dependent = new DependentBuilder();

			registry.register(independent1);
			registry.register(independent2);
			registry.register(dependent);

			const plan = planner.createExecutionPlan(['dependent']);
			const result = await strategy.execute(context, plan);

			expect(result.dataSet.contains('independent1')).toBe(true);
			expect(result.dataSet.contains('independent2')).toBe(true);
			expect(result.dataSet.contains('dependent')).toBe(true);
			expect(result.stats.parallelExecution).toBe(true);
		});

		test('should respect concurrency limits', async () => {
			// Create multiple independent builders
			const builders = [];
			for (let i = 1; i <= 5; i++) {
				class TestBuilder implements DataBuilder<Data> {
					readonly provides = `test${i}`;
					readonly consumes: string[] = [];
					async build(dataSet: DataSet): Promise<Data> {
						await new Promise((resolve) => setTimeout(resolve, 20));
						return { type: `test${i}` };
					}
				}
				const builder = new TestBuilder();
				builders.push(builder);
				registry.register(builder);
			}

			const targetTypes = builders.map((b) => b.provides);
			const plan = planner.createExecutionPlan(targetTypes);

			const result = await strategy.execute(context, plan, { maxConcurrency: 2 });

			// All builders should complete
			for (const dataType of targetTypes) {
				expect(result.dataSet.contains(dataType)).toBe(true);
			}
			expect(result.stats.parallelExecution).toBe(true);
		});

		test('should handle mixed sequential and parallel execution levels', async () => {
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();
			const statsBuilder = new UserStatsBuilder();
			const reportBuilder = new ReportBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);
			registry.register(statsBuilder);
			registry.register(reportBuilder);

			const plan = planner.createExecutionPlan(['report']);

			// Expected execution levels:
			// Level 1: [user] (sequential)
			// Level 2: [profile, userStats] (parallel)
			// Level 3: [report] (sequential)

			const startTime = Date.now();
			const result = await strategy.execute(context, plan);
			const endTime = Date.now();
			const executionTime = endTime - startTime;

			expect(result.dataSet.contains('user')).toBe(true);
			expect(result.dataSet.contains('profile')).toBe(true);
			expect(result.dataSet.contains('userStats')).toBe(true);
			expect(result.dataSet.contains('report')).toBe(true);

			// Should be faster than sequential (profile + userStats run in parallel)
			// Sequential: ~10 + 15 + 20 + 25 = 70ms
			// Parallel: ~10 + max(15, 20) + 25 = 55ms (plus overhead)
			expect(executionTime).toBeLessThan(70);
		});

		test('should handle timeout in parallel execution', async () => {
			const slowBuilder = new SlowBuilder();
			const independent1 = new IndependentBuilder1();

			registry.register(slowBuilder);
			registry.register(independent1);

			const plan = planner.createExecutionPlan(['slow', 'independent1']);

			await expect(strategy.execute(context, plan, { builderTimeout: 100 })).rejects.toThrow('timed out after 100ms');
		});

		test('should handle error in parallel execution with continueOnError=false', async () => {
			const failingBuilder = new FailingBuilder();
			const independent1 = new IndependentBuilder1();

			registry.register(failingBuilder);
			registry.register(independent1);

			const plan = planner.createExecutionPlan(['failing', 'independent1']);

			await expect(strategy.execute(context, plan, { continueOnError: false })).rejects.toThrow(BuilderExecutionError);
		});

		test('should handle error in parallel execution with continueOnError=true', async () => {
			const failingBuilder = new FailingBuilder();
			const independent1 = new IndependentBuilder1();

			registry.register(failingBuilder);
			registry.register(independent1);

			const plan = planner.createExecutionPlan(['failing', 'independent1']);

			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

			const result = await strategy.execute(context, plan, { continueOnError: true });

			expect(result.dataSet.contains('independent1')).toBe(true);
			expect(result.dataSet.contains('failing')).toBe(false);
			expect(consoleSpy).toHaveBeenCalled();

			consoleSpy.mockRestore();
		});

		test('should collect parallel execution statistics', async () => {
			const independent1 = new IndependentBuilder1();
			const independent2 = new IndependentBuilder2();
			const dependent = new DependentBuilder();

			registry.register(independent1);
			registry.register(independent2);
			registry.register(dependent);

			const plan = planner.createExecutionPlan(['dependent']);
			const result = await strategy.execute(context, plan);

			expect(result.stats.buildersExecuted).toBe(3);
			expect(result.stats.parallelExecution).toBe(true);
			expect(result.stats.totalExecutionTime).toBeGreaterThan(0);
			expect(result.stats.parallelLevels).toBe(2);
			expect(result.stats.maxConcurrency).toBe(2);
		});
	});

	describe('ExecutionStrategyFactory', () => {
		test('should create sequential strategy', () => {
			const strategy = ExecutionStrategyFactory.createStrategy('sequential', registry, statsCollector);

			expect(strategy).toBeInstanceOf(SequentialExecutionStrategy);
			expect(strategy.getStrategyName()).toBe('sequential');
		});

		test('should create parallel strategy', () => {
			const strategy = ExecutionStrategyFactory.createStrategy('parallel', registry, statsCollector);

			expect(strategy).toBeInstanceOf(ParallelExecutionStrategy);
			expect(strategy.getStrategyName()).toBe('parallel');
		});

		test('should throw error for unknown strategy', () => {
			expect(() => {
				ExecutionStrategyFactory.createStrategy('unknown' as any, registry, statsCollector);
			}).toThrow('Unknown execution strategy: unknown');
		});

		test('should return available strategies', () => {
			const strategies = ExecutionStrategyFactory.getAvailableStrategies();

			expect(strategies).toEqual(['sequential', 'parallel']);
		});
	});

	describe('BuilderExecutionError', () => {
		test('should create error with proper information', () => {
			const originalError = new Error('Original error message');
			const error = new BuilderExecutionError('TestBuilder', 'testType', originalError);

			expect(error.message).toContain('TestBuilder');
			expect(error.message).toContain('testType');
			expect(error.message).toContain('Original error message');
			expect(error.name).toBe('BuilderExecutionError');
		});
	});

	describe('Edge Cases and Advanced Scenarios', () => {
		test('should handle empty execution plan', async () => {
			const strategy = new SequentialExecutionStrategy(registry, statsCollector);
			const emptyPlan = planner.createExecutionPlan([]);

			const result = await strategy.execute(context, emptyPlan);

			expect(result.executionOrder).toEqual([]);
			expect(result.stats.buildersExecuted).toBe(0);
		});

		test('should handle DataSet cloning correctly', async () => {
			const strategy = new SequentialExecutionStrategy(registry, statsCollector);
			const userBuilder = new UserBuilder();
			registry.register(userBuilder);

			// Add initial data
			const initialData: User = { type: 'user', id: 100, name: 'Initial User', email: 'initial@example.com' };
			(context.initialData as DataSetImpl).add(initialData);

			const plan = planner.createExecutionPlan(['user']);
			const result = await strategy.execute(context, plan);

			// Should use existing data, not execute builder
			const user = result.dataSet.accessor<User>('user');
			expect(user?.id).toBe(100);
			expect(user?.name).toBe('Initial User');
		});

		test('should handle non-DataSetImpl initial data', async () => {
			const strategy = new SequentialExecutionStrategy(registry, statsCollector);
			const userBuilder = new UserBuilder();
			registry.register(userBuilder);

			// Create a mock DataSet that's not DataSetImpl
			const mockDataSet: DataSet = {
				contains: () => false,
				accessor: () => undefined,
				size: () => 0,
				isEmpty: () => true,
			};

			const customContext: ExecutionContext = {
				dataFlow: { name: 'test', targetData: [] },
				initialData: mockDataSet,
				builders: new Map(),
			};

			const plan = planner.createExecutionPlan(['user']);
			const result = await strategy.execute(customContext, plan);

			expect(result.dataSet.contains('user')).toBe(true);
		});

		test('should handle builder that returns null/undefined', async () => {
			class NullBuilder implements DataBuilder<Data> {
				readonly provides = 'null';
				readonly consumes: string[] = [];

				async build(dataSet: DataSet): Promise<Data> {
					return null as any; // Simulate null return
				}
			}

			const strategy = new SequentialExecutionStrategy(registry, statsCollector);
			const nullBuilder = new NullBuilder();
			registry.register(nullBuilder);

			const plan = planner.createExecutionPlan(['null']);
			const result = await strategy.execute(context, plan);

			// Should handle null result gracefully
			expect(result.dataSet.contains('null')).toBe(false);
		});

		test('should handle concurrent access to shared DataSet', async () => {
			const strategy = new ParallelExecutionStrategy(registry, statsCollector);

			// Create builders that access and modify shared state
			interface SharedData1 extends Data {
				readonly type: 'shared1';
				value: string;
			}

			interface SharedData2 extends Data {
				readonly type: 'shared2';
				value: string;
			}

			class SharedStateBuilder1 implements DataBuilder<SharedData1> {
				readonly provides = 'shared1';
				readonly consumes: string[] = [];

				async build(dataSet: DataSet): Promise<SharedData1> {
					await new Promise((resolve) => setTimeout(resolve, 10));
					return { type: 'shared1', value: 'builder1' };
				}
			}

			class SharedStateBuilder2 implements DataBuilder<SharedData2> {
				readonly provides = 'shared2';
				readonly consumes: string[] = [];

				async build(dataSet: DataSet): Promise<SharedData2> {
					await new Promise((resolve) => setTimeout(resolve, 15));
					return { type: 'shared2', value: 'builder2' };
				}
			}

			registry.register(new SharedStateBuilder1());
			registry.register(new SharedStateBuilder2());

			const plan = planner.createExecutionPlan(['shared1', 'shared2']);
			const result = await strategy.execute(context, plan);

			expect(result.dataSet.contains('shared1')).toBe(true);
			expect(result.dataSet.contains('shared2')).toBe(true);
		});

		test('should handle performance comparison between strategies', async () => {
			// Set up scenario with multiple independent builders
			const builders = [];
			for (let i = 1; i <= 4; i++) {
				class PerfTestBuilder implements DataBuilder<Data> {
					readonly provides = `perf${i}`;
					readonly consumes: string[] = [];
					async build(dataSet: DataSet): Promise<Data> {
						await new Promise((resolve) => setTimeout(resolve, 25)); // 25ms each
						return { type: `perf${i}` };
					}
				}
				const builder = new PerfTestBuilder();
				builders.push(builder);
				registry.register(builder);
			}

			const targetTypes = builders.map((b) => b.provides);
			const plan = planner.createExecutionPlan(targetTypes);

			// Test sequential execution
			const sequentialStrategy = new SequentialExecutionStrategy(registry, new ExecutionStatisticsCollector());
			const sequentialStart = Date.now();
			const sequentialResult = await sequentialStrategy.execute(context, plan);
			const sequentialTime = Date.now() - sequentialStart;

			// Test parallel execution
			const parallelStrategy = new ParallelExecutionStrategy(registry, new ExecutionStatisticsCollector());
			const parallelStart = Date.now();
			const parallelResult = await parallelStrategy.execute(context, plan);
			const parallelTime = Date.now() - parallelStart;

			// Both should have same result
			for (const dataType of targetTypes) {
				expect(sequentialResult.dataSet.contains(dataType)).toBe(true);
				expect(parallelResult.dataSet.contains(dataType)).toBe(true);
			}

			// Parallel should be faster (4 * 25ms = 100ms vs ~25ms parallel)
			expect(parallelTime).toBeLessThan(sequentialTime);
		});
	});
});
