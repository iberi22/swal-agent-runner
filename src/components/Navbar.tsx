import React, { useEffect, useState } from 'react';
import { Activity, Cpu, Database, FolderGit2, GitPullRequest, Key, Sparkles, Wifi } from 'lucide-react';
import { LLMProviderManager } from '../services/llm/llm-provider-manager';
import { EdgeMeshSyncService } from '../services/memory/edge-mesh-sync';
import { XavierPairStatus } from '../types';
import { cn } from '../lib/cn';

type TabId = 'projects' | 'new-task' | 'progress' | 'results' | 'memory' | 'mesh';

interface NavbarProps {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  openAuthModal: () => void;
}

interface BottomNavProps {
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
}

const TABS: { id: TabId; label: string; shortLabel: string; icon: React.ElementType }[] = [
  { id: 'projects', label: 'Projects', shortLabel: 'Projects', icon: FolderGit2 },
  { id: 'new-task', label: 'New Task', shortLabel: 'New Task', icon: Sparkles },
  { id: 'progress', label: 'Agent Progress', shortLabel: 'Progress', icon: Activity },
  { id: 'results', label: 'Results & Diff', shortLabel: 'Results', icon: GitPullRequest },
  { id: 'memory', label: 'Xavier Sync', shortLabel: 'Xavier', icon: Database },
  { id: 'mesh', label: 'P2P Mesh', shortLabel: 'Mesh', icon: Wifi },
];

/* ── Desktop Top Navbar ──────────────────────────────── */
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

  const pairTone = pairStatus.paired
    ? 'bg-success/10 text-success border-success/25 hover:bg-success/20'
    : 'bg-warning/10 text-warning border-warning/25 hover:bg-warning/20';

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/80 backdrop-blur-xl hidden md:block">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 shrink-0 rounded-xl bg-gradient-to-tr from-accent-muted via-accent to-purple-500 p-0.5 shadow-glow-accent">
            <div className="w-full h-full bg-base rounded-[10px] flex items-center justify-center">
              <Cpu className="w-5 h-5 text-accent-soft" />
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-bold text-text-primary tracking-wide truncate">SWAL Agent Runner</span>
              <span className="hidden sm:inline text-[10px] font-semibold px-2 py-0.5 rounded-full bg-accent/10 text-accent-soft border border-accent/25 uppercase tracking-wider">
                PWA Node
              </span>
            </div>
            <p className="text-xs text-text-muted font-mono hidden sm:block">GitCore Protocol v3.9.0</p>
          </div>
        </div>

        {/* Desktop navigation tabs */}
        <nav className="hidden md:flex items-center gap-1 rounded-2xl border border-line bg-base/60 p-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                'px-3 py-1.5 rounded-xl text-sm font-medium flex items-center gap-1.5 transition-colors',
                activeTab === id
                  ? 'bg-accent/15 text-accent-soft border border-accent/30 shadow-glow-accent'
                  : 'text-text-secondary border border-transparent hover:text-text-primary hover:bg-elevated'
              )}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden lg:inline">{label}</span>
            </button>
          ))}
        </nav>

        {/* Right status controls */}
        <div className="flex items-center gap-2.5">
          {/* Pair Status Badge */}
          <div
            onClick={() => setActiveTab('memory')}
            className={cn(
              'cursor-pointer px-2.5 py-1.5 rounded-full text-xs font-mono flex items-center gap-1.5 border transition-colors',
              pairTone
            )}
            title={`Xavier PC Master Node: ${pairStatus.endpoint}`}
          >
            <span className="relative flex w-2 h-2">
              {pairStatus.paired && (
                <span className="absolute inline-flex w-full h-full rounded-full bg-success opacity-60 animate-ping" />
              )}
              <span
                className={cn(
                  'relative inline-flex w-2 h-2 rounded-full',
                  pairStatus.paired ? 'bg-success' : 'bg-warning'
                )}
              />
            </span>
            <Database className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{pairStatus.paired ? 'Xavier Paired' : 'Xavier Local'}</span>
          </div>

          {/* Active Provider Auth Button */}
          <button
            onClick={openAuthModal}
            className="px-3 py-1.5 rounded-xl bg-elevated hover:bg-overlay text-text-primary border border-line text-xs font-medium flex items-center gap-2 transition-colors"
          >
            <Key className="w-3.5 h-3.5 text-accent-soft" />
            <span className="hidden sm:inline">{activeProvider.name}</span>
          </button>
        </div>
      </div>
    </header>
  );
};

/* ── Mobile Bottom Navigation ────────────────────────── */
export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, setActiveTab }) => {
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-line bg-surface/95 backdrop-blur-xl pb-safe">
      <div className="grid grid-cols-6">
        {TABS.map(({ id, shortLabel, icon: Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                'relative flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors',
                active ? 'text-accent-soft' : 'text-text-secondary hover:text-text-primary'
              )}
            >
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-accent-soft" />
              )}
              <Icon className="w-5 h-5" strokeWidth={active ? 2.4 : 2} />
              {shortLabel}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
