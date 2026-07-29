import { describe, it, expect, beforeEach } from 'vitest';

describe('GitWorkspaceService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should return empty projects list initially', async () => {
    const { GitWorkspaceService } = await import('../git-service');
    const projects = await GitWorkspaceService.listProjects();
    expect(projects).toEqual([]);
  });

  it('should save and retrieve projects', async () => {
    const { GitWorkspaceService } = await import('../git-service');
    const projects = [
      { id: '1', name: 'test-repo', url: 'https://github.com/user/repo.git', branch: 'main', lastSyncedAt: Date.now(), status: 'synced' as const },
    ];
    await GitWorkspaceService.saveProjects(projects);
    const loaded = await GitWorkspaceService.listProjects();
    expect(loaded).toEqual(projects);
  });

  it('should create and read files in LightningFS workspace', async () => {
    const { GitWorkspaceService } = await import('../git-service');
    const projectName = 'test-project-' + Date.now();

    // LightningFS is static, we don't need to init a repo
    // Just test that we can write and read files via the service
    await GitWorkspaceService.writeFile(projectName, 'test.txt', 'hello world');
    const content = await GitWorkspaceService.readFile(projectName, 'test.txt');
    expect(content).toBe('hello world');
  });

  it('should list files in directory', async () => {
    const { GitWorkspaceService } = await import('../git-service');
    const projectName = 'list-test-' + Date.now();

    await GitWorkspaceService.writeFile(projectName, 'src/index.ts', 'export const a = 1;');
    await GitWorkspaceService.writeFile(projectName, 'src/utils.ts', 'export const b = 2;');
    await GitWorkspaceService.writeFile(projectName, 'README.md', '# Test');

    const rootFiles = await GitWorkspaceService.listDirectory(projectName, '');
    expect(rootFiles).toContain('src');
    expect(rootFiles).toContain('README.md');

    const srcFiles = await GitWorkspaceService.listDirectory(projectName, 'src');
    expect(srcFiles).toContain('index.ts');
    expect(srcFiles).toContain('utils.ts');
  });

  it('should create parent directories on write', async () => {
    const { GitWorkspaceService } = await import('../git-service');
    const projectName = 'mkdir-test-' + Date.now();

    await GitWorkspaceService.writeFile(projectName, 'a/b/c/deep-file.ts', 'deep content');
    const content = await GitWorkspaceService.readFile(projectName, 'a/b/c/deep-file.ts');
    expect(content).toBe('deep content');
  });

  it('should handle non-existent directory listing', async () => {
    const { GitWorkspaceService } = await import('../git-service');
    const files = await GitWorkspaceService.listDirectory('nonexistent', '');
    expect(files).toEqual([]);
  });

  it('should return empty array on corrupted localStorage', async () => {
    localStorage.setItem('swal_git_projects', 'INVALID_JSON{{{');
    const { GitWorkspaceService } = await import('../git-service');
    const projects = await GitWorkspaceService.listProjects();
    expect(projects).toEqual([]);
  });
});
