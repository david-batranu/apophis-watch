/**
 * Service-worker registration and update prompt.
 *
 * vite-plugin-pwa is configured with `registerType: 'prompt'` and
 * `skipWaiting: false`, so a new build waits until the user explicitly
 * reloads. The current shell keeps working offline in the meantime.
 */

import { registerSW } from 'virtual:pwa-register';

export interface PwaHandlers {
  onNeedRefresh: () => void;
  onOfflineReady: () => void;
  onError?: (error: unknown) => void;
}

export interface PwaController {
  /** Activate the waiting build and reload. */
  reload: () => Promise<void>;
  /** Ask the browser to check for a new service worker now. */
  check: () => Promise<void>;
  /** True when a new build is waiting for the user. */
  hasWaitingUpdate: () => boolean;
}

const noop = async (): Promise<void> => undefined;

export function initPwa(handlers: PwaHandlers): PwaController {
  if (
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !import.meta.env.PROD
  ) {
    return {
      reload: noop,
      check: noop,
      hasWaitingUpdate: () => false,
    };
  }

  let registration: ServiceWorkerRegistration | null = null;
  let waiting = false;
  let reloading = false;
  let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;

  const check = async (): Promise<void> => {
    if (!registration || navigator.onLine === false) return;
    try {
      await registration.update();
    } catch {
      // Update checks are best-effort; the current build remains usable.
    }
  };

  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      waiting = true;
      handlers.onNeedRefresh();
    },
    onOfflineReady() {
      handlers.onOfflineReady();
    },
    onRegisteredSW(_swUrl, registered) {
      registration = registered ?? null;
    },
    onRegisterError(error) {
      handlers.onError?.(error);
    },
  });

  // A long-lived installed app should still discover new builds. Checks are
  // serialised by the browser and skipped while offline.
  window.setInterval(() => void check(), 30 * 60_000);
  window.addEventListener('online', () => void check());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });

  return {
    reload: async () => {
      if (reloading) return;
      reloading = true;
      try {
        await updateSW?.(true);
      } catch (error) {
        reloading = false;
        handlers.onError?.(error);
      }
    },
    check,
    hasWaitingUpdate: () => waiting,
  };
}
