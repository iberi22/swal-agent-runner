import React, { useState } from 'react';
import { CheckCircle2, GitPullRequest, UploadCloud, FileCode, GitCommit, Copy, ShieldCheck, ExternalLink } from 'lucide-react';
import { CodingTask } from '../types';
import { GitWorkspaceService } from '../services/git/git-service';

interface TaskResultViewProps {
  currentTask: CodingTask | null;
}

export const TaskResultView: React.FC<TaskResultViewProps> = ({ currentTask }) => {
  const [pushing, setPushing] = useState(false);
  const [pushSuccess, setPushSuccess] = useState(false);
  const [gitToken, setGitToken] = useState('');

  if (!currentTask || !currentTask.result) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <GitPullRequest className="w-12 h-12 text-slate-600 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-slate-300">No Completed Task Selected</h3>
        <p className="text-sm text-slate-500 mt-1">
          When an agent task finishes, summary, diffs, and push options appear here.
        </p>
      </div>
    );
  }

  const { result } = currentTask;

  const handlePush = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gitToken) {
      alert('Please enter your GitHub Personal Access Token.');
      return;
    }

    setPushing(true);
    try {
      await GitWorkspaceService.pushChanges(currentTask.projectId, gitToken);
      setPushSuccess(true);
    } catch (err: any) {
      alert(`Git push failed: ${err.message || err}`);
    } finally {
      setPushing(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header */}
      <div className="border border-emerald-500/20 bg-emerald-500/5 rounded-3xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-400">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-100">Task Completed Successfully</h2>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              Project: {currentTask.projectId} · Branch: {currentTask.targetBranch}
            </p>
          </div>
        </div>

        {result.commitHash && (
          <div className="px-3 py-1.5 rounded-xl bg-[#0a0a0f] border border-slate-800 text-xs font-mono text-slate-300 flex items-center gap-2">
            <GitCommit className="w-4 h-4 text-indigo-400" />
            <span>SHA: {result.commitHash.slice(0, 8)}</span>
          </div>
        )}
      </div>

      {/* Task Summary */}
      <div className="border border-slate-800 bg-[#0f1117] rounded-3xl p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">Agent Summary</h3>
        <p className="text-sm text-slate-300 leading-relaxed font-sans bg-[#0a0a0f] p-4 rounded-2xl border border-slate-800">
          {result.summary}
        </p>
      </div>

      {/* Diff Summary */}
      <div className="border border-slate-800 bg-[#0f1117] rounded-3xl p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
          <FileCode className="w-4 h-4 text-indigo-400" /> Modified Files & Diff
        </h3>
        <pre className="bg-black/60 p-4 rounded-2xl text-slate-300 font-mono text-xs overflow-x-auto border border-slate-800 max-h-[400px]">
          {result.diffSummary || 'No file changes recorded.'}
        </pre>
      </div>

      {/* Push to GitHub */}
      <div className="border border-slate-800 bg-[#0f1117] rounded-3xl p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
          <UploadCloud className="w-4 h-4 text-indigo-400" /> Push Branch to GitHub
        </h3>
        {pushSuccess ? (
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-400 text-sm flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" /> Branch "{currentTask.targetBranch}" successfully pushed to remote repository!
          </div>
        ) : (
          <form onSubmit={handlePush} className="flex flex-col sm:flex-row gap-3">
            <input
              type="password"
              required
              placeholder="GitHub Personal Access Token (ghp_...)"
              value={gitToken}
              onChange={(e) => setGitToken(e.target.value)}
              className="flex-1 bg-[#0a0a0f] border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={pushing}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 transition-all"
            >
              <UploadCloud className="w-4 h-4" />
              {pushing ? 'Pushing...' : 'Push Branch'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
