import React, { useState, useEffect } from 'react';
import { Navbar, BottomNav } from './components/Navbar';
import { ProjectsView } from './components/ProjectsView';
import { AuthSettingsModal } from './components/AuthSettingsModal';
import { CodingTask } from './types';
import { AgentLoopRunner } from './agent/agent-loop';
import { GeminiOAuthService } from './services/llm/providers/gemini-oauth';
import { edgeMeshClient } from './services/mesh/edge-mesh-client';
import { gestaltBridge } from './services/gestalt/gestalt-bridge';

// Lazy load non-default tabs to optimize mobile performance (TBT, LCP, CLS)
const NewTaskView = React.lazy(() => import('./components/NewTaskView').then(m => ({ default: m.NewTaskView })));
const TaskProgressView = React.lazy(() => import('./components/TaskProgressView').then(m => ({ default: m.TaskProgressView })));
const TaskResultView = React.lazy(() => import('./components/TaskResultView').then(m => ({ default: m.TaskResultView })));
const MemorySyncPanel = React.lazy(() => import('./components/MemorySyncPanel').then(m => ({ default: m.MemorySyncPanel })));
const MeshPanel = React.lazy(() => import('./components/MeshPanel').then(m => ({ default: m.MeshPanel })));

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

    // Wire Gestalt Bridge into mesh lifecycle — auto-init when room is joined
    gestaltBridge.bindMeshLifecycle();

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
          <React.Suspense fallback={
            <div className="max-w-4xl mx-auto px-4 py-8 text-center animate-pulse">
              <div className="h-10 w-48 bg-elevated rounded-xl mx-auto mb-4" />
              <div className="h-4 w-72 bg-elevated rounded-lg mx-auto mb-8" />
              <div className="h-64 bg-elevated rounded-3xl" />
            </div>
          }>
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
              <MeshPanel />
            )}
          </React.Suspense>
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
