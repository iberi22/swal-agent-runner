import { GitWorkspaceService } from '../git/git-service';

/**
 * PythonRunnerService
 * ===================
 * Service managing execution of Python code within the browser using Pyodide WASM runtime.
 * Provides capabilities to lazy-initialize Pyodide, execute scripts capturing output/errors,
 * install packages via pip (micropip), and mount files from the local Git workspace into
 * Pyodide's virtual filesystem.
 */
export class PythonRunnerService {
  /**
   * Promise that resolves when Pyodide has finished loading and initializing.
   * @private
   */
  private static pyodidePromise: Promise<any> | null = null;

  /**
   * Cache of the initialized Pyodide instance.
   * @private
   */
  private static pyodideInstance: any = null;

  /**
   * Lazy loads and initializes the Pyodide WASM runtime.
   * Downloads Pyodide from public CDN if not already loaded in the window environment.
   *
   * @returns A promise resolving to the initialized Pyodide instance.
   * @throws An error if called in a non-browser environment or if initialization/loading fails.
   */
  public static async getInstance(): Promise<any> {
    if (this.pyodideInstance) {
      return this.pyodideInstance;
    }

    if (this.pyodidePromise) {
      return this.pyodidePromise;
    }

    this.pyodidePromise = (async () => {
      try {
        // Ensure we are in a browser environment
        if (typeof window !== 'undefined') {
          // 1. Load Pyodide script from CDN if not already loaded globally
          if (!(window as any).loadPyodide) {
            await new Promise<void>((resolve, reject) => {
              const script = document.createElement('script');
              script.src = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js';
              script.async = true;
              script.onload = () => resolve();
              script.onerror = (err) => reject(new Error(`Failed to load Pyodide script: ${err}`));
              document.head.appendChild(script);
            });
          }

          // 2. Initialize Pyodide with indexURL pointing to CDN
          if ((window as any).loadPyodide) {
            const pyodide = await (window as any).loadPyodide({
              indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/',
            });
            this.pyodideInstance = pyodide;
            return pyodide;
          }
        }

        throw new Error('Pyodide is only available in the browser/PWA context.');
      } catch (err: any) {
        this.pyodidePromise = null;
        throw new Error(`Pyodide initialization failed: ${err.message || err}`);
      }
    })();

    return this.pyodidePromise;
  }

  /**
   * Runs raw Python code in the Pyodide runtime environment.
   * Automatically intercepts standard output/error and forwards them to `onOutput` if provided.
   *
   * @param code - The Python script/code block to execute.
   * @param onOutput - Optional callback that fires whenever stdout/stderr receives newline-buffered logs.
   * @returns A promise resolving to an object containing the process `exitCode` (0 for success, 1 for failure) and complete standard `output` logs.
   */
  public static async runCode(
    code: string,
    onOutput?: (data: string) => void
  ): Promise<{ exitCode: number; output: string }> {
    try {
      const pyodide = await this.getInstance();

      let output = '';
      const handleOutput = (text: string) => {
        const line = text + '\n';
        output += line;
        if (onOutput) {
          onOutput(line);
        }
      };

      // Direct Pyodide's stdout and stderr to our handlers
      pyodide.setStdout({ batched: handleOutput });
      pyodide.setStderr({ batched: handleOutput });

      // Run code asynchronously
      await pyodide.runPythonAsync(code);

      return { exitCode: 0, output };
    } catch (err: any) {
      const errorMsg = err.message || String(err);
      const output = errorMsg + '\n';
      if (onOutput) {
        onOutput(output);
      }
      return { exitCode: 1, output };
    }
  }

  /**
   * Installs third-party pip packages into the browser-side Pyodide runtime using `micropip`.
   *
   * @param packageName - The exact name of the pip package to install.
   * @param onOutput - Optional callback that captures progress output logs.
   * @returns A promise resolving to an object containing the process `exitCode` (0 for success, 1 for failure) and complete standard `output` logs.
   */
  public static async pipInstall(
    packageName: string,
    onOutput?: (data: string) => void
  ): Promise<{ exitCode: number; output: string }> {
    try {
      const pyodide = await this.getInstance();

      let output = '';
      const log = (msg: string) => {
        output += msg;
        if (onOutput) {
          onOutput(msg);
        }
      };

      log(`Loading micropip in Pyodide...\n`);
      await pyodide.loadPackage('micropip');

      log(`Installing package '${packageName}' via micropip...\n`);
      await pyodide.runPythonAsync(`
import micropip
await micropip.install('${packageName}')
      `);

      log(`Successfully installed package '${packageName}'!\n`);
      return { exitCode: 0, output };
    } catch (err: any) {
      const errorMsg = `pip install failed: ${err.message || err}\n`;
      if (onOutput) {
        onOutput(errorMsg);
      }
      return { exitCode: 1, output: errorMsg };
    }
  }

  /**
   * Mounts files and folders of a Git workspace project recursively into Pyodide's virtual filesystem (FS).
   * This allows the Python scripts executing in Pyodide to read/write workspace project files natively.
   *
   * @param projectName - The name of the project whose files are to be mounted.
   * @returns A promise resolving when the workspace files have finished being fully traversed and written into Pyodide's FS.
   */
  public static async mountProjectFiles(projectName: string): Promise<void> {
    const pyodide = await this.getInstance();
    const fs = GitWorkspaceService.getRawFS();

    const traverseAndMount = async (dirPath: string) => {
      const items = await GitWorkspaceService.listDirectory(projectName, dirPath);
      for (const item of items) {
        const itemPath = dirPath ? `${dirPath}/${item}` : item;
        const fullFSPath = `/projects/${projectName}/${itemPath}`;

        try {
          const stat = await fs.promises.stat(fullFSPath);

          if (stat.isDirectory()) {
            // Create directory in Pyodide virtual FS
            try {
              pyodide.FS.mkdir('/' + itemPath);
            } catch (e: any) {
              if (e.name !== 'ErrnoError' || e.errno !== 17) {
                throw e; // ignore folder already exists (EEXIST)
              }
            }
            // Recurse directory
            await traverseAndMount(itemPath);
          } else {
            // Read file and write to Pyodide FS
            const content = await GitWorkspaceService.readFile(projectName, itemPath);
            pyodide.FS.writeFile('/' + itemPath, content, { encoding: 'utf8' });
          }
        } catch (err) {
          // Gracefully skip unreadable or non-existent files/directories
        }
      }
    };

    await traverseAndMount('');
  }
}
