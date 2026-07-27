import React, { useEffect, useRef } from 'react';
import { Activity, CheckCircle2, AlertTriangle, RefreshCw, Terminal, Layers, ShieldCheck, Database } from 'lucide-react';
import { CodingTask } from '../types';

interface TaskProgressViewProps {
  currentTask: CodingTask | null;
  onViewResults: () => void;
}

export const TaskProgressView: React.FC<TaskProgressViewProps> = ({ currentTask, onViewResults }) => {
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentTask?.steps]);

  if (!currentTask) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <Activity className="w-12 h-12 text-slate-600 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-slate-300">No Active Agent Task</h3>
        <p className="text-sm text-slate-500 mt-1">Dispatch a task from the "New Task" tab to monitor progress live.</p>
      </div>
    );
  }

  const phaseColors: Record<string, string> = {
    plan: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
    read: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
    edit: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    exec: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
    verify: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    memory: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    git: 'text-pink-400 bg-pink-500/10 border-pink-500/20',
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Task Header */}
      <div className="border border-slate-800 bg-[#0f1117] rounded-3xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span
              className={`px-3 py-1 rounded-full text-xs font-mono font-semibold uppercase tracking-wider flex items-center gap-1.5 ${
                currentTask.status === 'executing' || currentTask.status === 'planning'
                  ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 animate-pulse'
                  : currentTask.status === 'completed'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
              }`}
            >
              {(currentTask.status === 'executing' || currentTask.status === 'planning') && (
                <RefreshCw className="w-3 h-3 animate-spin" />
              )}
              {currentTask.status}
            </span>
            <span className="text-xs font-mono text-slate-500">Task #{currentTask.id.slice(0, 8)}</span>
          </div>

          <h2 className="text-lg font-bold text-slate-100">{currentTask.title}</h2>
          <p className="text-xs text-slate-400 mt-1 font-mono">
            Repo: {currentTask.projectId} · Branch: {currentTask.targetBranch} · Engine: {currentTask.modelName}
          </p>
        </div>

        {currentTask.status === 'completed' && (
          <button
            onClick={onViewResults}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition-all"
          >
            <ShieldCheck className="w-4 h-4" /> View Results & Diff
          </button>
        )}
      </div>

      {/* Steps & Telemetry Log */}
      <div className="border border-slate-800 bg-[#0f1117] rounded-3xl p-6">
        <div className="flex items-center justify-between mb-4 border-b border-slate-800/80 pb-3">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <Terminal className="w-4 h-4 text-indigo-400" /> Execution Log ({currentTask.steps.length} steps)
          </h3>
          <span className="text-xs text-slate-500 font-mono">Real-time Stream</span>
        </div>

        <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 font-mono text-xs">
          {currentTask.steps.map((step) => (
            <div key={step.id} className="border border-slate-800/60 bg-[#0a0a0f] rounded-xl p-3.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span
                  className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold border ${
                    phaseColors[step.phase] || 'text-slate-400 bg-slate-800 border-slate-700'
                  }`}
                >
                  {step.phase}
                </span>
                <span className="text-[10px] text-slate-600">
                  {new Date(step.timestamp).toLocaleTimeString()}
                </span>
              </div>

              <p className="text-slate-300 font-sans">{step.actionSummary}</p>

              {step.outputSnippet && (
                <pre className="bg-black/50 p-2.5 rounded-lg text-slate-400 overflow-x-auto text-[11px] border border-slate-800/80">
                  {step.outputSnippet}
                </pre>
              )}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
};
