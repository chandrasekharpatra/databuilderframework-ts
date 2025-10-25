import { describe, test, expect, beforeEach } from 'vitest';
import {
	AbstractDataBuilder,
	SourceDataBuilder,
	TransformDataBuilder,
	CombineDataBuilder,
	RequiredDataNotFoundError,
} from '../src/builders/AbstractDataBuilder.js';
import { DataSetImpl } from '../src/core/DataSetImpl.js';
import { Data, DataSet } from '../src/types/index.js';

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
	timestamp: Date;
}

interface Config extends Data {
	readonly type: 'config';
	apiKey: string;
	timeout: number;
}

// Test builder that exposes protected methods for testing
class TestableBuilder extends AbstractDataBuilder<User> {
	readonly provides = 'user';
	readonly consumes = ['config'];

	async build(dataSet: DataSet): Promise<User> {
		const config = this.require<Config>(dataSet, 'config');
		return this.createData<User>('user', {
			id: 1,
			name: 'Test User',
			email: 'test@example.com',
		});
	}

	// Expose protected methods for testing
	public testRequire<U extends Data>(dataSet: DataSet, dataType: string): U {
		return this.require<U>(dataSet, dataType);
	}

	public testOptional<U extends Data>(dataSet: DataSet, dataType: string): U | undefined {
		return this.optional<U>(dataSet, dataType);
	}

	public testHas(dataSet: DataSet, dataType: string): boolean {
		return this.has(dataSet, dataType);
	}

	public testValidateRequiredData(dataSet: DataSet, requiredTypes: string[]): void {
		return this.validateRequiredData(dataSet, requiredTypes);
	}

	public testValidateConsumedData(dataSet: DataSet): void {
		return this.validateConsumedData(dataSet);
	}

	public testGetMultiple<U extends Data>(dataSet: DataSet, dataTypes: string[]): Map<string, U> {
		return this.getMultiple<U>(dataSet, dataTypes);
	}

	public testGetConsumedData<U extends Data>(dataSet: DataSet): Map<string, U> {
		return this.getConsumedData<U>(dataSet);
	}

	public testCreateData<U extends Data>(type: string, properties: Omit<U, 'type'>): U {
		return this.createData<U>(type, properties);
	}
}
class BasicBuilder extends AbstractDataBuilder<User> {
	readonly provides = 'user';
	readonly consumes = ['config'];

	async build(dataSet: DataSet): Promise<User> {
		const config = this.require<Config>(dataSet, 'config');
		return this.createData<User>('user', {
			id: 1,
			name: 'Test User',
			email: 'test@example.com',
		});
	}
}

// SourceDataBuilder implementation
class ConfigSourceBuilder extends SourceDataBuilder<Config> {
	readonly provides = 'config';

	async build(dataSet: DataSet): Promise<Config> {
		return this.createData<Config>('config', {
			apiKey: 'test-api-key',
			timeout: 5000,
		});
	}
}

// TransformDataBuilder implementation
class UserToProfileTransformer extends TransformDataBuilder<User, Profile> {
	readonly provides = 'profile';
	readonly inputType = 'user';

	async transform(input: User): Promise<Profile> {
		return this.createData<Profile>('profile', {
			userId: input.id,
			displayName: `${input.name} (Profile)`,
			avatar: 'default.png',
		});
	}
}

// CombineDataBuilder implementation
class UserReportCombiner extends CombineDataBuilder<Report> {
	readonly provides = 'report';
	readonly consumes = ['user', 'userStats'];

	async combine(inputs: Map<string, Data>): Promise<Report> {
		const user = inputs.get('user') as User;
		const stats = inputs.get('userStats') as UserStats;

		return this.createData<Report>('report', {
			userId: user.id,
			summary: `User ${user.name} has ${stats.loginCount} logins`,
			timestamp: new Date(),
		});
	}
}

// Builder with optional dependencies
class OptionalDependencyBuilder extends AbstractDataBuilder<Data> {
	readonly provides = 'optional';
	readonly consumes = ['user'];

	async build(dataSet: DataSet): Promise<Data> {
		const user = this.optional<User>(dataSet, 'user');
		const config = this.optional<Config>(dataSet, 'config');

		return this.createData<Data>('optional', {
			hasUser: !!user,
			hasConfig: !!config,
		});
	}
}

// Builder that validates multiple requirements
class MultiValidationBuilder extends AbstractDataBuilder<Data> {
	readonly provides = 'multiValidation';
	readonly consumes = ['user', 'config'];

	async build(dataSet: DataSet): Promise<Data> {
		this.validateConsumedData(dataSet);

		const user = this.require<User>(dataSet, 'user');
		const config = this.require<Config>(dataSet, 'config');

		return this.createData<Data>('multiValidation', {
			userId: user.id,
			configTimeout: config.timeout,
		});
	}
}

// Builder that uses multiple data retrieval
class MultiDataBuilder extends AbstractDataBuilder<Data> {
	readonly provides = 'multiData';
	readonly consumes = ['user', 'profile', 'config'];

	async build(dataSet: DataSet): Promise<Data> {
		const allData = this.getConsumedData(dataSet);
		const specificData = this.getMultiple<Data>(dataSet, ['user', 'profile']);

		return this.createData<Data>('multiData', {
			allDataCount: allData.size,
			specificDataCount: specificData.size,
		});
	}
}

// Failing builder for error testing
class FailingBuilder extends AbstractDataBuilder<Data> {
	readonly provides = 'failing';
	readonly consumes = ['nonexistent'];

	async build(dataSet: DataSet): Promise<Data> {
		const missing = this.require<Data>(dataSet, 'nonexistent');
		return missing;
	}
}

describe('AbstractDataBuilder', () => {
	let dataSet: DataSetImpl;

	beforeEach(() => {
		dataSet = new DataSetImpl();
	});

	describe('Basic Functionality', () => {
		test('should implement basic builder interface correctly', () => {
			const builder = new BasicBuilder();

			expect(builder.provides).toBe('user');
			expect(builder.consumes).toEqual(['config']);
			expect(typeof builder.build).toBe('function');
		});

		test('should build data with required dependencies', async () => {
			const configBuilder = new ConfigSourceBuilder();
			const basicBuilder = new BasicBuilder();

			// Add config to dataset
			const config = await configBuilder.build(dataSet);
			dataSet.add(config);

			// Build user using config
			const user = await basicBuilder.build(dataSet);

			expect(user.type).toBe('user');
			expect(user.id).toBe(1);
			expect(user.name).toBe('Test User');
			expect(user.email).toBe('test@example.com');
		});

		test('should provide meaningful string representation', () => {
			const builder = new BasicBuilder();
			const str = builder.toString();

			expect(str).toContain('BasicBuilder');
			expect(str).toContain('provides: user');
			expect(str).toContain('consumes: [config]');
		});

		test('should provide builder metadata', () => {
			const builder = new BasicBuilder();
			const metadata = builder.getMetadata();

			expect(metadata.name).toBe('BasicBuilder');
			expect(metadata.provides).toBe('user');
			expect(metadata.consumes).toEqual(['config']);

			// Ensure consumes array is a copy
			metadata.consumes.push('extra');
			expect(builder.consumes).not.toContain('extra');
		});
	});

	describe('Data Access Methods', () => {
		test('should require data successfully when available', async () => {
			const config: Config = { type: 'config', apiKey: 'test-key', timeout: 1000 };
			dataSet.add(config);

			const builder = new TestableBuilder();
			const retrievedConfig = builder.testRequire<Config>(dataSet, 'config');

			expect(retrievedConfig).toBe(config);
			expect(retrievedConfig.apiKey).toBe('test-key');
		});

		test('should throw error when required data is missing', () => {
			const builder = new TestableBuilder();

			expect(() => {
				builder.testRequire<Config>(dataSet, 'config');
			}).toThrow(RequiredDataNotFoundError);
		});

		test('should handle optional data when available', () => {
			const user: User = { type: 'user', id: 1, name: 'Test', email: 'test@example.com' };
			dataSet.add(user);

			const builder = new TestableBuilder();
			const retrievedUser = builder.testOptional<User>(dataSet, 'user');

			expect(retrievedUser).toBe(user);
		});

		test('should handle optional data when missing', () => {
			const builder = new TestableBuilder();
			const retrievedUser = builder.testOptional<User>(dataSet, 'user');

			expect(retrievedUser).toBeUndefined();
		});

		test('should check data existence correctly', () => {
			const user: User = { type: 'user', id: 1, name: 'Test', email: 'test@example.com' };
			dataSet.add(user);

			const builder = new TestableBuilder();

			expect(builder.testHas(dataSet, 'user')).toBe(true);
			expect(builder.testHas(dataSet, 'nonexistent')).toBe(false);
		});
	});

	describe('Data Validation', () => {
		test('should validate required data successfully', () => {
			const user: User = { type: 'user', id: 1, name: 'Test', email: 'test@example.com' };
			const config: Config = { type: 'config', apiKey: 'key', timeout: 1000 };
			dataSet.add(user);
			dataSet.add(config);

			const builder = new TestableBuilder();

			expect(() => {
				builder.testValidateRequiredData(dataSet, ['user', 'config']);
			}).not.toThrow();
		});

		test('should throw error when validating missing required data', () => {
			const user: User = { type: 'user', id: 1, name: 'Test', email: 'test@example.com' };
			dataSet.add(user);

			const builder = new TestableBuilder();

			expect(() => {
				builder.testValidateRequiredData(dataSet, ['user', 'config']);
			}).toThrow(RequiredDataNotFoundError);
		});

		test('should validate consumed data successfully', () => {
			const user: User = { type: 'user', id: 1, name: 'Test', email: 'test@example.com' };
			const config: Config = { type: 'config', apiKey: 'key', timeout: 1000 };
			dataSet.add(user);
			dataSet.add(config);

			const builder = new TestableBuilder();

			expect(() => {
				builder.testValidateConsumedData(dataSet);
			}).not.toThrow();
		});

		test('should throw error when validating missing consumed data', () => {
			const user: User = { type: 'user', id: 1, name: 'Test', email: 'test@example.com' };
			dataSet.add(user);

			const builder = new TestableBuilder();

			expect(() => {
				builder.testValidateConsumedData(dataSet);
			}).toThrow(RequiredDataNotFoundError);
		});
	});

	describe('Multiple Data Retrieval', () => {
		test('should get multiple data objects', () => {
			const user: User = { type: 'user', id: 1, name: 'Test', email: 'test@example.com' };
			const config: Config = { type: 'config', apiKey: 'key', timeout: 1000 };
			dataSet.add(user);
			dataSet.add(config);

			const builder = new TestableBuilder();
			const multiple = builder.testGetMultiple<Data>(dataSet, ['user', 'config', 'nonexistent']);

			expect(multiple.size).toBe(2);
			expect(multiple.get('user')).toBe(user);
			expect(multiple.get('config')).toBe(config);
			expect(multiple.has('nonexistent')).toBe(false);
		});

		test('should get consumed data objects', () => {
			const user: User = { type: 'user', id: 1, name: 'Test', email: 'test@example.com' };
			const profile: Profile = { type: 'profile', userId: 1, displayName: 'Test Profile', avatar: 'test.png' };
			const config: Config = { type: 'config', apiKey: 'key', timeout: 1000 };
			dataSet.add(user);
			dataSet.add(profile);
			dataSet.add(config);

			const builder = new TestableBuilder();
			const consumed = builder.testGetConsumedData<Data>(dataSet);

			expect(consumed.size).toBe(1); // TestableBuilder only consumes 'config'
			expect(consumed.get('config')).toBe(config);
		});

		test('should handle partial data availability', () => {
			const user: User = { type: 'user', id: 1, name: 'Test', email: 'test@example.com' };
			dataSet.add(user);

			const builder = new TestableBuilder();
			const consumed = builder.testGetConsumedData<Data>(dataSet);

			expect(consumed.size).toBe(0); // TestableBuilder consumes 'config' which is not present
		});
	});

	describe('Data Creation Utility', () => {
		test('should create data objects with proper typing', () => {
			const builder = new TestableBuilder();
			const user = builder.testCreateData<User>('user', {
				id: 42,
				name: 'Created User',
				email: 'created@example.com',
			});

			expect(user.type).toBe('user');
			expect(user.id).toBe(42);
			expect(user.name).toBe('Created User');
			expect(user.email).toBe('created@example.com');
		});

		test('should create data with complex properties', () => {
			const builder = new TestableBuilder();
			const report = builder.testCreateData<Report>('report', {
				userId: 1,
				summary: 'Test report',
				timestamp: new Date('2023-01-01'),
			});

			expect(report.type).toBe('report');
			expect(report.userId).toBe(1);
			expect(report.summary).toBe('Test report');
			expect(report.timestamp instanceof Date).toBe(true);
		});
	});

	describe('Error Handling', () => {
		test('should create RequiredDataNotFoundError with proper information', () => {
			const error = new RequiredDataNotFoundError('user', 'TestBuilder');

			expect(error.message).toContain('user');
			expect(error.message).toContain('TestBuilder');
			expect(error.name).toBe('RequiredDataNotFoundError');
			expect(error instanceof Error).toBe(true);
		});

		test('should throw error during build when required data is missing', async () => {
			const builder = new FailingBuilder();

			await expect(builder.build(dataSet)).rejects.toThrow(RequiredDataNotFoundError);
		});

		test('should include builder name in error message', async () => {
			const builder = new FailingBuilder();

			try {
				await builder.build(dataSet);
				expect.fail('Should have thrown an error');
			} catch (error) {
				expect(error).toBeInstanceOf(RequiredDataNotFoundError);
				expect((error as RequiredDataNotFoundError).message).toContain('FailingBuilder');
			}
		});
	});

	describe('Integration with Optional Dependencies', () => {
		test('should build successfully with optional dependencies present', async () => {
			const user: User = { type: 'user', id: 1, name: 'Test', email: 'test@example.com' };
			const config: Config = { type: 'config', apiKey: 'key', timeout: 1000 };
			dataSet.add(user);
			dataSet.add(config);

			const builder = new OptionalDependencyBuilder();
			const result = await builder.build(dataSet);

			expect(result.type).toBe('optional');
			expect((result as any).hasUser).toBe(true);
			expect((result as any).hasConfig).toBe(true);
		});

		test('should build successfully with optional dependencies missing', async () => {
			const builder = new OptionalDependencyBuilder();
			const result = await builder.build(dataSet);

			expect(result.type).toBe('optional');
			expect((result as any).hasUser).toBe(false);
			expect((result as any).hasConfig).toBe(false);
		});

		test('should build successfully with partial optional dependencies', async () => {
			const user: User = { type: 'user', id: 1, name: 'Test', email: 'test@example.com' };
			dataSet.add(user);

			const builder = new OptionalDependencyBuilder();
			const result = await builder.build(dataSet);

			expect(result.type).toBe('optional');
			expect((result as any).hasUser).toBe(true);
			expect((result as any).hasConfig).toBe(false);
		});
	});
});

describe('SourceDataBuilder', () => {
	let dataSet: DataSetImpl;

	beforeEach(() => {
		dataSet = new DataSetImpl();
	});

	describe('Basic Source Builder Functionality', () => {
		test('should have empty consumes array', () => {
			const builder = new ConfigSourceBuilder();

			expect(builder.consumes).toEqual([]);
		});

		test('should build data without dependencies', async () => {
			const builder = new ConfigSourceBuilder();
			const result = await builder.build(dataSet);

			expect(result.type).toBe('config');
			expect(result.apiKey).toBe('test-api-key');
			expect(result.timeout).toBe(5000);
		});

		test('should work with empty dataset', async () => {
			const builder = new ConfigSourceBuilder();
			const result = await builder.build(dataSet);

			expect(result).toBeDefined();
			expect(result.type).toBe('config');
		});

		test('should provide correct metadata', () => {
			const builder = new ConfigSourceBuilder();
			const metadata = builder.getMetadata();

			expect(metadata.name).toBe('ConfigSourceBuilder');
			expect(metadata.provides).toBe('config');
			expect(metadata.consumes).toEqual([]);
		});
	});

	describe('Multiple Source Builders', () => {
		test('should support multiple independent source builders', async () => {
			class AnotherSourceBuilder extends SourceDataBuilder<Data> {
				readonly provides = 'another';

				async build(dataSet: DataSet): Promise<Data> {
					return this.createData<Data>('another', {});
				}
			}

			const configBuilder = new ConfigSourceBuilder();
			const anotherBuilder = new AnotherSourceBuilder();

			const config = await configBuilder.build(dataSet);
			const another = await anotherBuilder.build(dataSet);

			expect(config.type).toBe('config');
			expect(another.type).toBe('another');
		});
	});
});

describe('TransformDataBuilder', () => {
	let dataSet: DataSetImpl;

	beforeEach(() => {
		dataSet = new DataSetImpl();
	});

	describe('Basic Transform Functionality', () => {
		test('should have correct consumes array based on inputType', () => {
			const transformer = new UserToProfileTransformer();

			expect(transformer.inputType).toBe('user');
			expect(transformer.consumes).toEqual(['user']);
		});

		test('should transform input data correctly', async () => {
			const user: User = { type: 'user', id: 1, name: 'John Doe', email: 'john@example.com' };

			const transformer = new UserToProfileTransformer();
			const profile = await transformer.transform(user);

			expect(profile.type).toBe('profile');
			expect(profile.userId).toBe(1);
			expect(profile.displayName).toBe('John Doe (Profile)');
			expect(profile.avatar).toBe('default.png');
		});

		test('should build using transform method', async () => {
			const user: User = { type: 'user', id: 1, name: 'John Doe', email: 'john@example.com' };
			dataSet.add(user);

			const transformer = new UserToProfileTransformer();
			const profile = await transformer.build(dataSet);

			expect(profile.type).toBe('profile');
			expect(profile.userId).toBe(1);
			expect(profile.displayName).toBe('John Doe (Profile)');
		});

		test('should throw error when input data is missing', async () => {
			const transformer = new UserToProfileTransformer();

			await expect(transformer.build(dataSet)).rejects.toThrow(RequiredDataNotFoundError);
		});

		test('should provide correct metadata', () => {
			const transformer = new UserToProfileTransformer();
			const metadata = transformer.getMetadata();

			expect(metadata.name).toBe('UserToProfileTransformer');
			expect(metadata.provides).toBe('profile');
			expect(metadata.consumes).toEqual(['user']);
		});
	});

	describe('Complex Transform Scenarios', () => {
		test('should handle complex data transformations', async () => {
			class UserStatsTransformer extends TransformDataBuilder<User, UserStats> {
				readonly provides = 'userStats';
				readonly inputType = 'user';

				async transform(input: User): Promise<UserStats> {
					return this.createData<UserStats>('userStats', {
						userId: input.id,
						loginCount: input.name.length, // Example transformation logic
						lastSeen: new Date(),
					});
				}
			}

			const user: User = { type: 'user', id: 1, name: 'John Doe', email: 'john@example.com' };
			dataSet.add(user);

			const transformer = new UserStatsTransformer();
			const stats = await transformer.build(dataSet);

			expect(stats.type).toBe('userStats');
			expect(stats.userId).toBe(1);
			expect(stats.loginCount).toBe(8); // Length of "John Doe"
			expect(stats.lastSeen instanceof Date).toBe(true);
		});

		test('should handle async transformation logic', async () => {
			class AsyncTransformer extends TransformDataBuilder<User, Profile> {
				readonly provides = 'asyncProfile';
				readonly inputType = 'user';

				async transform(input: User): Promise<Profile> {
					// Simulate async operation
					await new Promise((resolve) => setTimeout(resolve, 10));

					return this.createData<Profile>('asyncProfile', {
						userId: input.id,
						displayName: `Async ${input.name}`,
						avatar: 'async.png',
					});
				}
			}

			const user: User = { type: 'user', id: 1, name: 'John', email: 'john@example.com' };
			dataSet.add(user);

			const transformer = new AsyncTransformer();
			const profile = await transformer.build(dataSet);

			expect(profile.displayName).toBe('Async John');
		});
	});
});

describe('CombineDataBuilder', () => {
	let dataSet: DataSetImpl;

	beforeEach(() => {
		dataSet = new DataSetImpl();
	});

	describe('Basic Combine Functionality', () => {
		test('should combine multiple inputs correctly', async () => {
			const user: User = { type: 'user', id: 1, name: 'John Doe', email: 'john@example.com' };
			const stats: UserStats = { type: 'userStats', userId: 1, loginCount: 5, lastSeen: new Date() };
			dataSet.add(user);
			dataSet.add(stats);

			const combiner = new UserReportCombiner();
			const report = await combiner.build(dataSet);

			expect(report.type).toBe('report');
			expect(report.userId).toBe(1);
			expect(report.summary).toContain('John Doe');
			expect(report.summary).toContain('5 logins');
			expect(report.timestamp instanceof Date).toBe(true);
		});

		test('should validate all consumed data before combining', async () => {
			const user: User = { type: 'user', id: 1, name: 'John Doe', email: 'john@example.com' };
			dataSet.add(user);
			// Missing userStats

			const combiner = new UserReportCombiner();

			await expect(combiner.build(dataSet)).rejects.toThrow(RequiredDataNotFoundError);
		});

		test('should pass all consumed data to combine method', async () => {
			const user: User = { type: 'user', id: 1, name: 'John', email: 'john@example.com' };
			const stats: UserStats = { type: 'userStats', userId: 1, loginCount: 10, lastSeen: new Date() };
			dataSet.add(user);
			dataSet.add(stats);

			class TestCombiner extends CombineDataBuilder<Data> {
				readonly provides = 'test';
				readonly consumes = ['user', 'userStats'];

				async combine(inputs: Map<string, Data>): Promise<Data> {
					expect(inputs.size).toBe(2);
					expect(inputs.has('user')).toBe(true);
					expect(inputs.has('userStats')).toBe(true);

					const userData = inputs.get('user') as User;
					const statsData = inputs.get('userStats') as UserStats;

					return this.createData<Data>('test', {
						userName: userData.name,
						loginCount: statsData.loginCount,
					});
				}
			}

			const combiner = new TestCombiner();
			const result = await combiner.build(dataSet);

			expect(result.type).toBe('test');
			expect((result as any).userName).toBe('John');
			expect((result as any).loginCount).toBe(10);
		});

		test('should provide correct metadata', () => {
			const combiner = new UserReportCombiner();
			const metadata = combiner.getMetadata();

			expect(metadata.name).toBe('UserReportCombiner');
			expect(metadata.provides).toBe('report');
			expect(metadata.consumes).toEqual(['user', 'userStats']);
		});
	});

	describe('Complex Combine Scenarios', () => {
		test('should handle large number of inputs', async () => {
			class MultiInputCombiner extends CombineDataBuilder<Data> {
				readonly provides = 'multiInput';
				readonly consumes = ['user', 'profile', 'userStats', 'config'];

				async combine(inputs: Map<string, Data>): Promise<Data> {
					return this.createData<Data>('multiInput', {
						inputCount: inputs.size,
						hasUser: inputs.has('user'),
						hasProfile: inputs.has('profile'),
						hasStats: inputs.has('userStats'),
						hasConfig: inputs.has('config'),
					});
				}
			}

			const user: User = { type: 'user', id: 1, name: 'John', email: 'john@example.com' };
			const profile: Profile = { type: 'profile', userId: 1, displayName: 'John Profile', avatar: 'john.png' };
			const stats: UserStats = { type: 'userStats', userId: 1, loginCount: 3, lastSeen: new Date() };
			const config: Config = { type: 'config', apiKey: 'test', timeout: 1000 };

			dataSet.add(user);
			dataSet.add(profile);
			dataSet.add(stats);
			dataSet.add(config);

			const combiner = new MultiInputCombiner();
			const result = await combiner.build(dataSet);

			expect(result.type).toBe('multiInput');
			expect((result as any).inputCount).toBe(4);
			expect((result as any).hasUser).toBe(true);
			expect((result as any).hasProfile).toBe(true);
			expect((result as any).hasStats).toBe(true);
			expect((result as any).hasConfig).toBe(true);
		});

		test('should handle async combine logic', async () => {
			class AsyncCombiner extends CombineDataBuilder<Data> {
				readonly provides = 'asyncCombine';
				readonly consumes = ['user', 'config'];

				async combine(inputs: Map<string, Data>): Promise<Data> {
					// Simulate async processing
					await new Promise((resolve) => setTimeout(resolve, 10));

					const user = inputs.get('user') as User;
					const config = inputs.get('config') as Config;

					return this.createData<Data>('asyncCombine', {
						userEmail: user.email,
						configTimeout: config.timeout,
						processedAt: new Date().toISOString(),
					});
				}
			}

			const user: User = { type: 'user', id: 1, name: 'John', email: 'john@example.com' };
			const config: Config = { type: 'config', apiKey: 'test', timeout: 2000 };
			dataSet.add(user);
			dataSet.add(config);

			const combiner = new AsyncCombiner();
			const result = await combiner.build(dataSet);

			expect(result.type).toBe('asyncCombine');
			expect((result as any).userEmail).toBe('john@example.com');
			expect((result as any).configTimeout).toBe(2000);
			expect((result as any).processedAt).toBeDefined();
		});
	});

	describe('Edge Cases', () => {
		test('should handle empty consumes array in combine builder', async () => {
			class EmptyCombiner extends CombineDataBuilder<Data> {
				readonly provides = 'empty';
				readonly consumes: string[] = [];

				async combine(inputs: Map<string, Data>): Promise<Data> {
					return this.createData<Data>('empty', {
						isEmpty: inputs.size === 0,
					});
				}
			}

			const combiner = new EmptyCombiner();
			const result = await combiner.build(dataSet);

			expect(result.type).toBe('empty');
			expect((result as any).isEmpty).toBe(true);
		});
	});
});

describe('Inheritance and Polymorphism', () => {
	test('should work with polymorphic builder collections', () => {
		const builders: AbstractDataBuilder<any>[] = [new ConfigSourceBuilder(), new UserToProfileTransformer(), new UserReportCombiner()];

		expect(builders.length).toBe(3);
		expect(builders[0]!.provides).toBe('config');
		expect(builders[1]!.provides).toBe('profile');
		expect(builders[2]!.provides).toBe('report');

		expect(builders[0]!.consumes).toEqual([]);
		expect(builders[1]!.consumes).toEqual(['user']);
		expect(builders[2]!.consumes).toEqual(['user', 'userStats']);
	});

	test('should maintain proper inheritance chain', () => {
		const sourceBuilder = new ConfigSourceBuilder();
		const transformBuilder = new UserToProfileTransformer();
		const combineBuilder = new UserReportCombiner();

		expect(sourceBuilder instanceof SourceDataBuilder).toBe(true);
		expect(sourceBuilder instanceof AbstractDataBuilder).toBe(true);

		expect(transformBuilder instanceof TransformDataBuilder).toBe(true);
		expect(transformBuilder instanceof AbstractDataBuilder).toBe(true);

		expect(combineBuilder instanceof CombineDataBuilder).toBe(true);
		expect(combineBuilder instanceof AbstractDataBuilder).toBe(true);
	});

	test('should provide consistent interface across all builder types', () => {
		const builders = [new ConfigSourceBuilder(), new UserToProfileTransformer(), new UserReportCombiner()];

		for (const builder of builders) {
			expect(typeof builder.provides).toBe('string');
			expect(Array.isArray(builder.consumes)).toBe(true);
			expect(typeof builder.build).toBe('function');
			expect(typeof builder.toString).toBe('function');
			expect(typeof builder.getMetadata).toBe('function');
		}
	});
});
