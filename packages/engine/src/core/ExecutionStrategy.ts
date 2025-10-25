import { DataSet, ExecutionContext } from '../types/index.js';
import { BuilderRegistry } from './BuilderRegistry.js';
import { DataSetImpl } from './DataSetImpl.js';
import { ExecutionPlan } from './ExecutionPlanner.js';
import { ExecutionStatisticsCollector, ExecutionStats } from './ExecutionStatisticsCollector.js';

/**
 * Error thrown when a builder fails to execute.
 */
export class BuilderExecutionError extends Error {
  constructor(builderName: string, dataType: string, cause: Error) {
    super(`Builder '${builderName}' failed to build data type '${dataType}': ${cause.message}`, cause);
    this.name = 'BuilderExecutionError';
  }
}

/**
 * Result of executing a data flow.
 */
export interface ExecutionResult {
  /**
   * The final dataset containing all built data.
   */
  readonly dataSet: DataSet;

  /**
   * The execution order that was used.
   */
  readonly executionOrder: string[];

  /**
   * Statistics about the execution.
   */
  readonly stats: ExecutionStats;
}

/**
 * Configuration options for execution strategies.
 */
export interface ExecutionOptions {
  /**
   * Maximum number of builders to execute concurrently (only for parallel strategies).
   * If not specified, no limit is applied.
   */
  maxConcurrency?: number;

  /**
   * Timeout for individual builder execution in milliseconds.
   * If not specified, no timeout is applied.
   */
  builderTimeout?: number;

  /**
   * Whether to continue execution if a non-critical builder fails.
   * If false, any builder failure will stop execution.
   */
  continueOnError?: boolean;
}

/**
 * Abstract base class for execution strategies.
 * Implements the Strategy pattern for different execution modes.
 */
export abstract class ExecutionStrategy {
  constructor(
    protected readonly builderRegistry: BuilderRegistry,
    protected readonly statisticsCollector: ExecutionStatisticsCollector
  ) {}

  /**
   * Execute the data flow according to this strategy.
   * @param context The execution context
   * @param plan The execution plan to follow
   * @param options Execution options
   * @returns Promise that resolves to the execution result
   */
  abstract execute(context: ExecutionContext, plan: ExecutionPlan, options: ExecutionOptions): Promise<ExecutionResult>;

  /**
   * Get the name of this execution strategy.
   * @returns Strategy name
   */
  abstract getStrategyName(): string;

  /**
   * Clone a DataSet, handling both DataSetImpl and generic DataSet instances.
   * @param dataSet The DataSet to clone
   * @returns A new DataSetImpl with the same data
   * @protected
   */
  protected cloneDataSet(dataSet: DataSet): DataSetImpl {
    if (dataSet instanceof DataSetImpl) {
      return dataSet.clone();
    }

    // For generic DataSet instances, we can't access internal data directly
    // This is a limitation that could be addressed by extending the DataSet interface
    const result = new DataSetImpl();
    
    // TODO: Consider extending DataSet interface to include iteration capabilities
    // For now, we'll create an empty DataSet and let the builders populate it
    
    return result;
  }

  /**
   * Execute a single builder and handle timing/error collection.
   * @param dataType The data type to build
   * @param resultDataSet The dataset to use for building and to add results to
   * @param options Execution options
   * @returns Promise that resolves to execution result info
   * @protected
   */
  protected async executeBuilder(
    dataType: string, 
    resultDataSet: DataSetImpl, 
    options: ExecutionOptions
  ): Promise<{ dataType: string; skipped: boolean; result: any; executionTime: number }> {
    // Check if data already exists
    if (resultDataSet.contains(dataType)) {
      this.statisticsCollector.recordSkippedBuilder();
      return { dataType, skipped: true, result: null, executionTime: 0 };
    }

    const builder = this.builderRegistry.get(dataType);
    if (!builder) {
      throw new Error(`No builder found for data type: ${dataType}`);
    }

    const builderStartTime = Date.now();
    
    try {
      // Apply timeout if specified
      let buildPromise = builder.build(resultDataSet);
      
      if (options.builderTimeout) {
        buildPromise = this.withTimeout(buildPromise, options.builderTimeout, dataType);
      }

      const result = await buildPromise;
      const builderEndTime = Date.now();
      const executionTime = builderEndTime - builderStartTime;

      this.statisticsCollector.recordBuilderExecution(dataType, executionTime);
      return { dataType, skipped: false, result, executionTime };

    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      const builderName = builder.constructor.name;
      
      if (options.continueOnError) {
        console.warn(`Builder ${builderName} failed for ${dataType}, continuing execution:`, cause.message);
        return { dataType, skipped: false, result: null, executionTime: 0 };
      } else {
        throw new BuilderExecutionError(builderName, dataType, cause);
      }
    }
  }

  /**
   * Add a timeout to a promise.
   * @param promise The promise to add timeout to
   * @param timeoutMs Timeout in milliseconds
   * @param dataType Data type for error messages
   * @returns Promise that rejects if timeout is exceeded
   * @private
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, dataType: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Builder for ${dataType} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);
  }
}

/**
 * Sequential execution strategy - executes builders one after another.
 */
export class SequentialExecutionStrategy extends ExecutionStrategy {
  getStrategyName(): string {
    return 'sequential';
  }

  async execute(context: ExecutionContext, plan: ExecutionPlan, options: ExecutionOptions = {}): Promise<ExecutionResult> {
    this.statisticsCollector.startExecution();
    this.statisticsCollector.setSequentialExecution();

    // Create result dataset starting with initial data
    const resultDataSet = this.cloneDataSet(context.initialData);

    // Execute builders in sequential order
    for (const dataType of plan.executionOrder) {
      const { result } = await this.executeBuilder(dataType, resultDataSet, options);
      
      if (result) {
        resultDataSet.add(result);
      }
    }

    const stats = this.statisticsCollector.stopExecution();

    return {
      dataSet: resultDataSet,
      executionOrder: plan.executionOrder,
      stats
    };
  }
}

/**
 * Parallel execution strategy - executes independent builders concurrently.
 */
export class ParallelExecutionStrategy extends ExecutionStrategy {
  getStrategyName(): string {
    return 'parallel';
  }

  async execute(context: ExecutionContext, plan: ExecutionPlan, options: ExecutionOptions = {}): Promise<ExecutionResult> {
    this.statisticsCollector.startExecution();
    this.statisticsCollector.setParallelExecutionInfo(
      plan.parallelExecutionLevels.length,
      plan.maxConcurrency
    );

    // Create result dataset starting with initial data
    const resultDataSet = this.cloneDataSet(context.initialData);

    // Execute builders level by level (parallel within each level)
    for (const level of plan.parallelExecutionLevels) {
      await this.executeLevel(level, resultDataSet, options);
    }

    const stats = this.statisticsCollector.stopExecution();

    return {
      dataSet: resultDataSet,
      executionOrder: plan.executionOrder,
      stats
    };
  }

  /**
   * Execute all builders in a parallel level concurrently.
   * @param level Array of data types to build in parallel
   * @param resultDataSet The dataset to use and update
   * @param options Execution options
   * @private
   */
  private async executeLevel(level: string[], resultDataSet: DataSetImpl, options: ExecutionOptions): Promise<void> {
    // Apply concurrency limit if specified
    const maxConcurrency = options.maxConcurrency || level.length;
    
    if (maxConcurrency >= level.length) {
      // Execute all builders in parallel
      await this.executeBatch(level, resultDataSet, options);
    } else {
      // Execute in batches with concurrency limit
      for (let i = 0; i < level.length; i += maxConcurrency) {
        const batch = level.slice(i, i + maxConcurrency);
        await this.executeBatch(batch, resultDataSet, options);
      }
    }
  }

  /**
   * Execute a batch of builders concurrently.
   * @param batch Array of data types to build concurrently
   * @param resultDataSet The dataset to use and update
   * @param options Execution options
   * @private
   */
  private async executeBatch(batch: string[], resultDataSet: DataSetImpl, options: ExecutionOptions): Promise<void> {
    const promises = batch.map(dataType => this.executeBuilder(dataType, resultDataSet, options));
    const results = await Promise.all(promises);

    // Add results to dataset
    for (const { result } of results) {
      if (result) {
        resultDataSet.add(result);
      }
    }
  }
}

/**
 * Factory for creating execution strategies.
 */
export class ExecutionStrategyFactory {
  /**
   * Create an execution strategy based on the strategy name.
   * @param strategyName Name of the strategy to create
   * @param builderRegistry Builder registry to use
   * @param statisticsCollector Statistics collector to use
   * @returns The created execution strategy
   */
  static createStrategy(
    strategyName: 'sequential' | 'parallel',
    builderRegistry: BuilderRegistry,
    statisticsCollector: ExecutionStatisticsCollector
  ): ExecutionStrategy {
    switch (strategyName) {
      case 'sequential':
        return new SequentialExecutionStrategy(builderRegistry, statisticsCollector);
      case 'parallel':
        return new ParallelExecutionStrategy(builderRegistry, statisticsCollector);
      default:
        throw new Error(`Unknown execution strategy: ${strategyName}`);
    }
  }

  /**
   * Get all available strategy names.
   * @returns Array of strategy names
   */
  static getAvailableStrategies(): string[] {
    return ['sequential', 'parallel'];
  }
}