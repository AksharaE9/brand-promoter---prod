import { useState, useEffect } from 'react';

/**
 * Debounce a value by the specified delay.
 * Prevents API calls on every keystroke for search inputs.
 *
 * @param {*} value - The value to debounce
 * @param {number} delay - Delay in milliseconds (default 300ms)
 * @returns {*} The debounced value
 *
 * @example
 * const [search, setSearch] = useState('');
 * const debouncedSearch = useDebounce(search, 300);
 * // Only debouncedSearch goes into the query key
 * useQuery({ queryKey: ['candidates', { search: debouncedSearch }], ... });
 */
export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

export default useDebounce;
