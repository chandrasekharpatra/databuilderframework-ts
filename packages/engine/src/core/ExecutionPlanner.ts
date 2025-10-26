import { BuilderRegistry } from './BuilderRegistry';
import { DependencyGraph, DependencyNode } from './DependencyGraph';

/**
 * Error thrown when execution planning fails.
 */
export class ExecutionPlanningError extends Error {
	constructor(
		message: string,
		public readonly cause?: Error,
	) {
		super(message);
		this.name = 'ExecutionPlanningError';
	}
}

/**
 * Error thrown when circular dependencies are detected during planning.
 */
export class CircularDependencyError extends ExecutionPlanningError {
	constructor(cycles: string[]) {
		super(`Circular dependencies detected: ${cycles.join(', ')}`);
		this.name = 'CircularDependencyError';
	}
}

/**
 * Error thrown when required builders are missing during planning.
 */
export class MissingBuilderError extends ExecutionPlanningError {
	constructor(missingTypes: string[]) {
		super(`Missing builders for data types: ${missingTypes.join(', ')}`);
		this.name = 'MissingBuilderError';
	}
}

/**
 * Represents an execution plan for a data flow.
 */
export interface ExecutionPlan {
	/**
	 * Sequential execution order of builders.
	 */
	readonly executionOrder: string[];

	/**
	 * Parallel execution levels - each level can be executed concurrently.
	 */
	readonly parallelExecutionLevels: string[][];

	/**
	 * Data types that don't have registered builders.
	 */
	readonly missingBuilders: string[];

	/**
	 * Circular dependency cycles detected.
	 */
	readonly cycles: string[];

	/**
	 * Whether the plan is valid and can be executed.
	 */
	readonly isValid: boolean;

	/**
	 * Total number of builders that will be executed.
	 */
	readonly totalBuilders: number;

	/**
	 * Maximum concurrency level in parallel execution.
	 */
	readonly maxConcurrency: number;

	/**
	 * Dependency graph used for planning.
	 */
	readonly dependencyGraph: DependencyGraph;
}

/**
 * Planning and validation service for data flow execution.
 * Handles dependency analysis, execution order calculation, and validation.
 */
export class ExecutionPlanner {
	constructor(private readonly builderRegistry: BuilderRegistry) {}

	/**
	 * Create an execution plan for the given target data types.
	 * @param targetData The data types that need to be built
	 * @returns Complete execution plan with validation results
	 */
	createExecutionPlan(targetData: string[]): ExecutionPlan {
		// Build dependency graph
		const dependencyGraph = this.buildDependencyGraph();

		// Detect cycles
		const cycles = dependencyGraph.detectCycles();

		// Find missing dependencies
		const missingBuilders = dependencyGraph.findMissingDependencies(targetData);

		// Determine if plan is valid
		const isValid = cycles.length === 0 && missingBuilders.length === 0;

		let executionOrder: string[] = [];
		let parallelExecutionLevels: string[][] = [];
		let totalBuilders = 0;
		let maxConcurrency = 0;

		if (isValid) {
			// Get execution order
			const nodes = dependencyGraph.getExecutionOrder(targetData);
			executionOrder = nodes.map((node) => node.meta.provides);
			totalBuilders = nodes.length;

			// Calculate parallel execution levels
			parallelExecutionLevels = this.calculateParallelLevels(nodes);
			maxConcurrency = parallelExecutionLevels.length > 0 ? Math.max(...parallelExecutionLevels.map((level) => level.length)) : 0;
		}

		return {
			executionOrder,
			parallelExecutionLevels,
			missingBuilders,
			cycles,
			isValid,
			totalBuilders,
			maxConcurrency,
			dependencyGraph,
		};
	}

	/**
	 * Validate an execution plan and throw errors if invalid.
	 * @param plan The execution plan to validate
	 * @throws CircularDependencyError if cycles are detected
	 * @throws MissingBuilderError if required builders are missing
	 */
	validateExecutionPlan(plan: ExecutionPlan): void {
		if (plan.cycles.length > 0) {
			throw new CircularDependencyError(plan.cycles);
		}

		if (plan.missingBuilders.length > 0) {
			throw new MissingBuilderError(plan.missingBuilders);
		}
	}

	/**
	 * Get execution statistics for a plan without executing it.
	 * @param plan The execution plan to analyze
	 * @returns Statistical information about the plan
	 */
	getExecutionPlanStats(plan: ExecutionPlan): {
		sequentialEstimate: number;
		parallelLevels: number;
		averageConcurrency: number;
		dependencyDepth: number;
		complexityScore: number;
	} {
		if (!plan.isValid) {
			return {
				sequentialEstimate: 0,
				parallelLevels: 0,
				averageConcurrency: 0,
				dependencyDepth: 0,
				complexityScore: 0,
			};
		}

		const parallelLevels = plan.parallelExecutionLevels.length;
		const totalBuilders = plan.totalBuilders;
		const averageConcurrency = totalBuilders > 0 ? totalBuilders / parallelLevels : 0;
		const dependencyDepth = parallelLevels;

		// Complexity score: considers total builders, dependency depth, and concurrency variance
		const concurrencyVariance = this.calculateConcurrencyVariance(plan.parallelExecutionLevels);
		const complexityScore = totalBuilders * dependencyDepth * (1 + concurrencyVariance);

		return {
			sequentialEstimate: totalBuilders, // Assume 1 time unit per builder
			parallelLevels,
			averageConcurrency,
			dependencyDepth,
			complexityScore,
		};
	}

	/**
	 * Find optimal execution order considering dependencies and parallel opportunities.
	 * @param targetData The data types to build
	 * @returns Optimized execution plan
	 */
	optimizeExecutionPlan(targetData: string[]): ExecutionPlan {
		const basePlan = this.createExecutionPlan(targetData);

		if (!basePlan.isValid) {
			return basePlan;
		}

		// For now, return the base plan
		// Future optimizations could include:
		// - Reordering within levels to minimize resource usage
		// - Grouping related builders for cache locality
		// - Balancing load across parallel levels

		return basePlan;
	}

	/**
	 * Analyze dependencies for specific data types.
	 * @param targetData The data types to analyze
	 * @returns Dependency analysis results
	 */
	analyzeDependencies(targetData: string[]): {
		directDependencies: Map<string, string[]>;
		transitiveDependencies: Map<string, string[]>;
		dependencyTree: Map<string, Set<string>>;
		leafNodes: string[];
		rootNodes: string[];
	} {
		const graph = this.buildDependencyGraph();
		const directDependencies = new Map<string, string[]>();
		const transitiveDependencies = new Map<string, string[]>();
		const dependencyTree = new Map<string, Set<string>>();
		const leafNodes: string[] = [];
		const rootNodes: string[] = [];

		// Get all nodes involved in building target data
		const allNodes = graph.getExecutionOrder(targetData);

		for (const node of allNodes) {
			const dataType = node.meta.provides;

			// Direct dependencies
			const directDeps = Array.from(node.dependencies).map((dep) => dep.meta.provides);
			directDependencies.set(dataType, directDeps);

			// Build dependency tree
			const allDeps = new Set<string>();
			this.collectTransitiveDependencies(node, allDeps);
			dependencyTree.set(dataType, allDeps);
			transitiveDependencies.set(dataType, Array.from(allDeps));

			// Identify leaf and root nodes
			if (node.dependencies.size === 0) {
				rootNodes.push(dataType);
			}
			if (node.dependents.size === 0 && targetData.includes(dataType)) {
				leafNodes.push(dataType);
			}
		}

		return {
			directDependencies,
			transitiveDependencies,
			dependencyTree,
			leafNodes,
			rootNodes,
		};
	}

	/**
	 * Build a dependency graph from the current builder registry.
	 * @returns Constructed dependency graph
	 * @private
	 */
	private buildDependencyGraph(): DependencyGraph {
		const graph = new DependencyGraph();
		const metadata = this.builderRegistry.getAllMetadata();

		for (const meta of metadata) {
			graph.addBuilder(meta);
		}

		graph.buildGraph();
		return graph;
	}

	/**
	 * Calculate parallel execution levels from execution order.
	 * @param executionOrder Ordered list of dependency nodes
	 * @returns Array of parallel execution levels
	 * @private
	 */
	private calculateParallelLevels(executionOrder: DependencyNode[]): string[][] {
		const levels: string[][] = [];
		const processed = new Set<string>();
		const remaining = new Set(executionOrder.map((node) => node.meta.provides));

		while (remaining.size > 0) {
			const currentLevel: string[] = [];

			// Find all nodes that can be executed in this level
			for (const node of executionOrder) {
				if (processed.has(node.meta.provides)) {
					continue;
				}

				// Check if all dependencies are already processed
				const allDepsProcessed = Array.from(node.dependencies).every((dep) => processed.has(dep.meta.provides));

				if (allDepsProcessed) {
					currentLevel.push(node.meta.provides);
				}
			}

			// If no nodes can be processed, we have a problem
			if (currentLevel.length === 0) {
				break;
			}

			// Mark these nodes as processed
			for (const dataType of currentLevel) {
				processed.add(dataType);
				remaining.delete(dataType);
			}

			levels.push(currentLevel);
		}

		return levels;
	}

	/**
	 * Calculate variance in concurrency across parallel levels.
	 * @param parallelLevels Array of parallel execution levels
	 * @returns Concurrency variance (0 = uniform, higher = more variance)
	 * @private
	 */
	private calculateConcurrencyVariance(parallelLevels: string[][]): number {
		if (parallelLevels.length <= 1) {
			return 0;
		}

		const concurrencies = parallelLevels.map((level) => level.length);
		const mean = concurrencies.reduce((sum, c) => sum + c, 0) / concurrencies.length;
		const variance = concurrencies.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / concurrencies.length;

		return Math.sqrt(variance) / mean; // Coefficient of variation
	}

	/**
	 * Recursively collect all transitive dependencies for a node.
	 * @param node The node to collect dependencies for
	 * @param collected Set to store collected dependencies
	 * @private
	 */
	private collectTransitiveDependencies(node: DependencyNode, collected: Set<string>): void {
		for (const dep of node.dependencies) {
			if (!collected.has(dep.meta.provides)) {
				collected.add(dep.meta.provides);
				this.collectTransitiveDependencies(dep, collected);
			}
		}
	}
}
