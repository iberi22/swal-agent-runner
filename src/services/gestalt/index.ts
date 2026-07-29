/**
 * Gestalt services barrel export.
 *
 * Import the GestaltBridge singleton:
 *   import { gestaltBridge } from './services/gestalt';
 *
 * Or import individual types:
 *   import type { RunSpec, RunReport } from './services/gestalt';
 */

export { GestaltBridge, gestaltBridge } from './gestalt-bridge';
export type {
  AgentSpec,
  RunSpec,
  AgentResult,
  RunReport,
  GestaltStatus,
  BridgeState,
} from './gestalt-bridge';
