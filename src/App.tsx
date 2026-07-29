import React, { useState, useEffect } from 'react';
import { Navbar, BottomNav } from './components/Navbar';
import { ProjectsView } from './components/ProjectsView';
import { NewTaskView } from './components/NewTaskView';
import { TaskProgressView } from './components/TaskProgressView';
import { TaskResultView } from './components/TaskResultView';
import { MemorySyncPanel } from './components/MemorySyncPanel';
import { AuthSettingsModal } from './components/AuthSettingsModal';
import { CodingTask } from './types';
import { AgentLoopRunner } from './agent/agent-loop';
import { GeminiOAuthService } from './services/llm/providers/gemini-oauth';
import { edgeMeshClient } from './services/mesh/edge-mesh-client';
import { PairingView } from './components/PairingView';

export function App() {
  const [activeTab, setActiveTab] = useState<'projects' | 'new-task' | 'progress' | 'results' | 'memory' | 'mesh'>('projects');
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

    // EdgeMeshClient P2P — eventos de conexión
    const handlePaired = () => console.log('[EdgeMesh] Paired with peer');
    const handleUnpaired = () => console.log('[EdgeMesh] Unpaired');
    edgeMeshClient.events.addEventListener('paired', handlePaired);
    edgeMeshClient.events.addEventListener('unpaired', handleUnpaired);

    // Auto-join mesh room on startup (SWA-04)
    const defaultRoom = `device-${edgeMeshClient.deviceId || 'default'}`;
    edgeMeshClient.joinRoom(defaultRoom).catch(() => {
      // Mesh room not critical — fallback silently
    });

    return () => {
      edgeMeshClient.events.removeEventListener('paired', handlePaired);
      edgeMeshClient.events.removeEventListener('unpaired', handleUnpaired);
    };
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
    <div className="min-h-dvh flex flex-col bg-base text-text-primary">
      {/* Desktop top navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        openAuthModal={() => setIsAuthModalOpen(true)}
      />

      {/* Main content area */}
      <main className="flex-1 pb-safe md:pb-0">
        <div key={activeTab} className="animate-fade-up">
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

          {activeTab === 'mesh' && (
            <PairingView onClose={() => setActiveTab('projects')} />
          )}
        </div>
      </main>

      {/* Mobile bottom navigation */}
      <BottomNav activeTab={activeTab} setActiveTab={setActiveTab} />

      <AuthSettingsModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />
    </div>
  );
}

export default App;
