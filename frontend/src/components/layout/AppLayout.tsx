import React, { useCallback, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import { UploadCloud } from 'lucide-react';
import { useAuthStore } from '../../stores/auth.store';
import { useFileStore } from '../../stores/file.store';
import { useUploadStore } from '../../stores/upload.store';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import UploadQueue from '../upload/UploadQueue';

export default function AppLayout() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { currentParentId, isPrivate } = useFileStore();
  const { addFiles } = useUploadStore();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!user) navigate('/login', { replace: true });
  }, [user, navigate]);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;
      addFiles(acceptedFiles, currentParentId, isPrivate);
    },
    [addFiles, currentParentId, isPrivate],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    noClick: true,   // Don't open picker on background click
    noKeyboard: true,
  });

  if (!user) return null;

  return (
    <div {...getRootProps()} className="relative flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-950">
      {/* Hidden dropzone input */}
      <input {...getInputProps()} />

      {/* Global drag overlay */}
      {isDragActive && (
        <div className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-blue-600/20 dark:bg-blue-500/20 backdrop-blur-[2px] border-4 border-dashed border-blue-500 dark:border-blue-400 rounded-none pointer-events-none">
          <div className="flex flex-col items-center gap-4 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl px-12 py-10">
            <div className="w-16 h-16 rounded-2xl bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
              <UploadCloud className="h-8 w-8 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-gray-900 dark:text-white">松开以上传文件</p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {isPrivate ? '将上传到隐私空间' : '将上传到当前文件夹'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Left sidebar – fixed 240px */}
      <aside className="w-60 shrink-0 flex flex-col h-full border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 z-10">
        <Sidebar />
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top navbar */}
        <header className="shrink-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 z-20">
          <Topbar onUpload={open} />
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      {/* Floating upload panel */}
      <UploadQueue />
    </div>
  );
}
