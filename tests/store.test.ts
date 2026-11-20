import { describe, expect, it } from 'vitest';
import { UiStore, initialUiState } from '../src/state/store';

describe('typed UI store', () => {
  it('updates immutably and notifies subscribers', () => {
    const store = new UiStore(initialUiState);
    const seen: (number | null)[] = [];
    const unsubscribe = store.subscribe((state) => {
      seen.push(state.utcMs);
    });
    store.update({ utcMs: 1 });
    store.update({ utcMs: 2, toggles: { ...store.getState().toggles, nightMode: true } });
    unsubscribe();
    store.update({ utcMs: 3 });
    expect(seen).toEqual([null, 1, 2]);
    expect(store.getState().toggles.nightMode).toBe(true);
    expect(store.getState()).not.toBe(initialUiState);
  });
});
