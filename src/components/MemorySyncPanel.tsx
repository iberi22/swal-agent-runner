import React, { useState, useEffect } from 'react';
import { Database, RefreshCw, CheckCircle2, AlertTriangle, Radio, Server, HardDrive } from 'lucide-react';
import { XavierPairStatus, MemoryChunk } from '../types';
import { EdgeMeshSyncService } from '../services/memory/edge-mesh-sync';
import { XavierMemoryNode } from '../services/memory/xavier-memory-node';

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

  const loadData = async () => {
    const status = await EdgeMeshSyncService.checkPairConnection();
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

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header Card */}
      <div className="border border-slate-800 bg-[#0f1117] rounded-3xl p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl text-indigo-400">
            <Database className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-3">
              Xavier Local Memory Core & Real-Time Sync
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-xl">
              This node holds an embedded vector/semantic memory core in IndexedDB. When paired with your PC Xavier Master Node, it synchronizes task execution logs, code symbols, and ADRs in real time.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
          <button
            onClick={handleManualSync}
            disabled={syncing}
            className="w-full sm:w-auto px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync Real-Time Now'}
          </button>
        </div>
      </div>

      {/* Sync Status Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="border border-slate-800 bg-[#0f1117] rounded-2xl p-5">
          <div className="text-xs text-slate-400 font-mono mb-1">Pair Status</div>
          <div className="flex items-center gap-2">
            <Radio className={`w-4 h-4 ${pairStatus.paired ? 'text-emerald-400 animate-pulse' : 'text-amber-400'}`} />
            <span className="font-bold text-slate-100">{pairStatus.paired ? 'Paired (Connected)' : 'Local Only'}</span>
          </div>
        </div>

        <div className="border border-slate-800 bg-[#0f1117] rounded-2xl p-5">
          <div className="text-xs text-slate-400 font-mono mb-1">Pending Chunks to Sync</div>
          <div className="font-bold text-xl text-indigo-400 font-mono">{pairStatus.pendingSyncCount}</div>
        </div>

        <div className="border border-slate-800 bg-[#0f1117] rounded-2xl p-5">
          <div className="text-xs text-slate-400 font-mono mb-1">Total Local Chunks</div>
          <div className="font-bold text-xl text-slate-200 font-mono">{chunks.length}</div>
        </div>
      </div>

      {syncResult && (
        <div className={`p-4 rounded-2xl border text-xs font-mono ${syncResult.includes('Error') ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
          {syncResult}
        </div>
      )}

      {/* Master Node Pairing Config */}
      <div className="border border-slate-800 bg-[#0f1117] rounded-3xl p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
          <Server className="w-4 h-4 text-indigo-400" /> Master PC Xavier Endpoint Configuration
        </h3>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="url"
            value={targetEndpoint}
            onChange={(e) => setTargetEndpoint(e.target.value)}
            className="flex-1 bg-[#0a0a0f] border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
            placeholder="http://localhost:8006"
          />
          <button
            onClick={handleEndpointSave}
            className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium rounded-xl text-xs border border-slate-700"
          >
            Update & Check Pair
          </button>
        </div>
      </div>

      {/* Chunks List */}
      <div className="border border-slate-800 bg-[#0f1117] rounded-3xl p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-indigo-400" /> Embedded Memory Chunks ({chunks.length})
        </h3>

        {chunks.length === 0 ? (
          <p className="text-xs text-slate-500 italic py-4">No local memory chunks stored yet. Complete an agent task to generate memories.</p>
        ) : (
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
            {chunks.map((c) => (
              <div key={c.id} className="border border-slate-800/60 bg-[#0a0a0f] rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-mono font-bold uppercase text-[10px]">
                    {c.category}
                  </span>
                  <span className="text-slate-500 font-mono text-[10px]">
                    {new Date(c.timestamp).toLocaleString()} · {c.syncedToMaster ? '✅ Synced' : '⏳ Pending Sync'}
                  </span>
                </div>
                <p className="text-xs text-slate-300 font-mono leading-relaxed">{c.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
