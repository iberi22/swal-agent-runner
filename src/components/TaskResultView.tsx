import React, { useState } from 'react';
import { CheckCircle2, GitPullRequest, UploadCloud, FileCode, GitCommit, ShieldCheck, XCircle, AlertTriangle, TestTube, FileSymlink } from 'lucide-react';
import { CodingTask } from '../types';
import { GitWorkspaceService } from '../services/git/git-service';
import { cn } from '../lib/cn';

interface TaskResultViewProps {
  currentTask: CodingTask | null;
}

/* ── Format relative time ────────────────────────────── */
function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  const hours = Math.floor(mins / 60);
  if (hours < 1) return `${mins}m ago`;
  if (hours === 1) return '1h ago';
  const days = Math.floor(hours / 24);
  if (days < 1) return `${hours}h ago`;
  return `${days}d ago`;
}

/* ── Parse and render diff lines ─────────────────────── */
function DiffBlock({ diff }: { diff: string }) {
  const lines = diff.split('\n');

  return (
    <pre className="bg-elevated/80 p-4 rounded-2xl text-xs font-mono overflow-x-auto border border-line max-h-[500px] overflow-y-auto leading-relaxed">
      {lines.map((line, i) => {
        const trimmed = line;
        let className = 'text-text-secondary';
        let gutter = '  ';

        if (line.startsWith('+')) {
          className = 'text-success';
          gutter = '+ ';
        } else if (line.startsWith('-')) {
          className = 'text-error';
          gutter = '- ';
        } else if (line.startsWith('@@')) {
          className = 'text-accent-soft';
          gutter = '@ ';
        } else if (line.startsWith('diff --git') || line.startsWith('index') || line.startsWith('---') || line.startsWith('+++')) {
          className = 'text-text-muted italic';
          gutter = '  ';
        }

        return (
          <div key={i} className={cn('whitespace-pre-wrap', className)}>
            <span className="select-none text-text-muted/40 w-5 inline-block text-right mr-2">{gutter}</span>
            {trimmed || ' '}
          </div>
        );
      })}
    </pre>
  );
}

/* ── Test Output Block ───────────────────────────────── */
function TestOutputBlock({ output }: { output: string }) {
  return (
    <div className="mt-4">
      <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-2 mb-2">
        <TestTube className="w-3.5 h-3.5 text-accent-soft" /> Test Output
      </h4>
      <pre className="bg-elevated/80 p-4 rounded-2xl text-xs font-mono overflow-x-auto border border-line max-h-64 overflow-y-auto leading-relaxed text-text-secondary">
        {output}
      </pre>
    </div>
  );
}

/* ── Changed Files Table ─────────────────────────────── */
function ChangedFiles({ files }: { files: string[] }) {
  if (files.length === 0) return null;

  return (
    <div className="mt-4">
      <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-2 mb-2">
        <FileSymlink className="w-3.5 h-3.5 text-accent-soft" /> Changed Files ({files.length})
      </h4>
      <div className="border border-line rounded-xl overflow-hidden">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="bg-elevated border-b border-line">
              <th className="text-left px-3 py-2 text-text-muted font-medium">File</th>
              <th className="w-16 text-center px-3 py-2 text-text-muted font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {files.map((file, i) => (
              <tr key={i} className={cn('border-b border-line last:border-0', i % 2 === 0 ? 'bg-surface' : 'bg-elevated/50')}>
                <td className="px-3 py-2 text-text-primary flex items-center gap-2">
                  <FileCode className="w-3.5 h-3.5 text-accent-soft shrink-0" />
                  <span className="truncate">{file}</span>
                </td>
                <td className="px-3 py-2 text-center">
                  <span className="inline-flex items-center gap-1 text-success text-[10px]">
                    <CheckCircle2 className="w-3 h-3" /> Modified
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Task Result View ────────────────────────────────── */
export const TaskResultView: React.FC<TaskResultViewProps> = ({ currentTask }) => {
  const [pushing, setPushing] = useState(false);
  const [pushSuccess, setPushSuccess] = useState(false);
  const [gitToken, setGitToken] = useState('');
  const [showToken, setShowToken] = useState(false);

  if (!currentTask || !currentTask.result) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <GitPullRequest className="w-12 h-12 text-text-muted mx-auto mb-4" />
        <h3 className="text-lg font-medium text-text-primary">No Completed Task Selected</h3>
        <p className="text-sm text-text-secondary mt-1">
          When an agent task finishes, summary, diffs, and push options appear here.
        </p>
      </div>
    );
  }

  const { result } = currentTask;
  const isSuccess = result.success;

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
      {/* Score / Summary Header */}
      <div className={cn(
        'rounded-3xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-card border',
        isSuccess
          ? 'bg-success/5 border-success/25'
          : 'bg-error/5 border-error/25'
      )}>
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn(
            'p-3 rounded-2xl border',
            isSuccess
              ? 'bg-success/10 border-success/25 text-success'
              : 'bg-error/10 border-error/25 text-error'
          )}>
            {isSuccess
              ? <CheckCircle2 className="w-6 h-6" />
              : <XCircle className="w-6 h-6" />
            }
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-text-primary truncate">
                {isSuccess ? 'Task Completed Successfully' : 'Task Failed'}
              </h2>
              <span className={cn(
                'px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border flex items-center gap-1',
                isSuccess
                  ? 'bg-success/10 text-success border-success/25'
                  : 'bg-error/10 text-error border-error/25'
              )}>
                {isSuccess ? 'Passed' : 'Failed'}
              </span>
            </div>
            <p className="text-xs text-text-secondary font-mono mt-0.5 truncate">
              Project: {currentTask.projectId} · Branch: {currentTask.targetBranch}
              {currentTask.completedAt && <> · Duration: {Math.round((currentTask.completedAt - currentTask.createdAt) / 1000)}s</>}
            </p>
          </div>
        </div>

        {result.commitHash && (
          <div className="px-3 py-1.5 rounded-xl bg-elevated border border-line text-xs font-mono text-text-secondary flex items-center gap-2 shrink-0">
            <GitCommit className="w-4 h-4 text-accent-soft" />
            <span className="font-mono">{result.commitHash.slice(0, 8)}</span>
          </div>
        )}
      </div>

      {/* Agent Summary */}
      <div className="border border-line bg-surface rounded-3xl p-6 space-y-3 shadow-card">
        <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider flex items-center gap-2">
          <FileCode className="w-4 h-4 text-accent-soft" /> Agent Summary
        </h3>
        <div className="bg-elevated p-4 rounded-2xl border border-line">
          <p className="text-sm text-text-primary leading-relaxed">{result.summary}</p>
        </div>

        {result.changedFiles.length > 0 && (
          <ChangedFiles files={result.changedFiles} />
        )}
      </div>

      {/* Diff Viewer */}
      <div className="border border-line bg-surface rounded-3xl p-6 space-y-3 shadow-card">
        <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider flex items-center gap-2">
          <FileCode className="w-4 h-4 text-accent-soft" /> Diff Summary
        </h3>
        {result.diffSummary ? (
          <DiffBlock diff={result.diffSummary} />
        ) : (
          <p className="text-sm text-text-muted italic">No file changes recorded.</p>
        )}

        {result.testOutput && (
          <TestOutputBlock output={result.testOutput} />
        )}
      </div>

      {/* Push to GitHub */}
      <div className="border border-line bg-surface rounded-3xl p-6 space-y-4 shadow-card">
        <h3 className="text-sm font-semibold text-text-primary uppercase tracking-wider flex items-center gap-2">
          <UploadCloud className="w-4 h-4 text-accent-soft" /> Push Branch to GitHub
        </h3>
        {pushSuccess ? (
          <div className="p-4 bg-success/10 border border-success/25 rounded-2xl text-success text-sm flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" /> Branch &ldquo;{currentTask.targetBranch}&rdquo; successfully pushed to remote repository!
          </div>
        ) : (
          <form onSubmit={handlePush} className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <input
                  type={showToken ? 'text' : 'password'}
                  required
                  placeholder="GitHub Personal Access Token (ghp_...)"
                  value={gitToken}
                  onChange={(e) => setGitToken(e.target.value)}
                  className="w-full bg-elevated border border-line rounded-xl px-4 py-2.5 pr-10 text-sm text-text-primary font-mono placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors p-1"
                  tabIndex={-1}
                >
                  {showToken ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </button>
              </div>
              <button
                type="submit"
                disabled={pushing}
                className="px-6 py-2.5 bg-accent hover:bg-accent-muted text-white font-medium rounded-xl text-xs flex items-center justify-center gap-2 shadow-glow-accent transition-all disabled:opacity-50 shrink-0"
              >
                <UploadCloud className="w-4 h-4" />
                {pushing ? 'Pushing...' : 'Push Branch'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
