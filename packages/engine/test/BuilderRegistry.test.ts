import { beforeEach, describe, expect, test } from 'vitest';
import { BuilderRegistry } from '../src/core/BuilderRegistry';
import { Data, DataBuilder, DataSet } from '../src/types/index';

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

describe('BuilderRegistry', () => {
	let registry: BuilderRegistry;

	beforeEach(() => {
		registry = new BuilderRegistry();
	});

	describe('Basic Registration', () => {
		test('should start empty', () => {
			expect(registry.size()).toBe(0);
			expect(registry.isEmpty()).toBe(true);
		});

		test('should register a single builder', () => {
			const userBuilder = new UserBuilder();

			registry.register(userBuilder);

			expect(registry.size()).toBe(1);
			expect(registry.isEmpty()).toBe(false);
		});

		test('should retrieve registered builder', () => {
			const userBuilder = new UserBuilder();

			registry.register(userBuilder);
			const retrievedBuilder = registry.get('user');

			expect(retrievedBuilder).toBe(userBuilder);
			expect(retrievedBuilder?.provides).toBe('user');
		});

		test('should return undefined for non-existent builder', () => {
			const retrievedBuilder = registry.get('nonexistent');
			expect(retrievedBuilder).toBeUndefined();
		});

		test('should check if builder exists', () => {
			const userBuilder = new UserBuilder();

			expect(registry.has('user')).toBe(false);

			registry.register(userBuilder);

			expect(registry.has('user')).toBe(true);
			expect(registry.has('nonexistent')).toBe(false);
		});
	});

	describe('Multiple Builders', () => {
		test('should register multiple builders', () => {
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();
			const statsBuilder = new UserStatsBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);
			registry.register(statsBuilder);

			expect(registry.size()).toBe(3);
			expect(registry.get('user')).toBe(userBuilder);
			expect(registry.get('profile')).toBe(profileBuilder);
			expect(registry.get('userStats')).toBe(statsBuilder);
		});

		test('should throw error when registering duplicate builder without overwrite', () => {
			const userBuilder1 = new UserBuilder();
			const userBuilder2 = new UserBuilder();

			registry.register(userBuilder1);

			expect(() => {
				registry.register(userBuilder2);
			}).toThrow("Builder for data type 'user' is already registered");
		});

		test('should allow overwriting existing builder when explicitly allowed', () => {
			const userBuilder1 = new UserBuilder();
			const userBuilder2 = new UserBuilder();

			registry.register(userBuilder1);
			expect(registry.get('user')).toBe(userBuilder1);

			registry.register(userBuilder2, true); // Allow overwrite
			expect(registry.get('user')).toBe(userBuilder2);
			expect(registry.size()).toBe(1); // Size should remain 1
		});

		test('should register multiple builders at once', () => {
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();
			const statsBuilder = new UserStatsBuilder();

			registry.registerMany([userBuilder, profileBuilder, statsBuilder]);

			expect(registry.size()).toBe(3);
			expect(registry.has('user')).toBe(true);
			expect(registry.has('profile')).toBe(true);
			expect(registry.has('userStats')).toBe(true);
		});

		test('should get all registered data types', () => {
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);

			const dataTypes = registry.getProvidedTypes();
			expect(dataTypes).toContain('user');
			expect(dataTypes).toContain('profile');
			expect(dataTypes.length).toBe(2);
		});
	});

	describe('Builder Availability Check', () => {
		test('should check builder availability for single builder with no dependencies', () => {
			const userBuilder = new UserBuilder();
			registry.register(userBuilder);

			const result = registry.checkBuilderAvailability(['user']);

			expect(result.isValid).toBe(true);
			expect(result.missingBuilders).toEqual([]);
			expect(result.satisfiableTypes).toContain('user');
		});

		test('should check builder availability for builder with satisfied dependencies', () => {
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);

			const result = registry.checkBuilderAvailability(['profile']);

			expect(result.isValid).toBe(true);
			expect(result.missingBuilders).toEqual([]);
			expect(result.satisfiableTypes).toContain('profile');
			expect(result.satisfiableTypes).toContain('user');
		});

		test('should detect missing builders for requested data types', () => {
			const userBuilder = new UserBuilder();
			registry.register(userBuilder);

			const result = registry.checkBuilderAvailability(['user', 'nonexistent']);

			expect(result.isValid).toBe(false);
			expect(result.missingBuilders).toEqual(['nonexistent']);
			expect(result.satisfiableTypes).toContain('user');
		});

		test('should detect missing dependencies for registered builders', () => {
			const profileBuilder = new ProfileBuilder(); // depends on 'user'
			registry.register(profileBuilder);

			const result = registry.checkBuilderAvailability(['profile']);

			expect(result.isValid).toBe(false);
			expect(result.missingBuilders).toEqual(['user']);
			expect(result.satisfiableTypes).toContain('profile');
		});

		test('should detect both missing builders and dependencies', () => {
			const profileBuilder = new ProfileBuilder(); // depends on 'user'
			registry.register(profileBuilder);

			const result = registry.checkBuilderAvailability(['profile', 'nonexistent']);

			expect(result.isValid).toBe(false);
			expect(result.missingBuilders).toContain('nonexistent');
			expect(result.missingBuilders).toContain('user');
			expect(result.satisfiableTypes).toContain('profile');
		});

		test('should handle complex dependency chains', () => {
			// Create a chain: userStats -> user (and profile also -> user)
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();
			const statsBuilder = new UserStatsBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);
			registry.register(statsBuilder);

			const result = registry.checkBuilderAvailability(['profile', 'userStats']);

			expect(result.isValid).toBe(true);
			expect(result.missingBuilders).toEqual([]);
			expect(result.satisfiableTypes).toContain('profile');
			expect(result.satisfiableTypes).toContain('userStats');
			expect(result.satisfiableTypes).toContain('user');
		});
	});

	describe('Missing Dependencies Analysis', () => {
		test('should find all missing builders', () => {
			const userBuilder = new UserBuilder();
			registry.register(userBuilder);

			const missing = registry.findMissingBuilders(['user', 'profile', 'nonexistent']);

			expect(missing).toEqual(['profile', 'nonexistent']);
		});

		test('should return empty array when all builders exist', () => {
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);

			const missing = registry.findMissingBuilders(['user', 'profile']);

			expect(missing).toEqual([]);
		});

		test('should identify all consumed types across builders', () => {
			const profileBuilder = new ProfileBuilder(); // depends on 'user'
			const statsBuilder = new UserStatsBuilder(); // depends on 'user'

			registry.register(profileBuilder);
			registry.register(statsBuilder);

			const consumedTypes = registry.getConsumedTypes();

			expect(consumedTypes).toContain('user');
			expect(consumedTypes.length).toBe(1);
		});

		test('should handle complex dependency scenarios through availability check', () => {
			// Create builder that depends on profile, which depends on user
			class AdvancedProfileBuilder implements DataBuilder<Data> {
				readonly provides = 'advancedProfile';
				readonly consumes = ['profile'];

				async build(dataSet: DataSet): Promise<Data> {
					return { type: 'advancedProfile' };
				}
			}

			const advancedProfileBuilder = new AdvancedProfileBuilder();
			const profileBuilder = new ProfileBuilder(); // depends on 'user'

			registry.register(advancedProfileBuilder);
			registry.register(profileBuilder);

			const result = registry.checkBuilderAvailability(['advancedProfile']);

			expect(result.isValid).toBe(false);
			expect(result.missingBuilders).toContain('user');
		});
	});

	describe('Clear and Reset', () => {
		test('should clear all builders', () => {
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);
			expect(registry.size()).toBe(2);

			registry.clear();

			expect(registry.size()).toBe(0);
			expect(registry.isEmpty()).toBe(true);
			expect(registry.has('user')).toBe(false);
			expect(registry.has('profile')).toBe(false);
		});

		test('should unregister individual builders', () => {
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);
			expect(registry.size()).toBe(2);

			const removed = registry.unregister('user');

			expect(removed).toBe(true);
			expect(registry.size()).toBe(1);
			expect(registry.has('user')).toBe(false);
			expect(registry.has('profile')).toBe(true);
		});

		test('should return false when unregistering non-existent builder', () => {
			const removed = registry.unregister('nonexistent');
			expect(removed).toBe(false);
		});
	});

	describe('Metadata and Advanced Features', () => {
		test('should get metadata for registered builders', () => {
			const userBuilder = new UserBuilder();
			registry.register(userBuilder);

			const metadata = registry.getMetadata('user');

			expect(metadata).toBeDefined();
			expect(metadata?.name).toBe('UserBuilder');
			expect(metadata?.provides).toBe('user');
			expect(metadata?.consumes).toEqual([]);
		});

		test('should return undefined metadata for non-existent builder', () => {
			const metadata = registry.getMetadata('nonexistent');
			expect(metadata).toBeUndefined();
		});

		test('should get all metadata', () => {
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);

			const allMetadata = registry.getAllMetadata();

			expect(allMetadata.length).toBe(2);

			const userMeta = allMetadata.find((meta) => meta.provides === 'user');
			const profileMeta = allMetadata.find((meta) => meta.provides === 'profile');

			expect(userMeta?.name).toBe('UserBuilder');
			expect(profileMeta?.name).toBe('ProfileBuilder');
			expect(profileMeta?.consumes).toEqual(['user']);
		});

		test('should create subset registry', () => {
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();
			const statsBuilder = new UserStatsBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);
			registry.register(statsBuilder);

			const subset = registry.createSubset(['user', 'profile']);

			expect(subset.size()).toBe(2);
			expect(subset.has('user')).toBe(true);
			expect(subset.has('profile')).toBe(true);
			expect(subset.has('userStats')).toBe(false);
		});

		test('should get all builders as map', () => {
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);

			const allBuilders = registry.getAll();

			expect(allBuilders.size).toBe(2);
			expect(allBuilders.get('user')).toBe(userBuilder);
			expect(allBuilders.get('profile')).toBe(profileBuilder);
		});

		test('should find builders for specific types', () => {
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);

			const foundBuilders = registry.findBuilders(['user', 'nonexistent']);

			expect(foundBuilders.size).toBe(1);
			expect(foundBuilders.get('user')).toBe(userBuilder);
			expect(foundBuilders.has('nonexistent')).toBe(false);
		});

		test('should use getRequired method with existing builder', () => {
			const userBuilder = new UserBuilder();
			registry.register(userBuilder);

			const retrievedBuilder = registry.getRequired('user');
			expect(retrievedBuilder).toBe(userBuilder);
		});

		test('should throw error when using getRequired with non-existent builder', () => {
			expect(() => {
				registry.getRequired('nonexistent');
			}).toThrow("No builder found for data type 'nonexistent'");
		});
	});

	describe('Edge Cases', () => {
		test('should handle builder with empty consumes array', () => {
			const userBuilder = new UserBuilder();
			registry.register(userBuilder);

			expect(registry.get('user')?.consumes).toEqual([]);

			const result = registry.checkBuilderAvailability(['user']);
			expect(result.isValid).toBe(true);
		});

		test('should handle builder with self-dependency (availability check passes, cycle detection separate)', () => {
			class SelfDependentBuilder implements DataBuilder<Data> {
				readonly provides = 'selfDependent';
				readonly consumes = ['selfDependent'];

				async build(dataSet: DataSet): Promise<Data> {
					return { type: 'selfDependent' };
				}
			}

			const selfBuilder = new SelfDependentBuilder();
			registry.register(selfBuilder);

			// The registry availability check only checks if builders exist, not cycles
			// Cycle detection would be handled by DependencyGraph component
			const result = registry.checkBuilderAvailability(['selfDependent']);
			expect(result.isValid).toBe(true); // Builder exists, so availability check passes
			expect(result.satisfiableTypes).toContain('selfDependent');
		});

		test('should handle duplicate dependencies in consumes array', () => {
			class DuplicateDepsBuilder implements DataBuilder<Data> {
				readonly provides = 'duplicate';
				readonly consumes = ['user', 'user', 'profile'];

				async build(dataSet: DataSet): Promise<Data> {
					return { type: 'duplicate' };
				}
			}

			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();
			const duplicateBuilder = new DuplicateDepsBuilder();

			registry.register(userBuilder);
			registry.register(profileBuilder);
			registry.register(duplicateBuilder);

			const result = registry.checkBuilderAvailability(['duplicate']);
			expect(result.isValid).toBe(true);
		});
	});

	describe('toString and Debugging', () => {
		test('should provide meaningful string representation', () => {
			const userBuilder = new UserBuilder();
			const profileBuilder = new ProfileBuilder();

			// Empty registry
			expect(registry.toString()).toBe('BuilderRegistry(0 builders: [])');

			// Single builder
			registry.register(userBuilder);
			expect(registry.toString()).toBe('BuilderRegistry(1 builders: [user])');

			// Multiple builders
			registry.register(profileBuilder);
			const str = registry.toString();
			expect(str).toContain('BuilderRegistry(2 builders:');
			expect(str).toContain('user');
			expect(str).toContain('profile');
		});
	});

	describe('Type Safety', () => {
		test('should maintain type safety with builder generics', () => {
			const userBuilder = new UserBuilder();
			registry.register(userBuilder);

			const retrievedBuilder = registry.get('user');

			// TypeScript should know this is DataBuilder<User>
			expect(retrievedBuilder?.provides).toBe('user');
			expect(Array.isArray(retrievedBuilder?.consumes)).toBe(true);
			expect(typeof retrievedBuilder?.build).toBe('function');
		});
	});
});
