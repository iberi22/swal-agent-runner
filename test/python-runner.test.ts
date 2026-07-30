/**
 * python-runner.test.ts — Comprehensive unit tests for PythonRunnerService
 *
 * Tests the Pyodide-powered Python execution service:
 * - getInstance() — lazy initialization of Pyodide
 * - runCode() — Python code execution with output capture
 * - pipInstall() — micropip package installation
 * - mountProjectFiles() — Git workspace mounting into Pyodide FS
 *
 * Mocks window.loadPyodide and document.createElement to simulate
 * browser environments without needing an actual Pyodide WASM runtime.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PythonRunnerService } from '../src/services/runtime/python-runner';
import { GitWorkspaceService } from '../src/services/git/git-service';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('../src/services/git/git-service', () => ({
  GitWorkspaceService: {
    getRawFS: vi.fn(),
    listDirectory: vi.fn(),
    readFile: vi.fn(),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────

function createMockPyodideInstance(overrides: Record<string, any> = {}) {
  return {
    setStdout: vi.fn(),
    setStderr: vi.fn(),
    runPythonAsync: vi.fn().mockImplementation(async (code: string) => {
      if (code.includes('print')) {
        const stdoutHandler =
          overrides.setStdout?.mock?.calls?.[0]?.[0]?.batched;
        if (stdoutHandler) stdoutHandler('hello');
      }
      return 'mock-result';
    }),
    loadPackage: vi.fn().mockResolvedValue(undefined),
    FS: {
      mkdir: vi.fn(),
      writeFile: vi.fn(),
    },
    ...overrides,
  };
}

function setupBrowserEnv(mockPyodideInstance: any) {
  // Save originals
  const origWindow = global.window;
  const origDocument = global.document;

  const mockScript: any = {};

  global.window = {
    loadPyodide: vi.fn().mockResolvedValue(mockPyodideInstance),
  } as any;

  global.document = {
    createElement: vi.fn().mockReturnValue(mockScript),
    head: {
      appendChild: vi.fn().mockImplementation((script: any) => {
        if (script.onload) script.onload();
      }),
    },
  } as any;

  return { origWindow, origDocument };
}

function cleanupBrowserEnv(origWindow: any, origDocument: any) {
  global.window = origWindow;
  global.document = origDocument;
}

// ── Describe ─────────────────────────────────────────────────────────

describe('PythonRunnerService', () => {
  let mockPyodide: any;
  let origWindow: any;
  let origDocument: any;

  beforeEach(() => {
    // Reset static state
    (PythonRunnerService as any).pyodidePromise = null;
    (PythonRunnerService as any).pyodideInstance = null;

    mockPyodide = createMockPyodideInstance();
    const env = setupBrowserEnv(mockPyodide);
    origWindow = env.origWindow;
    origDocument = env.origDocument;
  });

  afterEach(() => {
    cleanupBrowserEnv(origWindow, origDocument);
    vi.restoreAllMocks();
  });

  // ── getInstance ──────────────────────────────────────────────────

  describe('getInstance()', () => {
    it('should initialize Pyodide and return the instance', async () => {
      const pyodide = await PythonRunnerService.getInstance();
      expect(pyodide).toBe(mockPyodide);
      expect((global.window as any).loadPyodide).toHaveBeenCalledWith({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/',
      });
    });

    it('should reuse the cached instance on subsequent calls', async () => {
      const first = await PythonRunnerService.getInstance();

      // Force clearing of promise to verify that the instance itself is used as the cache
      (PythonRunnerService as any).pyodidePromise = null;

      const second = await PythonRunnerService.getInstance();
      expect(first).toBe(mockPyodide);
      expect(second).toBe(mockPyodide);
      expect((global.window as any).loadPyodide).toHaveBeenCalledTimes(1);
    });

    it('should not inject script if loadPyodide is already globally available', async () => {
      await PythonRunnerService.getInstance();
      expect(global.document.createElement).not.toHaveBeenCalled();
    });

    it('should inject script tag when loadPyodide is missing globally', async () => {
      delete (global.window as any).loadPyodide;

      global.document.head.appendChild = vi.fn().mockImplementation((script: any) => {
        // Simulate the external script defining loadPyodide on window
        (global.window as any).loadPyodide = vi.fn().mockResolvedValue(mockPyodide);
        if (script.onload) script.onload();
      });

      const pyodide = await PythonRunnerService.getInstance();
      expect(pyodide).toBe(mockPyodide);
      expect(global.document.createElement).toHaveBeenCalledWith('script');
      const scriptEl = (global.document.createElement as any).mock.results[0].value;
      expect(scriptEl.src).toBe(
        'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js',
      );
      expect(scriptEl.async).toBe(true);
    });

    it('should return the pending promise when called concurrently', async () => {
      // The first call creates the promise; the second should reuse it
      const promise1 = PythonRunnerService.getInstance();
      const p1 = (PythonRunnerService as any).pyodidePromise;

      const promise2 = PythonRunnerService.getInstance();
      const p2 = (PythonRunnerService as any).pyodidePromise;

      expect(p1).toBe(p2);
      expect(p1).not.toBeNull();

      // Both promises should resolve to the same instance
      const result1 = await promise1;
      const result2 = await promise2;
      expect(result1).toBe(mockPyodide);
      expect(result2).toBe(mockPyodide);
    });

    it('should reinitialize after a failed initialization', async () => {
      // First call fails
      (global.window as any).loadPyodide = vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue(mockPyodide);

      await expect(PythonRunnerService.getInstance()).rejects.toThrow(
        'Pyodide initialization failed',
      );

      // Retry should succeed
      const pyodide = await PythonRunnerService.getInstance();
      expect(pyodide).toBe(mockPyodide);
    });

    it('should throw when called in non-browser environment', async () => {
      // Simulate non-browser
      const win = global.window;
      (global as any).window = undefined as any;

      await expect(PythonRunnerService.getInstance()).rejects.toThrow(
        'Pyodide is only available in the browser/PWA context.',
      );

      (global as any).window = win;
    });

    it('should reject when the injected script fails to load', async () => {
      delete (global.window as any).loadPyodide;

      global.document.head.appendChild = vi.fn().mockImplementation((script: any) => {
        if (script.onerror) {
          script.onerror('timeout');
        }
      });

      await expect(PythonRunnerService.getInstance()).rejects.toThrow(
        'Failed to load Pyodide script',
      );
    });
  });

  // ── runCode ──────────────────────────────────────────────────────

  describe('runCode()', () => {
    it('should execute Python code and capture stdout', async () => {
      let outputReceived = '';
      const onOutput = (data: string) => {
        outputReceived += data;
      };

      // Override setStdout to trigger batched callback
      mockPyodide.setStdout = vi.fn((handler: any) => {
        if (handler.batched) handler.batched('hello');
      });

      const res = await PythonRunnerService.runCode('print("hello")', onOutput);
      expect(res.exitCode).toBe(0);
      expect(res.output).toBe('hello\n');
      expect(outputReceived).toBe('hello\n');
    });

    it('should capture stdout when no onOutput callback is provided', async () => {
      mockPyodide.setStdout = vi.fn((handler: any) => {
        if (handler.batched) handler.batched('captured-only');
      });
      const res = await PythonRunnerService.runCode('print("captured-only")');
      expect(res.exitCode).toBe(0);
      expect(res.output).toBe('captured-only\n');
    });

    it('should capture errors and return exitCode 1', async () => {
      mockPyodide.runPythonAsync.mockRejectedValue(
        new Error('SyntaxError: invalid syntax'),
      );

      const res = await PythonRunnerService.runCode('invalid code');
      expect(res.exitCode).toBe(1);
      expect(res.output).toBe('SyntaxError: invalid syntax\n');
    });

    it('should call onOutput with the complete error message when execution fails', async () => {
      mockPyodide.runPythonAsync.mockRejectedValue(new Error('Fatal exception'));
      let outputReceived = '';
      const onOutput = (data: string) => {
        outputReceived += data;
      };

      const res = await PythonRunnerService.runCode('raise Exception', onOutput);
      expect(res.exitCode).toBe(1);
      expect(res.output).toBe('Fatal exception\n');
      expect(outputReceived).toBe('Fatal exception\n');
    });

    it('should work without an onOutput callback', async () => {
      mockPyodide.runPythonAsync.mockResolvedValue(undefined);

      const res = await PythonRunnerService.runCode('x = 1 + 1');
      expect(res.exitCode).toBe(0);
      expect(res.output).toBe('');
    });

    it('should forward output to onOutput callback when provided', async () => {
      const outputChunks: string[] = [];
      const onOutput = (data: string) => outputChunks.push(data);

      // Simulate batched output
      mockPyodide.setStdout = vi.fn((handler: any) => {
        if (handler.batched) {
          handler.batched('line1');
          handler.batched('line2');
        }
      });
      mockPyodide.setStderr = vi.fn((handler: any) => {
        if (handler.batched) {
          handler.batched('stderr line');
        }
      });

      const res = await PythonRunnerService.runCode(
        'print("multi-line")',
        onOutput,
      );
      expect(res.exitCode).toBe(0);
      expect(res.output).toBe('line1\nline2\nstderr line\n');
      expect(outputChunks).toEqual(['line1\n', 'line2\n', 'stderr line\n']);
    });

    it('should handle error message being a plain string (not Error)', async () => {
      // Simulate a throw that's not an Error object
      mockPyodide.runPythonAsync.mockRejectedValue('Division by zero');

      const res = await PythonRunnerService.runCode('1/0');
      expect(res.exitCode).toBe(1);
      expect(res.output).toBe('Division by zero\n');
    });
  });

  // ── pipInstall ───────────────────────────────────────────────────

  describe('pipInstall()', () => {
    it('should install a package via micropip successfully', async () => {
      let outputReceived = '';
      const onOutput = (data: string) => {
        outputReceived += data;
      };

      const res = await PythonRunnerService.pipInstall('numpy', onOutput);
      expect(res.exitCode).toBe(0);
      expect(mockPyodide.loadPackage).toHaveBeenCalledWith('micropip');
      expect(mockPyodide.runPythonAsync).toHaveBeenCalledWith(
        expect.stringContaining("await micropip.install('numpy')")
      );

      const expectedOutput =
        "Loading micropip in Pyodide...\n" +
        "Installing package 'numpy' via micropip...\n" +
        "Successfully installed package 'numpy'!\n";

      expect(res.output).toBe(expectedOutput);
      expect(outputReceived).toBe(expectedOutput);
    });

    it('should handle pip install failure', async () => {
      mockPyodide.loadPackage.mockRejectedValue(
        new Error('Package not found: nonexistent-pkg'),
      );

      let outputReceived = '';
      const onOutput = (data: string) => {
        outputReceived += data;
      };

      const res = await PythonRunnerService.pipInstall('nonexistent-pkg', onOutput);
      expect(res.exitCode).toBe(1);

      const expectedErrorMsg = "pip install failed: Package not found: nonexistent-pkg\n";
      const expectedOutputReceived = "Loading micropip in Pyodide...\n" + expectedErrorMsg;

      expect(res.output).toBe(expectedErrorMsg);
      expect(outputReceived).toBe(expectedOutputReceived);
    });

    it('should handle pip install failure when error is a plain string', async () => {
      mockPyodide.loadPackage.mockRejectedValue('Fatal string error');
      const res = await PythonRunnerService.pipInstall('nonexistent-pkg');
      expect(res.exitCode).toBe(1);
      expect(res.output).toBe("pip install failed: Fatal string error\n");
    });

    it('should work without onOutput callback', async () => {
      const res = await PythonRunnerService.pipInstall('requests');
      expect(res.exitCode).toBe(0);
      expect(res.output).toBe(
        "Loading micropip in Pyodide...\n" +
        "Installing package 'requests' via micropip...\n" +
        "Successfully installed package 'requests'!\n"
      );
    });

    it('should handle error during micropip.runPythonAsync throw', async () => {
      // loadPackage succeeds but runPythonAsync fails
      mockPyodide.loadPackage.mockResolvedValue(undefined);
      mockPyodide.runPythonAsync.mockRejectedValue(
        new Error('micropip install failed: dependency conflict'),
      );

      const res = await PythonRunnerService.pipInstall('pandas');
      expect(res.exitCode).toBe(1);
      expect(res.output).toBe("pip install failed: micropip install failed: dependency conflict\n");
    });
  });

  // ── mountProjectFiles ────────────────────────────────────────────

  describe('mountProjectFiles()', () => {
    it('should mount project files recursively into Pyodide FS', async () => {
      const fsMock = {
        promises: {
          stat: vi.fn().mockImplementation(async (path: string) => {
            if (path.endsWith('nested_dir')) {
              return { isDirectory: () => true };
            }
            return { isDirectory: () => false };
          }),
        },
      };

      vi.mocked(GitWorkspaceService.getRawFS).mockReturnValue(fsMock as any);
      vi.mocked(GitWorkspaceService.listDirectory).mockImplementation(
        async (_projectName: string, dirPath?: string) => {
          if (!dirPath) return ['file1.py', 'nested_dir'];
          if (dirPath === 'nested_dir') return ['file2.py'];
          return [];
        },
      );
      vi.mocked(GitWorkspaceService.readFile).mockResolvedValue(
        'print("dummy")',
      );

      await PythonRunnerService.mountProjectFiles('test-project');

      expect(mockPyodide.FS.mkdir).toHaveBeenCalledWith('/nested_dir');
      expect(mockPyodide.FS.writeFile).toHaveBeenCalledWith(
        '/file1.py',
        'print("dummy")',
        { encoding: 'utf8' },
      );
      expect(mockPyodide.FS.writeFile).toHaveBeenCalledWith(
        '/nested_dir/file2.py',
        'print("dummy")',
        { encoding: 'utf8' },
      );
    });

    it('should ignore EEXIST error when creating directories', async () => {
      const fsMock = {
        promises: {
          stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
        },
      };

      vi.mocked(GitWorkspaceService.getRawFS).mockReturnValue(fsMock as any);
      vi.mocked(GitWorkspaceService.listDirectory).mockImplementation(
        async (_projectName: string, dirPath?: string) => {
          // Return items at root level; return empty for nested to prevent recursion
          if (!dirPath) return ['existing_dir'];
          return [];
        },
      );
      vi.mocked(GitWorkspaceService.readFile).mockResolvedValue('');

      const eexistError = new Error('EEXIST: file already exists') as any;
      eexistError.name = 'ErrnoError';
      eexistError.errno = 17;
      mockPyodide.FS.mkdir = vi.fn().mockImplementation(() => {
        throw eexistError;
      });

      // Should not throw — EEXIST is silently ignored
      await expect(
        PythonRunnerService.mountProjectFiles('test-project'),
      ).resolves.toBeUndefined();

      // Verify directory listing continued recursively inside the existing directory
      expect(GitWorkspaceService.listDirectory).toHaveBeenCalledWith('test-project', 'existing_dir');
    });

    it('should skip non-EEXIST mkdir errors gracefully (outer try/catch swallows)', async () => {
      const fsMock = {
        promises: {
          stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
        },
      };

      vi.mocked(GitWorkspaceService.getRawFS).mockReturnValue(fsMock as any);
      vi.mocked(GitWorkspaceService.listDirectory).mockImplementation(
        async (_projectName: string, dirPath?: string) => {
          if (!dirPath) return ['some_dir'];
          return [];
        },
      );
      vi.mocked(GitWorkspaceService.readFile).mockResolvedValue('');

      const permissionError = new Error('EACCES: permission denied') as any;
      permissionError.name = 'ErrnoError';
      permissionError.errno = 13;
      mockPyodide.FS.mkdir = vi.fn().mockImplementation(() => {
        throw permissionError;
      });

      // Non-EEXIST errors from mkdir get re-thrown but are caught by the
      // outer try/catch handler in traverseAndMount, so they're swallowed.
      await expect(
        PythonRunnerService.mountProjectFiles('test-project'),
      ).resolves.toBeUndefined();
    });

    it('should gracefully skip files/dirs that throw stat errors', async () => {
      const fsMock = {
        promises: {
          stat: vi.fn().mockRejectedValue(new Error('ENOENT')),
        },
      };

      vi.mocked(GitWorkspaceService.getRawFS).mockReturnValue(fsMock as any);
      vi.mocked(GitWorkspaceService.listDirectory).mockResolvedValue([
        'broken_file.py',
      ]);

      await expect(
        PythonRunnerService.mountProjectFiles('test-project'),
      ).resolves.toBeUndefined();

      // Should not have tried to write anything since stat failed
      expect(mockPyodide.FS.writeFile).not.toHaveBeenCalled();
    });

    it('should handle readFile errors gracefully', async () => {
      const fsMock = {
        promises: {
          stat: vi.fn().mockResolvedValue({ isDirectory: () => false }),
        },
      };

      vi.mocked(GitWorkspaceService.getRawFS).mockReturnValue(fsMock as any);
      vi.mocked(GitWorkspaceService.listDirectory).mockResolvedValue([
        'unreadable.py',
      ]);
      vi.mocked(GitWorkspaceService.readFile).mockRejectedValue(
        new Error('Permission denied'),
      );

      await expect(
        PythonRunnerService.mountProjectFiles('test-project'),
      ).resolves.toBeUndefined();

      expect(mockPyodide.FS.writeFile).not.toHaveBeenCalled();
    });

    it('should handle empty directory listing', async () => {
      const fsMock = {
        promises: {
          stat: vi.fn(),
        },
      };

      vi.mocked(GitWorkspaceService.getRawFS).mockReturnValue(fsMock as any);
      vi.mocked(GitWorkspaceService.listDirectory).mockResolvedValue([]);

      await expect(
        PythonRunnerService.mountProjectFiles('test-project'),
      ).resolves.toBeUndefined();

      expect(fsMock.promises.stat).not.toHaveBeenCalled();
      expect(mockPyodide.FS.writeFile).not.toHaveBeenCalled();
    });

    it('should abort recursion and not list directory if mkdir fails with non-EEXIST error', async () => {
      const fsMock = {
        promises: {
          stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
        },
      };

      vi.mocked(GitWorkspaceService.getRawFS).mockReturnValue(fsMock as any);
      vi.mocked(GitWorkspaceService.listDirectory).mockImplementation(
        async (_projectName: string, dirPath?: string) => {
          if (!dirPath) return ['bad_dir'];
          if (dirPath === 'bad_dir') return ['should_not_be_reached.py'];
          return [];
        },
      );

      const customError = new Error('Permission Denied') as any;
      customError.name = 'PermissionError';
      customError.errno = 13;
      mockPyodide.FS.mkdir = vi.fn().mockImplementation(() => {
        throw customError;
      });

      await PythonRunnerService.mountProjectFiles('test-project');

      // Since mkdir threw a non-EEXIST error, it should NOT recurse into 'bad_dir'
      expect(GitWorkspaceService.listDirectory).toHaveBeenCalledTimes(1);
      expect(GitWorkspaceService.listDirectory).not.toHaveBeenCalledWith('test-project', 'bad_dir');
    });
  });
});
