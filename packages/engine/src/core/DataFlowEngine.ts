import { Data, DataBuilder, DataSet, ExecutionContext } from '../types';
import { BuilderRegistry, DuplicateBuilderError } from './BuilderRegistry';
import { DataSetImpl } from './DataSetImpl';
import { CircularDependencyError, ExecutionPlanner, MissingBuilderError } from './ExecutionPlanner';
import { ExecutionStatisticsCollector } from './ExecutionStatisticsCollector';
import { BuilderExecutionError, ExecutionOptions, ExecutionResult, ExecutionStrategyFactory } from './ExecutionStrategy';

/**
 * Error thrown when there are issues with the execution flow.
 */
export class DataFlowExecutionError extends Error {
	constructor(
		message: string,
		public readonly cause?: Error,
	) {
		super(message);
		this.name = 'DataFlowExecutionError';
	}
}

/**
 * Execution mode configuration.
 */
export enum ExecutionMode {
	SEQUENTIAL = 'sequential',
	PARALLEL = 'parallel',
}

/**
 * Enhanced execution options for the main engine.
 */
export interface DataFlowExecutionOptions extends ExecutionOptions {
	/**
	 * The execution mode to use.
	 */
	mode?: ExecutionMode;
}

/**
 * Engine that orchestrates the execution of data builders based on dependency resolution.
 * This is the main entry point for running data flows.
 *
 * The engine uses composition with specialized classes:
 * - BuilderRegistry: Manages builder registration and lookup
 * - ExecutionPlanner: Handles dependency analysis and execution planning
 * - ExecutionStrategy: Implements different execution modes (sequential/parallel)
 * - ExecutionStatisticsCollector: Tracks timing and performance metrics
 */
export class DataFlowEngine {
	private readonly builderRegistry: BuilderRegistry;
	private readonly executionPlanner: ExecutionPlanner;
	private readonly statisticsCollector: ExecutionStatisticsCollector;

	constructor() {
		this.builderRegistry = new BuilderRegistry();
		this.executionPlanner = new ExecutionPlanner(this.builderRegistry);
		this.statisticsCollector = new ExecutionStatisticsCollector();
	}

	// ===== Builder Management =====

	/**
	 * Register a data builder with the engine.
	 * @param builder The builder to register
	 * @param allowOverwrite Whether to allow overwriting existing builders (default: false)
	 * @throws DuplicateBuilderError if a builder for the same data type is already registered and allowOverwrite is false
	 */
	registerBuilder<T extends Data>(builder: DataBuilder<T>, allowOverwrite: boolean = false): void {
		try {
			this.builderRegistry.register(builder, allowOverwrite);
		} catch (error) {
			if (error instanceof DuplicateBuilderError) {
				throw new Error(error.message); // Maintain backward compatibility
			}
			throw error;
		}
	}

	/**
	 * Register multiple builders at once.
	 * @param builders Array of builders to register
	 * @param allowOverwrite Whether to allow overwriting existing builders
	 */
	registerBuilders(builders: DataBuilder<any>[], allowOverwrite: boolean = false): void {
		this.builderRegistry.registerMany(builders, allowOverwrite);
	}

	/**
	 * Unregister a data builder from the engine.
	 * @param dataType The data type of the builder to unregister
	 * @returns true if a builder was unregistered, false if none existed
	 */
	unregisterBuilder(dataType: string): boolean {
		return this.builderRegistry.unregister(dataType);
	}

	/**
	 * Get a registered builder by data type.
	 * @param dataType The data type to look up
	 * @returns The builder if found, undefined otherwise
	 */
	getBuilder<T extends Data>(dataType: string): DataBuilder<T> | undefined {
		return this.builderRegistry.get<T>(dataType);
	}

	/**
	 * Get all registered builders.
	 * @returns A copy of the builders map
	 */
	getAllBuilders(): Map<string, DataBuilder<any>> {
		return this.builderRegistry.getAll();
	}

	/**
	 * Clear all registered builders.
	 */
	clearBuilders(): void {
		this.builderRegistry.clear();
	}

	/**
	 * Check if a builder is registered for the given data type.
	 * @param dataType The data type to check
	 * @returns true if a builder is registered, false otherwise
	 */
	hasBuilder(dataType: string): boolean {
		return this.builderRegistry.has(dataType);
	}

	// ===== Execution Planning =====

	/**
	 * Get the execution plan for a data flow without actually executing it.
	 * @param targetData The data types that would be built
	 * @returns Information about how the flow would be executed
	 */
	getExecutionPlan(targetData: string[]): {
		executionOrder: string[];
		parallelExecutionLevels: string[][];
		missingBuilders: string[];
		cycles: string[];
		isValid: boolean;
		totalBuilders: number;
		maxConcurrency: number;
	} {
		const plan = this.executionPlanner.createExecutionPlan(targetData);

		return {
			executionOrder: plan.executionOrder,
			parallelExecutionLevels: plan.parallelExecutionLevels,
			missingBuilders: plan.missingBuilders,
			cycles: plan.cycles,
			isValid: plan.isValid,
			totalBuilders: plan.totalBuilders,
			maxConcurrency: plan.maxConcurrency,
		};
	}

	/**
	 * Analyze dependencies for specific data types.
	 * @param targetData The data types to analyze
	 * @returns Detailed dependency analysis
	 */
	analyzeDependencies(targetData: string[]) {
		return this.executionPlanner.analyzeDependencies(targetData);
	}

	/**
	 * Get execution statistics for a plan without executing it.
	 * @param targetData The data types to analyze
	 * @returns Statistical information about the execution plan
	 */
	getExecutionPlanStats(targetData: string[]) {
		const plan = this.executionPlanner.createExecutionPlan(targetData);
		return this.executionPlanner.getExecutionPlanStats(plan);
	}

	// ===== Execution Methods =====

	/**
	 * Execute a data flow using the provided context and options.
	 * @param context The execution context containing the flow definition and initial data
	 * @param options Optional execution options (mode, concurrency limits, etc.)
	 * @returns Promise that resolves to the execution result
	 * @throws DataFlowExecutionError if execution fails
	 */
	async executeWithOptions(context: ExecutionContext, options: DataFlowExecutionOptions = {}): Promise<ExecutionResult> {
		try {
			// Create execution plan
			const plan = this.executionPlanner.createExecutionPlan(context.dataFlow.targetData);

			// Filter out missing builders that are satisfied by initial data
			const unsatisfiedMissing = plan.missingBuilders.filter((type) => !context.initialData.contains(type));

			// If the original plan is invalid but would be valid with initial data,
			// we need to force an execution order
			let executionOrder = plan.executionOrder;
			if (!plan.isValid && plan.cycles.length === 0 && unsatisfiedMissing.length === 0) {
				// Plan is invalid only due to missing builders satisfied by initial data
				// Build execution order from available builders that can satisfy targets
				const availableBuilders = new Set<string>();
				const metadata = this.builderRegistry.getAllMetadata();
				for (const meta of metadata) {
					availableBuilders.add(meta.provides);
				}

				// Add builders needed for target data in dependency order
				const needed = new Set<string>();
				const visited = new Set<string>();

				const addDependencies = (dataType: string) => {
					if (visited.has(dataType)) return;
					visited.add(dataType);

					if (availableBuilders.has(dataType)) {
						const builder = this.builderRegistry.get(dataType);
						if (builder) {
							// Add dependencies first
							for (const dep of builder.consumes) {
								if (!context.initialData.contains(dep)) {
									addDependencies(dep);
								}
							}
							needed.add(dataType);
						}
					}
				};

				for (const target of context.dataFlow.targetData) {
					addDependencies(target);
				}

				executionOrder = Array.from(needed);
			}

			// Create a modified plan for validation and execution
			const modifiedPlan = {
				...plan,
				executionOrder,
				missingBuilders: unsatisfiedMissing,
				isValid: plan.cycles.length === 0 && unsatisfiedMissing.length === 0,
			};

			// Validate the modified plan
			this.executionPlanner.validateExecutionPlan(modifiedPlan);

			// Choose execution strategy
			const strategyName = options.mode || ExecutionMode.SEQUENTIAL;
			const strategy = ExecutionStrategyFactory.createStrategy(strategyName, this.builderRegistry, this.statisticsCollector);

			// Execute the modified plan
			return await strategy.execute(context, modifiedPlan, options);
		} catch (error) {
			if (
				error instanceof CircularDependencyError ||
				error instanceof MissingBuilderError ||
				error instanceof BuilderExecutionError
			) {
				throw error;
			}

			const cause = error instanceof Error ? error : new Error(String(error));
			throw new DataFlowExecutionError(`Unexpected error during execution: ${cause.message}`, cause);
		}
	}

	/**
	 * Execute a simple data flow with just target data types and options.
	 * @param targetData The data types to build
	 * @param initialData Optional initial data to start with
	 * @param options Optional execution options
	 * @returns Promise that resolves to the execution result
	 */
	async executeSimpleWithOptions(
		targetData: string[],
		initialData?: DataSet,
		options: DataFlowExecutionOptions = {},
	): Promise<ExecutionResult> {
		const context: ExecutionContext = {
			dataFlow: {
				name: 'simple-flow-with-options',
				targetData,
			},
			initialData: initialData || new DataSetImpl(),
			builders: this.builderRegistry.getAll(),
		};

		return this.executeWithOptions(context, options);
	}

	// ===== Legacy Methods (Backward Compatibility) =====

	/**
	 * Execute a data flow using the provided context (sequential mode).
	 * @param context The execution context containing the flow definition and initial data
	 * @returns Promise that resolves to the execution result
	 * @throws DataFlowExecutionError if execution fails
	 * @deprecated Use executeWithOptions with ExecutionMode.SEQUENTIAL instead
	 */
	async execute(context: ExecutionContext): Promise<ExecutionResult> {
		return this.executeWithOptions(context, { mode: ExecutionMode.SEQUENTIAL });
	}

	/**
	 * Execute a data flow using parallel execution where possible.
	 * @param context The execution context containing the flow definition and initial data
	 * @returns Promise that resolves to the execution result
	 * @throws DataFlowExecutionError if execution fails
	 * @deprecated Use executeWithOptions with ExecutionMode.PARALLEL instead
	 */
	async executeParallel(context: ExecutionContext): Promise<ExecutionResult> {
		return this.executeWithOptions(context, { mode: ExecutionMode.PARALLEL });
	}

	/**
	 * Execute a simple data flow with just target data types (sequential mode).
	 * @param targetData The data types to build
	 * @param initialData Optional initial data to start with
	 * @returns Promise that resolves to the execution result
	 * @deprecated Use executeSimpleWithOptions with ExecutionMode.SEQUENTIAL instead
	 */
	async executeSimple(targetData: string[], initialData?: DataSet): Promise<ExecutionResult> {
		return this.executeSimpleWithOptions(targetData, initialData, { mode: ExecutionMode.SEQUENTIAL });
	}

	/**
	 * Execute a simple data flow with just target data types using parallel execution.
	 * @param targetData The data types to build
	 * @param initialData Optional initial data to start with
	 * @returns Promise that resolves to the execution result
	 * @deprecated Use executeSimpleWithOptions with ExecutionMode.PARALLEL instead
	 */
	async executeParallelSimple(targetData: string[], initialData?: DataSet): Promise<ExecutionResult> {
		return this.executeSimpleWithOptions(targetData, initialData, { mode: ExecutionMode.PARALLEL });
	}

	// ===== Utility Methods =====

	/**
	 * Get information about the current state of the engine.
	 * @returns Engine state information
	 */
	getEngineInfo(): {
		registeredBuilders: number;
		availableStrategies: string[];
		builderTypes: string[];
	} {
		return {
			registeredBuilders: this.builderRegistry.size(),
			availableStrategies: ExecutionStrategyFactory.getAvailableStrategies(),
			builderTypes: this.builderRegistry.getProvidedTypes(),
		};
	}

	/**
	 * Validate the current builder registry for potential issues.
	 * @returns Validation results
	 */
	validateRegistry(): {
		isValid: boolean;
		issues: string[];
		warnings: string[];
	} {
		const issues: string[] = [];
		const warnings: string[] = [];

		const providedTypes = this.builderRegistry.getProvidedTypes();
		const consumedTypes = this.builderRegistry.getConsumedTypes();

		// Check for unresolvable dependencies
		const unsatisfiedDependencies = consumedTypes.filter((type) => !providedTypes.includes(type));
		if (unsatisfiedDependencies.length > 0) {
			issues.push(`Unsatisfied dependencies: ${unsatisfiedDependencies.join(', ')}`);
		}

		// Check for unused builders
		const unusedBuilders = providedTypes.filter((type) => !consumedTypes.includes(type));
		if (unusedBuilders.length > 0) {
			warnings.push(`Potentially unused builders: ${unusedBuilders.join(', ')}`);
		}

		return {
			isValid: issues.length === 0,
			issues,
			warnings,
		};
	}
}
