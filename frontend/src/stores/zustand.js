import { useState, useEffect, useRef } from 'react';

export const create = (createState) => {
  let state;
  const listeners = new Set();

  const getState = () => state;

  const setState = (nextStateOrUpdater, replace) => {
    const nextState = typeof nextStateOrUpdater === 'function'
      ? nextStateOrUpdater(state)
      : nextStateOrUpdater;

    if (!Object.is(nextState, state)) {
      const previousState = state;
      state = (replace ?? (typeof nextState !== 'object' || nextState === null))
        ? nextState
        : Object.assign({}, state, nextState);

      listeners.forEach((listener) => listener(state, previousState));
    }
  };

  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const api = { getState, setState, subscribe };
  state = createState(setState, getState, api);

  const useStore = (selector) => {
    const selectorRef = useRef(selector);
    selectorRef.current = selector;
    const [slice, setSlice] = useState(() => (selector ? selector(state) : state));

    useEffect(() => {
      const listener = () => {
        const nextSlice = selectorRef.current ? selectorRef.current(state) : state;
        setSlice(nextSlice);
      };
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }, []);

    return slice;
  };

  Object.assign(useStore, api);
  return useStore;
};
