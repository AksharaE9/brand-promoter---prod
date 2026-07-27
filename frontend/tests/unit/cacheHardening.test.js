import { describe, it, expect } from 'vitest';

// Simulating updateInfiniteOrFlatList function from useScheduling.js
function updateInfiniteOrFlatList(old, updateFn) {
  if (!old) return old;
  
  if (old.pages && Array.isArray(old.pages)) {
    return {
      ...old,
      pages: old.pages.map(page => {
        const list = page.data || page.rows || [];
        if (!Array.isArray(list)) return page;
        const updatedList = updateFn(list);
        if (page.data !== undefined) {
          return { ...page, data: updatedList };
        } else if (page.rows !== undefined) {
          return { ...page, rows: updatedList };
        }
        return { ...page, data: updatedList };
      })
    };
  }
  
  const list = old.data ?? old;
  if (!Array.isArray(list)) return old;
  const updatedList = updateFn(list);
  return old.data !== undefined ? { ...old, data: updatedList } : updatedList;
}

describe('updateInfiniteOrFlatList', () => {
  it('correctly maps over TanStack Query Infinite scroll cache shape', () => {
    const cache = {
      pages: [
        { data: [{ id: 1, val: 'a' }, { id: 2, val: 'b' }], hasMore: true },
        { data: [{ id: 3, val: 'c' }], hasMore: false }
      ],
      pageParams: [null, 2]
    };

    const updated = updateInfiniteOrFlatList(cache, (list) => {
      return list.map(item => item.id === 2 ? { ...item, val: 'updated_b' } : item);
    });

    expect(updated.pages[0].data[1].val).toBe('updated_b');
    expect(updated.pages[1].data[0].val).toBe('c');
    expect(updated.pageParams).toEqual([null, 2]);
  });

  it('correctly handles flat arrays', () => {
    const list = [{ id: 1, val: 'a' }, { id: 2, val: 'b' }];
    const updated = updateInfiniteOrFlatList(list, (l) => {
      return l.filter(item => item.id !== 2);
    });
    expect(updated).toEqual([{ id: 1, val: 'a' }]);
  });

  it('correctly handles nested object lists', () => {
    const old = { data: [{ id: 1, val: 'a' }] };
    const updated = updateInfiniteOrFlatList(old, (l) => {
      return [...l, { id: 2, val: 'b' }];
    });
    expect(updated.data).toEqual([{ id: 1, val: 'a' }, { id: 2, val: 'b' }]);
  });
});
