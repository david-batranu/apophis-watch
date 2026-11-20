/**
 * Best-spot Web Worker. The pure scoring code lives in
 * src/terrain/bestSpot.ts so it can also run in tests and as a main-thread
 * fallback. Cancellation is cooperative: `searchBestSpots` yields every N
 * candidates, allowing this worker's `cancel` message to be processed.
 */

import {
  searchBestSpots,
  type BestSpotInput,
} from '../terrain/bestSpot';
import type { BestSpotSummary } from '../terrain/types';

interface RunMessage {
  type: 'run';
  requestId: number;
  input: BestSpotInput;
}

interface CancelMessage {
  type: 'cancel';
  requestId: number;
}

type InboundMessage = RunMessage | CancelMessage;

type OutboundMessage =
  | { type: 'progress'; requestId: number; processed: number; total: number }
  | { type: 'done'; requestId: number; summary: BestSpotSummary }
  | { type: 'error'; requestId: number; message: string };

interface WorkerScope {
  onmessage: ((event: MessageEvent<InboundMessage>) => void) | null;
  postMessage(message: OutboundMessage): void;
}

const scope = globalThis as unknown as WorkerScope;
const cancelled = new Set<number>();

scope.onmessage = (event: MessageEvent<InboundMessage>) => {
  const data = event.data;
  if (data.type === 'cancel') {
    cancelled.add(data.requestId);
    return;
  }
  const { requestId, input } = data;
  void (async () => {
    try {
      const summary = await searchBestSpots(input, {
        shouldCancel: () => cancelled.has(requestId),
        onProgress: (processed, total) => {
          scope.postMessage({ type: 'progress', requestId, processed, total });
        },
        yieldEvery: 120,
      });
      scope.postMessage({ type: 'done', requestId, summary });
    } catch (error) {
      scope.postMessage({
        type: 'error',
        requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      cancelled.delete(requestId);
    }
  })();
};
