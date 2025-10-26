import { beforeEach, describe, expect, test, vi } from 'vitest';
import { AbstractDataBuilder, CombineDataBuilder, SourceDataBuilder, TransformDataBuilder } from '../src/builders/AbstractDataBuilder';
import { DataFlowEngine, ExecutionMode } from '../src/core/DataFlowEngine';
import { DataSetImpl } from '../src/core/DataSetImpl';
import { CircularDependencyError, MissingBuilderError } from '../src/core/ExecutionPlanner';
import { BuilderExecutionError } from '../src/core/ExecutionStrategy';
import { Data, DataSet, ExecutionContext } from '../src/types';

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
	userId: number;
	summary: string;
	generatedAt: Date;
}

interface Config extends Data {
	readonly type: 'config';
	apiKey: string;
	timeout: number;
	enableFeatures: string[];
}

interface Notification extends Data {
	readonly type: 'notification';
	userId: number;
	message: string;
	notificationType: 'email' | 'sms' | 'push';
}

// Test builders using AbstractDataBuilder hierarchy

// Source builders (no dependencies)
class ConfigSourceBuilder extends SourceDataBuilder<Config> {
	readonly provides = 'config';

	async build(dataSet: DataSet): Promise<Config> {
		return this.createData<Config>('config', {
			apiKey: 'test-api-key',
			timeout: 5000,
			enableFeatures: ['analytics', 'notifications'],
		});
	}
}

class UserSourceBuilder extends SourceDataBuilder<User> {
	readonly provides = 'user';

	async build(dataSet: DataSet): Promise<User> {
		return this.createData<User>('user', {
			id: 1,
			name: 'John Doe',
			email: 'john.doe@example.com',
		});
	}
}

// Transform builders (single input)
class UserToProfileTransformer extends TransformDataBuilder<User, Profile> {
	readonly provides = 'profile';
	readonly inputType = 'user';

	async transform(input: User): Promise<Profile> {
		return this.createData<Profile>('profile', {
			userId: input.id,
			displayName: `${input.name} (Profile)`,
			avatar: `avatar_${input.id}.png`,
		});
	}
}

class UserToStatsTransformer extends TransformDataBuilder<User, UserStats> {
	readonly provides = 'userStats';
	readonly inputType = 'user';

	async transform(input: User): Promise<UserStats> {
		await new Promise((resolve) => setTimeout(resolve, 10)); // Simulate async operation
		return this.createData<UserStats>('userStats', {
			userId: input.id,
			loginCount: Math.floor(Math.random() * 100) + 1,
			lastSeen: new Date(),
		});
	}
}

// Combine builders (multiple inputs)
class UserReportCombiner extends CombineDataBuilder<Report> {
	readonly provides = 'report';
	readonly consumes = ['user', 'profile', 'userStats'];

	async combine(inputs: Map<string, Data>): Promise<Report> {
		const user = inputs.get('user') as User;
		const profile = inputs.get('profile') as Profile;
		const stats = inputs.get('userStats') as UserStats;

		return this.createData<Report>('report', {
			userId: user.id,
			summary: `User ${profile.displayName} has ${stats.loginCount} logins`,
			generatedAt: new Date(),
		});
	}
}

class NotificationCombiner extends CombineDataBuilder<Notification> {
	readonly provides = 'notification';
	readonly consumes = ['user', 'config'];

	async combine(inputs: Map<string, Data>): Promise<Notification> {
		const user = inputs.get('user') as User;
		const config = inputs.get('config') as Config;

		return this.createData<Notification>('notification', {
			userId: user.id,
			message: `Welcome ${user.name}! Your API key is ${config.apiKey}`,
			notificationType: 'email',
		});
	}
}

// Problematic builders for error testing
class FailingBuilder extends AbstractDataBuilder<Data> {
	readonly provides = 'failing';
	readonly consumes: string[] = [];

	async build(dataSet: DataSet): Promise<Data> {
		throw new Error('Intentional failure for testing');
	}
}

class SlowBuilder extends AbstractDataBuilder<Data> {
	readonly provides = 'slow';
	readonly consumes: string[] = [];

	async build(dataSet: DataSet): Promise<Data> {
		await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second delay
		return this.createData<Data>('slow', {});
	}
}

class CircularBuilder1 extends AbstractDataBuilder<Data> {
	readonly provides = 'circular1';
	readonly consumes = ['circular2'];

	async build(dataSet: DataSet): Promise<Data> {
		return this.createData<Data>('circular1', {});
	}
}

class CircularBuilder2 extends AbstractDataBuilder<Data> {
	readonly provides = 'circular2';
	readonly consumes = ['circular1'];

	async build(dataSet: DataSet): Promise<Data> {
		return this.createData<Data>('circular2', {});
	}
}

class MissingDependencyBuilder extends AbstractDataBuilder<Data> {
	readonly provides = 'missingDep';
	readonly consumes = ['nonexistent'];

	async build(dataSet: DataSet): Promise<Data> {
		const missing = this.require<Data>(dataSet, 'nonexistent');
		return missing;
	}
}

describe('DataFlowEngine', () => {
	let engine: DataFlowEngine;

	beforeEach(() => {
		engine = new DataFlowEngine();
	});

	describe('Builder Management', () => {
		test('should register single builder', () => {
			const userBuilder = new UserSourceBuilder();

			engine.registerBuilder(userBuilder);

			expect(engine.hasBuilder('user')).toBe(true);
			expect(engine.getBuilder('user')).toBe(userBuilder);
		});

		test('should register multiple builders', () => {
			const builders = [new UserSourceBuilder(), new ConfigSourceBuilder(), new UserToProfileTransformer()];

			engine.registerBuilders(builders);

			expect(engine.hasBuilder('user')).toBe(true);
			expect(engine.hasBuilder('config')).toBe(true);
			expect(engine.hasBuilder('profile')).toBe(true);
		});

		test('should throw error when registering duplicate builder without overwrite', () => {
			const userBuilder1 = new UserSourceBuilder();
			const userBuilder2 = new UserSourceBuilder();

			engine.registerBuilder(userBuilder1);

			expect(() => {
				engine.registerBuilder(userBuilder2);
			}).toThrow();
		});

		test('should allow overwriting builder when explicitly allowed', () => {
			const userBuilder1 = new UserSourceBuilder();
			const userBuilder2 = new UserSourceBuilder();

			engine.registerBuilder(userBuilder1);
			engine.registerBuilder(userBuilder2, true);

			expect(engine.getBuilder('user')).toBe(userBuilder2);
		});

		test('should unregister builder', () => {
			const userBuilder = new UserSourceBuilder();

			engine.registerBuilder(userBuilder);
			expect(engine.hasBuilder('user')).toBe(true);

			const wasRemoved = engine.unregisterBuilder('user');
			expect(wasRemoved).toBe(true);
			expect(engine.hasBuilder('user')).toBe(false);
		});

		test('should return false when unregistering non-existent builder', () => {
			const wasRemoved = engine.unregisterBuilder('nonexistent');
			expect(wasRemoved).toBe(false);
		});

		test('should get all builders', () => {
			const userBuilder = new UserSourceBuilder();
			const configBuilder = new ConfigSourceBuilder();

			engine.registerBuilder(userBuilder);
			engine.registerBuilder(configBuilder);

			const allBuilders = engine.getAllBuilders();
			expect(allBuilders.size).toBe(2);
			expect(allBuilders.get('user')).toBe(userBuilder);
			expect(allBuilders.get('config')).toBe(configBuilder);
		});

		test('should clear all builders', () => {
			engine.registerBuilder(new UserSourceBuilder());
			engine.registerBuilder(new ConfigSourceBuilder());
			expect(engine.getAllBuilders().size).toBe(2);

			engine.clearBuilders();
			expect(engine.getAllBuilders().size).toBe(0);
		});
	});

	describe('Execution Planning', () => {
		test('should create execution plan for simple flow', () => {
			engine.registerBuilder(new UserSourceBuilder());
			engine.registerBuilder(new UserToProfileTransformer());

			const plan = engine.getExecutionPlan(['profile']);

			expect(plan.isValid).toBe(true);
			expect(plan.executionOrder).toEqual(['user', 'profile']);
			expect(plan.parallelExecutionLevels).toEqual([['user'], ['profile']]);
			expect(plan.missingBuilders).toEqual([]);
			expect(plan.cycles).toEqual([]);
			expect(plan.totalBuilders).toBe(2);
			expect(plan.maxConcurrency).toBe(1);
		});

		test('should create execution plan for complex flow', () => {
			engine.registerBuilder(new UserSourceBuilder());
			engine.registerBuilder(new UserToProfileTransformer());
			engine.registerBuilder(new UserToStatsTransformer());
			engine.registerBuilder(new UserReportCombiner());

			const plan = engine.getExecutionPlan(['report']);

			expect(plan.isValid).toBe(true);
			expect(plan.executionOrder).toEqual(['user', 'profile', 'userStats', 'report']);
			expect(plan.parallelExecutionLevels).toEqual([['user'], ['profile', 'userStats'], ['report']]);
			expect(plan.maxConcurrency).toBe(2);
		});

		test('should detect missing builders in plan', () => {
			const plan = engine.getExecutionPlan(['nonexistent']);

			expect(plan.isValid).toBe(false);
			expect(plan.missingBuilders).toContain('nonexistent');
			expect(plan.executionOrder).toEqual([]);
			expect(plan.totalBuilders).toBe(0);
		});

		test('should detect circular dependencies in plan', () => {
			engine.registerBuilder(new CircularBuilder1());
			engine.registerBuilder(new CircularBuilder2());

			const plan = engine.getExecutionPlan(['circular1']);

			expect(plan.isValid).toBe(false);
			expect(plan.cycles.length).toBeGreaterThan(0);
		});

		test('should analyze dependencies', () => {
			engine.registerBuilder(new UserSourceBuilder());
			engine.registerBuilder(new UserToProfileTransformer());
			engine.registerBuilder(new UserToStatsTransformer());
			engine.registerBuilder(new UserReportCombiner());

			const analysis = engine.analyzeDependencies(['report']);

			expect(analysis.directDependencies.get('user')).toEqual([]);
			expect(analysis.directDependencies.get('profile')).toEqual(['user']);
			expect(analysis.directDependencies.get('userStats')).toEqual(['user']);
			expect(analysis.directDependencies.get('report')).toEqual(['user', 'profile', 'userStats']);

			expect(analysis.rootNodes).toContain('user');
			expect(analysis.leafNodes).toContain('report');
		});

		test('should get execution plan statistics', () => {
			engine.registerBuilder(new UserSourceBuilder());
			engine.registerBuilder(new UserToProfileTransformer());
			engine.registerBuilder(new UserToStatsTransformer());
			engine.registerBuilder(new UserReportCombiner());

			const stats = engine.getExecutionPlanStats(['report']);

			expect(stats.sequentialEstimate).toBe(4);
			expect(stats.parallelLevels).toBe(3);
			expect(stats.dependencyDepth).toBe(3);
			expect(stats.complexityScore).toBeGreaterThan(0);
		});
	});

	describe('Sequential Execution', () => {
		test('should execute simple sequential flow', async () => {
			engine.registerBuilder(new UserSourceBuilder());

			const context: ExecutionContext = {
				dataFlow: { name: 'test-flow', targetData: ['user'] },
				initialData: new DataSetImpl(),
				builders: new Map(),
			};

			const result = await engine.executeWithOptions(context, { mode: ExecutionMode.SEQUENTIAL });

			expect(result.dataSet.contains('user')).toBe(true);
			expect(result.executionOrder).toEqual(['user']);
			expect(result.stats.buildersExecuted).toBe(1);
			expect(result.stats.parallelExecution).toBe(false);
		});

		test('should execute complex sequential flow', async () => {
			engine.registerBuilder(new UserSourceBuilder());
			engine.registerBuilder(new UserToProfileTransformer());
			engine.registerBuilder(new UserToStatsTransformer());
			engine.registerBuilder(new UserReportCombiner());

			const context: ExecutionContext = {
				dataFlow: { name: 'complex-flow', targetData: ['report'] },
				initialData: new DataSetImpl(),
				builders: new Map(),
			};

			const result = await engine.executeWithOptions(context, { mode: ExecutionMode.SEQUENTIAL });

			expect(result.dataSet.contains('user')).toBe(true);
			expect(result.dataSet.contains('profile')).toBe(true);
			expect(result.dataSet.contains('userStats')).toBe(true);
			expect(result.dataSet.contains('report')).toBe(true);

			const report = result.dataSet.accessor<Report>('report');
			expect(report?.userId).toBe(1);
			expect(report?.summary).toContain('John Doe (Profile)');
			expect(report?.generatedAt).toBeInstanceOf(Date);
		});

		test('should execute with initial data', async () => {
			engine.registerBuilder(new UserToProfileTransformer());

			const initialData = new DataSetImpl();
			const existingUser: User = { type: 'user', id: 99, name: 'Existing User', email: 'existing@example.com' };
			initialData.add(existingUser);

			const context: ExecutionContext = {
				dataFlow: { name: 'with-initial', targetData: ['profile'] },
				initialData,
				builders: new Map(),
			};

			const result = await engine.executeWithOptions(context, { mode: ExecutionMode.SEQUENTIAL });

			const profile = result.dataSet.accessor<Profile>('profile');
			expect(profile?.userId).toBe(99);
			expect(profile?.displayName).toBe('Existing User (Profile)');
		});

		test('should execute simple flow using convenience method', async () => {
			engine.registerBuilder(new UserSourceBuilder());
			engine.registerBuilder(new ConfigSourceBuilder());

			const result = await engine.executeSimpleWithOptions(['user', 'config'], undefined, {
				mode: ExecutionMode.SEQUENTIAL,
			});

			expect(result.dataSet.contains('user')).toBe(true);
			expect(result.dataSet.contains('config')).toBe(true);
			expect(result.stats.buildersExecuted).toBe(2);
		});
	});

	describe('Parallel Execution', () => {
		test('should execute parallel flow', async () => {
			engine.registerBuilder(new UserSourceBuilder());
			engine.registerBuilder(new ConfigSourceBuilder());
			engine.registerBuilder(new NotificationCombiner());

			const context: ExecutionContext = {
				dataFlow: { name: 'parallel-flow', targetData: ['notification'] },
				initialData: new DataSetImpl(),
				builders: new Map(),
			};

			const startTime = Date.now();
			const result = await engine.executeWithOptions(context, { mode: ExecutionMode.PARALLEL });
			const endTime = Date.now();

			expect(result.dataSet.contains('user')).toBe(true);
			expect(result.dataSet.contains('config')).toBe(true);
			expect(result.dataSet.contains('notification')).toBe(true);
			expect(result.stats.parallelExecution).toBe(true);

			const notification = result.dataSet.accessor<Notification>('notification');
			expect(notification?.userId).toBe(1);
			expect(notification?.message).toContain('John Doe');
			expect(notification?.message).toContain('test-api-key');
		});

		test('should execute complex parallel flow efficiently', async () => {
			engine.registerBuilder(new UserSourceBuilder());
			engine.registerBuilder(new UserToProfileTransformer());
			engine.registerBuilder(new UserToStatsTransformer());
			engine.registerBuilder(new UserReportCombiner());

			const context: ExecutionContext = {
				dataFlow: { name: 'efficient-parallel', targetData: ['report'] },
				initialData: new DataSetImpl(),
				builders: new Map(),
			};

			const startTime = Date.now();
			const result = await engine.executeWithOptions(context, { mode: ExecutionMode.PARALLEL });
			const endTime = Date.now();
			const executionTime = endTime - startTime;

			expect(result.dataSet.contains('report')).toBe(true);
			expect(result.stats.parallelExecution).toBe(true);
			expect(result.stats.parallelLevels).toBe(3);
			expect(result.stats.maxConcurrency).toBe(2);

			// Should be faster than purely sequential execution due to parallel profile/stats building
			expect(executionTime).toBeLessThan(100); // Reasonable upper bound
		});

		test('should respect concurrency limits', async () => {
			// Create multiple independent builders
			const builders = [];
			for (let i = 1; i <= 5; i++) {
				class IndependentBuilder extends SourceDataBuilder<Data> {
					readonly provides = `independent${i}`;
					async build(dataSet: DataSet): Promise<Data> {
						await new Promise((resolve) => setTimeout(resolve, 20));
						return this.createData<Data>(`independent${i}`, {});
					}
				}
				builders.push(new IndependentBuilder());
			}

			builders.forEach((builder) => engine.registerBuilder(builder));

			const targetTypes = builders.map((b) => b.provides);
			const result = await engine.executeSimpleWithOptions(targetTypes, undefined, {
				mode: ExecutionMode.PARALLEL,
				maxConcurrency: 2,
			});

			// All should complete despite concurrency limit
			targetTypes.forEach((type) => {
				expect(result.dataSet.contains(type)).toBe(true);
			});
			expect(result.stats.parallelExecution).toBe(true);
		});
	});

	describe('Error Handling', () => {
		test('should throw CircularDependencyError for circular dependencies', async () => {
			engine.registerBuilder(new CircularBuilder1());
			engine.registerBuilder(new CircularBuilder2());

			const context: ExecutionContext = {
				dataFlow: { name: 'circular-flow', targetData: ['circular1'] },
				initialData: new DataSetImpl(),
				builders: new Map(),
			};

			await expect(engine.executeWithOptions(context)).rejects.toThrow(CircularDependencyError);
		});

		test('should throw MissingBuilderError for missing dependencies', async () => {
			engine.registerBuilder(new MissingDependencyBuilder());

			const context: ExecutionContext = {
				dataFlow: { name: 'missing-dep-flow', targetData: ['missingDep'] },
				initialData: new DataSetImpl(),
				builders: new Map(),
			};

			await expect(engine.executeWithOptions(context)).rejects.toThrow(MissingBuilderError);
		});

		test('should throw BuilderExecutionError for failing builders', async () => {
			engine.registerBuilder(new FailingBuilder());

			const context: ExecutionContext = {
				dataFlow: { name: 'failing-flow', targetData: ['failing'] },
				initialData: new DataSetImpl(),
				builders: new Map(),
			};

			await expect(engine.executeWithOptions(context)).rejects.toThrow(BuilderExecutionError);
		});

		test('should handle builder timeout', async () => {
			engine.registerBuilder(new SlowBuilder());

			const context: ExecutionContext = {
				dataFlow: { name: 'timeout-flow', targetData: ['slow'] },
				initialData: new DataSetImpl(),
				builders: new Map(),
			};

			await expect(engine.executeWithOptions(context, { builderTimeout: 100 })).rejects.toThrow();
		});

		test('should continue execution on error when configured', async () => {
			engine.registerBuilder(new UserSourceBuilder());
			engine.registerBuilder(new FailingBuilder());

			const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

			const result = await engine.executeSimpleWithOptions(['user', 'failing'], undefined, {
				continueOnError: true,
			});

			expect(result.dataSet.contains('user')).toBe(true);
			expect(result.dataSet.contains('failing')).toBe(false);
			expect(consoleSpy).toHaveBeenCalled();

			consoleSpy.mockRestore();
		});

		test('should wrap unexpected errors in BuilderExecutionError', async () => {
			// Create a builder that throws a non-standard error
			class WeirdErrorBuilder extends AbstractDataBuilder<Data> {
				readonly provides = 'weird';
				readonly consumes: string[] = [];

				async build(dataSet: DataSet): Promise<Data> {
					throw 'String error instead of Error object';
				}
			}

			engine.registerBuilder(new WeirdErrorBuilder());

			const context: ExecutionContext = {
				dataFlow: { name: 'weird-error-flow', targetData: ['weird'] },
				initialData: new DataSetImpl(),
				builders: new Map(),
			};

			await expect(engine.executeWithOptions(context)).rejects.toThrow(BuilderExecutionError);
		});
	});

	describe('Legacy Methods (Backward Compatibility)', () => {
		test('should execute using legacy execute method', async () => {
			engine.registerBuilder(new UserSourceBuilder());

			const context: ExecutionContext = {
				dataFlow: { name: 'legacy-flow', targetData: ['user'] },
				initialData: new DataSetImpl(),
				builders: new Map(),
			};

			const result = await engine.execute(context);

			expect(result.dataSet.contains('user')).toBe(true);
			expect(result.stats.parallelExecution).toBe(false);
		});

		test('should execute using legacy executeParallel method', async () => {
			engine.registerBuilder(new UserSourceBuilder());
			engine.registerBuilder(new ConfigSourceBuilder());

			const context: ExecutionContext = {
				dataFlow: { name: 'legacy-parallel', targetData: ['user', 'config'] },
				initialData: new DataSetImpl(),
				builders: new Map(),
			};

			const result = await engine.executeParallel(context);

			expect(result.dataSet.contains('user')).toBe(true);
			expect(result.dataSet.contains('config')).toBe(true);
			expect(result.stats.parallelExecution).toBe(true);
		});

		test('should execute using legacy executeSimple method', async () => {
			engine.registerBuilder(new UserSourceBuilder());

			const result = await engine.executeSimple(['user']);

			expect(result.dataSet.contains('user')).toBe(true);
			expect(result.stats.parallelExecution).toBe(false);
		});

		test('should execute using legacy executeParallelSimple method', async () => {
			engine.registerBuilder(new UserSourceBuilder());
			engine.registerBuilder(new ConfigSourceBuilder());

			const result = await engine.executeParallelSimple(['user', 'config']);

			expect(result.dataSet.contains('user')).toBe(true);
			expect(result.dataSet.contains('config')).toBe(true);
			expect(result.stats.parallelExecution).toBe(true);
		});
	});

	describe('Utility Methods', () => {
		test('should get engine info', () => {
			engine.registerBuilder(new UserSourceBuilder());
			engine.registerBuilder(new ConfigSourceBuilder());
			engine.registerBuilder(new UserToProfileTransformer());

			const info = engine.getEngineInfo();

			expect(info.registeredBuilders).toBe(3);
			expect(info.availableStrategies).toEqual(['sequential', 'parallel']);
			expect(info.builderTypes).toContain('user');
			expect(info.builderTypes).toContain('config');
			expect(info.builderTypes).toContain('profile');
		});

		test('should validate registry and detect issues', () => {
			engine.registerBuilder(new UserToProfileTransformer()); // Depends on 'user' but no user builder

			const validation = engine.validateRegistry();

			expect(validation.isValid).toBe(false);
			expect(validation.issues).toContain('Unsatisfied dependencies: user');
		});

		test('should validate registry and detect warnings', () => {
			engine.registerBuilder(new UserSourceBuilder()); // Provides 'user' but nothing consumes it

			const validation = engine.validateRegistry();

			expect(validation.isValid).toBe(true);
			expect(validation.warnings).toContain('Potentially unused builders: user');
		});

		test('should validate healthy registry', () => {
			engine.registerBuilder(new UserSourceBuilder());
			engine.registerBuilder(new UserToProfileTransformer());

			const validation = engine.validateRegistry();

			expect(validation.isValid).toBe(true);
			expect(validation.issues).toEqual([]);
			expect(validation.warnings).toContain('Potentially unused builders: profile');
		});
	});

	describe('Complex Integration Scenarios', () => {
		test('should handle large dependency graph', async () => {
			// Build a complex graph: config/user -> profile/stats -> report -> notification
			engine.registerBuilder(new ConfigSourceBuilder());
			engine.registerBuilder(new UserSourceBuilder());
			engine.registerBuilder(new UserToProfileTransformer());
			engine.registerBuilder(new UserToStatsTransformer());
			engine.registerBuilder(new UserReportCombiner());

			// Extended notification that depends on report
			class ExtendedNotificationBuilder extends CombineDataBuilder<Notification> {
				readonly provides = 'notification';
				readonly consumes = ['report', 'config'];

				async combine(inputs: Map<string, Data>): Promise<Notification> {
					const report = inputs.get('report') as Report;
					const config = inputs.get('config') as Config;

					return this.createData<Notification>('notification', {
						userId: report.userId,
						message: `Report generated: ${report.summary}. Features: ${config.enableFeatures.join(', ')}`,
						notificationType: 'email',
					});
				}
			}

			engine.registerBuilder(new ExtendedNotificationBuilder());

			const result = await engine.executeSimpleWithOptions(['notification'], undefined, {
				mode: ExecutionMode.PARALLEL,
			});

			expect(result.dataSet.contains('config')).toBe(true);
			expect(result.dataSet.contains('user')).toBe(true);
			expect(result.dataSet.contains('profile')).toBe(true);
			expect(result.dataSet.contains('userStats')).toBe(true);
			expect(result.dataSet.contains('report')).toBe(true);
			expect(result.dataSet.contains('notification')).toBe(true);

			const notification = result.dataSet.accessor<Notification>('notification');
			expect(notification?.message).toContain('Report generated');
			expect(notification?.message).toContain('analytics, notifications');
		});

		test('should handle mixed execution patterns', async () => {
			engine.registerBuilder(new UserSourceBuilder());
			engine.registerBuilder(new ConfigSourceBuilder());
			engine.registerBuilder(new UserToProfileTransformer());
			engine.registerBuilder(new UserToStatsTransformer());
			engine.registerBuilder(new UserReportCombiner());
			engine.registerBuilder(new NotificationCombiner());

			// Execute multiple targets that share dependencies
			const result = await engine.executeSimpleWithOptions(['report', 'notification'], undefined, {
				mode: ExecutionMode.PARALLEL,
				maxConcurrency: 3,
			});

			expect(result.dataSet.contains('report')).toBe(true);
			expect(result.dataSet.contains('notification')).toBe(true);

			// Both should share the same user and config data
			const report = result.dataSet.accessor<Report>('report');
			const notification = result.dataSet.accessor<Notification>('notification');
			expect(report?.userId).toBe(notification?.userId);
		});

		test('should handle dynamic builder registration during execution', async () => {
			// Start with basic builders
			engine.registerBuilder(new UserSourceBuilder());

			const plan1 = engine.getExecutionPlan(['user']);
			expect(plan1.totalBuilders).toBe(1);

			// Add more builders
			engine.registerBuilder(new UserToProfileTransformer());
			engine.registerBuilder(new UserToStatsTransformer());

			const plan2 = engine.getExecutionPlan(['profile', 'userStats']);
			expect(plan2.totalBuilders).toBe(3);
			expect(plan2.parallelExecutionLevels).toEqual([['user'], ['profile', 'userStats']]);
		});

		test('should handle performance comparison between execution modes', async () => {
			// Set up scenario with multiple independent slow operations
			const slowBuilders = [];
			for (let i = 1; i <= 4; i++) {
				class SlowSourceBuilder extends SourceDataBuilder<Data> {
					readonly provides = `slow${i}`;
					async build(dataSet: DataSet): Promise<Data> {
						await new Promise((resolve) => setTimeout(resolve, 25)); // 25ms each
						return this.createData<Data>(`slow${i}`, {});
					}
				}
				slowBuilders.push(new SlowSourceBuilder());
			}

			slowBuilders.forEach((builder) => engine.registerBuilder(builder));
			const targetTypes = slowBuilders.map((b) => b.provides);

			// Test sequential execution
			const sequentialStart = Date.now();
			const sequentialResult = await engine.executeSimpleWithOptions(targetTypes, undefined, {
				mode: ExecutionMode.SEQUENTIAL,
			});
			const sequentialTime = Date.now() - sequentialStart;

			// Clear and re-register for parallel test
			engine.clearBuilders();
			slowBuilders.forEach((builder) => engine.registerBuilder(builder));

			// Test parallel execution
			const parallelStart = Date.now();
			const parallelResult = await engine.executeSimpleWithOptions(targetTypes, undefined, {
				mode: ExecutionMode.PARALLEL,
			});
			const parallelTime = Date.now() - parallelStart;

			// Verify both produce same results
			targetTypes.forEach((type) => {
				expect(sequentialResult.dataSet.contains(type)).toBe(true);
				expect(parallelResult.dataSet.contains(type)).toBe(true);
			});

			// Parallel should be faster (4 * 25ms = 100ms vs ~25ms parallel)
			expect(parallelTime).toBeLessThan(sequentialTime);
			expect(sequentialResult.stats.parallelExecution).toBe(false);
			expect(parallelResult.stats.parallelExecution).toBe(true);
		});
	});

	describe('Edge Cases', () => {
		test('should handle empty target data', async () => {
			const result = await engine.executeSimpleWithOptions([]);

			expect(result.executionOrder).toEqual([]);
			expect(result.stats.buildersExecuted).toBe(0);
		});

		test('should handle execution with no registered builders', async () => {
			await expect(engine.executeSimpleWithOptions(['nonexistent'])).rejects.toThrow(MissingBuilderError);
		});

		test('should handle multiple executions with same engine', async () => {
			engine.registerBuilder(new UserSourceBuilder());

			const result1 = await engine.executeSimpleWithOptions(['user']);
			const result2 = await engine.executeSimpleWithOptions(['user']);

			expect(result1.dataSet.contains('user')).toBe(true);
			expect(result2.dataSet.contains('user')).toBe(true);

			// Results should be independent
			const user1 = result1.dataSet.accessor<User>('user');
			const user2 = result2.dataSet.accessor<User>('user');
			expect(user1?.id).toBe(user2?.id); // Same builder produces same data
		});

		test('should handle concurrent executions', async () => {
			engine.registerBuilder(new UserSourceBuilder());
			engine.registerBuilder(new ConfigSourceBuilder());

			// Start multiple executions concurrently
			const promises = [
				engine.executeSimpleWithOptions(['user']),
				engine.executeSimpleWithOptions(['config']),
				engine.executeSimpleWithOptions(['user', 'config']),
			];

			const results = await Promise.all(promises);

			expect(results[0]!.dataSet.contains('user')).toBe(true);
			expect(results[1]!.dataSet.contains('config')).toBe(true);
			expect(results[2]!.dataSet.contains('user')).toBe(true);
			expect(results[2]!.dataSet.contains('config')).toBe(true);
		});
	});
});
