import { describe, test, expect, beforeEach } from 'vitest';
import { DependencyGraph, DependencyNode } from '../src/core/DependencyGraph.js';
import { DataBuilderMeta } from '../src/types/index.js';

describe('DependencyGraph', () => {
  let graph: DependencyGraph;

  beforeEach(() => {
    graph = new DependencyGraph();
  });

  // Helper function to create builder metadata
  const createMeta = (name: string, provides: string, consumes: string[] = []): DataBuilderMeta => ({
    name,
    provides,
    consumes
  });

  describe('Basic Node Operations', () => {
    test('should start empty', () => {
      expect(graph.size()).toBe(0);
      expect(graph.isEmpty()).toBe(true);
    });

    test('should add builders correctly', () => {
      graph.addBuilder(createMeta('UserBuilder', 'user', []));
      graph.addBuilder(createMeta('ProfileBuilder', 'profile', ['user']));
      
      expect(graph.size()).toBe(2);
      expect(graph.isEmpty()).toBe(false);
      expect(graph.getNode('user')).toBeDefined();
      expect(graph.getNode('profile')).toBeDefined();
    });

    test('should get node information', () => {
      graph.addBuilder(createMeta('UserBuilder', 'user', []));
      graph.addBuilder(createMeta('ProfileBuilder', 'profile', ['user']));
      
      const userNode = graph.getNode('user');
      const profileNode = graph.getNode('profile');
      
      expect(userNode?.meta.provides).toBe('user');
      expect(userNode?.meta.consumes).toEqual([]);
      
      expect(profileNode?.meta.provides).toBe('profile');
      expect(profileNode?.meta.consumes).toEqual(['user']);
    });

    test('should return undefined for non-existent node', () => {
      const node = graph.getNode('nonexistent');
      expect(node).toBeUndefined();
    });

    test('should not overwrite existing builder when added again', () => {
      const userMeta1 = createMeta('UserBuilder1', 'user', []);
      const userMeta2 = createMeta('UserBuilder2', 'user', ['profile']);
      
      graph.addBuilder(userMeta1);
      graph.addBuilder(userMeta2); // Should not overwrite
      
      const userNode = graph.getNode('user');
      expect(userNode?.meta.name).toBe('UserBuilder1'); // Should keep original
      expect(graph.size()).toBe(1); // Size should remain 1
    });
  });

  describe('Building Dependencies', () => {
    test('should build dependencies between nodes', () => {
      graph.addBuilder(createMeta('UserBuilder', 'user', []));
      graph.addBuilder(createMeta('ProfileBuilder', 'profile', ['user']));
      graph.buildGraph();
      
      const userNode = graph.getNode('user');
      const profileNode = graph.getNode('profile');
      
      expect(profileNode?.dependencies.has(userNode!)).toBe(true);
      expect(userNode?.dependents.has(profileNode!)).toBe(true);
    });

    test('should handle multiple dependencies', () => {
      graph.addBuilder(createMeta('UserBuilder', 'user', []));
      graph.addBuilder(createMeta('SettingsBuilder', 'settings', []));
      graph.addBuilder(createMeta('DashboardBuilder', 'dashboard', ['user', 'settings']));
      graph.buildGraph();
      
      const userNode = graph.getNode('user');
      const settingsNode = graph.getNode('settings');
      const dashboardNode = graph.getNode('dashboard');
      
      expect(dashboardNode?.dependencies.has(userNode!)).toBe(true);
      expect(dashboardNode?.dependencies.has(settingsNode!)).toBe(true);
      expect(dashboardNode?.dependencies.size).toBe(2);
    });

    test('should get all nodes', () => {
      graph.addBuilder(createMeta('UserBuilder', 'user', []));
      graph.addBuilder(createMeta('ProfileBuilder', 'profile', ['user']));
      graph.addBuilder(createMeta('SettingsBuilder', 'settings', ['user']));
      
      const allNodes = graph.getAllNodes();
      expect(allNodes.length).toBe(3);
      
      const dataTypes = allNodes.map(node => node.meta.provides);
      expect(dataTypes).toContain('user');
      expect(dataTypes).toContain('profile');
      expect(dataTypes).toContain('settings');
    });
  });

  describe('Execution Order', () => {
    test('should calculate execution order for single node', () => {
      graph.addBuilder(createMeta('UserBuilder', 'user', []));
      graph.buildGraph();
      
      const order = graph.getExecutionOrder(['user']);
      expect(order).toHaveLength(1);
      expect(order[0]!.meta.provides).toBe('user');
    });

    test('should calculate execution order for simple dependency chain', () => {
      graph.addBuilder(createMeta('UserBuilder', 'user', []));
      graph.addBuilder(createMeta('ProfileBuilder', 'profile', ['user']));
      graph.addBuilder(createMeta('SettingsBuilder', 'settings', ['profile']));
      graph.buildGraph();
      
      const order = graph.getExecutionOrder(['settings']);
      const orderTypes = order.map(node => node.meta.provides);
      expect(orderTypes).toEqual(['user', 'profile', 'settings']);
    });

    test('should calculate execution order for multiple independent nodes', () => {
      graph.addBuilder(createMeta('UserBuilder', 'user', []));
      graph.addBuilder(createMeta('ProfileBuilder', 'profile', []));
      graph.addBuilder(createMeta('SettingsBuilder', 'settings', []));
      graph.buildGraph();
      
      const order = graph.getExecutionOrder(['user', 'profile', 'settings']);
      const orderTypes = order.map(node => node.meta.provides);
      
      // Order should contain all three, but exact order doesn't matter for independent nodes
      expect(orderTypes).toHaveLength(3);
      expect(orderTypes).toContain('user');
      expect(orderTypes).toContain('profile');
      expect(orderTypes).toContain('settings');
    });

    test('should calculate execution order for diamond dependency', () => {
      /*
       * Diamond dependency:
       *     user
       *    /    \
       * profile  settings
       *    \    /
       *   dashboard
       */
      graph.addBuilder(createMeta('UserBuilder', 'user', []));
      graph.addBuilder(createMeta('ProfileBuilder', 'profile', ['user']));
      graph.addBuilder(createMeta('SettingsBuilder', 'settings', ['user']));
      graph.addBuilder(createMeta('DashboardBuilder', 'dashboard', ['profile', 'settings']));
      graph.buildGraph();
      
      const order = graph.getExecutionOrder(['dashboard']);
      const orderTypes = order.map(node => node.meta.provides);
      
      expect(orderTypes).toHaveLength(4);
      expect(orderTypes.indexOf('user')).toBe(0); // user should be first
      expect(orderTypes.indexOf('dashboard')).toBe(3); // dashboard should be last
      
      // profile and settings should be after user but before dashboard
      expect(orderTypes.indexOf('profile')).toBeGreaterThan(orderTypes.indexOf('user'));
      expect(orderTypes.indexOf('settings')).toBeGreaterThan(orderTypes.indexOf('user'));
      expect(orderTypes.indexOf('profile')).toBeLessThan(orderTypes.indexOf('dashboard'));
      expect(orderTypes.indexOf('settings')).toBeLessThan(orderTypes.indexOf('dashboard'));
    });

    test('should handle duplicate target types in execution order', () => {
      graph.addBuilder(createMeta('UserBuilder', 'user', []));
      graph.addBuilder(createMeta('ProfileBuilder', 'profile', ['user']));
      graph.buildGraph();
      
      const order = graph.getExecutionOrder(['user', 'profile', 'user']);
      const orderTypes = order.map(node => node.meta.provides);
      
      // Should not contain duplicates
      expect(orderTypes).toEqual(['user', 'profile']);
    });

    test('should handle empty target list', () => {
      graph.addBuilder(createMeta('UserBuilder', 'user', []));
      graph.buildGraph();
      
      const order = graph.getExecutionOrder([]);
      expect(order).toEqual([]);
    });
  });

  describe('Cycle Detection', () => {
    test('should detect simple cycle', () => {
      graph.addBuilder(createMeta('ABuilder', 'a', ['b']));
      graph.addBuilder(createMeta('BBuilder', 'b', ['a']));
      graph.buildGraph();
      
      const cycles = graph.detectCycles();
      expect(cycles.length).toBeGreaterThan(0);
      expect(cycles[0]).toContain('Cycle detected');
    });

    test('should detect cycle in longer chain', () => {
      graph.addBuilder(createMeta('ABuilder', 'a', ['b']));
      graph.addBuilder(createMeta('BBuilder', 'b', ['c']));
      graph.addBuilder(createMeta('CBuilder', 'c', ['a'])); // Creates cycle: a -> b -> c -> a
      graph.buildGraph();
      
      const cycles = graph.detectCycles();
      expect(cycles.length).toBeGreaterThan(0);
      expect(cycles[0]).toContain('Cycle detected');
    });

    test('should detect self-dependency', () => {
      graph.addBuilder(createMeta('ABuilder', 'a', ['a'])); // Self dependency
      graph.buildGraph();
      
      const cycles = graph.detectCycles();
      expect(cycles.length).toBeGreaterThan(0);
      expect(cycles[0]).toContain('Cycle detected');
    });

    test('should allow valid graphs without cycles', () => {
      graph.addBuilder(createMeta('ABuilder', 'a', []));
      graph.addBuilder(createMeta('BBuilder', 'b', ['a']));
      graph.addBuilder(createMeta('CBuilder', 'c', ['a']));
      graph.addBuilder(createMeta('DBuilder', 'd', ['b', 'c']));
      graph.buildGraph();
      
      const cycles = graph.detectCycles();
      expect(cycles).toEqual([]);
    });
  });

  describe('Missing Dependencies', () => {
    test('should find missing dependencies', () => {
      graph.addBuilder(createMeta('ProfileBuilder', 'profile', ['user'])); // user dependency not added
      graph.buildGraph();
      
      const missing = graph.findMissingDependencies(['profile']);
      expect(missing).toEqual(['user']);
    });

    test('should return empty array when all dependencies exist', () => {
      graph.addBuilder(createMeta('UserBuilder', 'user', []));
      graph.addBuilder(createMeta('ProfileBuilder', 'profile', ['user']));
      graph.buildGraph();
      
      const missing = graph.findMissingDependencies(['profile']);
      expect(missing).toEqual([]);
    });

    test('should find missing target types', () => {
      graph.addBuilder(createMeta('UserBuilder', 'user', []));
      graph.buildGraph();
      
      const missing = graph.findMissingDependencies(['nonexistent']);
      expect(missing).toEqual(['nonexistent']);
    });

    test('should find nested missing dependencies', () => {
      graph.addBuilder(createMeta('DashboardBuilder', 'dashboard', ['profile']));
      graph.addBuilder(createMeta('ProfileBuilder', 'profile', ['user'])); // user is missing
      graph.buildGraph();
      
      const missing = graph.findMissingDependencies(['dashboard']);
      expect(missing).toEqual(['user']);
    });
  });

  describe('Node Operations', () => {
    test('should remove builders correctly', () => {
      graph.addBuilder(createMeta('UserBuilder', 'user', []));
      graph.addBuilder(createMeta('ProfileBuilder', 'profile', ['user']));
      graph.buildGraph();
      
      expect(graph.size()).toBe(2);
      
      const removed = graph.removeBuilder('user');
      
      expect(removed).toBe(true);
      expect(graph.size()).toBe(1);
      expect(graph.getNode('user')).toBeUndefined();
      expect(graph.getNode('profile')).toBeDefined();
    });

    test('should return false when removing non-existent builder', () => {
      const removed = graph.removeBuilder('nonexistent');
      expect(removed).toBe(false);
    });

    test('should clear all builders', () => {
      graph.addBuilder(createMeta('UserBuilder', 'user', []));
      graph.addBuilder(createMeta('ProfileBuilder', 'profile', ['user']));
      expect(graph.size()).toBe(2);
      
      graph.clear();
      
      expect(graph.size()).toBe(0);
      expect(graph.isEmpty()).toBe(true);
      expect(graph.getNode('user')).toBeUndefined();
      expect(graph.getNode('profile')).toBeUndefined();
    });
  });

  describe('toString and Debugging', () => {
    test('should provide meaningful string representation', () => {
      // Empty graph
      expect(graph.toString()).toBe('DependencyGraph(0 nodes, 0 edges)');
      
      // Single node
      graph.addBuilder(createMeta('UserBuilder', 'user', []));
      graph.buildGraph();
      expect(graph.toString()).toBe('DependencyGraph(1 nodes, 0 edges)');
      
      // Multiple nodes with dependencies
      graph.addBuilder(createMeta('ProfileBuilder', 'profile', ['user']));
      graph.buildGraph();
      expect(graph.toString()).toBe('DependencyGraph(2 nodes, 1 edges)');
    });
  });
});

describe('DependencyNode', () => {
  const createMeta = (name: string, provides: string, consumes: string[] = []): DataBuilderMeta => ({
    name,
    provides,
    consumes
  });

  test('should create node with correct properties', () => {
    const meta = createMeta('TestBuilder', 'test', ['dep1', 'dep2']);
    const node = new DependencyNode(meta);
    
    expect(node.meta).toBe(meta);
    expect(node.meta.provides).toBe('test');
    expect(node.meta.consumes).toEqual(['dep1', 'dep2']);
    expect(node.dependencies.size).toBe(0);
    expect(node.dependents.size).toBe(0);
  });

  test('should handle dependency relationships', () => {
    const userMeta = createMeta('UserBuilder', 'user', []);
    const profileMeta = createMeta('ProfileBuilder', 'profile', ['user']);
    
    const userNode = new DependencyNode(userMeta);
    const profileNode = new DependencyNode(profileMeta);
    
    profileNode.addDependency(userNode);
    
    expect(profileNode.dependencies.has(userNode)).toBe(true);
    expect(userNode.dependents.has(profileNode)).toBe(true);
    expect(profileNode.hasDependencies()).toBe(true);
    expect(userNode.hasDependents()).toBe(true);
  });

  test('should remove dependency relationships', () => {
    const userMeta = createMeta('UserBuilder', 'user', []);
    const profileMeta = createMeta('ProfileBuilder', 'profile', ['user']);
    
    const userNode = new DependencyNode(userMeta);
    const profileNode = new DependencyNode(profileMeta);
    
    profileNode.addDependency(userNode);
    profileNode.removeDependency(userNode);
    
    expect(profileNode.dependencies.has(userNode)).toBe(false);
    expect(userNode.dependents.has(profileNode)).toBe(false);
    expect(profileNode.hasDependencies()).toBe(false);
    expect(userNode.hasDependents()).toBe(false);
  });

  test('should provide meaningful string representation', () => {
    const meta = createMeta('TestBuilder', 'test', []);
    const node = new DependencyNode(meta);
    
    expect(node.toString()).toBe('DependencyNode(test)');
  });
});