import git from 'isomorphic-git';
import { GitWorkspaceService } from './git-service';

/**
 * Status report from a Git sync cycle for a single project.
 *
 * @property projectName - Name of the project being synced
 * @property status - Current sync state
 * @property message - Optional human-readable status message
 * @property lastCheckedAt - Timestamp of the last sync check
 */
export interface SyncStatus {
  projectName: string;
  status: 'idle' | 'fetching' | 'pulling' | 'synced' | 'conflict' | 'error';
  message?: string;
  lastCheckedAt: number;
}

type SyncListener = (status: SyncStatus) => void;

/**
 * Background Git sync service that periodically fetches and merges
 * remote changes for all registered projects.
 *
 * Features:
 * - Periodic auto-sync loop with configurable interval
 * - Per-project status tracking and event emission
 * - Conflict detection and browser notification
 * - Graceful handling of transient errors
 *
 * Usage:
 * ```ts
 * GitSyncService.addListener((status) => console.log(status));
 * GitSyncService.startAutoSync(30000); // poll every 30s
 * ```
 */
export class GitSyncService {
  private static listeners = new Set<SyncListener>();
  private static intervalId: any = null;
  private static isSyncing = false;
  private static projectStatuses = new Map<string, SyncStatus>();

  /**
   * Register a callback listener to receive real-time sync status updates.
   *
   * @param listener - Callback receiving SyncStatus updates
   * @returns Unsubscribe function to remove the listener
   */
  public static addListener(listener: SyncListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Remove a registered callback listener.
   *
   * @param listener - The listener to remove
   */
  public static removeListener(listener: SyncListener): void {
    this.listeners.delete(listener);
  }

  private static emit(status: SyncStatus) {
    this.projectStatuses.set(status.projectName, status);
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch (err) {
        console.error('Error in GitSyncService listener callback:', err);
      }
    }
  }

  /**
   * Get the last sync status for a specific project.
   *
   * @param projectName - Name of the project
   * @returns The SyncStatus snapshot, or undefined if never synced
   */
  public static getProjectStatus(projectName: string): SyncStatus | undefined {
    return this.projectStatuses.get(projectName);
  }

  /**
   * Start background periodic sync loop for all repositories.
   * @param intervalMs polling interval in milliseconds, defaults to 30000 (30 seconds)
   */
  public static startAutoSync(intervalMs = 30000): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    this.intervalId = setInterval(async () => {
      await this.syncAllProjects();
    }, intervalMs);

    // Run first sync immediately in background
    this.syncAllProjects().catch((err) => {
      console.error('Initial Git background sync failed:', err);
    });
  }

  /**
   * Stop background periodic sync loop.
   */
  public static stopAutoSync(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Sync all connected Git repositories.
   */
  public static async syncAllProjects(): Promise<void> {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      const projects = await GitWorkspaceService.listProjects();
      const token = localStorage.getItem('swal_git_token') || undefined;

      for (const project of projects) {
        // Skip projects that are currently cloning or already in error state
        if (project.status === 'cloning') continue;

        await this.syncProject(project.name, token).catch((err) => {
          console.error(`Error syncing project ${project.name}:`, err);
        });
      }
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Fetch, compare, and merge remote changes for a single project.
   */
  public static async syncProject(projectName: string, token?: string): Promise<void> {
    const dir = `/projects/${projectName}`;
    const fs = GitWorkspaceService.getRawFS();

    this.emit({
      projectName,
      status: 'fetching',
      lastCheckedAt: Date.now(),
    });

    try {
      // 1. Fetch remote changes
      await GitWorkspaceService.fetch(projectName, token);

      // 2. Resolve local and remote tracking heads
      const branchName = (await git.currentBranch({ fs, dir })) || 'main';

      let localHead = '';
      try {
        localHead = await git.resolveRef({ fs, dir, ref: 'HEAD' });
      } catch {
        // Empty or newly initialized repo
      }

      let remoteHead = '';
      const remoteRef = `refs/remotes/origin/${branchName}`;
      try {
        remoteHead = await git.resolveRef({ fs, dir, ref: remoteRef });
      } catch {
        // No remote branch reference exists yet
      }

      // If local and remote match, or there is no remote branch yet, we are in sync
      if (!remoteHead || localHead === remoteHead) {
        this.emit({
          projectName,
          status: 'synced',
          lastCheckedAt: Date.now(),
        });
        return;
      }

      // 3. Remote has different changes. Let's pull!
      this.emit({
        projectName,
        status: 'pulling',
        lastCheckedAt: Date.now(),
      });

      await GitWorkspaceService.pull(projectName, token);

      this.emit({
        projectName,
        status: 'synced',
        lastCheckedAt: Date.now(),
      });
    } catch (err: any) {
      let syncStatus: 'error' | 'conflict' = 'error';
      let msg = err.message || String(err);

      if (err.name === 'MergeConflictError') {
        syncStatus = 'conflict';
        msg = `Conflict detected: ${msg}`;
      }

      // Update project status in local projects index
      const projects = await GitWorkspaceService.listProjects();
      const p = projects.find((x) => x.name === projectName);
      if (p) {
        p.status = 'error';
        p.lastSyncedAt = Date.now();
        await GitWorkspaceService.saveProjects(projects);
      }

      this.emit({
        projectName,
        status: syncStatus,
        message: msg,
        lastCheckedAt: Date.now(),
      });

      // Show browser notification/alert if a merge conflict occurs
      if (syncStatus === 'conflict' && typeof window !== 'undefined') {
        // Fire a custom event for conflict notification
        const event = new CustomEvent('git-sync-conflict', {
          detail: { projectName, message: msg },
        });
        window.dispatchEvent(event);
      }
    }
  }
}
