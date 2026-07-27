import React, { useState, useEffect } from 'react';
import { Play, Sparkles, FolderGit2, Cpu, GitBranch } from 'lucide-react';
import { ProjectRepo, ProviderConfig, CodingTask } from '../types';
import { GitWorkspaceService } from '../services/git/git-service';
import { LLMProviderManager } from '../services/llm/llm-provider-manager';

interface NewTaskViewProps {
  initialProjectName?: string;
  onLaunchTask: (task: CodingTask) => void;
}

export const NewTaskView: React.FC<NewTaskViewProps> = ({ initialProjectName, onLaunchTask }) => {
  const [projects, setProjects] = useState<ProjectRepo[]>([]);
  const [selectedProject, setSelectedProject] = useState(initialProjectName || '');
  const [prompt, setPrompt] = useState('');
  const [targetBranch, setTargetBranch] = useState('feature/agent-task');
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [selectedProviderType, setSelectedProviderType] = useState(LLMProviderManager.getActiveProviderType());

  useEffect(() => {
    GitWorkspaceService.listProjects().then((list) => {
      setProjects(list);
      if (!selectedProject && list.length > 0) {
        setSelectedProject(list[0].name);
      }
    });
    setProviders(LLMProviderManager.getProviders());
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject || !prompt) return;

    const provider = providers.find((p) => p.type === selectedProviderType) || LLMProviderManager.getActiveProvider();

    const newTask: CodingTask = {
      id: crypto.randomUUID(),
      projectId: selectedProject,
      title: prompt.slice(0, 60),
      prompt,
      targetBranch,
      status: 'pending',
      createdAt: Date.now(),
      providerType: provider.type,
      modelName: provider.model || 'gemini-2.5-pro',
      steps: [],
    };

    onLaunchTask(newTask);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="border border-slate-800 bg-[#0f1117] rounded-3xl p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl text-indigo-400">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-100">Dispatch Headless Agent Task</h2>
            <p className="text-xs text-slate-400">
              The agent will autonomously read files, write code, run WebContainer tests, and commit results.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Target Project */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-2">
              <FolderGit2 className="w-4 h-4 text-indigo-400" /> Target Repository
            </label>
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="w-full bg-[#0a0a0f] border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
            >
              {projects.length === 0 ? (
                <option value="">No repositories available. Clone one first.</option>
              ) : (
                projects.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name} ({p.branch})
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Prompt */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Task Prompt / Instruction
            </label>
            <textarea
              required
              rows={5}
              placeholder="e.g. Implement rate-limiting middleware in src/middleware/rate-limit.ts with unit tests using Vitest..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full bg-[#0a0a0f] border border-slate-800 rounded-xl p-4 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono leading-relaxed"
            />
          </div>

          {/* Branch & LLM Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-indigo-400" /> Target Branch Name
              </label>
              <input
                type="text"
                required
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
                className="w-full bg-[#0a0a0f] border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-indigo-400" /> LLM Provider Engine
              </label>
              <select
                value={selectedProviderType}
                onChange={(e) => setSelectedProviderType(e.target.value as any)}
                className="w-full bg-[#0a0a0f] border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
              >
                {providers.map((p) => (
                  <option key={p.type} value={p.type}>
                    {p.name} ({p.model})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Submit */}
          <div className="pt-4 border-t border-slate-800 flex justify-end">
            <button
              type="submit"
              disabled={!selectedProject || !prompt}
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-xl text-sm flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
            >
              <Play className="w-4 h-4 fill-white" /> Launch Autonomous Agent
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
