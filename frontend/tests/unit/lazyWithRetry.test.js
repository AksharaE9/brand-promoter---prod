import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Host the mock at the very top so it hoists cleanly.
// We write to global.__lastLoader so tests can inspect the loader function passed to React.lazy.
vi.mock('react', async () => {
  const actual = await vi.importActual('react');
  return {
    ...actual,
    lazy: (loader) => {
      global.__lastLoader = loader;
      return { $$typeof: Symbol.for('react.lazy'), _loader: loader };
    }
  };
});

// Import lazyWithRetry after react is mocked
import { lazyWithRetry } from '../../src/lib/lazyWithRetry';

describe('lazyWithRetry', () => {
  beforeEach(() => {
    global.__lastLoader = undefined;

    // Mock sessionStorage
    const store = {};
    vi.stubGlobal('sessionStorage', {
      getItem: (key) => store[key] || null,
      setItem: (key, val) => { store[key] = String(val); },
      removeItem: (key) => { delete store[key]; },
      clear: () => { for (const k in store) delete store[k]; }
    });

    // Mock window and window.location.reload
    const mockReload = vi.fn();
    const mockWindow = {
      location: {
        reload: mockReload,
        pathname: '/test-route',
        search: ''
      }
    };
    vi.stubGlobal('window', mockWindow);
    vi.stubGlobal('location', mockWindow.location);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('should successfully load the component and clear sessionStorage key', async () => {
    const mockComponent = { default: () => 'Hello Component' };
    const importFn = vi.fn().mockResolvedValue(mockComponent);

    sessionStorage.setItem('chunk-retry-TestComponent', 'true');

    lazyWithRetry(importFn, 'TestComponent');

    const loaderFn = global.__lastLoader;
    expect(loaderFn).toBeDefined();

    const result = await loaderFn();

    expect(importFn).toHaveBeenCalledTimes(1);
    expect(result).toBe(mockComponent);
    expect(sessionStorage.getItem('chunk-retry-TestComponent')).toBeNull();
  });

  it('should trigger reload on first import failure', async () => {
    const importError = new TypeError('Failed to fetch dynamically imported module: chunk.js');
    const importFn = vi.fn().mockRejectedValue(importError);

    lazyWithRetry(importFn, 'FailComponent');

    const loaderFn = global.__lastLoader;
    expect(loaderFn).toBeDefined();

    expect(sessionStorage.getItem('chunk-retry-FailComponent')).toBeNull();

    // Call the loader which triggers catch block and window.location.reload
    const promise = loaderFn();

    // Give microtasks a tick to process
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(window.location.reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('chunk-retry-FailComponent')).toBe('true');
  });

  it('should throw error on persistent import failure', async () => {
    const importError = new TypeError('Failed to fetch dynamically imported module: chunk.js');
    const importFn = vi.fn().mockRejectedValue(importError);

    lazyWithRetry(importFn, 'FailPersistentComponent');

    const loaderFn = global.__lastLoader;
    expect(loaderFn).toBeDefined();

    // Simulate already retried
    sessionStorage.setItem('chunk-retry-FailPersistentComponent', 'true');

    await expect(loaderFn()).rejects.toThrow('Failed to fetch dynamically imported module: chunk.js');
    expect(window.location.reload).not.toHaveBeenCalled();
  });
});
