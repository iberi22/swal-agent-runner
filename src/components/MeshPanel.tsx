import React, { useEffect, useState, useRef } from 'react';
import {
  Smartphone,
  Monitor,
  Globe,
  Server,
  Wifi,
  WifiOff,
  Users,
  Pencil,
  Check,
  X,
  DoorOpen,
  Plus,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { edgeMeshClient } from '../services/mesh/edge-mesh-client';
import { deviceIdentity, type DeviceInfo, type DeviceType } from '../services/mesh/device-identity';

// ── Helpers ──

/**
 * Returns a React element rendering the appropriate Lucide icon corresponding to the device type.
 *
 * @param type - The device type string.
 * @returns React node representation of the device icon.
 */
function deviceTypeIcon(type: DeviceType): React.ReactNode {
  switch (type) {
    case 'phone':
      return <Smartphone className="w-5 h-5" />;
    case 'tablet':
      return <Monitor className="w-5 h-5" />;
    case 'pc':
      return <Monitor className="w-5 h-5" />;
    case 'web':
      return <Globe className="w-5 h-5" />;
    default:
      return <Server className="w-5 h-5" />;
  }
}

/** Mapping from DeviceType enumeration to human-friendly display names. */
const deviceTypeLabel: Record<DeviceType, string> = {
  phone: 'Phone',
  tablet: 'Tablet',
  pc: 'Desktop',
  web: 'Web Browser',
  unknown: 'Unknown',
};

/**
 * Formats a raw numerical timestamp into a human-readable relative time string (e.g. "Just now", "5m ago", "2h ago").
 *
 * @param timestamp - The numerical timestamp to format.
 * @returns A human-readable relative time string.
 */
function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/**
 * Truncates long peer IDs to make them layout-friendly (e.g. "abcdef123456" into "abcdef12…3456").
 *
 * @param id - The peer ID to truncate.
 * @returns The truncated peer ID string.
 */
function truncatePeerId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

// ── Component ──

/**
 * MeshPanel Component
 * ===================
 * A React functional component representing the Multi-Peer Mesh network room manager panel.
 * Displays local device identity (type, ID, created dates, etc.), allows editing local device display names,
 * handles room connection/disconnection inputs, and lists active WebRTC peers in the connected room in real-time.
 */
export const MeshPanel: React.FC = () => {
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [meshRoom, setMeshRoom] = useState('');
  const [meshPeers, setMeshPeers] = useState<string[]>([]);
  const [paired, setPaired] = useState(false);
  const [roomInput, setRoomInput] = useState('');
  const [joining, setJoining] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const prevPeersRef = useRef<string[]>([]);

  // ── Sync state from EdgeMeshClient ──
  const syncMeshState = useRef(() => {
    if (!mountedRef.current) return;
    const room = edgeMeshClient.meshRoom;
    const peers = edgeMeshClient.meshPeers;
    setMeshRoom(room);
    setPaired(edgeMeshClient.paired);

    // Only update peer list when it actually changes (avoids re-render storms)
    const prev = prevPeersRef.current;
    if (peers.length !== prev.length || peers.some((p, i) => p !== prev[i])) {
      setMeshPeers(peers);
      prevPeersRef.current = peers;
    }
  }).current;

  // ── Init ──
  useEffect(() => {
    mountedRef.current = true;

    // Load device identity
    (async () => {
      try {
        const info = await deviceIdentity.getInfo();
        if (!mountedRef.current) return;
        setDeviceInfo(info);
        setNameInput(info.name);
      } catch (err) {
        console.error('[MeshPanel] Failed to load device info:', err);
      }
    })();

    // Initial mesh state
    syncMeshState();

    // Subscribe to pairing status changes
    const unsub = edgeMeshClient.subscribe((status) => {
      if (!mountedRef.current) return;
      setPaired(status.paired);
    });

    // Poll for mesh room / peer changes (edges don't fire explicit events for peer set)
    const pollInterval = setInterval(syncMeshState, 3_000);

    // Listen for mesh room events
    const handleRoomJoined = () => {
      if (!mountedRef.current) return;
      syncMeshState();
      setError(null);
    };
    const handleRoomLeft = () => {
      if (!mountedRef.current) return;
      setMeshRoom('');
      setMeshPeers([]);
      setPaired(false);
      prevPeersRef.current = [];
    };

    edgeMeshClient.events.addEventListener('mesh:room-joined', handleRoomJoined);
    edgeMeshClient.events.addEventListener('mesh:room-left', handleRoomLeft);

    return () => {
      mountedRef.current = false;
      unsub();
      clearInterval(pollInterval);
      edgeMeshClient.events.removeEventListener('mesh:room-joined', handleRoomJoined);
      edgeMeshClient.events.removeEventListener('mesh:room-left', handleRoomLeft);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Handlers ──

  const handleJoinRoom = async () => {
    if (!roomInput.trim()) return;
    setJoining(true);
    setError(null);
    try {
      await edgeMeshClient.joinRoom(roomInput.trim());
      setRoomInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join room');
    } finally {
      setJoining(false);
    }
  };

  const handleLeaveRoom = async () => {
    try {
      await edgeMeshClient.leaveRoom();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to leave room');
    }
  };

  const handleSaveName = async () => {
    if (!nameInput.trim() || !deviceInfo) return;
    try {
      await deviceIdentity.setName(nameInput.trim());
      const updated = await deviceIdentity.getInfo();
      if (mountedRef.current) {
        setDeviceInfo(updated);
        setEditingName(false);
      }
    } catch (err) {
      console.error('[MeshPanel] Failed to save name:', err);
    }
  };

  const handleCancelEdit = () => {
    setNameInput(deviceInfo?.name ?? '');
    setEditingName(false);
  };

  const handleRegenerateId = async () => {
    setConfirmRegenerate(false);
    try {
      const newInfo = await deviceIdentity.reset();
      if (mountedRef.current) {
        setDeviceInfo(newInfo);
        setNameInput(newInfo.name);
      }
    } catch (err) {
      console.error('[MeshPanel] Failed to regenerate device ID:', err);
    }
  };

  // ── Render ──

  if (!deviceInfo) {
    return (
      <div className="max-w-lg mx-auto px-4 py-8 animate-fade-up">
        <div className="bg-surface border border-line rounded-2xl p-6 shadow-lg">
          <div className="flex items-center justify-center gap-2 py-8">
            <RefreshCw className="w-5 h-5 text-text-muted animate-spin" />
            <span className="text-sm text-text-muted">Loading device info…</span>
          </div>
        </div>
      </div>
    );
  }

  const peerCount = meshPeers.length;

  return (
    <div className="max-w-lg mx-auto px-4 py-8 animate-fade-up space-y-4">
      {/* ── Device Identity Card ── */}
      <div className="bg-surface border border-line rounded-2xl p-6 shadow-lg">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="p-3 bg-accent/10 border border-accent/20 rounded-xl">
            <Server className="w-6 h-6 text-accent" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-text-primary">Mesh Panel</h2>
            <p className="text-xs text-text-muted">
              Multi-peer room management &amp; device identity
            </p>
          </div>
        </div>

        {/* Identity block */}
        <div className="p-4 bg-elevated border border-line rounded-xl mb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-1.5 bg-accent/10 rounded-lg text-accent shrink-0">
                {deviceTypeIcon(deviceInfo.deviceType)}
              </div>
              <div className="min-w-0">
                {editingName ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveName();
                        if (e.key === 'Escape') handleCancelEdit();
                      }}
                      className="bg-base border border-line rounded-lg px-2 py-1 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent font-medium w-28 transition-all"
                      autoFocus
                    />
                    <button
                      onClick={handleSaveName}
                      className="p-1 rounded-md text-accent hover:bg-accent/10 transition-all cursor-pointer"
                      title="Save name"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="p-1 rounded-md text-text-muted hover:bg-base transition-all cursor-pointer"
                      title="Cancel"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold text-text-primary truncate">
                      {deviceInfo.name}
                    </p>
                    <button
                      onClick={() => {
                        setNameInput(deviceInfo.name);
                        setEditingName(true);
                      }}
                      className="p-1 rounded-md text-text-muted hover:text-accent hover:bg-accent/10 transition-all cursor-pointer shrink-0"
                      title="Edit name"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  </div>
                )}
                <p className="text-xs text-text-muted">
                  {deviceTypeLabel[deviceInfo.deviceType]}
                </p>
              </div>
            </div>

            {/* Online / Offline badge */}
            <div className="flex items-center gap-1.5 shrink-0 ml-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  paired ? 'bg-success animate-pulse' : 'bg-warning'
                }`}
              />
              <span
                className={`text-xs font-medium ${
                  paired ? 'text-success' : 'text-warning'
                }`}
              >
                {paired ? 'Connected' : 'Offline'}
              </span>
            </div>
          </div>

          {/* Device ID */}
          <div className="bg-base border border-line rounded-lg p-2.5 mb-3">
            <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1">
              Device ID
            </p>
            <p className="text-sm font-mono text-accent font-medium break-all">
              {deviceInfo.deviceId}
            </p>
          </div>

          {/* Timestamps */}
          <div className="flex justify-between text-[11px] text-text-muted">
            <span>Created {formatRelativeTime(deviceInfo.createdAt)}</span>
            <span>Last seen {formatRelativeTime(deviceInfo.lastSeen)}</span>
          </div>
        </div>

        {/* Regenerate Device ID */}
        {!confirmRegenerate ? (
          <button
            onClick={() => setConfirmRegenerate(true)}
            className="w-full flex items-center justify-center gap-2 text-xs text-text-muted hover:text-warning px-3 py-2 rounded-lg border border-line hover:border-warning/30 hover:bg-warning/5 transition-all cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Regenerate Device ID
          </button>
        ) : (
          <div className="p-3 bg-warning/10 border border-warning/20 rounded-xl">
            <div className="flex items-start gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <p className="text-xs text-text-primary">
                This will create a new identity. All existing mesh connections will be lost.
                Are you sure?
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmRegenerate(false)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-line text-text-muted hover:bg-base transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleRegenerateId}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-warning/20 text-warning hover:bg-warning/30 transition-all cursor-pointer"
              >
                Regenerate
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Room Section ── */}
      <div className="bg-surface border border-line rounded-2xl p-6 shadow-lg">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 bg-accent/10 border border-accent/20 rounded-xl">
            <Wifi className="w-5 h-5 text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-text-primary">Mesh Room</h3>
            {meshRoom ? (
              <p className="text-xs text-text-muted font-mono truncate">{meshRoom}</p>
            ) : (
              <p className="text-xs text-text-muted">Not connected to any room</p>
            )}
          </div>
          {meshRoom && (
            <div className="flex items-center gap-1.5 bg-success/10 px-3 py-1.5 rounded-lg shrink-0">
              <Users className="w-3.5 h-3.5 text-success" />
              <span className="text-xs font-semibold text-success">{peerCount}</span>
            </div>
          )}
        </div>

        {/* Room actions */}
        {meshRoom ? (
          <button
            onClick={handleLeaveRoom}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border border-error/20 text-error hover:bg-error/5 transition-all cursor-pointer"
          >
            <DoorOpen className="w-4 h-4" />
            Leave Room
          </button>
        ) : (
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Enter room name…"
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleJoinRoom();
              }}
              className="flex-1 bg-base border border-line rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent font-mono transition-all"
            />
            <button
              onClick={handleJoinRoom}
              disabled={!roomInput.trim() || joining}
              className="px-4 py-2.5 bg-accent hover:bg-accent-soft disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-xl text-sm flex items-center gap-2 transition-all cursor-pointer"
            >
              {joining ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              Join
            </button>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="mt-3 p-2.5 bg-error/10 border border-error/20 rounded-lg">
            <p className="text-xs text-error">{error}</p>
          </div>
        )}
      </div>

      {/* ── Peer List ── */}
      <div className="bg-surface border border-line rounded-2xl p-6 shadow-lg">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 bg-accent/10 border border-accent/20 rounded-xl">
            <Users className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-text-primary">Connected Peers</h3>
            <p className="text-xs text-text-muted">
              {peerCount > 0
                ? `${peerCount} peer${peerCount !== 1 ? 's' : ''} in room`
                : meshRoom
                  ? 'Waiting for peers…'
                  : 'Join a room to see peers'}
            </p>
          </div>
        </div>

        {peerCount > 0 ? (
          <div className="space-y-2">
            {meshPeers.map((peerId) => (
              <div
                key={peerId}
                className="flex items-center justify-between p-3 bg-elevated border border-line rounded-xl"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-1.5 bg-accent/10 rounded-lg text-accent shrink-0">
                    <Monitor className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {truncatePeerId(peerId)}
                    </p>
                    <p className="text-[11px] text-text-muted font-mono truncate">{peerId}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <div className="w-2 h-2 rounded-full bg-success" />
                  <span className="text-[11px] text-text-muted">Active</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-6 flex flex-col items-center justify-center text-center">
            <WifiOff className="w-8 h-8 text-text-muted/40 mb-2" />
            <p className="text-xs text-text-muted">
              {meshRoom
                ? 'No peers connected yet'
                : 'Connect to a room to discover peers'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
