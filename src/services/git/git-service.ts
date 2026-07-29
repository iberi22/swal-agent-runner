import git from 'isomorphic-git';
import LightningFS from '@isomorphic-git/lightning-fs';
import http from 'isomorphic-git/http/web';
import { ProjectRepo } from '../../types';

/**
 * Git workspace management service for the browser-based PWA environment.
 *
 * Provides a full Git workflow layer over isomorphic-git + LightningFS,
 * enabling clone, branch, read/write, commit, diff, push, fetch, merge,
 * and pull operations entirely within the browser (no server needed).
 *
 * All methods are static — the service is stateless and operates on an
 * in-memory virtual filesystem persisted via IndexedDB.
 *
 * Usage:
 * ```ts
 * import { GitWorkspaceService } from './services/git/git-service';
 * await GitWorkspaceService.cloneRepository('https://github.com/...');
 * await GitWorkspaceService.createBranch('my-project', 'feature/new-feature');
 * ```
 */
export class GitWorkspaceService {
  private static fs = new LightningFS('swal_agent_git_fs');
  private static defaultCorsProxy = 'https://cors-proxy.swal.dev';

  /**
   * List all registered Git projects.
   *
   * Reads the project index from localStorage.
   *
   * @returns Array of ProjectRepo descriptors
   */
  public static async listProjects(): Promise<ProjectRepo[]> {
    const raw = localStorage.getItem('swal_git_projects');
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  /**
   * Persist the project index to localStorage.
   *
   * @param projects - Array of ProjectRepo descriptors to save
   */
  public static async saveProjects(projects: ProjectRepo[]): Promise<void> {
    localStorage.setItem('swal_git_projects', JSON.stringify(projects));
  }

  /**
   * Clone a remote Git repository into the virtual filesystem.
   *
   * Creates a project entry, performs a shallow clone (depth=1, single branch),
   * and updates the project status on success or failure.
   *
   * @param url - Remote repository URL
   * @param name - Optional local project name (inferred from URL if omitted)
   * @param corsProxy - Optional CORS proxy URL (defaults to swal.dev proxy)
   * @returns The created ProjectRepo descriptor
   * @throws {Error} If the clone operation fails
   */
  public static async cloneRepository(
    url: string,
    name?: string,
    corsProxy?: string
  ): Promise<ProjectRepo> {
    const projectName = name || url.split('/').pop()?.replace(/\.git$/, '') || 'swal-repo';
    const dir = `/projects/${projectName}`;
    const proxy = corsProxy || this.defaultCorsProxy;

    const project: ProjectRepo = {
      id: crypto.randomUUID(),
      name: projectName,
      url,
      branch: 'main',
      lastSyncedAt: Date.now(),
      status: 'cloning',
    };

    const projects = await this.listProjects();
    projects.push(project);
    await this.saveProjects(projects);

    try {
      await git.clone({
        fs: this.fs,
        http,
        dir,
        url,
        corsProxy: proxy,
        depth: 1,
        singleBranch: true,
      });

      project.status = 'synced';
      project.lastSyncedAt = Date.now();
      await this.saveProjects(projects);
      return project;
    } catch (err: any) {
      project.status = 'error';
      await this.saveProjects(projects);
      throw new Error(`Git clone failed for ${url}: ${err.message || err}`);
    }
  }

  /**
   * Create and checkout a new branch for a project.
   *
   * @param projectName - Name of the project
   * @param branchName - Name of the branch to create
   */
  public static async createBranch(projectName: string, branchName: string): Promise<void> {
    const dir = `/projects/${projectName}`;
    await git.branch({
      fs: this.fs,
      dir,
      ref: branchName,
      checkout: true,
    });

    const projects = await this.listProjects();
    const p = projects.find((x) => x.name === projectName);
    if (p) {
      p.branch = branchName;
      p.status = 'modified';
      await this.saveProjects(projects);
    }
  }

  /**
   * Read a file from the project workspace.
   *
   * @param projectName - Name of the project
   * @param filePath - Relative file path (e.g. "src/index.ts")
   * @returns The file contents as a string
   */
  public static async readFile(projectName: string, filePath: string): Promise<string> {
    const fullPath = `/projects/${projectName}/${filePath.replace(/^\//, '')}`;
    const data = (await this.fs.promises.readFile(fullPath, 'utf8')) as string;
    return data;
  }

  /**
   * Write content to a file in the project workspace.
   *
   * Creates parent directories as needed. Marks the project as modified.
   *
   * @param projectName - Name of the project
   * @param filePath - Relative file path
   * @param content - File content to write
   */
  public static async writeFile(projectName: string, filePath: string, content: string): Promise<void> {
    const fullPath = `/projects/${projectName}/${filePath.replace(/^\//, '')}`;

    // Ensure parent directories exist
    const parts = fullPath.split('/').filter(Boolean);
    parts.pop(); // remove file name
    let current = '';
    for (const part of parts) {
      current += '/' + part;
      try {
        await this.fs.promises.mkdir(current);
      } catch {
        // Ignore if exists
      }
    }

    await this.fs.promises.writeFile(fullPath, content, 'utf8');

    const projects = await this.listProjects();
    const p = projects.find((x) => x.name === projectName);
    if (p && p.status !== 'modified') {
      p.status = 'modified';
      await this.saveProjects(projects);
    }
  }

  /**
   * List files and directories in a project path.
   *
   * Excludes the ".git" directory from results.
   *
   * @param projectName - Name of the project
   * @param dirPath - Relative directory path (empty string for root)
   * @returns Array of file/directory names
   */
  public static async listDirectory(projectName: string, dirPath: string = ''): Promise<string[]> {
    const fullPath = `/projects/${projectName}/${dirPath.replace(/^\//, '')}`.replace(/\/$/, '');
    try {
      const files = await this.fs.promises.readdir(fullPath);
      return files.filter((f) => f !== '.git');
    } catch {
      return [];
    }
  }

  /**
   * Stage all changes and create a commit.
   *
   * @param projectName - Name of the project
   * @param message - Commit message
   * @param authorName - Author name (default: "SWAL Agent")
   * @param authorEmail - Author email (default: "agent@swal.dev")
   * @returns The commit SHA hash
   */
  public static async commitChanges(
    projectName: string,
    message: string,
    authorName = 'SWAL Agent',
    authorEmail = 'agent@swal.dev'
  ): Promise<string> {
    const dir = `/projects/${projectName}`;

    await git.add({ fs: this.fs, dir, filepath: '.' });

    const sha = await git.commit({
      fs: this.fs,
      dir,
      message,
      author: {
        name: authorName,
        email: authorEmail,
      },
    });

    const projects = await this.listProjects();
    const p = projects.find((x) => x.name === projectName);
    if (p) {
      p.status = 'synced';
      p.lastSyncedAt = Date.now();
      await this.saveProjects(projects);
    }

    return sha;
  }

  /**
   * Get a summary of uncommitted file changes.
   *
   * Uses the status matrix to detect modified files.
   *
   * @param projectName - Name of the project
   * @returns Human-readable diff summary or "No uncommitted changes detected."
   */
  public static async getDiff(projectName: string): Promise<string> {
    const dir = `/projects/${projectName}`;
    try {
      const statusMatrix = await git.statusMatrix({ fs: this.fs, dir });
      const changedFiles: string[] = [];

      for (const [filepath, head, workdir, stage] of statusMatrix) {
        if (head !== workdir || workdir !== stage) {
          changedFiles.push(filepath);
        }
      }

      if (changedFiles.length === 0) {
        return 'No uncommitted changes detected.';
      }

      return `Modified Files:\n${changedFiles.map((f) => `- ${f}`).join('\n')}`;
    } catch (err: any) {
      return `Diff calculation summary: ${err.message || err}`;
    }
  }

  /**
   * Push committed changes to a remote repository.
   *
   * @param projectName - Name of the project
   * @param token - Authentication token for the remote
   * @param remoteName - Remote name (default: "origin")
   * @param corsProxy - Optional CORS proxy URL
   */
  public static async pushChanges(
    projectName: string,
    token: string,
    remoteName = 'origin',
    corsProxy?: string
  ): Promise<void> {
    const dir = `/projects/${projectName}`;
    const proxy = corsProxy || this.defaultCorsProxy;

    await git.push({
      fs: this.fs,
      http,
      dir,
      remote: remoteName,
      corsProxy: proxy,
      onAuth: () => ({ username: token }),
    });

    const projects = await this.listProjects();
    const p = projects.find((x) => x.name === projectName);
    if (p) {
      p.status = 'synced';
      p.lastSyncedAt = Date.now();
      await this.saveProjects(projects);
    }
  }

  /**
   * Fetch changes from a remote repository (without merging).
   *
   * @param projectName - Name of the project
   * @param token - Optional authentication token
   * @param remoteName - Remote name (default: "origin")
   * @param corsProxy - Optional CORS proxy URL
   */
  public static async fetch(
    projectName: string,
    token?: string,
    remoteName = 'origin',
    corsProxy?: string
  ): Promise<void> {
    const dir = `/projects/${projectName}`;
    const proxy = corsProxy || this.defaultCorsProxy;

    await git.fetch({
      fs: this.fs,
      http,
      dir,
      remote: remoteName,
      corsProxy: proxy,
      onAuth: token ? () => ({ username: token }) : undefined,
      singleBranch: true,
    });
  }

  /**
   * Merge a branch into the current (or specified) branch.
   *
   * Auto-checkouts the ours branch after merge to update the working tree.
   *
   * @param projectName - Name of the project
   * @param theirs - The branch name to merge from
   * @param ours - Optional branch name to merge into (defaults to current branch)
   * @param authorName - Author name for the merge commit
   * @param authorEmail - Author email for the merge commit
   * @returns Merge result with commit OID and already-merged flag
   * @throws {MergeConflictError} If a merge conflict occurs and abortOnConflict is true
   */
  public static async merge(
    projectName: string,
    theirs: string,
    ours?: string,
    authorName = 'SWAL Agent',
    authorEmail = 'agent@swal.dev'
  ): Promise<{ oid: string; alreadyMerged?: boolean }> {
    const dir = `/projects/${projectName}`;
    let oursBranch = ours;
    if (!oursBranch) {
      oursBranch = (await git.currentBranch({ fs: this.fs, dir })) || 'main';
    }

    try {
      const res = await git.merge({
        fs: this.fs,
        dir,
        ours: oursBranch,
        theirs,
        author: {
          name: authorName,
          email: authorEmail,
        },
        abortOnConflict: true,
      });

      // After a successful merge, update working tree by checking out
      await git.checkout({
        fs: this.fs,
        dir,
        ref: oursBranch,
        force: true,
      });

      const projects = await this.listProjects();
      const p = projects.find((x) => x.name === projectName);
      if (p) {
        p.status = 'synced';
        p.lastSyncedAt = Date.now();
        await this.saveProjects(projects);
      }

      return {
        oid: res.oid || '',
        alreadyMerged: res.alreadyMerged,
      };
    } catch (err: any) {
      if (err.name === 'MergeConflictError') {
        throw err;
      }
      throw new Error(`Merge failed: ${err.message || err}`);
    }
  }

  /**
   * Pull (fetch + merge) changes from a remote branch.
   *
   * Fetches remote changes first, then merges the remote tracking branch
   * into the current local branch.
   *
   * @param projectName - Name of the project
   * @param token - Optional authentication token
   * @param remoteName - Remote name (default: "origin")
   * @param corsProxy - Optional CORS proxy URL
   * @param authorName - Author name for merge commit
   * @param authorEmail - Author email for merge commit
   * @returns Merge result with commit OID
   * @throws {Error} If merge fails (other than NotFoundError)
   */
  public static async pull(
    projectName: string,
    token?: string,
    remoteName = 'origin',
    corsProxy?: string,
    authorName = 'SWAL Agent',
    authorEmail = 'agent@swal.dev'
  ): Promise<{ oid: string; alreadyMerged?: boolean }> {
    const dir = `/projects/${projectName}`;

    // Fetch remote changes first
    await this.fetch(projectName, token, remoteName, corsProxy);

    const branchName = (await git.currentBranch({ fs: this.fs, dir })) || 'main';
    const remoteRef = `refs/remotes/${remoteName}/${branchName}`;

    try {
      return await this.merge(projectName, remoteRef, branchName, authorName, authorEmail);
    } catch (err: any) {
      if (err.name === 'NotFoundError') {
        // If remote branch is not found, maybe it hasn't been created on remote yet.
        return { oid: '', alreadyMerged: true };
      }
      throw err;
    }
  }

  /**
   * Get the raw LightningFS instance for direct filesystem access.
   *
   * @returns The LightningFS instance
   */
  public static getRawFS() {
    return this.fs;
  }
}
