import React, { useEffect, useRef } from 'react';
import { Activity, CheckCircle2, AlertTriangle, RefreshCw, Terminal, ShieldCheck, BookOpen, Eye, Pencil, TestTube, Database, GitBranch } from 'lucide-react';
import { CodingTask, TaskStep } from '../types';
import { cn } from '../lib/cn';

interface TaskProgressViewProps {
  currentTask: CodingTask | null;
  onViewResults: () => void;
}

/* ── Step Phase Configuration ────────────────────────── */
const PHASE_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string; dotColor: string; railColor: string }> = {
  plan:   { icon: BookOpen,   label: 'Plan',   color: 'text-accent',   dotColor: 'bg-accent',   railColor: 'bg-accent/30' },
  read:   { icon: Eye,        label: 'Read',   color: 'text-blue-400', dotColor: 'bg-blue-400', railColor: 'bg-blue-400/30' },
  edit:   { icon: Pencil,     label: 'Edit',   color: 'text-warning',  dotColor: 'bg-warning',  railColor: 'bg-warning/30' },
  exec:   { icon: Terminal,   label: 'Exec',   color: 'text-purple-400', dotColor: 'bg-purple-400', railColor: 'bg-purple-400/30' },
  verify: { icon: TestTube,   label: 'Verify', color: 'text-success',  dotColor: 'bg-success',  railColor: 'bg-success/30' },
  memory: { icon: Database,   label: 'Memory', color: 'text-cyan-400', dotColor: 'bg-cyan-400', railColor: 'bg-cyan-400/30' },
  git:    { icon: GitBranch,  label: 'Git',    color: 'text-orange-400', dotColor: 'bg-orange-400', railColor: 'bg-orange-400/30' },
};

/* ── Phase badge background color ───────────────────── */
function getPhaseBadgeColor(phase: string): string {
  const map: Record<string, string> = {
    plan:   'bg-accent/10 border-accent/20',
    read:   'bg-blue-500/10 border-blue-500/20',
    edit:   'bg-warning/10 border-warning/20',
    exec:   'bg-purple-500/10 border-purple-500/20',
    verify: 'bg-success/10 border-success/20',
    memory: 'bg-cyan-500/10 border-cyan-500/20',
    git:    'bg-orange-500/10 border-orange-500/20',
  };
  return map[phase] || 'bg-elevated border-line';
}

/* ── Timeline Step Item ──────────────────────────────── */
function TimelineStep({ step, index }: { step: TaskStep; index: number }) {
  const phase = PHASE_CONFIG[step.phase] || PHASE_CONFIG.plan;
  const Icon = phase.icon;

  const statusIcon = step.status === 'success'
    ? <CheckCircle2 className="w-3.5 h-3.5 text-success" />
    : step.status === 'error'
    ? <AlertTriangle className="w-3.5 h-3.5 text-error" />
    : null;

  return (
    <div
      className="relative flex gap-4 animate-fade-up pl-0"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      {/* Timeline rail + dot */}
      <div className="flex flex-col items-center shrink-0 w-8">
        {/* Rail above (hidden for first) */}
        {index > 0 && (
          <div className={cn('w-0.5 h-4 -mt-4', PHASE_CONFIG[step.phase]?.railColor || 'bg-line')} />
        )}
        {/* Dot */}
        <div className={cn('w-8 h-8 rounded-full flex items-center justify-center border-2 border-base z-10', phase.dotColor)}>
          <Icon className="w-3.5 h-3.5 text-white" />
        </div>
        {/* Rail below */}
        <div className={cn('w-0.5 flex-1 min-h-[8px]', PHASE_CONFIG[step.phase]?.railColor || 'bg-line')} />
      </div>

      {/* Content */}
      <div className="flex-1 pb-6 min-w-0">
        <div className="border border-line bg-surface rounded-xl p-4 shadow-card hover:border-accent/20 transition-colors">
          {/* Header: phase badge + timestamp + tool */}
          <div className="flex items-center flex-wrap gap-2 mb-2">
            <span className={cn('px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border', getPhaseBadgeColor(step.phase))}>
              {phase.label}
            </span>
            <span className="text-[10px] text-text-muted font-mono">
              {new Date(step.timestamp).toLocaleTimeString()}
            </span>
            {step.toolUsed && (
              <span className="ml-auto px-2 py-0.5 rounded-md bg-elevated border border-line text-[10px] font-mono text-text-secondary">
                {step.toolUsed}
              </span>
            )}
            {statusIcon && (
              <span className="flex items-center">{statusIcon}</span>
            )}
          </div>

          {/* Summary */}
          <p className="text-sm text-text-primary leading-relaxed">{step.actionSummary}</p>

          {/* Output snippet */}
          {step.outputSnippet && (
            <pre className="mt-2 bg-elevated/80 p-3 rounded-lg text-text-secondary overflow-x-auto text-[11px] font-mono border border-line leading-relaxed max-h-32 overflow-y-auto">
              {step.outputSnippet}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Task Progress View ──────────────────────────────── */
export const TaskProgressView: React.FC<TaskProgressViewProps> = ({ currentTask, onViewResults }) => {
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentTask?.steps]);

  if (!currentTask) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <Activity className="w-12 h-12 text-text-muted mx-auto mb-4" />
        <h3 className="text-lg font-medium text-text-primary">No Active Agent Task</h3>
        <p className="text-sm text-text-secondary mt-1">Dispatch a task from the "New Task" tab to monitor progress live.</p>
      </div>
    );
  }

  const isRunning = currentTask.status === 'executing' || currentTask.status === 'planning' || currentTask.status === 'verifying';
  const isDone = currentTask.status === 'completed' || currentTask.status === 'failed';

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Task Header */}
      <div className="border border-line bg-surface rounded-3xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-card">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 mb-2">
            <span
              className={cn(
                'px-3 py-1 rounded-full text-xs font-mono font-semibold uppercase tracking-wider flex items-center gap-1.5 border',
                isRunning
                  ? 'bg-accent/10 text-accent-soft border-accent/30'
                  : currentTask.status === 'completed'
                  ? 'bg-success/10 text-success border-success/25'
                  : 'bg-error/10 text-error border-error/25'
              )}
            >
              {isRunning && <RefreshCw className="w-3 h-3 animate-spin" />}
              {currentTask.status}
            </span>
            <span className="text-xs font-mono text-text-muted">Task #{currentTask.id.slice(0, 8)}</span>
          </div>

          <h2 className="text-lg font-bold text-text-primary truncate">{currentTask.title}</h2>
          <p className="text-xs text-text-secondary mt-1 font-mono truncate">
            Repo: {currentTask.projectId} · Branch: {currentTask.targetBranch} · Engine: {currentTask.modelName}
          </p>
        </div>

        {currentTask.status === 'completed' && (
          <button
            onClick={onViewResults}
            className="px-5 py-2.5 bg-success hover:bg-green-600 text-white text-xs font-semibold rounded-xl flex items-center gap-2 shadow-glow-success transition-all shrink-0"
          >
            <ShieldCheck className="w-4 h-4" /> View Results & Diff
          </button>
        )}
      </div>

      {/* Timeline */}
      <div className="border border-line bg-surface rounded-3xl p-6 shadow-card">
        <div className="flex items-center justify-between mb-6 border-b border-line pb-3">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <Terminal className="w-4 h-4 text-accent-soft" /> Execution Timeline ({currentTask.steps.length} steps)
          </h3>
          {isRunning && (
            <span className="flex items-center gap-1.5 text-xs text-text-muted">
              <span className="relative flex w-2 h-2">
                <span className="absolute inline-flex w-full h-full rounded-full bg-accent opacity-60 animate-ping" />
                <span className="relative inline-flex w-2 h-2 rounded-full bg-accent" />
              </span>
              Live
            </span>
          )}
        </div>

        {currentTask.steps.length === 0 ? (
          <div className="py-12 text-center">
            <Activity className="w-8 h-8 text-text-muted mx-auto mb-3" />
            <p className="text-sm text-text-secondary">Waiting for agent to begin execution...</p>
            <div className="flex items-center justify-center gap-1 mt-4">
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse-dot" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse-dot" style={{ animationDelay: '200ms' }} />
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse-dot" style={{ animationDelay: '400ms' }} />
            </div>
          </div>
        ) : (
          <div className="max-h-[600px] overflow-y-auto pr-2">
            {currentTask.steps.map((step, i) => (
              <TimelineStep key={step.id} step={step} index={i} />
            ))}
          </div>
        )}

        <div ref={logEndRef} />
      </div>
    </div>
  );
};
