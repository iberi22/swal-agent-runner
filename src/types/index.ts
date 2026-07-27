export type LLMProviderType = 'gemini-oauth' | 'gemini-key' | 'openrouter' | 'opencode' | 'anthropic' | 'custom';

export interface ProviderConfig {
  type: LLMProviderType;
  name: string;
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  oauthToken?: string;
  oauthRefreshToken?: string;
  oauthExpiresAt?: number;
  userEmail?: string;
}

export interface ProjectRepo {
  id: string;
  name: string;
  url: string;
  branch: string;
  lastSyncedAt: number;
  status: 'synced' | 'cloning' | 'modified' | 'error';
  sizeBytes?: number;
}

export type TaskStatus = 'pending' | 'planning' | 'executing' | 'verifying' | 'completed' | 'failed' | 'paused';

export interface TaskStep {
  id: string;
  timestamp: number;
  phase: 'plan' | 'read' | 'edit' | 'exec' | 'verify' | 'memory' | 'git';
  actionSummary: string;
  toolUsed?: string;
  outputSnippet?: string;
  status: 'success' | 'warning' | 'error';
}

export interface TaskResult {
  success: boolean;
  summary: string;
  diffSummary?: string;
  changedFiles: string[];
  testOutput?: string;
  branchName: string;
  commitHash?: string;
}

export interface CodingTask {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  targetBranch: string;
  status: TaskStatus;
  createdAt: number;
  completedAt?: number;
  providerType: LLMProviderType;
  modelName: string;
  steps: TaskStep[];
  result?: TaskResult;
  error?: string;
}

export interface MemoryChunk {
  id: string;
  projectId: string;
  content: string;
  category: 'episodic' | 'semantic' | 'procedural' | 'working';
  embedding?: number[];
  score?: number;
  source: string;
  timestamp: number;
  syncedToMaster: boolean;
}

export interface XavierPairStatus {
  paired: boolean;
  endpoint: string;
  lastSyncAt: number;
  pendingSyncCount: number;
  connectionState: 'connected' | 'connecting' | 'disconnected' | 'error';
}

export interface AgentToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export interface AgentToolCall {
  name: string;
  arguments: Record<string, unknown>;
}
