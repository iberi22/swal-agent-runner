import React, { useEffect, useState } from 'react';
import { Cpu, Database, Key, Layers, Moon, RefreshCw, Smartphone } from 'lucide-react';
import { LLMProviderManager } from '../services/llm/llm-provider-manager';
import { EdgeMeshSyncService } from '../services/memory/edge-mesh-sync';
import { XavierPairStatus } from '../types';

interface NavbarProps {
  activeTab: 'projects' | 'new-task' | 'progress' | 'results' | 'memory';
  setActiveTab: (tab: 'projects' | 'new-task' | 'progress' | 'results' | 'memory') => void;
  openAuthModal: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ activeTab, setActiveTab, openAuthModal }) => {
  const [activeProvider, setActiveProvider] = useState(LLMProviderManager.getActiveProvider());
  const [pairStatus, setPairStatus] = useState<XavierPairStatus>({
    paired: false,
    endpoint: 'http://localhost:8006',
    lastSyncAt: 0,
    pendingSyncCount: 0,
    connectionState: 'disconnected',
  });

  useEffect(() => {
    const unsub = EdgeMeshSyncService.subscribePairStatus((status) => {
      setPairStatus(status);
    });
    EdgeMeshSyncService.checkPairConnection();
    return () => unsub();
  }, []);

  return (
    <header className="border-b border-slate-800 bg-[#0f1117]/80 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-purple-500 p-0.5 shadow-lg shadow-indigo-500/20">
            <div className="w-full h-full bg-[#0a0a0f] rounded-[10px] flex items-center justify-center">
              <Cpu className="w-5 h-5 text-indigo-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-100 tracking-wide">SWAL Agent Runner</span>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 uppercase tracking-wider">PWA Node</span>
            </div>
            <p className="text-xs text-slate-400 font-mono hidden sm:block">GitCore Protocol v3.9.0</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center gap-1 sm:gap-2">
          <button
            onClick={() => setActiveTab('projects')}
            className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              activeTab === 'projects'
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            Projects
          </button>
          <button
            onClick={() => setActiveTab('new-task')}
            className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              activeTab === 'new-task'
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            New Task
          </button>
          <button
            onClick={() => setActiveTab('progress')}
            className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              activeTab === 'progress'
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            Agent Progress
          </button>
          <button
            onClick={() => setActiveTab('results')}
            className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              activeTab === 'results'
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            Results & Diff
          </button>
          <button
            onClick={() => setActiveTab('memory')}
            className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${
              activeTab === 'memory'
                ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            Xavier Sync
          </button>
        </nav>

        {/* Right Status Controls */}
        <div className="flex items-center gap-3">
          {/* Pair Status Badge */}
          <div
            onClick={() => setActiveTab('memory')}
            className={`cursor-pointer px-2.5 py-1 rounded-full text-xs font-mono flex items-center gap-1.5 border transition-all ${
              pairStatus.paired
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20'
            }`}
            title={`Xavier PC Master Node: ${pairStatus.endpoint}`}
          >
            <Database className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{pairStatus.paired ? 'Xavier Paired' : 'Xavier Local'}</span>
          </div>

          {/* Active Provider Auth Button */}
          <button
            onClick={openAuthModal}
            className="px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-2 transition-all"
          >
            <Key className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">{activeProvider.name}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
