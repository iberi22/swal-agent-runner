/**
 * Type declarations for the gestalt-wasm WASM module.
 *
 * The WASM module is produced by wasm-pack from gestalt-wasm/ and copied to
 *   swal-agent-runner/src/wasm/gestalt_wasm.js + gestalt_wasm_bg.wasm
 *
 * Until gestalt-wasm is compiled to wasm32-unknown-unknown with wasm-pack,
 * this file provides the TypeScript type declarations so the rest of the
 * codebase can type-check. The actual module is loaded dynamically and will
 * gracefully fall back to the mock engine if unavailable.
 */

declare module '../wasm/gestalt_wasm.js' {
  /** Initialize the WASM module. Must be called before using GestaltEngine. */
  export default function init(): Promise<void>;

  // ── WasmEngine types matching gestalt-wasm/src/lib.rs wasm-bindgen exports ──

  export class GestaltEngine {
    constructor();
    executeRunSpec(spec: Record<string, unknown>): Record<string, unknown>;
    subscribeEvents(): { next(): string | null };
  }

  export class WasmGraph {
    constructor();
    addNode(node: Record<string, unknown>): void;
    addEdge(edge: Record<string, unknown>): void;
    getNodes(): Record<string, unknown>[];
    getEdges(): Record<string, unknown>[];
  }

  export class WasmEventBus {
    constructor(callback?: (event: string) => void);
    publish(event: string): void;
  }

  export class RunSpec {
    constructor(
      baseRef: string,
      task: string,
      agents: Record<string, unknown>[],
      maxParallel: number,
      timeout: number,
      push: boolean,
      integrationBranch?: string,
    );
    agents(): Record<string, unknown>[];
  }

  export class AgentSpec {
    constructor(id: string, command: string, args: string[]);
    id: string;
    command: string;
    args: string[];
  }
}

// Also provide a wildcard type for any other wasm imports
declare module '*.wasm' {
  const content: string;
  export default content;
}

declare module '*.wasm.js' {
  const init: () => Promise<void>;
  export default init;
}
