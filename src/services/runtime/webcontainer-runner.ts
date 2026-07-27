import { WebContainer } from '@webcontainer/api';
import { GitWorkspaceService } from '../git/git-service';

export class WebContainerRunnerService {
  private static instancePromise: Promise<WebContainer> | null = null;

  public static async getInstance(): Promise<WebContainer> {
    if (!this.instancePromise) {
      this.instancePromise = WebContainer.boot().catch((err) => {
        this.instancePromise = null;
        throw new Error(`WebContainer boot failed: ${err.message || err}. Ensure COEP/COOP headers are configured.`);
      });
    }
    return this.instancePromise;
  }

  public static async mountProjectFiles(projectName: string): Promise<void> {
    const instance = await this.getInstance();
    const files = await GitWorkspaceService.listDirectory(projectName);

    const mountTree: Record<string, { file: { contents: string } }> = {};

    for (const file of files) {
      try {
        const content = await GitWorkspaceService.readFile(projectName, file);
        mountTree[file] = {
          file: { contents: content },
        };
      } catch {
        // Skip binaries or unreadable files for now
      }
    }

    await instance.mount(mountTree);
  }

  public static async runCommand(
    command: string,
    args: string[] = [],
    onOutput?: (data: string) => void
  ): Promise<{ exitCode: number; output: string }> {
    const instance = await this.getInstance();
    const process = await instance.spawn(command, args);

    let output = '';

    process.output.pipeTo(
      new WritableStream({
        write(chunk) {
          output += chunk;
          if (onOutput) {
            onOutput(chunk);
          }
        },
      })
    );

    const exitCode = await process.exit;
    return { exitCode, output };
  }

  public static async installDependencies(onOutput?: (data: string) => void): Promise<{ exitCode: number; output: string }> {
    return this.runCommand('npm', ['install'], onOutput);
  }

  public static async runTests(onOutput?: (data: string) => void): Promise<{ exitCode: number; output: string }> {
    return this.runCommand('npm', ['test'], onOutput);
  }
}
