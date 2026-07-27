import { XavierPairStatus } from '../../types';
import { XavierMemoryNode } from './xavier-memory-node';

export class EdgeMeshSyncService {
  private static STORAGE_KEY_PEER = 'swal_xavier_peer_endpoint';
  private static pairStatusListeners: ((status: XavierPairStatus) => void)[] = [];
  private static syncInterval: number | null = null;

  public static getTargetEndpoint(): string {
    return localStorage.getItem(this.STORAGE_KEY_PEER) || 'http://localhost:8006';
  }

  public static setTargetEndpoint(endpoint: string): void {
    localStorage.setItem(this.STORAGE_KEY_PEER, endpoint);
  }

  public static subscribePairStatus(listener: (status: XavierPairStatus) => void): () => void {
    this.pairStatusListeners.push(listener);
    return () => {
      this.pairStatusListeners = this.pairStatusListeners.filter(l => l !== listener);
    };
  }

  private static notifyListeners(status: XavierPairStatus): void {
    for (const listener of this.pairStatusListeners) {
      listener(status);
    }
  }

  public static async checkPairConnection(): Promise<XavierPairStatus> {
    const endpoint = this.getTargetEndpoint();
    const unsynced = await XavierMemoryNode.getUnsyncedChunks();

    try {
      // Ping Xavier endpoint
      const res = await fetch(`${endpoint}/health`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (res.ok) {
        const status: XavierPairStatus = {
          paired: true,
          endpoint,
          lastSyncAt: Date.now(),
          pendingSyncCount: unsynced.length,
          connectionState: 'connected',
        };
        this.notifyListeners(status);
        return status;
      }
    } catch {
      // Endpoint unreachable or offline
    }

    const status: XavierPairStatus = {
      paired: false,
      endpoint,
      lastSyncAt: 0,
      pendingSyncCount: unsynced.length,
      connectionState: 'disconnected',
    };
    this.notifyListeners(status);
    return status;
  }

  public static async performRealtimeSync(): Promise<{ syncedCount: number; error?: string }> {
    const status = await this.checkPairConnection();
    if (!status.paired) {
      return { syncedCount: 0, error: 'Target PC Xavier node is offline or unreachable.' };
    }

    const unsynced = await XavierMemoryNode.getUnsyncedChunks();
    if (unsynced.length === 0) {
      return { syncedCount: 0 };
    }

    try {
      const res = await fetch(`${status.endpoint}/api/v1/memory/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: 'swal-agent-runner-edge',
          chunks: unsynced,
        }),
      });

      if (res.ok) {
        const chunkIds = unsynced.map(c => c.id);
        await XavierMemoryNode.markChunksSynced(chunkIds);
        await this.checkPairConnection();
        return { syncedCount: chunkIds.length };
      } else {
        const text = await res.text();
        return { syncedCount: 0, error: `Sync API returned error ${res.status}: ${text}` };
      }
    } catch (err: any) {
      return { syncedCount: 0, error: `Sync network error: ${err.message || err}` };
    }
  }

  public static startAutoSyncLoop(intervalMs = 30000): void {
    if (this.syncInterval) return;
    
    // Initial check
    this.checkPairConnection();

    this.syncInterval = window.setInterval(() => {
      this.performRealtimeSync();
    }, intervalMs);
  }

  public static stopAutoSyncLoop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
}
