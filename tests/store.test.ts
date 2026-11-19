import { describe, expect, it } from 'vitest';
import { UiStore, initialUiState } from '../src/ui/store';

describe('typed UI store', () => {
  it('updates immutably and notifies subscribers', () => {
    const store = new UiStore(initialUiState);
    const seen: number[] = [];
    const unsubscribe = store.subscribe((state) => {
      if (state.timeUtcMs !== null) seen.push(state.timeUtcMs);
    });
    store.update({ timeUtcMs: 1 });
    store.update({ timeUtcMs: 2, nightMode: true });
    unsubscribe();
    store.update({ timeUtcMs: 3 });
    expect(seen).toEqual([1, 2]);
    expect(store.getState().nightMode).toBe(true);
    expect(store.getState()).not.toBe(initialUiState);
  });
});
