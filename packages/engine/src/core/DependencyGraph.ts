import { DataBuilderMeta } from '../types/index.js';

/**
 * Represents a node in the dependency graph.
 * Each node corresponds to a data builder and tracks its dependencies and dependents.
 */
export class DependencyNode {
	/**
	 * Set of nodes that this node depends on (must be executed before this node).
	 */
	public readonly dependencies: Set<DependencyNode> = new Set();

	/**
	 * Set of nodes that depend on this node (must be executed after this node).
	 */
	public readonly dependents: Set<DependencyNode> = new Set();

	constructor(public readonly meta: DataBuilderMeta) {}

	/**
	 * Add a dependency to this node.
	 * @param dependency The node that this node depends on
	 */
	addDependency(dependency: DependencyNode): void {
		this.dependencies.add(dependency);
		dependency.dependents.add(this);
	}

	/**
	 * Remove a dependency from this node.
	 * @param dependency The node to remove as a dependency
	 */
	removeDependency(dependency: DependencyNode): void {
		this.dependencies.delete(dependency);
		dependency.dependents.delete(this);
	}

	/**
	 * Check if this node has any dependencies.
	 * @returns true if this node has dependencies, false otherwise
	 */
	hasDependencies(): boolean {
		return this.dependencies.size > 0;
	}

	/**
	 * Check if this node has any dependents.
	 * @returns true if other nodes depend on this node, false otherwise
	 */
	hasDependents(): boolean {
		return this.dependents.size > 0;
	}

	/**
	 * Get a string representation of this node for debugging.
	 * @returns String representation of the node
	 */
	toString(): string {
		return `DependencyNode(${this.meta.provides})`;
	}
}

/**
 * Manages the dependency graph for data builders.
 * Provides functionality to build the graph, detect cycles, and determine execution order.
 */
export class DependencyGraph {
	private nodes: Map<string, DependencyNode> = new Map();

	/**
	 * Add a builder to the dependency graph.
	 * @param meta Metadata about the builder to add
	 */
	addBuilder(meta: DataBuilderMeta): void {
		if (!this.nodes.has(meta.provides)) {
			this.nodes.set(meta.provides, new DependencyNode(meta));
		}
	}

	/**
	 * Remove a builder from the dependency graph.
	 * @param dataType The data type produced by the builder to remove
	 * @returns true if the builder was removed, false if it didn't exist
	 */
	removeBuilder(dataType: string): boolean {
		const node = this.nodes.get(dataType);
		if (!node) {
			return false;
		}

		// Remove all dependencies and dependents
		for (const dependency of node.dependencies) {
			node.removeDependency(dependency);
		}

		// We need to create a copy of dependents since we're modifying the set
		const dependents = Array.from(node.dependents);
		for (const dependent of dependents) {
			dependent.removeDependency(node);
		}

		return this.nodes.delete(dataType);
	}

	/**
	 * Build the dependency relationships between nodes.
	 * Must be called after adding all builders and before using the graph.
	 */
	buildGraph(): void {
		// Clear existing dependencies
		for (const node of this.nodes.values()) {
			node.dependencies.clear();
			node.dependents.clear();
		}

		// Build new dependencies
		for (const node of this.nodes.values()) {
			for (const consumedType of node.meta.consumes) {
				const dependency = this.nodes.get(consumedType);
				if (dependency) {
					node.addDependency(dependency);
				}
			}
		}
	}

	/**
	 * Get the execution order for building specific target data types.
	 * Uses topological sorting to ensure dependencies are built before dependents.
	 * @param targetTypes The data types that need to be built
	 * @returns Array of nodes in the order they should be executed
	 */
	getExecutionOrder(targetTypes: string[]): DependencyNode[] {
		const visited = new Set<DependencyNode>();
		const result: DependencyNode[] = [];

		const visit = (node: DependencyNode) => {
			if (visited.has(node)) {
				return;
			}
			visited.add(node);

			// Visit all dependencies first (depth-first)
			for (const dependency of node.dependencies) {
				visit(dependency);
			}

			result.push(node);
		};

		// Visit nodes for each target type
		for (const targetType of targetTypes) {
			const node = this.nodes.get(targetType);
			if (node) {
				visit(node);
			}
		}

		return result;
	}

	/**
	 * Detect circular dependencies in the graph.
	 * @returns Array of strings describing any cycles found
	 */
	detectCycles(): string[] {
		const visited = new Set<string>();
		const recursionStack = new Set<string>();
		const cycles: string[] = [];

		const dfs = (nodeKey: string, path: string[]): boolean => {
			if (recursionStack.has(nodeKey)) {
				cycles.push(`Cycle detected: ${path.join(' -> ')} -> ${nodeKey}`);
				return true;
			}

			if (visited.has(nodeKey)) {
				return false;
			}

			visited.add(nodeKey);
			recursionStack.add(nodeKey);

			const node = this.nodes.get(nodeKey);
			if (node) {
				for (const dep of node.dependencies) {
					if (dfs(dep.meta.provides, [...path, nodeKey])) {
						return true;
					}
				}
			}

			recursionStack.delete(nodeKey);
			return false;
		};

		for (const nodeKey of this.nodes.keys()) {
			if (!visited.has(nodeKey)) {
				dfs(nodeKey, []);
			}
		}

		return cycles;
	}

	/**
	 * Check if all required dependencies are available for the given target types.
	 * @param targetTypes The data types that need to be built
	 * @returns Array of missing data types
	 */
	findMissingDependencies(targetTypes: string[]): string[] {
		const visited = new Set<string>();
		const missing: Set<string> = new Set();

		const checkDependencies = (nodeKey: string) => {
			if (visited.has(nodeKey)) {
				return;
			}
			visited.add(nodeKey);

			const node = this.nodes.get(nodeKey);
			if (!node) {
				missing.add(nodeKey);
				return;
			}

			for (const consumedType of node.meta.consumes) {
				checkDependencies(consumedType);
			}
		};

		for (const targetType of targetTypes) {
			checkDependencies(targetType);
		}

		return Array.from(missing);
	}

	/**
	 * Get a node by its data type.
	 * @param dataType The data type to look up
	 * @returns The node if found, undefined otherwise
	 */
	getNode(dataType: string): DependencyNode | undefined {
		return this.nodes.get(dataType);
	}

	/**
	 * Get all nodes in the graph.
	 * @returns Array of all nodes
	 */
	getAllNodes(): DependencyNode[] {
		return Array.from(this.nodes.values());
	}

	/**
	 * Get the number of nodes in the graph.
	 * @returns The number of nodes
	 */
	size(): number {
		return this.nodes.size;
	}

	/**
	 * Check if the graph is empty.
	 * @returns true if the graph has no nodes, false otherwise
	 */
	isEmpty(): boolean {
		return this.nodes.size === 0;
	}

	/**
	 * Clear all nodes from the graph.
	 */
	clear(): void {
		this.nodes.clear();
	}

	/**
	 * Get a string representation of the graph for debugging.
	 * @returns String describing the graph structure
	 */
	toString(): string {
		const nodeCount = this.size();
		const edgeCount = Array.from(this.nodes.values()).reduce((total, node) => total + node.dependencies.size, 0);

		return `DependencyGraph(${nodeCount} nodes, ${edgeCount} edges)`;
	}
}
