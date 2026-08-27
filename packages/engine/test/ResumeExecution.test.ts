import { beforeEach, describe, expect, test } from 'vitest';
import { createEngine, createDataSet, SourceDataBuilder, TransformDataBuilder, CombineDataBuilder } from '../src/index';
import { Data, DataSet } from '../src/types';

/**
 * Tests that demonstrate the engine can be used as a resume mechanism by:
 * 1. Persisting only the DataSet (the built data objects).
 * 2. Re-initializing a fresh engine with the same builders.
 * 3. Re-executing with the persisted data as initial data.
 *
 * Because ExecutionStrategy skips builders whose output already exists in the
 * dataset, previously completed work is not re-executed.
 */

interface ConfigData extends Data {
	readonly type: 'config';
	apiUrl: string;
}

interface UserData extends Data {
	readonly type: 'user';
	id: string;
	name: string;
}

interface ProfileData extends Data {
	readonly type: 'profile';
	bio: string;
}

interface SummaryData extends Data {
	readonly type: 'summary';
	text: string;
}

interface BuildTracker {
	configCount: number;
	userCount: number;
	profileCount: number;
	summaryCount: number;
}

class ConfigBuilder extends SourceDataBuilder<ConfigData> {
	readonly provides = 'config';

	constructor(private readonly tracker: BuildTracker) {
		super();
	}

	async build(): Promise<ConfigData> {
		this.tracker.configCount++;
		return { type: 'config', apiUrl: 'https://api.example.com' };
	}
}

class UserBuilder extends SourceDataBuilder<UserData> {
	readonly provides = 'user';

	constructor(private readonly tracker: BuildTracker) {
		super();
	}

	async build(): Promise<UserData> {
		this.tracker.userCount++;
		return { type: 'user', id: '42', name: 'Ada Lovelace' };
	}
}

class ProfileBuilder extends TransformDataBuilder<UserData, ProfileData> {
	readonly provides = 'profile';
	readonly inputType = 'user';

	constructor(private readonly tracker: BuildTracker) {
		super();
	}

	async transform(user: UserData): Promise<ProfileData> {
		this.tracker.profileCount++;
		return { type: 'profile', bio: `Profile for ${user.name}` };
	}
}

class SummaryBuilder extends CombineDataBuilder<SummaryData> {
	readonly provides = 'summary';
	readonly consumes = ['config', 'profile'];

	constructor(private readonly tracker: BuildTracker) {
		super();
	}

	async combine(inputs: Map<string, Data>): Promise<SummaryData> {
		this.tracker.summaryCount++;
		const config = inputs.get('config') as ConfigData;
		const profile = inputs.get('profile') as ProfileData;
		return { type: 'summary', text: `${profile.bio} @ ${config.apiUrl}` };
	}
}

function createTrackedEngine(tracker: BuildTracker) {
	const engine = createEngine();
	engine.registerBuilder(new ConfigBuilder(tracker));
	engine.registerBuilder(new UserBuilder(tracker));
	engine.registerBuilder(new ProfileBuilder(tracker));
	engine.registerBuilder(new SummaryBuilder(tracker));
	return engine;
}

function serializeDataSet(dataSet: DataSet): Data[] {
	return Array.from((<DataSetImpl>dataSet).getAll().values());
}

function deserializeDataSet(data: Data[]): DataSet {
	return createDataSet(new Map(data.map((item) => [item.type, item])));
}

describe('Resume execution via persisted DataSet', () => {
	let tracker: BuildTracker;

	beforeEach(() => {
		tracker = { configCount: 0, userCount: 0, profileCount: 0, summaryCount: 0 };
	});

	test('full resume skips all builders when entire dataset is restored', async () => {
		const engine = createTrackedEngine(tracker);
		const firstResult = await engine.executeSimpleWithOptions(['summary']);

		expect(firstResult.dataSet.accessor<SummaryData>('summary')?.text).toBe('Profile for Ada Lovelace @ https://api.example.com');
		expect(tracker.configCount).toBe(1);
		expect(tracker.userCount).toBe(1);
		expect(tracker.profileCount).toBe(1);
		expect(tracker.summaryCount).toBe(1);

		// Simulate persistence and transport through JSON
		const persisted = serializeDataSet(firstResult.dataSet);
		const restoredData = deserializeDataSet(JSON.parse(JSON.stringify(persisted)));

		const resumedEngine = createTrackedEngine(tracker);
		const resumedResult = await resumedEngine.executeSimpleWithOptions(['summary'], restoredData);

		expect(resumedResult.dataSet.accessor<SummaryData>('summary')?.text).toBe('Profile for Ada Lovelace @ https://api.example.com');
		expect(tracker.configCount).toBe(1);
		expect(tracker.userCount).toBe(1);
		expect(tracker.profileCount).toBe(1);
		expect(tracker.summaryCount).toBe(1);
		expect(resumedResult.stats.skipCount).toBe(4);
	});

	test('partial resume runs only builders whose output is missing', async () => {
		const partialData = deserializeDataSet([
			{ type: 'config', apiUrl: 'https://api.example.com' } as ConfigData,
			{ type: 'user', id: '42', name: 'Ada Lovelace' } as UserData,
		]);

		const engine = createTrackedEngine(tracker);
		const result = await engine.executeSimpleWithOptions(['summary'], partialData);

		expect(result.dataSet.accessor<SummaryData>('summary')?.text).toBe('Profile for Ada Lovelace @ https://api.example.com');
		expect(tracker.configCount).toBe(0);
		expect(tracker.userCount).toBe(0);
		expect(tracker.profileCount).toBe(1);
		expect(tracker.summaryCount).toBe(1);
		expect(result.stats.skipCount).toBe(2);
	});

	test('resume after intermediate failure continues from last known dataset', async () => {
		// Use a separate tracker for the first phase so we can isolate resume behavior.
		const firstTracker: BuildTracker = {
			configCount: 0,
			userCount: 0,
			profileCount: 0,
			summaryCount: 0,
		};

		// First run only builds user. Config was already supplied as pre-existing data.
		const firstEngine = createEngine();
		firstEngine.registerBuilder(new UserBuilder(firstTracker));
		const initialData = createDataSet(new Map([['config', { type: 'config', apiUrl: 'https://api.example.com' }]]));
		const firstResult = await firstEngine.executeSimple(['user'], initialData);
		expect(firstTracker.userCount).toBe(1);

		const checkpoint = serializeDataSet(firstResult.dataSet);

		// Resume with a fresh engine to build the remaining outputs
		const resumeEngine = createTrackedEngine(tracker);
		const resumedResult = await resumeEngine.executeSimple(['summary'], deserializeDataSet(checkpoint));

		expect(resumedResult.dataSet.contains('summary')).toBe(true);
		// Both config and user were present in the restored dataset, so they are skipped
		expect(tracker.configCount).toBe(0);
		expect(tracker.userCount).toBe(0);
		// profile and summary still need to be produced
		expect(tracker.profileCount).toBe(1);
		expect(tracker.summaryCount).toBe(1);
		expect(resumedResult.stats.skipCount).toBe(2);
	});
	test('pause for user action and continue execution', async () => {
		const engine = createTrackedEngine(tracker);

		// Stage 1: run only up to the pause point
		const stage1 = await engine.executeSimple(['profile']);
		expect(stage1.dataSet.contains('profile')).toBe(true);
		expect(tracker.userCount).toBe(1);
		expect(tracker.profileCount).toBe(1);
		// summary has not been built yet
		expect(tracker.summaryCount).toBe(0);

		// Simulate user action / confirmation using the profile data
		const profile = stage1.dataSet.accessor<ProfileData>('profile');
		expect(profile?.bio).toBe('Profile for Ada Lovelace');

		// Stage 2: continue after user action, reusing the paused dataset
		const stage2 = await engine.executeSimple(['summary'], stage1.dataSet);

		expect(stage2.dataSet.contains('summary')).toBe(true);
		expect(stage2.dataSet.accessor<SummaryData>('summary')?.text).toBe('Profile for Ada Lovelace @ https://api.example.com');
		// Already built data is skipped; only summary should run
		expect(tracker.userCount).toBe(1);
		expect(tracker.profileCount).toBe(1);
		expect(tracker.summaryCount).toBe(1);
		expect(stage2.stats.skipCount).toBe(2);
	});
});
