import git from 'isomorphic-git';
import LightningFS from '@isomorphic-git/lightning-fs';
import http from 'isomorphic-git/http/web';
import { ProjectRepo } from '../../types';

export class GitWorkspaceService {
  private static fs = new LightningFS('swal_agent_git_fs');
  private static defaultCorsProxy = 'https://cors-proxy.swal.dev';

  public static async listProjects(): Promise<ProjectRepo[]> {
    const raw = localStorage.getItem('swal_git_projects');
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  public static async saveProjects(projects: ProjectRepo[]): Promise<void> {
    localStorage.setItem('swal_git_projects', JSON.stringify(projects));
  }

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

  public static async readFile(projectName: string, filePath: string): Promise<string> {
    const fullPath = `/projects/${projectName}/${filePath.replace(/^\//, '')}`;
    const data = (await this.fs.promises.readFile(fullPath, 'utf8')) as string;
    return data;
  }

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

  public static async listDirectory(projectName: string, dirPath: string = ''): Promise<string[]> {
    const fullPath = `/projects/${projectName}/${dirPath.replace(/^\//, '')}`.replace(/\/$/, '');
    try {
      const files = await this.fs.promises.readdir(fullPath);
      return files.filter((f) => f !== '.git');
    } catch {
      return [];
    }
  }

  public static async commitChanges(projectName: string, message: string, authorName = 'SWAL Agent', authorEmail = 'agent@swal.dev'): Promise<string> {
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

  public static getRawFS() {
    return this.fs;
  }
}
