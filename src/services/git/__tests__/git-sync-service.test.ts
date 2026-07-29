import 'fake-indexeddb/auto';

// Mock localStorage for Node.js Vitest environment
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    clear: () => {
      store = {};
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// Mock window and dispatchEvent for Node.js Vitest environment
if (typeof window === 'undefined') {
  (globalThis as any).window = globalThis;
}

const listenersMap = new Map<string, Set<EventListener>>();
if (!globalThis.addEventListener) {
  (globalThis as any).addEventListener = (type: string, listener: EventListener) => {
    if (!listenersMap.has(type)) {
      listenersMap.set(type, new Set());
    }
    listenersMap.get(type)!.add(listener);
  };
}
if (!globalThis.removeEventListener) {
  (globalThis as any).removeEventListener = (type: string, listener: EventListener) => {
    listenersMap.get(type)?.delete(listener);
  };
}
if (!globalThis.dispatchEvent) {
  (globalThis as any).dispatchEvent = (event: Event) => {
    listenersMap.get(event.type)?.forEach((l) => l(event));
    return true;
  };
}

if (typeof CustomEvent === 'undefined') {
  class CustomEventMock {
    type: string;
    detail: any;
    constructor(type: string, options: any = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }
  (globalThis as any).CustomEvent = CustomEventMock;
}

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import git from 'isomorphic-git';
import { GitWorkspaceService } from '../git-service';
import { GitSyncService, SyncStatus } from '../git-sync-service';

describe('GitWorkspaceService & GitSyncService Tests', () => {
  const fs = GitWorkspaceService.getRawFS();
  let projectName: string;
  let dir: string;

  beforeEach(async () => {
    projectName = 'proj-' + Math.random().toString(36).substring(2, 9);
    dir = `/projects/${projectName}`;

    // Ensure parent directory exists
    try {
      await fs.promises.mkdir('/projects');
    } catch {
      // ignore
    }

    try {
      await fs.promises.mkdir(dir);
    } catch {
      // ignore
    }

    localStorage.clear();
    GitSyncService.stopAutoSync();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GitWorkspaceService Core Merge Logic', () => {
    it('should cleanly merge non-conflicting changes and update working tree', async () => {
      // 1. Setup local project structure and list
      const projects = [
        {
          id: '1',
          name: projectName,
          url: 'https://github.com/example/repo.git',
          branch: 'master',
          lastSyncedAt: Date.now(),
          status: 'synced' as const,
        },
      ];
      await GitWorkspaceService.saveProjects(projects);

      // 2. Initialize repo
      await git.init({ fs, dir });

      // 3. Initial commit
      await GitWorkspaceService.writeFile(projectName, 'file.txt', 'base content\n');
      await GitWorkspaceService.commitChanges(projectName, 'initial commit');

      // 4. Create and commit on feature branch
      await GitWorkspaceService.createBranch(projectName, 'feature');
      await GitWorkspaceService.writeFile(projectName, 'file-feature.txt', 'feature content\n');
      await GitWorkspaceService.commitChanges(projectName, 'feature commit');

      // 5. Checkout master and commit there
      await git.checkout({ fs, dir, ref: 'master' });
      await GitWorkspaceService.writeFile(projectName, 'file-master.txt', 'master content\n');
      await GitWorkspaceService.commitChanges(projectName, 'master commit');

      // 6. Merge feature into master
      const mergeResult = await GitWorkspaceService.merge(projectName, 'refs/heads/feature', 'master');
      expect(mergeResult.alreadyMerged).toBeFalsy();

      // 7. Verify files in working directory are updated (thanks to force checkout in merge method)
      const files = await GitWorkspaceService.listDirectory(projectName);
      expect(files).toContain('file.txt');
      expect(files).toContain('file-feature.txt');
      expect(files).toContain('file-master.txt');
    });

    it('should throw MergeConflictError when a conflict occurs', async () => {
      // 1. Setup project
      const projects = [
        {
          id: '1',
          name: projectName,
          url: 'https://github.com/example/repo.git',
          branch: 'master',
          lastSyncedAt: Date.now(),
          status: 'synced' as const,
        },
      ];
      await GitWorkspaceService.saveProjects(projects);

      // 2. Init repo
      await git.init({ fs, dir });

      // 3. Initial commit
      await GitWorkspaceService.writeFile(projectName, 'file.txt', 'base content\n');
      await GitWorkspaceService.commitChanges(projectName, 'initial commit');

      // 4. Feature branch change
      await GitWorkspaceService.createBranch(projectName, 'feature');
      await GitWorkspaceService.writeFile(projectName, 'file.txt', 'base content\nfeature change\n');
      await GitWorkspaceService.commitChanges(projectName, 'feature change commit');

      // 5. Master branch change
      await git.checkout({ fs, dir, ref: 'master' });
      await GitWorkspaceService.writeFile(projectName, 'file.txt', 'base content\nmaster change\n');
      await GitWorkspaceService.commitChanges(projectName, 'master change commit');

      // 6. Merge feature into master and expect conflict
      await expect(
        GitWorkspaceService.merge(projectName, 'refs/heads/feature', 'master')
      ).rejects.toThrow(); // throws MergeConflictError or aborts
    });
  });

  describe('GitSyncService Polling and Multi-Node Workflows', () => {
    it('should emit synced status when local and remote heads match', async () => {
      // Initialize repo so currentBranch works
      await git.init({ fs, dir });

      const statuses: SyncStatus[] = [];
      const remove = GitSyncService.addListener((status) => {
        statuses.push(status);
      });

      // Mock resolveRef to return same SHA for both HEAD and origin
      const resolveSpy = vi.spyOn(git, 'resolveRef').mockResolvedValue('commit-sha-123');
      const fetchSpy = vi.spyOn(GitWorkspaceService, 'fetch').mockResolvedValue();

      // Setup project list
      await GitWorkspaceService.saveProjects([
        {
          id: '1',
          name: projectName,
          url: 'https://github.com/example/repo.git',
          branch: 'master',
          lastSyncedAt: Date.now(),
          status: 'synced',
        },
      ]);

      await GitSyncService.syncProject(projectName);

      expect(fetchSpy).toHaveBeenCalledWith(projectName, undefined);
      expect(resolveSpy).toHaveBeenCalled();

      // The final status should be 'synced'
      expect(statuses.length).toBeGreaterThan(0);
      expect(statuses[statuses.length - 1].status).toBe('synced');

      remove();
    });

    it('should trigger pull and successfully merge remote changes', async () => {
      // Initialize repo so currentBranch works
      await git.init({ fs, dir });

      const statuses: SyncStatus[] = [];
      const remove = GitSyncService.addListener((status) => {
        statuses.push(status);
      });

      // Mock resolveRef to return different SHAs (local outdated)
      const resolveSpy = vi.spyOn(git, 'resolveRef')
        .mockResolvedValueOnce('local-sha')   // local HEAD
        .mockResolvedValueOnce('remote-sha'); // remote HEAD

      const fetchSpy = vi.spyOn(GitWorkspaceService, 'fetch').mockResolvedValue();
      const pullSpy = vi.spyOn(GitWorkspaceService, 'pull').mockResolvedValue({ oid: 'new-sha' });

      // Setup project list
      await GitWorkspaceService.saveProjects([
        {
          id: '1',
          name: projectName,
          url: 'https://github.com/example/repo.git',
          branch: 'master',
          lastSyncedAt: Date.now(),
          status: 'synced',
        },
      ]);

      await GitSyncService.syncProject(projectName);

      expect(fetchSpy).toHaveBeenCalled();
      expect(pullSpy).toHaveBeenCalledWith(projectName, undefined);

      expect(statuses.some((s) => s.status === 'pulling')).toBe(true);
      expect(statuses[statuses.length - 1].status).toBe('synced');

      remove();
    });

    it('should handle merge conflict correctly during automated background sync', async () => {
      // Initialize repo so currentBranch works
      await git.init({ fs, dir });

      const statuses: SyncStatus[] = [];
      const remove = GitSyncService.addListener((status) => {
        statuses.push(status);
      });

      // Listen to window custom event
      let customEventFired = false;
      let customEventDetail: any = null;
      const handleConflictEvent = (e: any) => {
        customEventFired = true;
        customEventDetail = e.detail;
      };
      window.addEventListener('git-sync-conflict', handleConflictEvent);

      // Mock resolveRef to return different SHAs
      vi.spyOn(git, 'resolveRef')
        .mockResolvedValueOnce('local-sha')
        .mockResolvedValueOnce('remote-sha');

      vi.spyOn(GitWorkspaceService, 'fetch').mockResolvedValue();

      // Mock pull to throw MergeConflictError
      const mockConflictError = new Error('Merge conflict in file.txt');
      mockConflictError.name = 'MergeConflictError';
      vi.spyOn(GitWorkspaceService, 'pull').mockRejectedValue(mockConflictError);

      // Setup project list
      await GitWorkspaceService.saveProjects([
        {
          id: '1',
          name: projectName,
          url: 'https://github.com/example/repo.git',
          branch: 'master',
          lastSyncedAt: Date.now(),
          status: 'synced',
        },
      ]);

      await GitSyncService.syncProject(projectName);

      // Status should transition to 'conflict'
      expect(statuses[statuses.length - 1].status).toBe('conflict');
      expect(statuses[statuses.length - 1].message).toContain('Conflict detected');

      // Project status in index should be marked as 'error'
      const projects = await GitWorkspaceService.listProjects();
      expect(projects[0].status).toBe('error');

      // Custom browser event should be fired
      expect(customEventFired).toBe(true);
      expect(customEventDetail.projectName).toBe(projectName);

      // Clean up event listener
      window.removeEventListener('git-sync-conflict', handleConflictEvent);
      remove();
    });
  });
});
