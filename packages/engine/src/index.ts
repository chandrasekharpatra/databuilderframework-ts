// Core types and interfaces
export * from './types';

// Core implementations
export { DataFlowEngine, DataFlowExecutionError, ExecutionMode, type DataFlowExecutionOptions } from './core/DataFlowEngine';
export { DataSetImpl } from './core/DataSetImpl';

// Re-export error types for backward compatibility
export { CircularDependencyError, MissingBuilderError } from './core/ExecutionPlanner';
export { type ExecutionStats } from './core/ExecutionStatisticsCollector';
export { BuilderExecutionError, type ExecutionOptions, type ExecutionResult } from './core/ExecutionStrategy';

// Utility classes (advanced usage)
export { BuilderNotFoundError, BuilderRegistry, DuplicateBuilderError } from './core/BuilderRegistry';
export { DependencyGraph, DependencyNode } from './core/DependencyGraph';
export { ExecutionPlanner, type ExecutionPlan } from './core/ExecutionPlanner';
export { ExecutionStatisticsCollector } from './core/ExecutionStatisticsCollector';
export {
	ExecutionStrategy,
	ExecutionStrategyFactory,
	ParallelExecutionStrategy,
	SequentialExecutionStrategy
} from './core/ExecutionStrategy';

// Base classes for builders
export {
	AbstractDataBuilder,
	CombineDataBuilder,
	RequiredDataNotFoundError,
	SourceDataBuilder,
	TransformDataBuilder
} from './builders/AbstractDataBuilder';

// Import for use in convenience functions
import { DataFlowEngine } from './core/DataFlowEngine';
import { DataSetImpl } from './core/DataSetImpl';
import { Data } from './types';

// Convenience functions
export function createEngine(): DataFlowEngine {
	return new DataFlowEngine();
}

export function createDataSet(initialData?: Map<string, Data>): DataSetImpl {
	return new DataSetImpl(initialData);
}
