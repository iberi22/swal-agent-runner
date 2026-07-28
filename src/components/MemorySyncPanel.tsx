import React, { useState, useEffect } from 'react';
import {
  Database,
  RefreshCw,
  Radio,
  Server,
  HardDrive,
  Clock,
  Zap,
  CloudUpload,
  CloudOff,
  Layers,
} from 'lucide-react';
import { XavierPairStatus, MemoryChunk } from '../types';
import { EdgeMeshSyncService } from '../services/memory/edge-mesh-sync';
import { XavierMemoryNode } from '../services/memory/xavier-memory-node';
import { timeAgo } from '../lib/format';

const CONNECTION_META: Record<
  XavierPairStatus['connectionState'],
  { label: string; dot: string; text: string; ring: string }
> = {
  connected: {
    label: 'Paired · Connected',
    dot: 'bg-ok shadow-[0_0_10px_rgb(52_211_153/0.9)]',
    text: 'text-ok',
    ring: 'border-ok/25 bg-ok/5',
  },
  connecting: {
    label: 'Connecting…',
    dot: 'bg-warn animate-pulse-soft',
    text: 'text-warn',
    ring: 'border-warn/25 bg-warn/5',
  },
  disconnected: {
    label: 'Local Only · Unpaired',
    dot: 'bg-faint',
    text: 'text-muted',
    ring: 'border-line bg-surface',
  },
  error: {
    label: 'Connection Error',
    dot: 'bg-danger shadow-[0_0_10px_rgb(251_113_133/0.9)]',
    text: 'text-danger',
    ring: 'border-danger/25 bg-danger/5',
  },
};

const CATEGORY_STYLE: Record<MemoryChunk['category'], string> = {
  episodic: 'border-phase-exec/30 bg-phase-exec/10 text-phase-exec',
  semantic: 'border-phase-read/30 bg-phase-read/10 text-phase-read',
  procedural: 'border-phase-verify/30 bg-phase-verify/10 text-phase-verify',
  working: 'border-phase-edit/30 bg-phase-edit/10 text-phase-edit',
};

export const MemorySyncPanel: React.FC = () => {
  const [pairStatus, setPairStatus] = useState<XavierPairStatus>({
    paired: false,
    endpoint: EdgeMeshSyncService.getTargetEndpoint(),
    lastSyncAt: 0,
    pendingSyncCount: 0,
    connectionState: 'disconnected',
  });
  const [targetEndpoint, setTargetEndpoint] = useState(EdgeMeshSyncService.getTargetEndpoint());
  const [chunks, setChunks] = useState<MemoryChunk[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const loadData = async () => {
    const t0 = performance.now();
    const status = await EdgeMeshSyncService.checkPairConnection();
    setLatencyMs(Math.round(performance.now() - t0));
    setPairStatus(status);
    const allChunks = await XavierMemoryNode.getAllChunks();
    setChunks(allChunks);
  };

  useEffect(() => {
    loadData();
    const unsub = EdgeMeshSyncService.subscribePairStatus((st) => setPairStatus(st));
    return () => unsub();
  }, []);

  const handleEndpointSave = () => {
    EdgeMeshSyncService.setTargetEndpoint(targetEndpoint);
    EdgeMeshSyncService.checkPairConnection();
  };

  const handleManualSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    const res = await EdgeMeshSyncService.performRealtimeSync();
    setSyncing(false);
    if (res.error) {
      setSyncResult(`Sync Error: ${res.error}`);
    } else {
      setSyncResult(`Synced ${res.syncedCount} memory chunks to PC master node successfully!`);
      loadData();
    }
  };

  const conn = CONNECTION_META[pairStatus.connectionState];

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6 md:py-10 lg:px-8">
      {/* Pair status hero */}
      <div className={`rounded-3xl border p-5 transition-colors sm:p-8 ${conn.ring}`}>
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-accent/25 bg-accent/10 text-accent-strong">
              <Database className="h-6 w-6" />
            </div>
            <div>
              <h2 className="flex items-center gap-2.5 text-lg font-bold text-fg md:text-xl">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${conn.dot}`} />
                <span className={conn.text}>{conn.label}</span>
              </h2>
              <p className="mt-1.5 max-w-xl text-xs leading-relaxed text-muted">
                Embedded semantic memory core in IndexedDB. When paired with your PC Xavier Master
                Node, it syncs execution logs, code symbols, and ADRs in real time.
              </p>
              <p className="mt-2 truncate font-mono text-[11px] text-faint">
                {pairStatus.endpoint}
              </p>
            </div>
          </div>

          <button
            onClick={handleManualSync}
            disabled={syncing}
            className="flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-xs font-semibold text-white shadow-glow-accent transition-all hover:bg-accent-strong active:scale-[0.98] disabled:opacity-60 md:w-auto"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync Real-Time Now'}
          </button>
        </div>

        {/* Telemetry strip */}
        <div className="mt-6 grid grid-cols-2 gap-3 border-t border-line/60 pt-5 sm:grid-cols-4">
          <div>
            <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-faint">
              <Zap className="h-3 w-3" /> Latency
            </div>
            <div className="font-mono text-lg font-bold text-fg">
              {latencyMs !== null && pairStatus.connectionState === 'connected'
                ? `${latencyMs}ms`
                : '—'}
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-faint">
              <Clock className="h-3 w-3" /> Last Sync
            </div>
            <div className="font-mono text-lg font-bold text-fg">
              {timeAgo(pairStatus.lastSyncAt)}
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-faint">
              <CloudUpload className="h-3 w-3" /> Pending
            </div>
            <div
              className={`font-mono text-lg font-bold ${
                pairStatus.pendingSyncCount > 0 ? 'text-warn' : 'text-ok'
              }`}
            >
              {pairStatus.pendingSyncCount}
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-faint">
              <Layers className="h-3 w-3" /> Local Chunks
            </div>
            <div className="font-mono text-lg font-bold text-fg">{chunks.length}</div>
          </div>
        </div>
      </div>

      {/* Sync result banner */}
      {syncResult && (
        <div
          className={`animate-fade-up rounded-2xl border p-4 font-mono text-xs ${
            syncResult.includes('Error')
              ? 'border-danger/25 bg-danger/10 text-danger'
              : 'border-ok/25 bg-ok/10 text-ok'
          }`}
        >
          {syncResult}
        </div>
      )}

      {/* Master node endpoint config */}
      <div className="space-y-4 rounded-3xl border border-line bg-surface p-5 md:p-6">
        <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
          <Server className="h-4 w-4 text-accent-strong" /> Master PC Xavier Endpoint
        </h3>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="url"
            value={targetEndpoint}
            onChange={(e) => setTargetEndpoint(e.target.value)}
            className="flex-1 rounded-xl border border-line bg-base px-4 py-2.5 font-mono text-xs text-fg placeholder-faint transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            placeholder="http://localhost:8006"
          />
          <button
            onClick={handleEndpointSave}
            className="flex items-center justify-center gap-2 rounded-xl border border-line bg-elevated px-5 py-2.5 text-xs font-semibold text-fg transition-all hover:border-line-strong hover:bg-overlay active:scale-[0.98]"
          >
            <Radio className="h-3.5 w-3.5 text-accent-strong" />
            Update & Check Pair
          </button>
        </div>
      </div>

      {/* Memory chunks */}
      <div className="space-y-4 rounded-3xl border border-line bg-surface p-5 md:p-6">
        <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
          <HardDrive className="h-4 w-4 text-accent-strong" /> Embedded Memory Chunks
          <span className="rounded-full border border-line bg-elevated px-2 py-0.5 font-mono text-[10px] normal-case text-muted">
            {chunks.length}
          </span>
        </h3>

        {chunks.length === 0 ? (
          <p className="py-4 text-xs italic text-faint">
            No local memory chunks stored yet. Complete an agent task to generate memories.
          </p>
        ) : (
          <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
            {chunks.map((c) => (
              <div
                key={c.id}
                className="space-y-2 rounded-2xl border border-line bg-base p-4 transition-colors hover:border-line-strong"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${CATEGORY_STYLE[c.category]}`}
                  >
                    {c.category}
                  </span>
                  <span className="flex items-center gap-1.5 font-mono text-[10px] text-faint">
                    {new Date(c.timestamp).toLocaleString()} ·
                    {c.syncedToMaster ? (
                      <span className="flex items-center gap-1 text-ok">
                        <CloudUpload className="h-3 w-3" /> Synced
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-warn">
                        <CloudOff className="h-3 w-3" /> Pending
                      </span>
                    )}
                  </span>
                </div>
                <p className="font-mono text-xs leading-relaxed text-muted">{c.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
