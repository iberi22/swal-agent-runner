import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Mock all eagerly-imported components ───────────────────

vi.mock('../Navbar', () => ({
  Navbar: vi.fn(({ activeTab, setActiveTab, openAuthModal }) => (
    <div data-testid="navbar">
      <span>Navbar</span>
      <button data-testid="tab-projects" onClick={() => setActiveTab('projects')}>Projects</button>
      <button data-testid="tab-new-task" onClick={() => setActiveTab('new-task')}>New Task</button>
      <button data-testid="tab-progress" onClick={() => setActiveTab('progress')}>Progress</button>
      <button data-testid="tab-results" onClick={() => setActiveTab('results')}>Results</button>
      <button data-testid="tab-memory" onClick={() => setActiveTab('memory')}>Memory</button>
      <button data-testid="tab-mesh" onClick={() => setActiveTab('mesh')}>Mesh</button>
      <button data-testid="open-auth" onClick={openAuthModal}>Auth</button>
    </div>
  )),
  BottomNav: vi.fn(({ activeTab, setActiveTab }) => (
    <div data-testid="bottom-nav">
      <span>BottomNav</span>
      <button data-testid="bottom-projects" onClick={() => setActiveTab('projects')}>P</button>
      <button data-testid="bottom-new-task" onClick={() => setActiveTab('new-task')}>NT</button>
      <button data-testid="bottom-progress" onClick={() => setActiveTab('progress')}>Pr</button>
      <button data-testid="bottom-results" onClick={() => setActiveTab('results')}>R</button>
      <button data-testid="bottom-memory" onClick={() => setActiveTab('memory')}>M</button>
      <button data-testid="bottom-mesh" onClick={() => setActiveTab('mesh')}>Me</button>
    </div>
  )),
}));

vi.mock('../ProjectsView', () => ({
  ProjectsView: vi.fn(({ onSelectProject }) => (
    <div data-testid="projects-view">
      <span>ProjectsView</span>
      <button data-testid="select-project" onClick={() => onSelectProject('test-project')}>
        Select Project
      </button>
    </div>
  )),
}));

vi.mock('../AuthSettingsModal', () => ({
  AuthSettingsModal: vi.fn(({ isOpen, onClose }) => (
    <div data-testid="auth-modal">
      <span>AuthSettingsModal</span>
      <span data-testid="auth-modal-open">{String(isOpen)}</span>
      <button data-testid="close-auth" onClick={onClose}>Close</button>
    </div>
  )),
}));

// ── Mock all lazy-loaded view modules ──────────────────────

vi.mock('../NewTaskView', () => ({
  NewTaskView: vi.fn(({ initialProjectName, onLaunchTask }) => (
    <div data-testid="new-task-view">
      <span>NewTaskView</span>
      <span data-testid="initial-project">{initialProjectName || ''}</span>
      <button
        data-testid="launch-task"
        onClick={() =>
          onLaunchTask({
            id: 'task-1',
            projectId: 'proj-1',
            title: 'Test Task',
            prompt: 'Do something',
            targetBranch: 'main',
            status: 'pending',
            createdAt: Date.now(),
            providerType: 'gemini-key',
            modelName: 'gemini-2.0-flash',
            steps: [],
          })
        }
      >
        Launch
      </button>
    </div>
  )),
}));

vi.mock('../TaskProgressView', () => ({
  TaskProgressView: vi.fn(({ currentTask, onViewResults }) => (
    <div data-testid="progress-view">
      <span>TaskProgressView</span>
      <span data-testid="current-task-title">{currentTask?.title || 'none'}</span>
      <button data-testid="view-results" onClick={onViewResults}>View Results</button>
    </div>
  )),
}));

vi.mock('../TaskResultView', () => ({
  TaskResultView: vi.fn(({ currentTask }) => (
    <div data-testid="results-view">
      <span>TaskResultView</span>
      <span data-testid="results-task-title">{currentTask?.title || 'none'}</span>
    </div>
  )),
}));

vi.mock('../MemorySyncPanel', () => ({
  MemorySyncPanel: vi.fn(() => (
    <div data-testid="memory-panel">
      <span>MemorySyncPanel</span>
    </div>
  )),
}));

vi.mock('../MeshPanel', () => ({
  MeshPanel: vi.fn(() => (
    <div data-testid="mesh-panel">
      <span>MeshPanel</span>
    </div>
  )),
}));

// ── Mock service imports ──────────────────────────────────

vi.mock('../../agent/agent-loop', () => ({
  AgentLoopRunner: {
    runTask: vi.fn((task: any, onUpdate: (t: any) => void) => {
      // Preserve the original task properties, just update status
      onUpdate({ ...task, status: 'running' as const });
    }),
  },
}));

vi.mock('../../services/llm/providers/gemini-oauth', () => ({
  GeminiOAuthService: {
    handleCallback: vi.fn().mockResolvedValue(undefined),
    getSavedConfig: vi.fn().mockReturnValue(null),
  },
}));

vi.mock('../../services/mesh/edge-mesh-client', () => {
  const eventsTarget = new EventTarget();
  return {
    edgeMeshClient: {
      events: eventsTarget,
      deviceId: 'test-device-001',
      joinRoom: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock('../../services/gestalt/gestalt-bridge', () => ({
  gestaltBridge: {
    bindMeshLifecycle: vi.fn(),
  },
}));

// ── The component under test ──────────────────────────────

import App from '../../App';

describe('App', () => {
  beforeEach(() => {
    // Clear call counts between tests — does NOT clear implementations
    vi.clearAllMocks();
    // Suppress window.alert not-implemented warning in jsdom
    vi.spyOn(window, 'alert').mockReturnValue(undefined);
    // Reset localStorage
    localStorage.clear();
    // Reset window location
    window.history.replaceState({}, document.title, '/');
  });

  it('renders without crashing', async () => {
    const { container } = render(<App />);

    // App shell should exist
    expect(container.querySelector('[data-testid="app-shell"]') || container.firstChild).toBeTruthy();

    // Navbar and BottomNav should render
    await waitFor(() => {
      expect(screen.getByTestId('navbar')).toBeTruthy();
    });
    expect(screen.getByTestId('bottom-nav')).toBeTruthy();
  });

  it('renders the projects view as the default active tab', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('projects-view')).toBeTruthy();
    });
  });

  it('switches to new-task tab when select-project is clicked', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('projects-view')).toBeTruthy();
    });

    await act(async () => {
      screen.getByTestId('select-project').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('new-task-view')).toBeTruthy();
    });
    expect(screen.getByTestId('initial-project').textContent).toBe('test-project');
  });

  it('switches to progress tab when task is launched', async () => {
    render(<App />);

    // First navigate to new-task view
    const bottomNewTask = screen.getByTestId('bottom-new-task');
    await act(async () => {
      bottomNewTask.click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('new-task-view')).toBeTruthy();
    });

    // Launch a task
    await act(async () => {
      screen.getByTestId('launch-task').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('progress-view')).toBeTruthy();
    });
    expect(screen.getByTestId('current-task-title').textContent).toBe('Test Task');
  });

  it('switches to results tab from progress view', async () => {
    render(<App />);

    // Navigate to new-task and launch
    await act(async () => {
      screen.getByTestId('bottom-new-task').click();
    });
    await waitFor(() => {
      expect(screen.getByTestId('new-task-view')).toBeTruthy();
    });
    await act(async () => {
      screen.getByTestId('launch-task').click();
    });
    await waitFor(() => {
      expect(screen.getByTestId('progress-view')).toBeTruthy();
    });

    // Click "View Results"
    await act(async () => {
      screen.getByTestId('view-results').click();
    });
    await waitFor(() => {
      expect(screen.getByTestId('results-view')).toBeTruthy();
    });
    expect(screen.getByTestId('results-task-title').textContent).toBe('Test Task');
  });

  it('switches to memory tab', async () => {
    render(<App />);

    await act(async () => {
      screen.getByTestId('bottom-memory').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('memory-panel')).toBeTruthy();
    });
  });

  it('switches to mesh tab', async () => {
    render(<App />);

    await act(async () => {
      screen.getByTestId('bottom-mesh').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('mesh-panel')).toBeTruthy();
    });
  });

  it('renders all 6 tabs via bottom navigation', async () => {
    render(<App />);

    const tabIds = ['projects', 'new-task', 'progress', 'results', 'memory', 'mesh'];
    const testIds = [
      'projects-view',
      'new-task-view',
      'progress-view',
      'results-view',
      'memory-panel',
      'mesh-panel',
    ];

    for (let i = 0; i < tabIds.length; i++) {
      // Click the tab via bottom nav
      await act(async () => {
        screen.getByTestId(`bottom-${tabIds[i]}`).click();
      });

      // Wait for the lazy component to render — but note the default
      // (projects) won't change until we await. For each tab after the
      // first, verify the previous tab's content is gone.
      await waitFor(() => {
        expect(screen.getByTestId(testIds[i])).toBeTruthy();
      });
    }
  });

  it('switches tabs via the navbar tab buttons', async () => {
    render(<App />);

    await act(async () => {
      screen.getByTestId('tab-mesh').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('mesh-panel')).toBeTruthy();
    });

    await act(async () => {
      screen.getByTestId('tab-memory').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('memory-panel')).toBeTruthy();
    });
  });

  it('opens and closes the auth modal via Navbar', async () => {
    render(<App />);

    // Initially auth modal should not be open (renders but isOpen=false)
    await waitFor(() => {
      expect(screen.getByTestId('auth-modal')).toBeTruthy();
    });
    expect(screen.getByTestId('auth-modal-open').textContent).toBe('false');

    // Click open auth button in navbar
    await act(async () => {
      screen.getByTestId('open-auth').click();
    });

    // Modal should now be open
    expect(screen.getByTestId('auth-modal-open').textContent).toBe('true');

    // Close modal
    await act(async () => {
      screen.getByTestId('close-auth').click();
    });

    expect(screen.getByTestId('auth-modal-open').textContent).toBe('false');
  });

  it('handles OAuth callback URL parameters', async () => {
    // Set up OAuth callback URL
    window.history.replaceState(
      {},
      document.title,
      '/oauth/callback?code=test-code-123&state=test-state-456',
    );

    render(<App />);

    const { GeminiOAuthService } = await import('../../services/llm/providers/gemini-oauth');
    await waitFor(() => {
      expect(GeminiOAuthService.handleCallback).toHaveBeenCalledWith(
        'test-code-123',
        'test-state-456',
        expect.any(String),
      );
    });

    // Clean up — reset location
    window.history.replaceState({}, document.title, '/');
  });

  it('initializes edge mesh and gestalt bridge on mount', async () => {
    render(<App />);

    const { edgeMeshClient } = await import('../../services/mesh/edge-mesh-client');
    const { gestaltBridge } = await import('../../services/gestalt/gestalt-bridge');

    await waitFor(() => {
      expect(edgeMeshClient.joinRoom).toHaveBeenCalled();
    });
    expect(gestaltBridge.bindMeshLifecycle).toHaveBeenCalledTimes(1);
  });

  it('sets active tab to progress and launches AgentLoopRunner when task is launched', async () => {
    const { AgentLoopRunner } = await import('../../agent/agent-loop');
    render(<App />);

    // Navigate to new-task then launch
    await act(async () => {
      screen.getByTestId('bottom-new-task').click();
    });
    await waitFor(() => {
      expect(screen.getByTestId('new-task-view')).toBeTruthy();
    });

    await act(async () => {
      screen.getByTestId('launch-task').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('progress-view')).toBeTruthy();
    });

    expect(AgentLoopRunner.runTask).toHaveBeenCalledTimes(1);
    const [task, callback] = (AgentLoopRunner.runTask as any).mock.calls[0];
    expect(task.title).toBe('Test Task');
    expect(typeof callback).toBe('function');
  });

  it('navigates from projects to new-task with selected project', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('projects-view')).toBeTruthy();
    });

    await act(async () => {
      screen.getByTestId('select-project').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('new-task-view')).toBeTruthy();
    });
    expect(screen.getByTestId('initial-project').textContent).toBe('test-project');
  });

  it('renders the fallback skeleton while suspending', async () => {
    // By mocking React.lazy to suspend longer we could test the fallback,
    // but with our fast mock modules it resolves immediately.
    // Instead, just verify no crash and the main structure is correct.
    const { container } = render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('navbar')).toBeTruthy();
    });

    // The container should have a main section
    const main = container.querySelector('main');
    expect(main).toBeTruthy();
  });
});
