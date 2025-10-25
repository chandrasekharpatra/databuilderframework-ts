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
npm install @databuilderframework-ts/engine
```

## Quick Start

```typescript
import { Data, SourceDataBuilder, TransformDataBuilder, createEngine } from '@databuilderframework-ts/engine';

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
