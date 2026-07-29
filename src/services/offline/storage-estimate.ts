/**
 * Hook/helper para mostrar uso de almacenamiento en la UI.
 */
export async function getStorageInfo(): Promise<{ used: string; total: string; percent: number; persisted: boolean }> {
  const { offlineManager } = await import('./offline-manager');
  const est = await offlineManager.estimateStorage();
  const persisted = offlineManager.persisted;

  if (!est) {
    return { used: '?', total: '?', percent: 0, persisted };
  }

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return {
    used: formatBytes(est.usage),
    total: formatBytes(est.quota),
    percent: Math.round((est.usage / est.quota) * 100),
    persisted,
  };
}
