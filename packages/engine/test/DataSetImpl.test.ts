import { describe, test, expect, beforeEach } from 'vitest';
import { DataSetImpl } from '../src/core/DataSetImpl.js';
import { Data } from '../src/types/index.js';

// Test data interfaces
interface User extends Data {
  readonly type: 'user';
  id: number;
  name: string;
  email: string;
}

interface Product extends Data {
  readonly type: 'product';
  id: number;
  title: string;
  price: number;
}

describe('DataSetImpl', () => {
  let dataSet: DataSetImpl;

  beforeEach(() => {
    dataSet = new DataSetImpl();
  });

  describe('Basic Operations', () => {
    test('should start empty', () => {
      expect(dataSet.size()).toBe(0);
      expect(dataSet.isEmpty()).toBe(true);
    });

    test('should add data successfully', () => {
      const user: User = { type: 'user', id: 1, name: 'John Doe', email: 'john@example.com' };
      
      dataSet.add(user);
      
      expect(dataSet.size()).toBe(1);
      expect(dataSet.isEmpty()).toBe(false);
    });

    test('should retrieve data using accessor', () => {
      const user: User = { type: 'user', id: 1, name: 'John Doe', email: 'john@example.com' };
      
      dataSet.add(user);
      const retrievedUser = dataSet.accessor<User>('user');
      
      expect(retrievedUser).toEqual(user);
      expect(retrievedUser?.name).toBe('John Doe');
    });

    test('should return undefined when accessing non-existent data', () => {
      const retrievedUser = dataSet.accessor<User>('nonexistent');
      expect(retrievedUser).toBeUndefined();
    });

    test('should check if data exists', () => {
      const user: User = { type: 'user', id: 1, name: 'John Doe', email: 'john@example.com' };
      
      expect(dataSet.contains('user')).toBe(false);
      
      dataSet.add(user);
      
      expect(dataSet.contains('user')).toBe(true);
      expect(dataSet.contains('nonexistent')).toBe(false);
    });
  });

  describe('Multiple Data Types', () => {
    test('should handle multiple different data types', () => {
      const user: User = { type: 'user', id: 1, name: 'John Doe', email: 'john@example.com' };
      const product: Product = { type: 'product', id: 101, title: 'Laptop', price: 999.99 };
      
      dataSet.add(user);
      dataSet.add(product);
      
      expect(dataSet.size()).toBe(2);
      expect(dataSet.accessor<User>('user')).toEqual(user);
      expect(dataSet.accessor<Product>('product')).toEqual(product);
    });

    test('should overwrite existing data with same type', () => {
      const user1: User = { type: 'user', id: 1, name: 'John Doe', email: 'john@example.com' };
      const user2: User = { type: 'user', id: 2, name: 'Jane Smith', email: 'jane@example.com' };
      
      dataSet.add(user1);
      expect(dataSet.accessor<User>('user')?.name).toBe('John Doe');
      
      dataSet.add(user2);
      expect(dataSet.accessor<User>('user')?.name).toBe('Jane Smith');
      expect(dataSet.size()).toBe(1); // Size should remain 1
    });
  });

  describe('Cloning', () => {
    test('should create deep clone of dataset', () => {
      const user: User = { type: 'user', id: 1, name: 'John Doe', email: 'john@example.com' };
      const product: Product = { type: 'product', id: 101, title: 'Laptop', price: 999.99 };
      
      dataSet.add(user);
      dataSet.add(product);
      
      const clonedDataSet = dataSet.clone();
      
      // Verify clone has same data
      expect(clonedDataSet.size()).toBe(2);
      expect(clonedDataSet.accessor<User>('user')).toEqual(user);
      expect(clonedDataSet.accessor<Product>('product')).toEqual(product);
      
      // Verify it's a separate instance
      expect(clonedDataSet).not.toBe(dataSet);
      
      // Verify modifications to clone don't affect original
      const newUser: User = { type: 'user', id: 3, name: 'Bob Wilson', email: 'bob@example.com' };
      clonedDataSet.add(newUser);
      
      expect(dataSet.accessor<User>('user')?.name).toBe('John Doe');
      expect(clonedDataSet.accessor<User>('user')?.name).toBe('Bob Wilson');
    });

    test('should clone empty dataset', () => {
      const clonedDataSet = dataSet.clone();
      
      expect(clonedDataSet.size()).toBe(0);
      expect(clonedDataSet.isEmpty()).toBe(true);
      expect(clonedDataSet).not.toBe(dataSet);
    });
  });

  describe('Merging', () => {
    test('should merge datasets correctly', () => {
      const user: User = { type: 'user', id: 1, name: 'John Doe', email: 'john@example.com' };
      const product: Product = { type: 'product', id: 101, title: 'Laptop', price: 999.99 };
      
      dataSet.add(user);
      
      const otherDataSet = new DataSetImpl();
      otherDataSet.add(product);
      
      dataSet.merge(otherDataSet);
      
      expect(dataSet.size()).toBe(2);
      expect(dataSet.accessor<User>('user')).toEqual(user);
      expect(dataSet.accessor<Product>('product')).toEqual(product);
    });

    test('should merge with overlapping keys (other dataset wins)', () => {
      const user1: User = { type: 'user', id: 1, name: 'John Doe', email: 'john@example.com' };
      const user2: User = { type: 'user', id: 2, name: 'Jane Smith', email: 'jane@example.com' };
      
      dataSet.add(user1);
      
      const otherDataSet = new DataSetImpl();
      otherDataSet.add(user2);
      
      dataSet.merge(otherDataSet);
      
      expect(dataSet.size()).toBe(1);
      expect(dataSet.accessor<User>('user')).toEqual(user2); // Other dataset's value wins
    });

    test('should merge empty dataset', () => {
      const user: User = { type: 'user', id: 1, name: 'John Doe', email: 'john@example.com' };
      dataSet.add(user);
      
      const emptyDataSet = new DataSetImpl();
      dataSet.merge(emptyDataSet);
      
      expect(dataSet.size()).toBe(1);
      expect(dataSet.accessor<User>('user')).toEqual(user);
    });

    test('should merge into empty dataset', () => {
      const user: User = { type: 'user', id: 1, name: 'John Doe', email: 'john@example.com' };
      
      const otherDataSet = new DataSetImpl();
      otherDataSet.add(user);
      
      dataSet.merge(otherDataSet);
      
      expect(dataSet.size()).toBe(1);
      expect(dataSet.accessor<User>('user')).toEqual(user);
    });
  });

  describe('Additional Methods', () => {
    test('should remove data correctly', () => {
      const user: User = { type: 'user', id: 1, name: 'John Doe', email: 'john@example.com' };
      
      dataSet.add(user);
      expect(dataSet.size()).toBe(1);
      
      const removed = dataSet.remove('user');
      expect(removed).toBe(true);
      expect(dataSet.size()).toBe(0);
      expect(dataSet.contains('user')).toBe(false);
    });

    test('should return false when removing non-existent data', () => {
      const removed = dataSet.remove('nonexistent');
      expect(removed).toBe(false);
    });

    test('should clear all data', () => {
      const user: User = { type: 'user', id: 1, name: 'John Doe', email: 'john@example.com' };
      const product: Product = { type: 'product', id: 101, title: 'Laptop', price: 999.99 };
      
      dataSet.add(user);
      dataSet.add(product);
      expect(dataSet.size()).toBe(2);
      
      dataSet.clear();
      expect(dataSet.size()).toBe(0);
      expect(dataSet.isEmpty()).toBe(true);
    });

    test('should get all data types', () => {
      const user: User = { type: 'user', id: 1, name: 'John Doe', email: 'john@example.com' };
      const product: Product = { type: 'product', id: 101, title: 'Laptop', price: 999.99 };
      
      dataSet.add(user);
      dataSet.add(product);
      
      const dataTypes = dataSet.getDataTypes();
      expect(dataTypes).toContain('user');
      expect(dataTypes).toContain('product');
      expect(dataTypes.length).toBe(2);
    });

    test('should get all data as map', () => {
      const user: User = { type: 'user', id: 1, name: 'John Doe', email: 'john@example.com' };
      const product: Product = { type: 'product', id: 101, title: 'Laptop', price: 999.99 };
      
      dataSet.add(user);
      dataSet.add(product);
      
      const allData = dataSet.getAll();
      expect(allData.size).toBe(2);
      expect(allData.get('user')).toEqual(user);
      expect(allData.get('product')).toEqual(product);
      
      // Verify it's a copy, not reference
      expect(allData).not.toBe(dataSet.getAll());
    });
  });

  describe('Edge Cases', () => {
    test('should handle data with complex properties', () => {
      interface ComplexData extends Data {
        readonly type: 'complex';
        nested: {
          array: number[];
          object: { key: string };
        };
      }
      
      const complexData: ComplexData = {
        type: 'complex',
        nested: {
          array: [1, 2, 3],
          object: { key: 'value' }
        }
      };
      
      dataSet.add(complexData);
      const retrieved = dataSet.accessor<ComplexData>('complex');
      
      expect(retrieved?.nested.array).toEqual([1, 2, 3]);
      expect(retrieved?.nested.object.key).toBe('value');
    });

    test('should handle special characters in type names', () => {
      interface SpecialData extends Data {
        readonly type: 'user@#$%^&*()_+-=[]{}|;:,.<>?';
        value: string;
      }
      
      const specialData: SpecialData = {
        type: 'user@#$%^&*()_+-=[]{}|;:,.<>?',
        value: 'test'
      };
      
      dataSet.add(specialData);
      expect(dataSet.accessor<SpecialData>('user@#$%^&*()_+-=[]{}|;:,.<>?')).toEqual(specialData);
    });
  });

  describe('Type Safety', () => {
    test('should maintain type safety with generic accessor', () => {
      const user: User = { type: 'user', id: 1, name: 'John Doe', email: 'john@example.com' };
      const product: Product = { type: 'product', id: 101, title: 'Laptop', price: 999.99 };
      
      dataSet.add(user);
      dataSet.add(product);
      
      // TypeScript should infer correct types
      const retrievedUser = dataSet.accessor<User>('user');
      const retrievedProduct = dataSet.accessor<Product>('product');
      
      expect(typeof retrievedUser?.name).toBe('string');
      expect(typeof retrievedUser?.id).toBe('number');
      expect(typeof retrievedProduct?.price).toBe('number');
      expect(typeof retrievedProduct?.title).toBe('string');
    });
  });

  describe('toString', () => {
    test('should provide meaningful string representation', () => {
      const user: User = { type: 'user', id: 1, name: 'John Doe', email: 'john@example.com' };
      const product: Product = { type: 'product', id: 101, title: 'Laptop', price: 999.99 };
      
      // Empty dataset
      expect(dataSet.toString()).toBe('DataSet(0 items: [])');
      
      // Single item
      dataSet.add(user);
      expect(dataSet.toString()).toBe('DataSet(1 items: [user])');
      
      // Multiple items
      dataSet.add(product);
      const str = dataSet.toString();
      expect(str).toContain('DataSet(2 items:');
      expect(str).toContain('user');
      expect(str).toContain('product');
    });
  });
});