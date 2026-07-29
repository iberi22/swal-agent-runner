import React, { useEffect, useState } from 'react';
import { Smartphone, Monitor, QrCode, Link2, Link2Off, RefreshCw, Check } from 'lucide-react';
import { edgeMeshClient } from '../services/mesh/edge-mesh-client';
import { XavierPairStatus } from '../types';
import { getQRDataUrl } from '../lib/qrcode';

interface PairingViewProps {
  onClose?: () => void;
}

export const PairingView: React.FC<PairingViewProps> = ({ onClose }) => {
  const [status, setStatus] = useState<XavierPairStatus>(edgeMeshClient.getPairStatus());
  const [peerId, setPeerId] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [myPeerId, setMyPeerId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = edgeMeshClient.subscribe(setStatus);
    // Use persistent device identity
    setMyPeerId(edgeMeshClient.deviceId || 'swal-' + Math.random().toString(36).slice(2, 10));
    return unsub;
  }, []);

  const handleConnect = async () => {
    if (!peerId.trim()) return;
    setConnecting(true);
    try {
      const { PeerJSTransport } = await import('../services/mesh/transport');
      const transport = new PeerJSTransport(myPeerId || 'swal-pwa');
      await transport.iniciar();
      edgeMeshClient.setTransport(transport);
    } catch (err) {
      console.error('Pairing failed:', err);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await edgeMeshClient.destroy();
    setPeerId('');
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-8 animate-fade-up">
      <div className="bg-surface border border-line rounded-2xl p-6 shadow-lg">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-accent/10 border border-accent/20 rounded-xl">
            <Smartphone className="w-6 h-6 text-accent" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-text-primary">Pair Device</h2>
            <p className="text-xs text-text-muted">
              Connect this device to your PC for remote agent execution
            </p>
          </div>
        </div>

        {/* Connection Status */}
        <div className={`p-4 rounded-xl mb-6 border transition-all ${
          status.paired
            ? 'bg-success/10 border-success/20'
            : 'bg-warning/10 border-warning/20'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${status.paired ? 'bg-success animate-pulse' : 'bg-warning'}`} />
              <div>
                <p className={`font-semibold text-sm ${status.paired ? 'text-success' : 'text-warning'}`}>
                  {status.paired ? 'Connected' : 'Disconnected'}
                </p>
                {status.paired && (
                  <p className="text-xs text-text-muted font-mono">{status.endpoint}</p>
                )}
              </div>
            </div>
            {status.paired && (
              <button
                onClick={handleDisconnect}
                className="text-xs text-error hover:text-error/80 px-3 py-1.5 rounded-lg border border-error/20 hover:bg-error/5 transition-all"
              >
                Disconnect
              </button>
            )}
          </div>
        </div>

        {!status.paired && (
          <>
            {/* This device ID */}
            <div className="mb-4 p-3 bg-elevated border border-line rounded-xl">
              <p className="text-xs text-text-muted mb-1">Your Device ID</p>
              <p className="text-sm font-mono text-accent font-semibold">{myPeerId || '...'}</p>
            </div>

            {/* Manual peer ID input */}
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                placeholder="Enter PC peer ID..."
                value={peerId}
                onChange={(e) => setPeerId(e.target.value)}
                className="flex-1 bg-base border border-line rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent font-mono transition-all"
              />
              <button
                onClick={handleConnect}
                disabled={!peerId.trim() || connecting}
                className="px-4 py-2.5 bg-accent hover:bg-accent-soft disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-xl text-sm flex items-center gap-2 transition-all cursor-pointer"
              >
                {connecting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Link2 className="w-4 h-4" />
                )}
                Pair
              </button>
            </div>

            {/* QR real */}
            {myPeerId && (
              <div className="flex flex-col items-center gap-3 pt-4 border-t border-line">
                <img
                  src={getQRDataUrl(myPeerId)}
                  alt="QR Code for pairing"
                  className="w-40 h-40 rounded-xl border border-line"
                />
                <p className="text-xs text-text-muted text-center">
                  Scan with phone camera to auto-connect
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
