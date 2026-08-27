# DataBuilderFramework TypeScript

A TypeScript implementation of the DataBuilderFramework - a dependency injection framework for building complex data processing pipelines.

## Overview

The DataBuilderFramework allows you to define data dependencies and automatically resolves the execution order. It's particularly useful for complex data processing workflows where different pieces of data depend on each other.

## Key Concepts

- **Data**: Basic interface for all data objects with a `type` identifier
- **DataBuilder**: Interface for builders that create data objects
- **DataSet**: Collection that stores and provides access to data objects
- **DataFlowEngine**: Orchestrates the execution of builders based on dependencies
- **DependencyGraph**: Manages builder dependencies and execution order

## Installation

```bash
npm install @chandrasekharpatra/databuilderframework-ts
```

## Quick Start

```typescript
import { Data, SourceDataBuilder, TransformDataBuilder, createEngine } from '@chandrasekharpatra/databuilderframework-ts';

// Define your data types
interface UserData extends Data {
	type: 'user';
	id: string;
	name: string;
}

interface EmailData extends Data {
	type: 'email';
	userId: string;
	email: string;
}

// Create builders
class UserBuilder extends SourceDataBuilder<UserData> {
	readonly provides = 'user';

	async build(): Promise<UserData> {
		return {
			type: 'user',
			id: '123',
			name: 'John Doe',
		};
	}
}

class EmailBuilder extends TransformDataBuilder<UserData, EmailData> {
	readonly provides = 'email';
	readonly inputType = 'user';

	async transform(user: UserData): Promise<EmailData> {
		return {
			type: 'email',
			userId: user.id,
			email: `${user.name.toLowerCase().replace(' ', '.')}@example.com`,
		};
	}
}

// Use the engine
async function main() {
	const engine = createEngine();

	engine.registerBuilder(new UserBuilder());
	engine.registerBuilder(new EmailBuilder());

	const result = await engine.executeSimple(['email']);
	const email = result.dataSet.accessor<EmailData>('email');

	console.log(email); // { type: 'email', userId: '123', email: 'john.doe@example.com' }
}
```

## Builder Types

### SourceDataBuilder

For builders that don't require any input data:

```typescript
class ConfigBuilder extends SourceDataBuilder<ConfigData> {
	readonly provides = 'config';

	async build(): Promise<ConfigData> {
		// Generate or fetch initial data
		return { type: 'config', apiUrl: 'https://api.example.com' };
	}
}
```

### TransformDataBuilder

For builders that transform one input into one output:

```typescript
class ProcessedDataBuilder extends TransformDataBuilder<RawData, ProcessedData> {
	readonly provides = 'processedData';
	readonly inputType = 'rawData';

	async transform(input: RawData): Promise<ProcessedData> {
		// Transform the input
		return { type: 'processedData', result: input.value * 2 };
	}
}
```

### CombineDataBuilder

For builders that combine multiple inputs:

```typescript
class SummaryBuilder extends CombineDataBuilder<SummaryData> {
	readonly provides = 'summary';
	readonly consumes = ['user', 'stats', 'preferences'];

	async combine(inputs: Map<string, Data>): Promise<SummaryData> {
		const user = inputs.get('user') as UserData;
		const stats = inputs.get('stats') as StatsData;
		const preferences = inputs.get('preferences') as PreferencesData;

		// Combine the inputs
		return {
			type: 'summary',
			text: `User ${user.name} has ${stats.loginCount} logins`,
		};
	}
}
```

## Features

- **Dependency Resolution**: Automatically determines the order to execute builders
- **Cycle Detection**: Detects and reports circular dependencies
- **Type Safety**: Full TypeScript support with generic types
- **Error Handling**: Comprehensive error types for different failure scenarios
- **Execution Statistics**: Detailed timing and execution information
- **Execution Planning**: Preview execution order without running
- **Initial Data Support**: Provide pre-existing data to skip certain builders
- **Checkpointing**: Serialize the dataset to resume execution later
- **Phase Boundaries**: Pause workflows at explicit data-type boundaries
- **Execution Hooks**: Observe builder-level and execution-level progress
- **External Inputs**: Declare inputs supplied from outside the engine

## Advanced Usage

### Execution with Initial Data

```typescript
const initialData = createDataSet();
initialData.add({ type: 'config', apiUrl: 'https://api.example.com' });

const result = await engine.executeSimple(['processedData'], initialData);
```

### Execution Planning

```typescript
const plan = engine.getExecutionPlan(['targetData']);
console.log('Execution order:', plan.executionOrder);
console.log('Missing builders:', plan.missingBuilders);
console.log('Cycles:', plan.cycles);
```

### Custom DataFlow

```typescript
const context = {
	dataFlow: {
		name: 'user-processing-flow',
		description: 'Process user data through multiple stages',
		targetData: ['finalResult'],
	},
	initialData: createDataSet(),
	builders: engine.getAllBuilders(),
};

const result = await engine.execute(context);
```

## Checkpointing and Resuming Execution

The engine supports resuming execution by persisting only the `DataSet`. Because builders whose outputs already exist in the dataset are skipped, you can safely re-run the same flow with a restored dataset and only missing builders will execute.

### Creating and restoring checkpoints

```typescript
import { createCheckpoint, restoreFromCheckpoint } from '@chandrasekharpatra/databuilderframework-ts';

// Run the first part of the workflow
const result = await engine.executeSimple(['profile']);

// Create a serializable checkpoint
const checkpoint = createCheckpoint(result.dataSet);
await db.save('workflow-123', JSON.stringify(checkpoint));

// Later, restore and continue
const saved = JSON.parse(await db.load('workflow-123'));
const restoredDataSet = restoreFromCheckpoint(saved);

const engine2 = createEngine();
engine2.registerBuilder(new UserBuilder());
engine2.registerBuilder(new ProfileBuilder());
engine2.registerBuilder(new EmailBuilder());

const finalResult = await engine2.executeSimple(['email'], restoredDataSet);
```

### Engine helpers for resume

Convenience methods are also available directly on `DataFlowEngine`:

```typescript
// Run only until a specific data type is produced
const phaseOne = await engine.executeUpTo('profile');

// Create a checkpoint from the result
const checkpoint = engine.createCheckpoint(phaseOne);

// Later, resume from that checkpoint with a fresh engine
const phaseTwo = await engine2.resume(['email'], checkpoint);
```

## Marker-Driven Workflow Phases

For workflows that need to pause for external input (e.g. user approval), you can encode the pause as a missing-but-required data type. No builder produces this data type, so the engine cannot proceed until your application injects it.

```typescript
class SummaryBuilder extends CombineDataBuilder<SummaryData> {
	readonly provides = 'summary';
	readonly consumes = ['profile', 'phaseTwoInput'];

	async combine(inputs: Map<string, Data>): Promise<SummaryData> {
		const profile = inputs.get('profile') as ProfileData;
		const phaseTwoInput = inputs.get('phaseTwoInput') as PhaseTwoInputData;

		return {
			type: 'summary',
			text: `${profile.bio} + ${phaseTwoInput.value}`,
		};
	}
}
```

Run up to the phase marker:

```typescript
const phaseOne = await engine.executeUpTo('phaseOne');
```

If you accidentally try to continue without the required input, the engine throws `MissingBuilderError`, preventing the workflow from advancing at the wrong step.

Once the input is available, resume:

```typescript
const dataSet = createDataSet(phaseOne.dataSet.getAll());
dataSet.add({ type: 'phaseTwoInput', value: 'user-confirmed' });

const result = await engine.executeSimple(['summary'], dataSet);
```

## Execution Hooks

Observe execution progress without subclassing the execution strategy:

```typescript
import { ExecutionMode } from '@chandrasekharpatra/databuilderframework-ts';

const result = await engine.executeSimpleWithOptions(['summary'], initialData, {
	mode: ExecutionMode.PARALLEL,
	hooks: {
		onExecutionStart: (plan) => console.log('Order:', plan.executionOrder),
		onBuilderStart: (dataType) => console.log('Building', dataType),
		onBuilderComplete: (dataType, executionTime) => console.log(`Built ${dataType} in ${executionTime}ms`),
		onBuilderSkipped: (dataType) => console.log('Skipped', dataType),
		onBuilderError: (dataType, error) => console.error('Failed', dataType, error),
		onLevelStart: (level) => console.log('Parallel level', level),
		onExecutionComplete: (stats) => console.log('Total time', stats.totalExecutionTime),
	},
});
```

Hooks are purely observational — throwing inside a hook will abort execution.

## Declaring External Inputs

For workflows that receive some data from outside the engine (e.g. user-provided phase inputs), declare the expected input so registry validation does not flag it as missing:

```typescript
engine.registerBuilder(new SummaryBuilder());
engine.declareExternalInput('phaseTwoInput');

const validation = engine.validateRegistry();
expect(validation.isValid).toBe(true);
```

You can also declare multiple inputs at once, or remove declarations later:

```typescript
engine.declareExternalInputs(['config', 'phaseTwoInput']);
engine.undeclareExternalInput('config');
engine.clearDeclaredExternalInputs();
```

## Error Handling

The framework provides specific error types:

- `CircularDependencyError`: When builders have circular dependencies
- `MissingBuilderError`: When required builders are not registered
- `BuilderExecutionError`: When a builder fails during execution
- `RequiredDataNotFoundError`: When a builder can't find required input data

```typescript
try {
	const result = await engine.executeSimple(['targetData']);
} catch (error) {
	if (error instanceof CircularDependencyError) {
		console.log('Circular dependency detected:', error.message);
	} else if (error instanceof MissingBuilderError) {
		console.log('Missing builders:', error.message);
	}
}
```

## Examples

See the [examples](./examples/usage-examples.ts) directory for comprehensive usage examples.

## License

MIT
