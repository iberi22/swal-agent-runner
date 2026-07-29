import React, { useState, useEffect } from 'react';
import { FolderGit2, Plus, RefreshCw, GitBranch, CheckCircle2, AlertCircle, AlertTriangle, HardDrive, Clock, GitFork } from 'lucide-react';
import { ProjectRepo } from '../types';
import { GitWorkspaceService } from '../services/git/git-service';
import { cn } from '../lib/cn';

interface ProjectsViewProps {
  onSelectProject: (projectId: string) => void;
}

/* ── Skeleton Card for Loading State ─────────────────── */
function SkeletonCard() {
  return (
    <div className="border border-line bg-surface rounded-2xl p-6 animate-pulse space-y-4">
      <div className="flex items-center justify-between">
        <div className="h-5 w-32 rounded-md bg-elevated" />
        <div className="h-5 w-20 rounded-full bg-elevated" />
      </div>
      <div className="h-3 w-48 rounded bg-elevated" />
      <div className="flex gap-4">
        <div className="h-3 w-20 rounded bg-elevated" />
        <div className="h-3 w-24 rounded bg-elevated" />
      </div>
      <div className="h-9 w-full rounded-xl bg-elevated" />
    </div>
  );
}

/* ── Status Badge ────────────────────────────────────── */
function StatusBadge({ status }: { status: ProjectRepo['status'] }) {
  const config: Record<ProjectRepo['status'], { icon: React.ElementType; color: string; label: string }> = {
    synced: { icon: CheckCircle2, color: 'bg-success/10 text-success border-success/25', label: 'Synced' },
    cloning: { icon: RefreshCw, color: 'bg-warning/10 text-warning border-warning/25', label: 'Cloning' },
    modified: { icon: AlertTriangle, color: 'bg-warning/10 text-warning border-warning/25', label: 'Modified' },
    error: { icon: AlertCircle, color: 'bg-error/10 text-error border-error/25', label: 'Error' },
  };

  const { icon: Icon, color, label } = config[status];
  return (
    <span className={cn('px-2.5 py-0.5 rounded-full text-xs font-mono flex items-center gap-1.5 border', color)}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

/* ── Clone Modal ─────────────────────────────────────── */
function CloneModal({
  open,
  onClose,
  onClone,
}: {
  open: boolean;
  onClose: () => void;
  onClone: (e: React.FormEvent) => void;
}) {
  const [repoUrl, setRepoUrl] = useState('');
  const [repoName, setRepoName] = useState('');
  const [corsProxy, setCorsProxy] = useState('https://cors-proxy.swal.dev');
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl) return;
    setLoading(true);
    try {
      await GitWorkspaceService.cloneRepository(repoUrl, repoName || undefined, corsProxy);
      onClone(e);
      setRepoUrl('');
      setRepoName('');
      onClose();
    } catch (err: any) {
      alert(`Error cloning repository: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-base/75 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-surface border border-line rounded-2xl p-6 max-w-md w-full shadow-card animate-fade-up">
        <h2 className="text-lg font-bold text-text-primary mb-4 flex items-center gap-2">
          <GitFork className="w-5 h-5 text-accent-soft" />
          Clone Git Repository
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Git Repository URL</label>
            <input
              type="url"
              required
              placeholder="https://github.com/user/repository.git"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              className="w-full bg-elevated border border-line rounded-xl px-3 py-2.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Project Name <span className="text-text-muted">(Optional)</span></label>
            <input
              type="text"
              placeholder="custom-name"
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
              className="w-full bg-elevated border border-line rounded-xl px-3 py-2.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">CORS Proxy URL</label>
            <input
              type="url"
              value={corsProxy}
              onChange={(e) => setCorsProxy(e.target.value)}
              className="w-full bg-elevated border border-line rounded-xl px-3 py-2.5 text-sm text-text-primary font-mono text-xs placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-line">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-accent hover:bg-accent-muted text-white rounded-xl text-xs font-medium flex items-center gap-2 shadow-glow-accent transition-all disabled:opacity-50"
            >
              {loading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              {loading ? 'Cloning...' : 'Start Clone'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Projects View ───────────────────────────────────── */
export const ProjectsView: React.FC<ProjectsViewProps> = ({ onSelectProject }) => {
  const [projects, setProjects] = useState<ProjectRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const loadProjects = async () => {
    setLoading(true);
    const list = await GitWorkspaceService.listProjects();
    setProjects(list);
    setLoading(false);
  };

  useEffect(() => {
    loadProjects();
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-3">
            <FolderGit2 className="w-7 h-7 text-accent-soft" />
            Connected Repositories
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            In-browser Git workspace powered by IndexedDB. Works identically on Mobile and Desktop.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-accent hover:bg-accent-muted text-white rounded-xl font-medium text-sm flex items-center gap-2 shadow-glow-accent transition-all"
        >
          <Plus className="w-4 h-4" />
          Clone Repository
        </button>
      </div>

      {/* Loading Skeleton */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {/* Empty State */}
      {!loading && projects.length === 0 && (
        <div className="border border-dashed border-line-strong rounded-2xl p-12 text-center bg-surface/40">
          <HardDrive className="w-12 h-12 text-text-muted mx-auto mb-4" />
          <h2 className="text-lg font-medium text-text-primary">No Repositories Connected</h2>
          <p className="text-sm text-text-secondary max-w-md mx-auto mt-2 mb-6">
            Clone a Git repository into your browser's IndexedDB storage to start executing autonomous agent tasks.
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-accent hover:bg-accent-muted text-white rounded-xl font-medium text-sm inline-flex items-center gap-2 shadow-glow-accent transition-all"
          >
            <Plus className="w-4 h-4" />
            Connect Your First Repo
          </button>
        </div>
      )}

      {/* Projects Grid */}
      {!loading && projects.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((p) => (
            <div
              key={p.id}
              className="border border-line bg-surface rounded-2xl p-6 hover:border-accent/40 transition-all duration-300 group flex flex-col justify-between shadow-card"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="font-semibold text-lg text-text-primary group-hover:text-accent-soft transition-colors truncate mr-2">
                    {p.name}
                  </span>
                  <StatusBadge status={p.status} />
                </div>

                <p className="text-xs text-text-muted font-mono truncate mb-4">{p.url}</p>

                <div className="flex items-center gap-4 text-xs text-text-secondary mb-6">
                  <span className="flex items-center gap-1 text-text-primary">
                    <GitBranch className="w-3.5 h-3.5 text-accent-soft" />
                    {p.branch}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-text-muted" />
                    {new Date(p.lastSyncedAt).toLocaleTimeString()}
                  </span>
                </div>
              </div>

              <button
                onClick={() => onSelectProject(p.name)}
                className="w-full px-3 py-2.5 bg-accent/10 hover:bg-accent/20 text-accent-soft border border-accent/25 rounded-xl text-xs font-medium transition-all text-center"
              >
                Start Agent Task
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Clone Modal */}
      <CloneModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onClone={(e) => { e.preventDefault(); loadProjects(); }}
      />
    </div>
  );
};
