import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

interface Props {
  server: string;
  token: string;
  onLogout: () => void;
}

interface FileInfo {
  id: string;
  name: string;
  size: number;
  mimeType?: string;
  updatedAt: string;
}

const formatBytes = (b: number) => {
  if (!b) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${(b / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

const formatDate = (d: string) =>
  new Date(d).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function Dashboard({ server, token, onLogout }: Props) {
  const [syncDir, setSyncDir] = useState(
    () => localStorage.getItem('tgpan_sync_dir') || '',
  );
  const [syncing, setSyncing] = useState(false);

  const { data: files, isLoading, error } = useQuery<FileInfo[]>({
    queryKey: ['files'],
    queryFn: async () => {
      const res = await fetch(`${server}/api/files`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json.nodes ?? [];
    },
    refetchInterval: 30_000,
  });

  const handleStartSync = () => {
    if (!syncDir) return;
    localStorage.setItem('tgpan_sync_dir', syncDir);
    setSyncing(true);
  };

  const handleStopSync = () => setSyncing(false);

  return (
    <div className="dashboard">
      {/* Header */}
      <header className="header">
        <h1>TG Cloud Desktop</h1>
        <button onClick={onLogout} className="btn-logout">Sign Out</button>
      </header>

      {/* Sync Panel */}
      <section className="panel sync-panel">
        <h2>Sync Settings</h2>
        <div className="sync-row">
          <input
            type="text"
            value={syncDir}
            onChange={e => setSyncDir(e.target.value)}
            placeholder="C:\Users\me\TGCloud"
            className="flex-1"
          />
          {!syncing ? (
            <button onClick={handleStartSync} disabled={!syncDir} className="btn-primary">
              Start Sync
            </button>
          ) : (
            <button onClick={handleStopSync} className="btn-danger">
              Stop Sync
            </button>
          )}
        </div>
        {syncing && (
          <div className="sync-status">
            <span className="pulse" /> Monitoring "{syncDir}" for changes…
          </div>
        )}
      </section>

      {/* Files */}
      <section className="panel files-panel">
        <h2>Cloud Files ({files?.length ?? 0})</h2>
        {isLoading ? (
          <div className="loading">Loading…</div>
        ) : error ? (
          <div className="error">Failed to load: {(error as Error).message}</div>
        ) : files && files.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Size</th>
                <th>Modified</th>
              </tr>
            </thead>
            <tbody>
              {files.map(f => (
                <tr key={f.id}>
                  <td className="name-cell">{f.name}</td>
                  <td className="num-cell">{formatBytes(f.size)}</td>
                  <td className="num-cell">{formatDate(f.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty">No files in cloud. Upload via web app first.</div>
        )}
      </section>
    </div>
  );
}
