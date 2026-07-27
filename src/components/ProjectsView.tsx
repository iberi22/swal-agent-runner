import React, { useState, useEffect } from 'react';
import { FolderGit2, Plus, RefreshCw, GitBranch, ExternalLink, CheckCircle2, AlertCircle, HardDrive } from 'lucide-react';
import { ProjectRepo } from '../types';
import { GitWorkspaceService } from '../services/git/git-service';

interface ProjectsViewProps {
  onSelectProject: (projectId: string) => void;
}

export const ProjectsView: React.FC<ProjectsViewProps> = ({ onSelectProject }) => {
  const [projects, setProjects] = useState<ProjectRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [repoUrl, setRepoUrl] = useState('');
  const [repoName, setRepoName] = useState('');
  const [corsProxy, setCorsProxy] = useState('https://cors-proxy.swal.dev');

  const loadProjects = async () => {
    const list = await GitWorkspaceService.listProjects();
    setProjects(list);
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const handleClone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl) return;

    setLoading(true);
    try {
      await GitWorkspaceService.cloneRepository(repoUrl, repoName || undefined, corsProxy);
      await loadProjects();
      setShowModal(false);
      setRepoUrl('');
      setRepoName('');
    } catch (err: any) {
      alert(`Error cloning repository: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-3">
            <FolderGit2 className="w-7 h-7 text-indigo-400" />
            Connected Repositories
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            In-browser Git workspace powered by IndexedDB. Works identically on Mobile and Desktop.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium text-sm flex items-center gap-2 shadow-lg shadow-indigo-600/20 transition-all"
        >
          <Plus className="w-4 h-4" />
          Clone Repository
        </button>
      </div>

      {/* Projects List */}
      {projects.length === 0 ? (
        <div className="border border-dashed border-slate-800 rounded-2xl p-12 text-center bg-[#0f1117]/40">
          <HardDrive className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-300">No Repositories Connected</h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto mt-2 mb-6">
            Clone a Git repository into your browser's IndexedDB storage to start executing autonomous agent tasks.
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium text-sm inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Connect Your First Repo
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((p) => (
            <div
              key={p.id}
              className="border border-slate-800 bg-[#0f1117] rounded-2xl p-6 hover:border-slate-700 transition-all group flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="font-semibold text-lg text-slate-100 group-hover:text-indigo-300 transition-colors">
                    {p.name}
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-mono flex items-center gap-1.5 ${
                      p.status === 'synced'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : p.status === 'modified'
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                    }`}
                  >
                    {p.status === 'synced' ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                    {p.status}
                  </span>
                </div>

                <p className="text-xs text-slate-400 font-mono truncate mb-4">{p.url}</p>

                <div className="flex items-center gap-4 text-xs text-slate-400 mb-6">
                  <span className="flex items-center gap-1 text-slate-300">
                    <GitBranch className="w-3.5 h-3.5 text-indigo-400" />
                    {p.branch}
                  </span>
                  <span>Synced {new Date(p.lastSyncedAt).toLocaleTimeString()}</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => onSelectProject(p.name)}
                  className="flex-1 px-3 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-xl text-xs font-medium transition-all text-center"
                >
                  Start Agent Task
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Clone Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#0f1117] border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-lg font-bold text-slate-100 mb-4">Clone Git Repository</h3>
            <form onSubmit={handleClone} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Git Repository URL</label>
                <input
                  type="url"
                  required
                  placeholder="https://github.com/user/repository.git"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  className="w-full bg-[#0a0a0f] border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Project Name (Optional)</label>
                <input
                  type="text"
                  placeholder="custom-name"
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  className="w-full bg-[#0a0a0f] border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">CORS Proxy URL</label>
                <input
                  type="url"
                  value={corsProxy}
                  onChange={(e) => setCorsProxy(e.target.value)}
                  className="w-full bg-[#0a0a0f] border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 font-mono text-xs"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-medium flex items-center gap-2"
                >
                  {loading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  {loading ? 'Cloning...' : 'Start Clone'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
