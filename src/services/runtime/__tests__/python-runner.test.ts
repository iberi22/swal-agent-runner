import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PythonRunnerService } from '../python-runner';
import { GitWorkspaceService } from '../../git/git-service';

// Mock the GitWorkspaceService
vi.mock('../../git/git-service', () => {
  return {
    GitWorkspaceService: {
      getRawFS: vi.fn(),
      listDirectory: vi.fn(),
      readFile: vi.fn(),
    },
  };
});

describe('PythonRunnerService', () => {
  let mockPyodideInstance: any;
  let originalWindow: any;
  let originalDocument: any;

  beforeEach(() => {
    // Reset modules and states
    (PythonRunnerService as any).pyodidePromise = null;
    (PythonRunnerService as any).pyodideInstance = null;

    mockPyodideInstance = {
      setStdout: vi.fn(),
      setStderr: vi.fn(),
      runPythonAsync: vi.fn().mockImplementation(async (code: string) => {
        if (code.includes('print')) {
          // Trigger the standard output handler if configured
          const stdoutHandler = mockPyodideInstance.setStdout.mock.calls[0]?.[0]?.batched;
          if (stdoutHandler) {
            stdoutHandler('hello');
          }
        }
        return 'mock-result';
      }),
      loadPackage: vi.fn().mockResolvedValue(undefined),
      FS: {
        mkdir: vi.fn(),
        writeFile: vi.fn(),
      },
    };

    // Save originals
    originalWindow = global.window;
    originalDocument = global.document;

    // Define mock window and document globally
    const mockScript: any = {};
    global.window = {
      loadPyodide: vi.fn().mockResolvedValue(mockPyodideInstance),
    } as any;

    global.document = {
      createElement: vi.fn().mockReturnValue(mockScript),
      head: {
        appendChild: vi.fn().mockImplementation((script: any) => {
          // Simulate dynamic loading of script
          if (script.onload) {
            script.onload();
          }
        }),
      },
    } as any;
  });

  afterEach(() => {
    global.window = originalWindow;
    global.document = originalDocument;
    vi.restoreAllMocks();
  });

  it('should use globally available loadPyodide if already defined', async () => {
    const pyodide = await PythonRunnerService.getInstance();
    expect(pyodide).toBe(mockPyodideInstance);
    expect(global.document.createElement).not.toHaveBeenCalled();
    expect((global.window as any).loadPyodide).toHaveBeenCalled();
  });

  it('should dynamically inject script when loadPyodide is not globally defined', async () => {
    // Delete loadPyodide to force script injection
    delete (global.window as any).loadPyodide;

    // When the script tag runs, simulate it defining loadPyodide on window
    global.document.head.appendChild = vi.fn().mockImplementation((script: any) => {
      (global.window as any).loadPyodide = vi.fn().mockResolvedValue(mockPyodideInstance);
      if (script.onload) {
        script.onload();
      }
    });

    const pyodide = await PythonRunnerService.getInstance();
    expect(pyodide).toBe(mockPyodideInstance);
    expect(global.document.createElement).toHaveBeenCalledWith('script');
    expect((global.window as any).loadPyodide).toHaveBeenCalled();
  });

  it('should execute Python code and capture output', async () => {
    let outputReceived = '';
    const onOutput = (data: string) => {
      outputReceived += data;
    };

    const res = await PythonRunnerService.runCode('print("hello")', onOutput);
    expect(res.exitCode).toBe(0);
    expect(res.output).toContain('hello');
    expect(outputReceived).toContain('hello');
  });

  it('should handle errors gracefully during code execution', async () => {
    mockPyodideInstance.runPythonAsync.mockRejectedValue(new Error('SyntaxError: invalid syntax'));

    const res = await PythonRunnerService.runCode('invalid code');
    expect(res.exitCode).toBe(1);
    expect(res.output).toContain('SyntaxError: invalid syntax');
  });

  it('should support package installation via micropip', async () => {
    let outputReceived = '';
    const onOutput = (data: string) => {
      outputReceived += data;
    };

    const res = await PythonRunnerService.pipInstall('numpy', onOutput);
    expect(res.exitCode).toBe(0);
    expect(mockPyodideInstance.loadPackage).toHaveBeenCalledWith('micropip');
    expect(mockPyodideInstance.runPythonAsync).toHaveBeenCalled();
    expect(outputReceived).toContain('Successfully installed package');
  });

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
    vi.mocked(GitWorkspaceService.listDirectory).mockImplementation(async (projectName: string, dirPath?: string) => {
      if (!dirPath) {
        return ['file1.py', 'nested_dir'];
      }
      if (dirPath === 'nested_dir') {
        return ['file2.py'];
      }
      return [];
    });
    vi.mocked(GitWorkspaceService.readFile).mockResolvedValue('print("dummy")');

    await PythonRunnerService.mountProjectFiles('test-project');

    // Root level folder traversal & creation
    expect(mockPyodideInstance.FS.mkdir).toHaveBeenCalledWith('/nested_dir');
    // Root level file write
    expect(mockPyodideInstance.FS.writeFile).toHaveBeenCalledWith('/file1.py', 'print("dummy")', { encoding: 'utf8' });
    // Nested level file write
    expect(mockPyodideInstance.FS.writeFile).toHaveBeenCalledWith('/nested_dir/file2.py', 'print("dummy")', { encoding: 'utf8' });
  });
});
