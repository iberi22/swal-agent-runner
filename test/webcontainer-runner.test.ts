import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock GitWorkspaceService before importing WebContainerRunnerService
vi.mock('../src/services/git/git-service', () => ({
  GitWorkspaceService: {
    listDirectory: vi.fn(),
    readFile: vi.fn(),
  },
}));

// Use vi.hoisted to create mock objects before vi.mock factory is hoisted
const { mockInstance, mockWebContainerModule } = vi.hoisted(() => {
  const mockProcess = {
    output: new ReadableStream({
      start(controller: any) {
        controller.enqueue('test output\n');
        controller.close();
      },
    }),
    exit: Promise.resolve(0),
  };

  const _mockInstance = {
    mount: vi.fn().mockResolvedValue(undefined),
    spawn: vi.fn().mockResolvedValue(mockProcess),
  };

  const _mockWebContainerModule = {
    WebContainer: {
      boot: vi.fn().mockResolvedValue(_mockInstance),
    },
  };

  return { mockInstance: _mockInstance, mockWebContainerModule: _mockWebContainerModule };
});

vi.mock('@webcontainer/api', () => mockWebContainerModule);

import { WebContainerRunnerService } from '../src/services/runtime/webcontainer-runner';
import { GitWorkspaceService } from '../src/services/git/git-service';

describe('WebContainerRunnerService', () => {
  beforeEach(() => {
    // Reset singleton state before each test
    (WebContainerRunnerService as any).instancePromise = null;
    vi.clearAllMocks();
    // Re-stub mockInstance after clearAllMocks
    mockInstance.mount.mockResolvedValue(undefined);
    const defaultProcess = {
      output: new ReadableStream({
        start(controller: any) {
          controller.enqueue('test output\n');
          controller.close();
        },
      }),
      exit: Promise.resolve(0),
    };
    mockInstance.spawn.mockResolvedValue(defaultProcess);
    mockWebContainerModule.WebContainer.boot.mockResolvedValue(mockInstance);
  });

  // ── getInstance() ──────────────────────────────────────

  it('should boot WebContainer on first call to getInstance', async () => {
    const instance = await WebContainerRunnerService.getInstance();

    expect(mockWebContainerModule.WebContainer.boot).toHaveBeenCalledTimes(1);
    expect(instance).toBe(mockInstance);
  });

  it('should return the cached instance on subsequent calls', async () => {
    const instance1 = await WebContainerRunnerService.getInstance();
    const instance2 = await WebContainerRunnerService.getInstance();

    expect(mockWebContainerModule.WebContainer.boot).toHaveBeenCalledTimes(1);
    expect(instance1).toBe(instance2);
  });

  it('should clear instancePromise and throw on boot failure', async () => {
    mockWebContainerModule.WebContainer.boot.mockRejectedValueOnce(
      new Error('COEP/COOP missing'),
    );

    await expect(WebContainerRunnerService.getInstance()).rejects.toThrow(
      'WebContainer boot failed: COEP/COOP missing. Ensure COEP/COOP headers are configured.',
    );

    // instancePromise should be null so a subsequent call retries
    expect((WebContainerRunnerService as any).instancePromise).toBeNull();
    expect(mockWebContainerModule.WebContainer.boot).toHaveBeenCalledTimes(1);

    // Next call should try booting again
    mockWebContainerModule.WebContainer.boot.mockResolvedValue(mockInstance);
    const instance = await WebContainerRunnerService.getInstance();
    expect(mockWebContainerModule.WebContainer.boot).toHaveBeenCalledTimes(2);
  });

  it('should handle boot failure with non-Error rejection', async () => {
    mockWebContainerModule.WebContainer.boot.mockRejectedValueOnce('string error');

    await expect(WebContainerRunnerService.getInstance()).rejects.toThrow(
      'WebContainer boot failed: string error. Ensure COEP/COOP headers are configured.',
    );
  });

  // ── mountProjectFiles() ────────────────────────────────

  it('should mount project files into WebContainer', async () => {
    vi.mocked(GitWorkspaceService.listDirectory).mockResolvedValue([
      'package.json',
      'src/index.ts',
    ]);
    vi.mocked(GitWorkspaceService.readFile).mockImplementation(
      async (_project: string, file: string) => {
        if (file === 'package.json') return '{"name":"test"}';
        if (file === 'src/index.ts') return 'console.log("hi");';
        return '';
      },
    );

    await WebContainerRunnerService.mountProjectFiles('test-project');

    expect(GitWorkspaceService.listDirectory).toHaveBeenCalledWith('test-project');
    expect(mockInstance.mount).toHaveBeenCalledWith({
      'package.json': { file: { contents: '{"name":"test"}' } },
      'src/index.ts': { file: { contents: 'console.log("hi");' } },
    });
  });

  it('should handle empty directory during mount', async () => {
    vi.mocked(GitWorkspaceService.listDirectory).mockResolvedValue([]);

    await WebContainerRunnerService.mountProjectFiles('empty-project');

    expect(mockInstance.mount).toHaveBeenCalledWith({});
  });

  it('should skip unreadable files during mount', async () => {
    vi.mocked(GitWorkspaceService.listDirectory).mockResolvedValue([
      'readable.txt',
      'unreadable.bin',
    ]);
    vi.mocked(GitWorkspaceService.readFile).mockImplementation(
      async (_project: string, file: string) => {
        if (file === 'unreadable.bin') throw new Error('binary file');
        return 'hello';
      },
    );

    await WebContainerRunnerService.mountProjectFiles('test-project');

    expect(mockInstance.mount).toHaveBeenCalledWith({
      'readable.txt': { file: { contents: 'hello' } },
    });
    const mountArg = mockInstance.mount.mock.calls[0][0];
    expect(mountArg['unreadable.bin']).toBeUndefined();
  });

  // ── runCommand() ───────────────────────────────────────

  it('should run a command and return exit code and output', async () => {
    const result = await WebContainerRunnerService.runCommand('node', ['--version']);

    expect(mockInstance.spawn).toHaveBeenCalledWith('node', ['--version']);
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe('test output\n');
  });

  it('should pass output chunks to onOutput callback', async () => {
    const onOutput = vi.fn();
    const result = await WebContainerRunnerService.runCommand('echo', ['hello'], onOutput);

    expect(onOutput).toHaveBeenCalledWith('test output\n');
    expect(result.exitCode).toBe(0);
  });

  it('should run command with no args', async () => {
    const result = await WebContainerRunnerService.runCommand('ls');

    expect(mockInstance.spawn).toHaveBeenCalledWith('ls', []);
    expect(result.exitCode).toBe(0);
  });

  // ── installDependencies() ──────────────────────────────

  it('should run npm install via installDependencies', async () => {
    const result = await WebContainerRunnerService.installDependencies();

    expect(mockInstance.spawn).toHaveBeenCalledWith('npm', ['install']);
    expect(result.exitCode).toBe(0);
  });

  it('should pass onOutput to installDependencies', async () => {
    const onOutput = vi.fn();
    await WebContainerRunnerService.installDependencies(onOutput);

    expect(onOutput).toHaveBeenCalled();
  });

  // ── runTests() ─────────────────────────────────────────

  it('should run npm test via runTests', async () => {
    const result = await WebContainerRunnerService.runTests();

    expect(mockInstance.spawn).toHaveBeenCalledWith('npm', ['test']);
    expect(result.exitCode).toBe(0);
  });

  it('should pass onOutput to runTests', async () => {
    const onOutput = vi.fn();
    await WebContainerRunnerService.runTests(onOutput);

    expect(onOutput).toHaveBeenCalled();
  });

  // ── Edge Cases ─────────────────────────────────────────

  it('should handle spawn failure gracefully', async () => {
    mockInstance.spawn.mockRejectedValueOnce(new Error('command not found'));

    await expect(
      WebContainerRunnerService.runCommand('nonexistent'),
    ).rejects.toThrow('command not found');
  });

  it('should handle non-zero exit codes', async () => {
    const failingProcess = {
      output: new ReadableStream({
        start(controller: any) {
          controller.enqueue('error occurred');
          controller.close();
        },
      }),
      exit: Promise.resolve(1),
    };
    mockInstance.spawn.mockResolvedValue(failingProcess);

    const result = await WebContainerRunnerService.runCommand('npm', ['test']);

    expect(result.exitCode).toBe(1);
    expect(result.output).toBe('error occurred');
  });
});
