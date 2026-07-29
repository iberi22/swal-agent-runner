import { edgeMeshClient } from '../mesh/edge-mesh-client';
import { syncQueue } from './sync-queue';

/**
 * OfflineManager — Gestiona el estado offline/online de la PWA.
 *
 * - Detecta cambios de conectividad
 * - Notifica al EdgeMeshClient cuando se reconecta
 * - Auto-ejecuta SyncQueue al reconectarse
 * - Solicita almacenamiento persistente al navegador
 * - Mantiene stats de sync
 */
export class OfflineManager {
  private listeners: Set<(online: boolean) => void> = new Set();
  private _online: boolean = navigator.onLine;
  private _persisted: boolean = false;

  constructor() {
    window.addEventListener('online', () => {
      this._online = true;
      this.notify();
      // Auto-flush pending operations when back online
      syncQueue.processAll().then(result => {
        if (result.completed > 0 || result.failed > 0) {
          console.log(`[SyncQueue] ${result.completed} synced, ${result.failed} failed`);
        }
      });
    });
    window.addEventListener('offline', () => {
      this._online = false;
      this.notify();
    });
    // Also flush on init if online
    if (navigator.onLine) {
      syncQueue.processAll();
    }
    this.requestPersistence();
  }

  get online(): boolean { return this._online; }
  get persisted(): boolean { return this._persisted; }

  /** Solicitar almacenamiento persistente (navegador no borra datos). */
  async requestPersistence(): Promise<boolean> {
    if (!navigator.storage?.persist) return false;
    try {
      this._persisted = await navigator.storage.persist();
      return this._persisted;
    } catch {
      return false;
    }
  }

  /** Estimar espacio usado/disponible en IndexedDB. */
  async estimateStorage(): Promise<{ usage: number; quota: number } | null> {
    if (!navigator.storage?.estimate) return null;
    try {
      const est = await navigator.storage.estimate();
      return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
    } catch {
      return null;
    }
  }

  subscribe(callback: (online: boolean) => void): () => void {
    this.listeners.add(callback);
    callback(this._online);
    return () => this.listeners.delete(callback);
  }

  private notify(): void {
    for (const cb of this.listeners) cb(this._online);
  }
}

export const offlineManager = new OfflineManager();
