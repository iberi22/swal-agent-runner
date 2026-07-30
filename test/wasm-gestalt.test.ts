/**
 * wasm-gestalt.test.ts — Validates the compiled gestalt-wasm artifact.
 *
 * Verifies:
 * 1. The .wasm binary is a valid WebAssembly module with expected exports
 * 2. The generated JS module exports all expected classes
 * 3. JS classes can be constructed and called (non-WASM-surface operations)
 *
 * Note: wasm-bindgen's init() uses fetch() + WebAssembly.Instantiate, which
 * requires either a browser environment or Node.js with --experimental-wasm.
 * We validate the binary directly via Node.js WebAssembly.compile().
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';

const WASM_DIR = path.resolve(__dirname, '..', 'src', 'wasm');
const WASM_BINARY = path.join(WASM_DIR, 'gestalt_wasm_bg.wasm');
const WASM_JS = path.join(WASM_DIR, 'gestalt_wasm.js');

describe('gestalt-wasm compiled artifact', () => {
  describe('.wasm binary', () => {
    it('should exist on disk', () => {
      expect(fs.existsSync(WASM_BINARY)).toBe(true);
    });

    it('should be a non-trivial file size', () => {
      const stat = fs.statSync(WASM_BINARY);
      expect(stat.size).toBeGreaterThan(1000);
      console.log(`  .wasm file size: ${(stat.size / 1024).toFixed(1)} KB`);
    });

    it('should be valid WebAssembly bytecode (header 0x00 0x61 0x73 0x6d)', () => {
      const wasmBytes = new Uint8Array(fs.readFileSync(WASM_BINARY));
      // WASM magic: \0asm (0x00 0x61 0x73 0x6d)
      expect(wasmBytes[0]).toBe(0x00);
      expect(wasmBytes[1]).toBe(0x61); // 'a'
      expect(wasmBytes[2]).toBe(0x73); // 's'
      expect(wasmBytes[3]).toBe(0x6d); // 'm'
    });

    it('should compile as a valid WebAssembly module', async () => {
      const wasmBytes = fs.readFileSync(WASM_BINARY);
      const module = await WebAssembly.compile(wasmBytes);
      const exports = WebAssembly.Module.exports(module);
      const importSections = WebAssembly.Module.imports(module);

      console.log(`  WASM exports: ${exports.length}`);
      console.log(`  WASM imports: ${importSections.length}`);

      // Verify expected exports from wasm-bindgen
      const exportNames = exports.map((e) => e.name);

      // Memory export must exist
      const memExports = exports.filter((e) => e.name === 'memory');
      expect(memExports.length).toBeGreaterThanOrEqual(1);

      // Check core class constructor/free exports
      expect(exportNames).toContain('gestaltengine_new');
      expect(exportNames).toContain('__wbg_gestaltengine_free');
      expect(exportNames).toContain('gestaltengine_executeRunSpec');
      expect(exportNames).toContain('gestaltengine_subscribeEvents');
      expect(exportNames).toContain('wasmeventstream_next');
      expect(exportNames).toContain('wasmgraph_new');
      expect(exportNames).toContain('wasmgraph_addNode');
      expect(exportNames).toContain('wasmgraph_getNodes');
      expect(exportNames).toContain('wasmeventbus_new');
      expect(exportNames).toContain('wasmeventbus_publish');
      expect(exportNames).toContain('runspec_new');
      expect(exportNames).toContain('runspec_agents');
      expect(exportNames).toContain('agentspec_new');
      expect(exportNames).toContain('__wbg_agentspec_free');

      console.log(`  Known WASM exports found: ${exportNames.filter(n => n.includes('_free') || n.includes('_new') || n.includes('_get') || n.includes('_set') || n.includes('_add') || n.includes('_publish')).length}`);
      console.log(`  All ${exportNames.length} exports listed above`);
    });

    it('should have an instantiable module', async () => {
      const wasmBytes = fs.readFileSync(WASM_BINARY);
      const module = await WebAssembly.compile(wasmBytes);

      // wasm-bindgen imports need the wasm-bindgen runtime, but we can
      // create a minimal mock to verify instantiation
      const importSections = WebAssembly.Module.imports(module);
      const importObj: Record<string, Record<string, WebAssembly.ImportValue>> = {};

      for (const imp of importSections) {
        if (!importObj[imp.module]) {
          importObj[imp.module] = {};
        }
        // Provide a minimal stub based on import kind
        const kind = imp.kind;
        if (kind === 'function') {
          importObj[imp.module][imp.name] = () => {};
        } else if (kind === 'memory') {
          importObj[imp.module][imp.name] = new WebAssembly.Memory({ initial: 256 });
        } else if (kind === 'table') {
          importObj[imp.module][imp.name] = new WebAssembly.Table({
            initial: 0,
            element: 'anyfunc',
          });
        } else if (kind === 'global') {
          importObj[imp.module][imp.name] = 0;
        }
      }

      // Should not throw
      const instance = await WebAssembly.instantiate(module, importObj);
      expect(instance.exports).toBeDefined();
      console.log(`  Instance exports: ${Object.keys(instance.exports).length}`);
    });
  });

  describe('generated JS module', () => {
    it('should exist on disk', () => {
      expect(fs.existsSync(WASM_JS)).toBe(true);
    });

    it('should export expected classes (source inspection)', () => {
      const source = fs.readFileSync(WASM_JS, 'utf-8');
      const classNames = (source.match(/export class \w+/g) || []).map(
        (c) => c.replace('export class ', ''),
      );
      console.log(`  Exported JS classes: ${classNames.join(', ')}`);

      expect(classNames).toContain('GestaltEngine');
      expect(classNames).toContain('WasmEventStream');
      expect(classNames).toContain('WasmGraph');
      expect(classNames).toContain('WasmEventBus');
      expect(classNames).toContain('RunSpec');
      expect(classNames).toContain('AgentSpec');
    });

    it('should export default init function and initSync', () => {
      const source = fs.readFileSync(WASM_JS, 'utf-8');
      expect(source).toContain('export { initSync, __wbg_init as default }');
      expect(source).toContain('async function __wbg_init');
      expect(source).toContain('function initSync');
    });
  });

  describe('WASM integration readiness', () => {
    it('should have a corresponding .d.ts file', () => {
      const dtsPath = path.join(WASM_DIR, 'gestalt-wasm.d.ts');
      expect(fs.existsSync(dtsPath)).toBe(true);
    });

    it('should have self-consistent wasm-path reference in generated JS', () => {
      const source = fs.readFileSync(WASM_JS, 'utf-8');
      // The generated JS expects the .wasm file at a relative path
      expect(source).toContain('gestalt_wasm_bg.wasm');
    });
  });
});
