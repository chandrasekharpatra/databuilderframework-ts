import { beforeEach, describe, expect, test } from 'vitest';
import {
	createCheckpoint,
	createDataSet,
	createEngine,
	restoreFromCheckpoint,
	SourceDataBuilder,
	TransformDataBuilder,
} from '../src/index';
import { Data } from '../src/types';

/**
 * Tests for the first-class checkpoint / resume API.
 */

interface UserData extends Data {
	readonly type: 'user';
	id: string;
	name: string;
}

interface EmailData extends Data {
	readonly type: 'email';
	address: string;
}

interface BuildTracker {
	userCount: number;
	emailCount: number;
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

class EmailBuilder extends TransformDataBuilder<UserData, EmailData> {
	readonly provides = 'email';
	readonly inputType = 'user';

	constructor(private readonly tracker: BuildTracker) {
		super();
	}

	async transform(user: UserData): Promise<EmailData> {
		this.tracker.emailCount++;
		return { type: 'email', address: `${user.name.toLowerCase().replace(/\s+/g, '.')}@example.com` };
	}
}

function createTrackedEngine(tracker: BuildTracker) {
	const engine = createEngine();
	engine.registerBuilder(new UserBuilder(tracker));
	engine.registerBuilder(new EmailBuilder(tracker));
	return engine;
}

describe('Checkpoint and resume API', () => {
	let tracker: BuildTracker;

	beforeEach(() => {
		tracker = { userCount: 0, emailCount: 0 };
	});

	describe('createCheckpoint / restoreFromCheckpoint', () => {
		test('createCheckpoint produces a serializable snapshot', () => {
			const dataSet = createDataSet(
				new Map([
					['user', { type: 'user', id: '42', name: 'Ada Lovelace' }],
					['email', { type: 'email', address: 'ada.lovelace@example.com' }],
				]),
			);

			const checkpoint = createCheckpoint(dataSet);

			expect(checkpoint.version).toBe(1);
			expect(checkpoint.data).toHaveLength(2);
			expect(checkpoint.data).toContainEqual({ type: 'user', id: '42', name: 'Ada Lovelace' });
			expect(checkpoint.data).toContainEqual({ type: 'email', address: 'ada.lovelace@example.com' });
		});

		test('checkpoint survives JSON round-trip', () => {
			const dataSet = createDataSet(new Map([['user', { type: 'user', id: '42', name: 'Ada Lovelace' }]]));

			const checkpoint = createCheckpoint(dataSet);
			const restored = restoreFromCheckpoint(JSON.parse(JSON.stringify(checkpoint)));

			expect(restored.size()).toBe(1);
			expect(restored.accessor<UserData>('user')).toEqual({ type: 'user', id: '42', name: 'Ada Lovelace' });
		});

		test('restoreFromCheckpoint creates an independent copy', () => {
			const dataSet = createDataSet(new Map([['user', { type: 'user', id: '42', name: 'Ada Lovelace' }]]));

			const checkpoint = createCheckpoint(dataSet);
			const restored = restoreFromCheckpoint(checkpoint);

			restored.add({ type: 'email', address: 'ada@example.com' } as EmailData);
			expect(dataSet.size()).toBe(1);
			expect(restored.size()).toBe(2);
		});
	});

	describe('DataFlowEngine checkpoint helpers', () => {
		test('executeUpTo stops when target data is produced', async () => {
			const engine = createTrackedEngine(tracker);
			const result = await engine.executeUpTo('user');

			expect(result.dataSet.contains('user')).toBe(true);
			expect(result.dataSet.contains('email')).toBe(false);
			expect(tracker.userCount).toBe(1);
			expect(tracker.emailCount).toBe(0);
		});

		test('createCheckpoint serializes an execution result', async () => {
			const engine = createTrackedEngine(tracker);
			const result = await engine.executeUpTo('user');
			const checkpoint = engine.createCheckpoint(result);

			expect(checkpoint.data).toHaveLength(1);
			expect(checkpoint.data[0]).toEqual({ type: 'user', id: '42', name: 'Ada Lovelace' });
		});

		test('resume continues from a checkpoint', async () => {
			const phaseOneTracker: BuildTracker = { userCount: 0, emailCount: 0 };
			const engine1 = createTrackedEngine(phaseOneTracker);
			const phaseOneResult = await engine1.executeUpTo('user');
			const checkpoint = engine1.createCheckpoint(phaseOneResult);

			// Fresh engine, separate tracker to isolate resume behavior
			const engine2 = createTrackedEngine(tracker);
			const resumedResult = await engine2.resume(['email'], checkpoint);

			expect(resumedResult.dataSet.accessor<EmailData>('email')?.address).toBe('ada.lovelace@example.com');
			expect(tracker.userCount).toBe(0); // user was in checkpoint, skipped
			expect(tracker.emailCount).toBe(1);
		});

		test('resume accepts a DataSet directly', async () => {
			const engine = createTrackedEngine(tracker);
			const initialData = createDataSet(new Map([['user', { type: 'user', id: '42', name: 'Ada Lovelace' }]]));

			const result = await engine.resume(['email'], initialData);

			expect(result.dataSet.contains('email')).toBe(true);
			expect(tracker.userCount).toBe(0);
			expect(tracker.emailCount).toBe(1);
		});

		test('resume checkpoint survives JSON round-trip', async () => {
			const phaseOneTracker: BuildTracker = { userCount: 0, emailCount: 0 };
			const engine1 = createTrackedEngine(phaseOneTracker);
			const phaseOneResult = await engine1.executeUpTo('user');
			const checkpoint = JSON.parse(JSON.stringify(engine1.createCheckpoint(phaseOneResult)));

			const engine2 = createTrackedEngine(tracker);
			const resumedResult = await engine2.resume(['email'], checkpoint);

			expect(resumedResult.dataSet.contains('email')).toBe(true);
			expect(tracker.userCount).toBe(0); // user was in checkpoint, skipped
			expect(tracker.emailCount).toBe(1);
		});
	});
});
