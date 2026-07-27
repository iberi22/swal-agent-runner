import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { ProjectsView } from './components/ProjectsView';
import { NewTaskView } from './components/NewTaskView';
import { TaskProgressView } from './components/TaskProgressView';
import { TaskResultView } from './components/TaskResultView';
import { MemorySyncPanel } from './components/MemorySyncPanel';
import { AuthSettingsModal } from './components/AuthSettingsModal';
import { CodingTask } from './types';
import { AgentLoopRunner } from './agent/agent-loop';
import { GeminiOAuthService } from './services/llm/providers/gemini-oauth';
import { EdgeMeshSyncService } from './services/memory/edge-mesh-sync';

export function App() {
  const [activeTab, setActiveTab] = useState<'projects' | 'new-task' | 'progress' | 'results' | 'memory'>('projects');
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [currentTask, setCurrentTask] = useState<CodingTask | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Handle Google OAuth Callback if returning from authentication flow
  useEffect(() => {
    const path = window.location.pathname;
    if (path === '/oauth/callback') {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      const state = urlParams.get('state');

      if (code && state) {
        const clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID || '';
        GeminiOAuthService.handleCallback(code, state, clientId)
          .then(() => {
            alert('✅ Google AI Pro OAuth authentication successful!');
            window.history.replaceState({}, document.title, '/');
          })
          .catch((err) => {
            alert(`OAuth Error: ${err.message || err}`);
            window.history.replaceState({}, document.title, '/');
          });
      }
    }

    // Start background auto sync loop for Xavier memory
    EdgeMeshSyncService.startAutoSyncLoop(30000);
    return () => EdgeMeshSyncService.stopAutoSyncLoop();
  }, []);

  const handleLaunchTask = (task: CodingTask) => {
    setCurrentTask(task);
    setActiveTab('progress');

    AgentLoopRunner.runTask(task, (updated) => {
      setCurrentTask({ ...updated });
    });
  };

  const handleSelectProjectToTask = (projectName: string) => {
    setSelectedProject(projectName);
    setActiveTab('new-task');
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col">
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        openAuthModal={() => setIsAuthModalOpen(true)}
      />

      <main className="flex-1">
        {activeTab === 'projects' && (
          <ProjectsView onSelectProject={handleSelectProjectToTask} />
        )}

        {activeTab === 'new-task' && (
          <NewTaskView
            initialProjectName={selectedProject}
            onLaunchTask={handleLaunchTask}
          />
        )}

        {activeTab === 'progress' && (
          <TaskProgressView
            currentTask={currentTask}
            onViewResults={() => setActiveTab('results')}
          />
        )}

        {activeTab === 'results' && (
          <TaskResultView currentTask={currentTask} />
        )}

        {activeTab === 'memory' && (
          <MemorySyncPanel />
        )}
      </main>

      <AuthSettingsModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />
    </div>
  );
}

export default App;
