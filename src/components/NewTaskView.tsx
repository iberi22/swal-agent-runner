import React, { useState, useEffect } from 'react';
import { Play, Sparkles, FolderGit2, Cpu, GitBranch, Search } from 'lucide-react';
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
  const [projectSearch, setProjectSearch] = useState('');
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
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

  const filteredProjects = projects.filter(
    (p) => p.name.toLowerCase().includes(projectSearch.toLowerCase())
  );

  const selectedProjectData = projects.find((p) => p.name === selectedProject);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="border border-line bg-surface rounded-3xl p-6 sm:p-8 shadow-card">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-accent/10 border border-accent/20 rounded-2xl text-accent-soft">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-text-primary">Dispatch Headless Agent Task</h2>
            <p className="text-xs text-text-secondary">
              The agent will autonomously read files, write code, run WebContainer tests, and commit results.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Target Project — with search/typeahead for many projects */}
          <div className="relative">
            <label htmlFor="target-repo" className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2 flex items-center gap-2">
              <FolderGit2 className="w-4 h-4 text-accent-soft" /> Target Repository
            </label>
            {projects.length > 5 ? (
              /* Typeahead search for many projects */
              <div className="relative">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
                  <input
                    type="text"
                    id="target-repo"
                    placeholder="Search repositories..."
                    value={projectSearch || selectedProject}
                    onFocus={() => { setShowProjectDropdown(true); setProjectSearch(''); }}
                    onBlur={() => setTimeout(() => setShowProjectDropdown(false), 200)}
                    onChange={(e) => { setProjectSearch(e.target.value); setSelectedProject(''); }}
                    className="w-full bg-elevated border border-line rounded-xl pl-10 pr-4 py-2.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
                {showProjectDropdown && (
                  <div className="absolute z-10 mt-1 w-full bg-elevated border border-line rounded-xl shadow-card max-h-48 overflow-y-auto">
                    {filteredProjects.length === 0 ? (
                      <div className="px-4 py-3 text-xs text-text-muted">No matching repositories</div>
                    ) : (
                      filteredProjects.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onMouseDown={() => { setSelectedProject(p.name); setProjectSearch(p.name); setShowProjectDropdown(false); }}
                          className="w-full text-left px-4 py-2.5 text-sm text-text-primary hover:bg-overlay transition-colors flex items-center gap-2"
                        >
                          <FolderGit2 className="w-3.5 h-3.5 text-accent-soft shrink-0" />
                          <span className="truncate">{p.name}</span>
                          <span className="text-text-muted text-xs ml-auto font-mono">{p.branch}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            ) : (
              /* Simple select for few projects */
              <select
                id="target-repo"
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                className="w-full bg-elevated border border-line rounded-xl px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
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
            )}
          </div>

          {/* Prompt */}
          <div>
            <label htmlFor="task-prompt" className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
              Task Prompt / Instruction
            </label>
            <textarea
              id="task-prompt"
              required
              rows={5}
              placeholder="e.g. Implement rate-limiting middleware in src/middleware/rate-limit.ts with unit tests using Vitest..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full bg-elevated border border-line rounded-xl p-4 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent transition-colors font-mono leading-relaxed resize-y min-h-[120px]"
            />
          </div>

          {/* Branch & LLM Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="target-branch" className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2 flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-accent-soft" /> Target Branch Name
              </label>
              <input
                id="target-branch"
                type="text"
                required
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
                className="w-full bg-elevated border border-line rounded-xl px-4 py-2.5 text-sm text-text-primary font-mono focus:outline-none focus:border-accent transition-colors"
              />
            </div>

            <div>
              <label htmlFor="provider-engine" className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2 flex items-center gap-2">
                <Cpu className="w-4 h-4 text-accent-soft" /> LLM Provider Engine
              </label>
              <select
                id="provider-engine"
                value={selectedProviderType}
                onChange={(e) => setSelectedProviderType(e.target.value as any)}
                className="w-full bg-elevated border border-line rounded-xl px-4 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent transition-colors"
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
          <div className="pt-4 border-t border-line flex justify-end">
            <button
              type="submit"
              disabled={!selectedProject || !prompt}
              className="px-6 py-3 bg-accent hover:bg-accent-muted disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl text-sm flex items-center gap-2 shadow-glow-accent transition-all cursor-pointer"
            >
              <Play className="w-4 h-4 fill-white" /> Launch Autonomous Agent
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
