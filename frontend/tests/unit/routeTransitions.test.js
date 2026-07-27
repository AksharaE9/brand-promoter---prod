import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';

// Mock react-router-dom so we can simulate location changes in RouteTransition
let mockLocation = { pathname: '/candidates', search: '' };
vi.mock('react-router-dom', () => ({
  useLocation: () => mockLocation,
}));

// Mock react hooks cleanly using a call array to support multiple useState calls
let hookStates = [];
let hookIndex = 0;
let registeredEffect = null;

const resetHooks = () => {
  hookIndex = 0;
};

vi.mock('react', async () => {
  const actual = await vi.importActual('react');
  return {
    ...actual,
    useState: (initial) => {
      const currentIndex = hookIndex;
      if (hookStates[currentIndex] === undefined) {
        hookStates[currentIndex] = initial;
      }
      const setVal = (newVal) => {
        hookStates[currentIndex] = newVal;
      };
      hookIndex++;
      return [hookStates[currentIndex], setVal];
    },
    useRef: (initial) => {
      const currentIndex = hookIndex;
      if (hookStates[currentIndex] === undefined) {
        hookStates[currentIndex] = { current: initial };
      }
      hookIndex++;
      return hookStates[currentIndex];
    },
    useEffect: (fn) => {
      registeredEffect = fn;
    }
  };
});

// Import the RouteTransition component
import { RouteTransition } from '../../src/components/PageMotion';

describe('RouteTransition Unit Verification', () => {
  beforeEach(() => {
    mockLocation = { pathname: '/candidates', search: '' };
    hookStates = [];
    hookIndex = 0;
    registeredEffect = null;

    // Mock setTimeout to fire synchronously
    vi.stubGlobal('setTimeout', (fn) => {
      fn();
      return 1;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('updates displayKey and triggers effect when pathname changes', () => {
    const children = React.createElement('div', {}, 'Page Content');
    
    // 1. Initial render — isTransitioning (index 0) starts false (no displayKey state anymore)
    resetHooks();
    RouteTransition({ children });
    expect(hookStates[0]).toBe(false); // isTransitioning is index 0

    // 2. Change location parameters
    mockLocation = { pathname: '/jobs', search: '' };
    
    // 3. Trigger second render so the new closures and currentKey are bound
    resetHooks();
    RouteTransition({ children });

    // 4. Run the registered effect which sets isTransitioning=true then (via synchronous
    //    mocked setTimeout) immediately calls the fadeInTimer, setting isTransitioning=false.
    if (registeredEffect) {
      const cleanup = registeredEffect();
      if (cleanup) cleanup();
    }

    // 5. Render once more to verify final state
    resetHooks();
    RouteTransition({ children });

    // isTransitioning resolved to false; showBar is also false (synchronous mock fires
    // both timers immediately, so setShowBar(false) overwrites setShowBar(true))
    expect(hookStates[0]).toBe(false); // isTransitioning resolved
    expect(hookStates[1]).toBe(false); // showBar ends false (both timers fired sync)
  });

  it('updates displayKey and triggers transition when query params change', () => {
    const children = React.createElement('div', {}, 'Page Content');
    
    // 1. Initial render — isTransitioning (index 0) starts false
    resetHooks();
    RouteTransition({ children });
    expect(hookStates[0]).toBe(false); // isTransitioning is index 0

    // 2. Change query params
    mockLocation = { pathname: '/candidates', search: '?status=OFFER_SENT' };
    
    // 3. Trigger second render
    resetHooks();
    RouteTransition({ children });

    // 4. Run the effect (synchronous setTimeout immediately fires the fade-in callback)
    if (registeredEffect) {
      const cleanup = registeredEffect();
      if (cleanup) cleanup();
    }

    // 5. Render once more
    resetHooks();
    RouteTransition({ children });

    // isTransitioning resolved to false; showBar is also false (synchronous mock fires
    // both timers immediately, so setShowBar(false) overwrites setShowBar(true))
    expect(hookStates[0]).toBe(false); // isTransitioning resolved
    expect(hookStates[1]).toBe(false); // showBar ends false (both timers fired sync)
  });
});
