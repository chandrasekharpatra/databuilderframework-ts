import { beforeEach, describe, expect, test } from 'vitest';
import { createEngine, createDataSet, SourceDataBuilder, TransformDataBuilder, CombineDataBuilder, DataSetImpl } from '../src/index';
import { Data } from '../src/types';
import { MissingBuilderError } from '../src/core/ExecutionPlanner';

/**
 * Marker-driven workflow phase test.
 *
 * Instead of externally pausing the engine, the workflow itself defines a
 * phase boundary using a marker data type (`phaseOne`). After the marker is
 * produced, the next phase requires `phaseTwoInput`, which no builder creates.
 * This forces the application to collect user input and inject it before
 * continuing. If someone tries to continue without the input, the engine
 * throws MissingBuilderError.
 */

interface UserData extends Data {
	readonly type: 'user';
	id: string;
	name: string;
}

interface ProfileData extends Data {
	readonly type: 'profile';
	bio: string;
}

interface PhaseOneMarker extends Data {
	readonly type: 'phaseOne';
	status: 'complete';
}

interface PhaseTwoInputData extends Data {
	readonly type: 'phaseTwoInput';
	value: string;
}

interface SummaryData extends Data {
	readonly type: 'summary';
	text: string;
}

interface BuildTracker {
	userCount: number;
	profileCount: number;
	phaseOneCount: number;
	summaryCount: number;
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

class PhaseOneMarkerBuilder extends TransformDataBuilder<ProfileData, PhaseOneMarker> {
	readonly provides = 'phaseOne';
	readonly inputType = 'profile';

	constructor(private readonly tracker: BuildTracker) {
		super();
	}

	async transform(): Promise<PhaseOneMarker> {
		this.tracker.phaseOneCount++;
		return { type: 'phaseOne', status: 'complete' };
	}
}

class SummaryBuilder extends CombineDataBuilder<SummaryData> {
	readonly provides = 'summary';
	readonly consumes = ['profile', 'phaseTwoInput'];

	constructor(private readonly tracker: BuildTracker) {
		super();
	}

	async combine(inputs: Map<string, Data>): Promise<SummaryData> {
		this.tracker.summaryCount++;
		const profile = inputs.get('profile') as ProfileData;
		const phaseTwoInput = inputs.get('phaseTwoInput') as PhaseTwoInputData;
		return {
			type: 'summary',
			text: `${profile.bio} + ${phaseTwoInput.value}`,
		};
	}
}

function createPhaseEngine(tracker: BuildTracker) {
	const engine = createEngine();
	engine.registerBuilder(new UserBuilder(tracker));
	engine.registerBuilder(new ProfileBuilder(tracker));
	engine.registerBuilder(new PhaseOneMarkerBuilder(tracker));
	engine.registerBuilder(new SummaryBuilder(tracker));
	return engine;
}

describe('Marker-driven workflow phases', () => {
	let tracker: BuildTracker;

	beforeEach(() => {
		tracker = { userCount: 0, profileCount: 0, phaseOneCount: 0, summaryCount: 0 };
	});

	test('phase one completes and produces the marker', async () => {
		const engine = createPhaseEngine(tracker);
		const result = await engine.executeSimple(['phaseOne']);

		expect(result.dataSet.contains('phaseOne')).toBe(true);
		expect(result.dataSet.accessor<PhaseOneMarker>('phaseOne')?.status).toBe('complete');
		expect(tracker.userCount).toBe(1);
		expect(tracker.profileCount).toBe(1);
		expect(tracker.phaseOneCount).toBe(1);
		expect(tracker.summaryCount).toBe(0);
	});

	test('continuing without phaseTwoInput throws MissingBuilderError', async () => {
		const engine = createPhaseEngine(tracker);

		// Phase one runs and produces its marker, but summary cannot proceed
		await expect(engine.executeSimple(['summary'])).rejects.toBeInstanceOf(MissingBuilderError);
	});

	test('phase two continues after user provides phaseTwoInput', async () => {
		const engine = createPhaseEngine(tracker);

		// Phase one: automated workflow up to the marker
		const phaseOneResult = await engine.executeSimple(['phaseOne']);
		expect(phaseOneResult.dataSet.contains('phaseOne')).toBe(true);

		// Simulate user action: collect phaseTwoInput and add it to the dataset
		const dataWithUserInput = createDataSet((<DataSetImpl>phaseOneResult.dataSet).getAll());
		dataWithUserInput.add({ type: 'phaseTwoInput', value: 'user-confirmed' } as PhaseTwoInputData);

		// Phase two: continue workflow
		const phaseTwoResult = await engine.executeSimple(['summary'], dataWithUserInput);

		expect(phaseTwoResult.dataSet.contains('summary')).toBe(true);
		expect(phaseTwoResult.dataSet.accessor<SummaryData>('summary')?.text).toBe('Profile for Ada Lovelace + user-confirmed');
		expect(tracker.userCount).toBe(1);
		expect(tracker.profileCount).toBe(1);
		expect(tracker.phaseOneCount).toBe(1);
		expect(tracker.summaryCount).toBe(1);
	});
});
