import { describe, test, expect, beforeEach } from 'vitest';
import { ExecutionPlanner, ExecutionPlanningError, CircularDependencyError, MissingBuilderError } from '../src/core/ExecutionPlanner.js';
import { BuilderRegistry } from '../src/core/BuilderRegistry.js';
import { DataBuilder, Data, DataSet } from '../src/types/index.js';

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

interface Email extends Data {
	readonly type: 'email';
	to: string;
	subject: string;
	body: string;
}

// Mock builders for testing
class UserBuilder implements DataBuilder<User> {
	readonly provides = 'user';
	readonly consumes: string[] = [];

	async build(dataSet: DataSet): Promise<User> {
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
		return {
			type: 'report',
			profileId: profile.userId,
			statsId: stats.userId,
			summary: `Report for ${profile.displayName}`,
		};
	}
}

class EmailBuilder implements DataBuilder<Email> {
	readonly provides = 'email';
	readonly consumes = ['user', 'report'];

	async build(dataSet: DataSet): Promise<Email> {
		const user = dataSet.accessor<User>('user');
		const report = dataSet.accessor<Report>('report');
		if (!user || !report) {
			throw new Error('Required data not found');
		}
		return {
			type: 'email',
			to: user.email,
			subject: 'Your Report',
			body: report.summary,
		};
	}
}

// Builders for circular dependency testing
class CircularBuilder1 implements DataBuilder<Data> {
	readonly provides = 'circular1';
	readonly consumes = ['circular2'];

	async build(dataSet: DataSet): Promise<Data> {
		return { type: 'circular1' };
	}
}

class CircularBuilder2 implements DataBuilder<Data> {
	readonly provides = 'circular2';
	readonly consumes = ['circular1'];

	async build(dataSet: DataSet): Promise<Data> {
		return { type: 'circular2' };
	}
}

// Independent builders for parallel execution testing
class IndependentBuilder1 implements DataBuilder<Data> {
	readonly provides = 'independent1';
	readonly consumes: string[] = [];

	async build(dataSet: DataSet): Promise<Data> {
		return { type: 'independent1' };
	}
}

class IndependentBuilder2 implements DataBuilder<Data> {
	readonly provides = 'independent2';
	readonly consumes: string[] = [];

	async build(dataSet: DataSet): Promise<Data> {
		return { type: 'independent2' };
	}
}

class DependentBuilder implements DataBuilder<Data> {
	readonly provides = 'dependent';
	readonly consumes = ['independent1', 'independent2'];

	async build(dataSet: DataSet): Promise<Data> {
		return { type: 'dependent' };
	}
}

describe('ExecutionPlanner', () => {
	let registry: BuilderRegistry;
	let planner: ExecutionPlanner;

	beforeEach(() => {
		registry = new BuilderRegistry();
		planner = new ExecutionPlanner(registry);
	});

	describe('Basic Planning', () => {
		test('should create valid plan for single builder with no dependencies', () => {
			const userBuilder = new UserBuilder();
			registry.register(userBuilder);

			const plan = planner.createExecutionPlan(['user']);

			expect(plan.isValid).toBe(true);
			expect(plan.executionOrder).toEqual(['user']);
			expect(plan.parallelExecutionLevels).toEqual([['user']]);
			expect(plan.missingBuilders).toEqual([]);
			expect(plan.cycles).toEqual([]);
			expect(plan.totalBuilders).toBe(1);
			expect(plan.maxConcurrency).toBe(1);
		});

		test('should create valid plan for simple dependency chain', () => {
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);

			const plan = planner.createExecutionPlan(['profile']);

			expect(plan.isValid).toBe(true);
			expect(plan.executionOrder).toEqual(['user', 'profile']);
			expect(plan.parallelExecutionLevels).toEqual([['user'], ['profile']]);
			expect(plan.missingBuilders).toEqual([]);
			expect(plan.cycles).toEqual([]);
			expect(plan.totalBuilders).toBe(2);
			expect(plan.maxConcurrency).toBe(1);
		});

		test('should create valid plan for complex dependency tree', () => {
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();
			const statsBuilder = new UserStatsBuilder();
			const reportBuilder = new ReportBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);
			registry.register(statsBuilder);
			registry.register(reportBuilder);

			const plan = planner.createExecutionPlan(['report']);

			expect(plan.isValid).toBe(true);
			expect(plan.executionOrder).toEqual(['user', 'profile', 'userStats', 'report']);
			expect(plan.parallelExecutionLevels).toEqual([['user'], ['profile', 'userStats'], ['report']]);
			expect(plan.missingBuilders).toEqual([]);
			expect(plan.cycles).toEqual([]);
			expect(plan.totalBuilders).toBe(4);
			expect(plan.maxConcurrency).toBe(2);
		});

		test('should handle multiple target types', () => {
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();
			const statsBuilder = new UserStatsBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);
			registry.register(statsBuilder);

			const plan = planner.createExecutionPlan(['profile', 'userStats']);

			expect(plan.isValid).toBe(true);
			expect(plan.executionOrder).toEqual(['user', 'profile', 'userStats']);
			expect(plan.parallelExecutionLevels).toEqual([['user'], ['profile', 'userStats']]);
			expect(plan.totalBuilders).toBe(3);
			expect(plan.maxConcurrency).toBe(2);
		});
	});

	describe('Error Detection', () => {
		test('should detect missing builders', () => {
			const plan = planner.createExecutionPlan(['nonexistent']);

			expect(plan.isValid).toBe(false);
			expect(plan.missingBuilders).toContain('nonexistent');
			expect(plan.executionOrder).toEqual([]);
			expect(plan.parallelExecutionLevels).toEqual([]);
			expect(plan.totalBuilders).toBe(0);
			expect(plan.maxConcurrency).toBe(0);
		});

		test('should detect missing dependencies', () => {
			const profileBuilder = new ProfileBuilder(); // depends on 'user'
			registry.register(profileBuilder);

			const plan = planner.createExecutionPlan(['profile']);

			expect(plan.isValid).toBe(false);
			expect(plan.missingBuilders).toContain('user');
			expect(plan.executionOrder).toEqual([]);
			expect(plan.parallelExecutionLevels).toEqual([]);
		});

		test('should detect circular dependencies', () => {
			const circular1 = new CircularBuilder1();
			const circular2 = new CircularBuilder2();

			registry.register(circular1);
			registry.register(circular2);

			const plan = planner.createExecutionPlan(['circular1']);

			expect(plan.isValid).toBe(false);
			expect(plan.cycles.length).toBeGreaterThan(0);
			expect(plan.executionOrder).toEqual([]);
			expect(plan.parallelExecutionLevels).toEqual([]);
		});

		test('should detect both missing builders and circular dependencies', () => {
			const circular1 = new CircularBuilder1();
			const circular2 = new CircularBuilder2();
			registry.register(circular1);
			registry.register(circular2);

			const plan = planner.createExecutionPlan(['circular1', 'nonexistent']);

			expect(plan.isValid).toBe(false);
			expect(plan.cycles.length).toBeGreaterThan(0);
			expect(plan.missingBuilders).toContain('nonexistent');
		});
	});

	describe('Parallel Execution Analysis', () => {
		test('should identify parallel execution opportunities', () => {
			const independent1 = new IndependentBuilder1();
			const independent2 = new IndependentBuilder2();
			const dependent = new DependentBuilder();

			registry.register(independent1);
			registry.register(independent2);
			registry.register(dependent);

			const plan = planner.createExecutionPlan(['dependent']);

			expect(plan.isValid).toBe(true);
			expect(plan.parallelExecutionLevels).toEqual([['independent1', 'independent2'], ['dependent']]);
			expect(plan.maxConcurrency).toBe(2);
		});

		test('should handle complex parallel scenarios', () => {
			// Create scenario: user -> [profile, userStats] -> report -> email
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();
			const statsBuilder = new UserStatsBuilder();
			const reportBuilder = new ReportBuilder();
			const emailBuilder = new EmailBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);
			registry.register(statsBuilder);
			registry.register(reportBuilder);
			registry.register(emailBuilder);

			const plan = planner.createExecutionPlan(['email']);

			expect(plan.isValid).toBe(true);
			expect(plan.parallelExecutionLevels).toEqual([['user'], ['profile', 'userStats'], ['report'], ['email']]);
			expect(plan.maxConcurrency).toBe(2);
		});

		test('should handle purely sequential execution', () => {
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);

			const plan = planner.createExecutionPlan(['profile']);

			expect(plan.parallelExecutionLevels).toEqual([['user'], ['profile']]);
			expect(plan.maxConcurrency).toBe(1);
		});

		test('should handle purely parallel execution', () => {
			const independent1 = new IndependentBuilder1();
			const independent2 = new IndependentBuilder2();

			registry.register(independent1);
			registry.register(independent2);

			const plan = planner.createExecutionPlan(['independent1', 'independent2']);

			expect(plan.parallelExecutionLevels).toEqual([['independent1', 'independent2']]);
			expect(plan.maxConcurrency).toBe(2);
		});
	});

	describe('Plan Validation', () => {
		test('should validate valid plan without throwing', () => {
			const userBuilder = new UserBuilder();
			registry.register(userBuilder);

			const plan = planner.createExecutionPlan(['user']);

			expect(() => {
				planner.validateExecutionPlan(plan);
			}).not.toThrow();
		});

		test('should throw CircularDependencyError for invalid plan with cycles', () => {
			const circular1 = new CircularBuilder1();
			const circular2 = new CircularBuilder2();

			registry.register(circular1);
			registry.register(circular2);

			const plan = planner.createExecutionPlan(['circular1']);

			expect(() => {
				planner.validateExecutionPlan(plan);
			}).toThrow(CircularDependencyError);
		});

		test('should throw MissingBuilderError for plan with missing builders', () => {
			const plan = planner.createExecutionPlan(['nonexistent']);

			expect(() => {
				planner.validateExecutionPlan(plan);
			}).toThrow(MissingBuilderError);
		});

		test('should include specific cycle information in error', () => {
			const circular1 = new CircularBuilder1();
			const circular2 = new CircularBuilder2();

			registry.register(circular1);
			registry.register(circular2);

			const plan = planner.createExecutionPlan(['circular1']);

			try {
				planner.validateExecutionPlan(plan);
				expect.fail('Should have thrown CircularDependencyError');
			} catch (error) {
				expect(error).toBeInstanceOf(CircularDependencyError);
				expect((error as CircularDependencyError).message).toContain('Circular dependencies detected');
			}
		});

		test('should include specific missing builder information in error', () => {
			const plan = planner.createExecutionPlan(['nonexistent']);

			try {
				planner.validateExecutionPlan(plan);
				expect.fail('Should have thrown MissingBuilderError');
			} catch (error) {
				expect(error).toBeInstanceOf(MissingBuilderError);
				expect((error as MissingBuilderError).message).toContain('Missing builders for data types: nonexistent');
			}
		});
	});

	describe('Execution Statistics', () => {
		test('should calculate stats for valid plan', () => {
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();
			const statsBuilder = new UserStatsBuilder();
			const reportBuilder = new ReportBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);
			registry.register(statsBuilder);
			registry.register(reportBuilder);

			const plan = planner.createExecutionPlan(['report']);
			const stats = planner.getExecutionPlanStats(plan);

			expect(stats.sequentialEstimate).toBe(4); // 4 builders
			expect(stats.parallelLevels).toBe(3); // 3 levels: [user] -> [profile, userStats] -> [report]
			expect(stats.averageConcurrency).toBeCloseTo(4 / 3); // 4 builders / 3 levels
			expect(stats.dependencyDepth).toBe(3);
			expect(stats.complexityScore).toBeGreaterThan(0);
		});

		test('should return zero stats for invalid plan', () => {
			const plan = planner.createExecutionPlan(['nonexistent']);
			const stats = planner.getExecutionPlanStats(plan);

			expect(stats.sequentialEstimate).toBe(0);
			expect(stats.parallelLevels).toBe(0);
			expect(stats.averageConcurrency).toBe(0);
			expect(stats.dependencyDepth).toBe(0);
			expect(stats.complexityScore).toBe(0);
		});

		test('should calculate concurrency variance correctly', () => {
			// Create scenario with uneven parallel levels
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();
			const statsBuilder = new UserStatsBuilder();
			const reportBuilder = new ReportBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);
			registry.register(statsBuilder);
			registry.register(reportBuilder);

			const plan = planner.createExecutionPlan(['report']);
			const stats = planner.getExecutionPlanStats(plan);

			// Levels: [user(1)] -> [profile, userStats(2)] -> [report(1)]
			// This has concurrency variance due to different level sizes
			expect(stats.complexityScore).toBeGreaterThan(stats.sequentialEstimate * stats.dependencyDepth);
		});
	});

	describe('Plan Optimization', () => {
		test('should return optimized plan for valid scenario', () => {
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);

			const optimizedPlan = planner.optimizeExecutionPlan(['profile']);

			expect(optimizedPlan.isValid).toBe(true);
			expect(optimizedPlan.executionOrder).toEqual(['user', 'profile']);
		});

		test('should return invalid plan for optimization of invalid scenario', () => {
			const optimizedPlan = planner.optimizeExecutionPlan(['nonexistent']);

			expect(optimizedPlan.isValid).toBe(false);
			expect(optimizedPlan.missingBuilders).toContain('nonexistent');
		});
	});

	describe('Dependency Analysis', () => {
		test('should analyze dependencies for valid plan', () => {
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();
			const statsBuilder = new UserStatsBuilder();
			const reportBuilder = new ReportBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);
			registry.register(statsBuilder);
			registry.register(reportBuilder);

			const analysis = planner.analyzeDependencies(['report']);

			expect(analysis.directDependencies.get('user')).toEqual([]);
			expect(analysis.directDependencies.get('profile')).toEqual(['user']);
			expect(analysis.directDependencies.get('userStats')).toEqual(['user']);
			expect(analysis.directDependencies.get('report')).toEqual(['profile', 'userStats']);

			expect(analysis.transitiveDependencies.get('report')).toContain('user');
			expect(analysis.transitiveDependencies.get('report')).toContain('profile');
			expect(analysis.transitiveDependencies.get('report')).toContain('userStats');

			expect(analysis.rootNodes).toContain('user');
			expect(analysis.leafNodes).toContain('report');
		});

		test('should handle multiple root and leaf nodes', () => {
			const independent1 = new IndependentBuilder1();
			const independent2 = new IndependentBuilder2();
			const dependent = new DependentBuilder();

			registry.register(independent1);
			registry.register(independent2);
			registry.register(dependent);

			const analysis = planner.analyzeDependencies(['dependent']);

			expect(analysis.rootNodes).toContain('independent1');
			expect(analysis.rootNodes).toContain('independent2');
			expect(analysis.leafNodes).toContain('dependent');
		});

		test('should analyze dependencies for multiple targets', () => {
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();
			const statsBuilder = new UserStatsBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);
			registry.register(statsBuilder);

			const analysis = planner.analyzeDependencies(['profile', 'userStats']);

			expect(analysis.leafNodes).toContain('profile');
			expect(analysis.leafNodes).toContain('userStats');
			expect(analysis.rootNodes).toContain('user');
		});
	});

	describe('Edge Cases', () => {
		test('should handle empty target data', () => {
			const userBuilder = new UserBuilder();
			registry.register(userBuilder);

			const plan = planner.createExecutionPlan([]);

			expect(plan.isValid).toBe(true);
			expect(plan.executionOrder).toEqual([]);
			expect(plan.parallelExecutionLevels).toEqual([]);
			expect(plan.totalBuilders).toBe(0);
			expect(plan.maxConcurrency).toBe(0);
		});

		test('should handle empty registry', () => {
			const plan = planner.createExecutionPlan(['user']);

			expect(plan.isValid).toBe(false);
			expect(plan.missingBuilders).toContain('user');
		});

		test('should handle self-dependent builder in planning', () => {
			class SelfDependentBuilder implements DataBuilder<Data> {
				readonly provides = 'selfDependent';
				readonly consumes = ['selfDependent'];

				async build(dataSet: DataSet): Promise<Data> {
					return { type: 'selfDependent' };
				}
			}

			const selfBuilder = new SelfDependentBuilder();
			registry.register(selfBuilder);

			const plan = planner.createExecutionPlan(['selfDependent']);

			// Should detect cycle
			expect(plan.isValid).toBe(false);
			expect(plan.cycles.length).toBeGreaterThan(0);
		});

		test('should handle duplicate target types', () => {
			const userBuilder = new UserBuilder();
			registry.register(userBuilder);

			const plan = planner.createExecutionPlan(['user', 'user', 'user']);

			expect(plan.isValid).toBe(true);
			expect(plan.executionOrder).toEqual(['user']);
			expect(plan.totalBuilders).toBe(1);
		});
	});

	describe('Error Classes', () => {
		test('should create ExecutionPlanningError with cause', () => {
			const originalError = new Error('Original error');
			const planningError = new ExecutionPlanningError('Planning failed', originalError);

			expect(planningError.message).toBe('Planning failed');
			expect(planningError.cause).toBe(originalError);
			expect(planningError.name).toBe('ExecutionPlanningError');
		});

		test('should create CircularDependencyError with cycles', () => {
			const cycles = ['cycle1', 'cycle2'];
			const error = new CircularDependencyError(cycles);

			expect(error.message).toContain('cycle1');
			expect(error.message).toContain('cycle2');
			expect(error.name).toBe('CircularDependencyError');
			expect(error).toBeInstanceOf(ExecutionPlanningError);
		});

		test('should create MissingBuilderError with missing types', () => {
			const missingTypes = ['type1', 'type2'];
			const error = new MissingBuilderError(missingTypes);

			expect(error.message).toContain('type1');
			expect(error.message).toContain('type2');
			expect(error.name).toBe('MissingBuilderError');
			expect(error).toBeInstanceOf(ExecutionPlanningError);
		});
	});

	describe('Complex Integration Scenarios', () => {
		test('should handle deep dependency tree', () => {
			// Create a 5-level deep dependency chain
			class Level1Builder implements DataBuilder<Data> {
				readonly provides = 'level1';
				readonly consumes: string[] = [];
				async build(dataSet: DataSet): Promise<Data> {
					return { type: 'level1' };
				}
			}

			class Level2Builder implements DataBuilder<Data> {
				readonly provides = 'level2';
				readonly consumes = ['level1'];
				async build(dataSet: DataSet): Promise<Data> {
					return { type: 'level2' };
				}
			}

			class Level3Builder implements DataBuilder<Data> {
				readonly provides = 'level3';
				readonly consumes = ['level2'];
				async build(dataSet: DataSet): Promise<Data> {
					return { type: 'level3' };
				}
			}

			class Level4Builder implements DataBuilder<Data> {
				readonly provides = 'level4';
				readonly consumes = ['level3'];
				async build(dataSet: DataSet): Promise<Data> {
					return { type: 'level4' };
				}
			}

			class Level5Builder implements DataBuilder<Data> {
				readonly provides = 'level5';
				readonly consumes = ['level4'];
				async build(dataSet: DataSet): Promise<Data> {
					return { type: 'level5' };
				}
			}

			registry.register(new Level1Builder());
			registry.register(new Level2Builder());
			registry.register(new Level3Builder());
			registry.register(new Level4Builder());
			registry.register(new Level5Builder());

			const plan = planner.createExecutionPlan(['level5']);

			expect(plan.isValid).toBe(true);
			expect(plan.executionOrder).toEqual(['level1', 'level2', 'level3', 'level4', 'level5']);
			expect(plan.parallelExecutionLevels.length).toBe(5);
			expect(plan.maxConcurrency).toBe(1);
			expect(plan.totalBuilders).toBe(5);

			const stats = planner.getExecutionPlanStats(plan);
			expect(stats.dependencyDepth).toBe(5);
		});

		test('should handle wide parallel execution', () => {
			// Create scenario with many parallel builders
			const builders: DataBuilder<Data>[] = [];
			for (let i = 1; i <= 10; i++) {
				class ParallelBuilder implements DataBuilder<Data> {
					readonly provides = `parallel${i}`;
					readonly consumes: string[] = [];
					async build(dataSet: DataSet): Promise<Data> {
						return { type: `parallel${i}` };
					}
				}
				const builder = new ParallelBuilder();
				builders.push(builder);
				registry.register(builder);
			}

			const targetTypes = builders.map((b) => b.provides);
			const plan = planner.createExecutionPlan(targetTypes);

			expect(plan.isValid).toBe(true);
			expect(plan.parallelExecutionLevels).toEqual([targetTypes]);
			expect(plan.maxConcurrency).toBe(10);
			expect(plan.totalBuilders).toBe(10);
		});
	});
});
