import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback } from 'react';
import { RefreshCw, Upload, Download } from 'lucide-react';

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
  isPrivate?: boolean;
}

interface SyncDiff {
  since: string;
  created: FileInfo[];
  modified: FileInfo[];
  deleted: { id: string; name: string }[];
  total: number;
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
  const qc = useQueryClient();
  const [syncDir, setSyncDir] = useState(() => localStorage.getItem('tgpan_sync_dir') || '');
  const [lastSync, setLastSync] = useState<string | null>(() => localStorage.getItem('tgpan_last_sync'));
  const [syncing, setSyncing] = useState(false);

  // Full file list
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

  // Sync diff — only fetched when lastSync is set
  const sinceParam = lastSync || new Date(0).toISOString();
  const { data: diff, refetch: refetchDiff } = useQuery<SyncDiff>({
    queryKey: ['sync-diff', sinceParam],
    queryFn: async () => {
      const res = await fetch(`${server}/api/files/sync/diff?since=${encodeURIComponent(sinceParam)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!lastSync,
    refetchInterval: lastSync ? 60_000 : false,
  });

  const handleSyncNow = useCallback(async () => {
    setSyncing(true);
    try {
      await refetchDiff();
      const now = new Date().toISOString();
      setLastSync(now);
      localStorage.setItem('tgpan_last_sync', now);
      qc.invalidateQueries({ queryKey: ['files'] });
    } finally {
      setSyncing(false);
    }
  }, [refetchDiff, qc]);

  const handleSaveDir = () => {
    if (!syncDir) return;
    localStorage.setItem('tgpan_sync_dir', syncDir);
    // On first save, set lastSync so diff becomes active
    if (!lastSync) {
      const now = new Date().toISOString();
      setLastSync(now);
      localStorage.setItem('tgpan_last_sync', now);
    }
  };

  return (
    <div className="dashboard">
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
          <button onClick={handleSaveDir} disabled={!syncDir} className="btn-secondary">
            Set Folder
          </button>
          <button onClick={handleSyncNow} disabled={syncing} className="btn-primary">
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            Sync Now
          </button>
        </div>

        {/* Sync diff summary */}
        {diff && (
          <div className="sync-summary">
            <div className="sync-stat">
              <Upload className="w-3.5 h-3.5 text-green-400" />
              <span>{diff.created.length} new</span>
            </div>
            <div className="sync-stat">
              <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
              <span>{diff.modified.length} modified</span>
            </div>
            <div className="sync-stat">
              <Download className="w-3.5 h-3.5 text-red-400" />
              <span>{diff.deleted.length} deleted</span>
            </div>
            <div className="sync-stat text-xs text-gray-500">
              Last sync: {lastSync ? formatDate(lastSync) : 'never'}
            </div>
          </div>
        )}

        {syncDir && lastSync && (
          <div className="sync-status-active">
            <span className="pulse" />
            Monitoring "{syncDir}" — auto-sync every 60s
          </div>
        )}
      </section>

      {/* Recent Changes */}
      {diff && (diff.created.length > 0 || diff.modified.length > 0) && (
        <section className="panel changes-panel">
          <h2>Pending Changes</h2>
          {diff.created.map(f => (
            <div key={f.id} className="change-row new">
              <span className="tag tag-new">NEW</span>
              <span className="change-name">{f.name}</span>
              <span className="change-size">{formatBytes(f.size)}</span>
            </div>
          ))}
          {diff.modified.map(f => (
            <div key={f.id} className="change-row modified">
              <span className="tag tag-modified">MOD</span>
              <span className="change-name">{f.name}</span>
              <span className="change-size">{formatBytes(f.size)}</span>
            </div>
          ))}
        </section>
      )}

      {/* All Files */}
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
