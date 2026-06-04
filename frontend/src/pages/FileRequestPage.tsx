import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Upload, Loader2, CheckCircle, AlertTriangle, File } from 'lucide-react';
import { t } from '../i18n/translations';
import axios from 'axios';

export default function FileRequestPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<{ maxFiles: number; uploadCount: number; expiresAt: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState<string[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`/api/file-request/${token}`);
        setInfo(res.data);
      } catch (err: any) {
        setError(err?.response?.data?.message ?? t('shareAccess.invalidLink'));
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const handleUpload = useCallback(async (files: FileList) => {
    if (!info || uploading) return;
    const remaining = info.maxFiles - info.uploadCount;
    if (remaining <= 0) { setError(t('fileRequestPage.uploadLimitReached')); return; }
    setUploading(true);
    for (let i = 0; i < Math.min(files.length, remaining); i++) {
      const file = files[i];
      try {
        const form = new FormData();
        form.append('file', file);
        await axios.post(`/api/file-request/${token}/upload`, form);
        setDone(prev => [...prev, file.name]);
        setInfo(prev => prev ? { ...prev, uploadCount: prev.uploadCount + 1 } : prev);
      } catch {
      }
    }
    setUploading(false);
  }, [info, uploading, token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error && !info) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="flex flex-col items-center gap-4 p-8">
          <AlertTriangle className="w-12 h-12 text-red-400" />
          <p className="text-gray-600 dark:text-gray-300">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <header className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center gap-3">
        <Upload className="w-5 h-5 text-green-500" />
        <div>
          <h1 className="text-base font-semibold text-gray-800 dark:text-gray-100">{t('fileRequestPage.title')}</h1>
          {info && (
            <p className="text-xs text-gray-400">
              {t('fileRequestPage.progress', { done: info.uploadCount, max: info.maxFiles, remaining: info.maxFiles - info.uploadCount })}
            </p>
          )}
        </div>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center p-8">
        {done.length > 0 && (
          <div className="mb-6 w-full max-w-md space-y-2">
            <p className="text-sm font-medium text-green-600">{t('fileRequestPage.doneFiles', { n: done.length })}</p>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {done.map((name, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                  <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                  <span className="truncate">{name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <label className={`
          flex flex-col items-center justify-center gap-4 w-full max-w-md h-48
          border-2 border-dashed rounded-2xl cursor-pointer transition
          ${uploading
            ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20'
            : 'border-gray-300 dark:border-gray-600 hover:border-green-400 dark:hover:border-green-500 bg-white dark:bg-gray-900'
          }
        `}>
          {uploading ? (
            <>
              <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
              <p className="text-sm text-gray-500">{t('fileRequestPage.uploading')}</p>
            </>
          ) : (
            <>
              <Upload className="w-10 h-10 text-gray-400" />
              <div className="text-center">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{t('fileRequestPage.dropHint')}</p>
                <p className="text-xs text-gray-400 mt-1">{t('fileRequestPage.maxSize')}</p>
              </div>
            </>
          )}
          <input
            type="file"
            multiple
            className="hidden"
            onChange={e => e.target.files && handleUpload(e.target.files)}
            disabled={uploading}
          />
        </label>
      </div>
    </div>
  );
}
