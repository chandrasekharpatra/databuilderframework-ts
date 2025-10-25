// Core types and interfaces
export * from './types/index.js';

// Core implementations
export {
    DataFlowEngine,
    DataFlowExecutionError,
    ExecutionMode,
    type DataFlowExecutionOptions
} from './core/DataFlowEngine.js';
export { DataSetImpl } from './core/DataSetImpl.js';

// Re-export error types for backward compatibility
export {
    CircularDependencyError,
    MissingBuilderError
} from './core/ExecutionPlanner.js';
export { type ExecutionStats } from './core/ExecutionStatisticsCollector.js';
export {
    BuilderExecutionError, type ExecutionOptions, type ExecutionResult
} from './core/ExecutionStrategy.js';

// Utility classes (advanced usage)
export { BuilderNotFoundError, BuilderRegistry, DuplicateBuilderError } from './core/BuilderRegistry.js';
export { DependencyGraph, DependencyNode } from './core/DependencyGraph.js';
export { ExecutionPlanner, type ExecutionPlan } from './core/ExecutionPlanner.js';
export { ExecutionStatisticsCollector } from './core/ExecutionStatisticsCollector.js';
export {
    ExecutionStrategy, ExecutionStrategyFactory, ParallelExecutionStrategy, SequentialExecutionStrategy
} from './core/ExecutionStrategy.js';

// Base classes for builders
export {
    AbstractDataBuilder, CombineDataBuilder,
    RequiredDataNotFoundError, SourceDataBuilder,
    TransformDataBuilder
} from './builders/AbstractDataBuilder.js';

// Import for use in convenience functions
import { DataFlowEngine } from './core/DataFlowEngine.js';
import { DataSetImpl } from './core/DataSetImpl.js';
import { Data } from './types/index.js';

// Convenience functions
export function createEngine(): DataFlowEngine {
	return new DataFlowEngine();
}

export function createDataSet(initialData?: Map<string, Data>): DataSetImpl {
	return new DataSetImpl(initialData);
}
