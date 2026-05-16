import React, { useMemo } from 'react';
import {
  UploadCloud,
  ChevronDown,
  ChevronUp,
  Trash2,
  X,
  Pause,
  Play,
  CheckCircle2,
  AlertCircle,
  Lock,
  Loader2,
} from 'lucide-react';
import { useUploadStore } from '../../stores/upload.store';
import { UploadTask } from '../../types';
import { formatBytes } from '../../utils/crypto';

// ── Status icon ───────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: UploadTask['status'] }) {
  switch (status) {
    case 'encrypting':
      return <Lock className="h-4 w-4 text-purple-500 animate-pulse" />;
    case 'uploading':
      return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
    case 'done':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case 'error':
      return <AlertCircle className="h-4 w-4 text-red-500" />;
    case 'paused':
      return <Pause className="h-4 w-4 text-yellow-500" />;
    case 'pending':
    default:
      return <Loader2 className="h-4 w-4 text-gray-400 animate-spin dark:text-gray-500" />;
  }
}

// ── Status label ──────────────────────────────────────────────────────────────

function statusLabel(status: UploadTask['status']): string {
  switch (status) {
    case 'pending': return '等待中';
    case 'encrypting': return '加密中';
    case 'uploading': return '上传中';
    case 'done': return '已完成';
    case 'error': return '失败';
    case 'paused': return '已暂停';
  }
}

// ── Progress bar color ────────────────────────────────────────────────────────

function progressColor(status: UploadTask['status']): string {
  switch (status) {
    case 'encrypting': return 'bg-purple-500';
    case 'uploading': return 'bg-blue-500';
    case 'done': return 'bg-green-500';
    case 'error': return 'bg-red-500';
    case 'paused': return 'bg-yellow-400';
    default: return 'bg-gray-400';
  }
}

// ── Single task row ───────────────────────────────────────────────────────────

interface TaskRowProps {
  task: UploadTask;
}

function TaskRow({ task }: TaskRowProps) {
  const { pauseTask, resumeTask, cancelTask, swapTasks, tasks } = useUploadStore();

  const canPause = task.status === 'uploading';
  const canResume = task.status === 'paused' || task.status === 'error';
  const canCancel = task.status !== 'done';
  const canMove = task.status === 'pending' || task.status === 'paused';
  const idx = tasks.findIndex(t => t.id === task.id);

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-xl transition group">
      <div className="flex items-center gap-2">
        <StatusIcon status={task.status} />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate dark:text-gray-100" title={task.file.name}>
            {task.file.name}
          </p>
          <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            <span>{statusLabel(task.status)}</span>
            {(task.status === 'uploading' || task.status === 'encrypting') && task.progress > 0 && (
              <>
                <span>·</span>
                <span>{task.progress}%</span>
                {task.status === 'uploading' && task.speed > 0 && (
                  <>
                    <span>·</span>
                    <span>{formatBytes(task.speed)}/s</span>
                  </>
                )}
              </>
            )}
            {task.status === 'error' && task.error && (
              <>
                <span>·</span>
                <span className="text-red-400 truncate max-w-[120px]">{task.error}</span>
              </>
            )}
            {(task.status === 'done' || task.status === 'paused' || task.status === 'uploading') && (
              <>
                <span>·</span>
                <span>{formatBytes(task.file.size)}</span>
              </>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {canMove && idx > 0 && (
            <button
              onClick={() => swapTasks(task.id, tasks[idx - 1].id)}
              title="上移"
              className="p-1 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition dark:text-gray-500"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
          )}
          {canMove && idx < tasks.length - 1 && (
            <button
              onClick={() => swapTasks(task.id, tasks[idx + 1].id)}
              title="下移"
              className="p-1 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition dark:text-gray-500"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          )}
          {canPause && (
            <button
              onClick={() => pauseTask(task.id)}
              title="暂停"
              className="p-1 rounded-lg text-gray-400 hover:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-950/30 transition dark:text-gray-500"
            >
              <Pause className="h-3.5 w-3.5" />
            </button>
          )}
          {canResume && (
            <button
              onClick={() => resumeTask(task.id)}
              title="继续"
              className="p-1 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition dark:text-gray-500"
            >
              <Play className="h-3.5 w-3.5" />
            </button>
          )}
          {canCancel && (
            <button
              onClick={() => cancelTask(task.id)}
              title="取消"
              className="p-1 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition dark:text-gray-500"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {task.status !== 'done' && (
        <div className="h-1 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden ml-6">
          <div
            className={`h-full rounded-full transition-all duration-300 ${progressColor(task.status)}`}
            style={{ width: `${task.progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ── Upload queue panel ────────────────────────────────────────────────────────

export default function UploadQueue() {
  const { tasks, isOpen, toggleOpen, clearDone } = useUploadStore();

  const totalProgress = useMemo(() => {
    const active = tasks.filter(t => t.status === 'uploading' || t.status === 'encrypting');
    if (active.length === 0) return null;
    return Math.round(active.reduce((sum, t) => sum + t.progress, 0) / active.length);
  }, [tasks]);

  const doneCount = useMemo(() => tasks.filter(t => t.status === 'done').length, [tasks]);
  const activeCount = useMemo(
    () => tasks.filter(t => t.status === 'uploading' || t.status === 'encrypting' || t.status === 'pending').length,
    [tasks],
  );

  // Don't render at all if no tasks ever
  if (tasks.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-80 rounded-2xl shadow-2xl shadow-black/20 overflow-hidden transition-all duration-300 ease-in-out"
      style={{ maxHeight: isOpen ? '480px' : 'auto' }}
    >
      {/* Header (always visible) */}
      <div
        className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 cursor-pointer select-none"
        style={{ borderRadius: isOpen ? '1rem 1rem 0 0' : '1rem' }}
        onClick={toggleOpen}
      >
        <div className={`flex items-center justify-center w-8 h-8 rounded-xl ${activeCount > 0 ? 'bg-blue-100 dark:bg-blue-900/50' : 'bg-green-100 dark:bg-green-900/50'}`}>
          <UploadCloud className={`h-4 w-4 ${activeCount > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-green-600 dark:text-green-400'}`} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {activeCount > 0 ? `上传中 (${activeCount})` : `已完成 ${doneCount} 个`}
          </p>
          {totalProgress !== null && (
            <div className="mt-1 h-1 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-300"
                style={{ width: `${totalProgress}%` }}
              />
            </div>
          )}
          {totalProgress === null && activeCount === 0 && doneCount > 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500">{doneCount} 个已完成</p>
          )}
        </div>

        <div className="flex items-center gap-1">
          {totalProgress !== null && (
            <span className="text-xs font-medium text-blue-600 dark:text-blue-400 w-8 text-right">
              {totalProgress}%
            </span>
          )}
          <button className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition dark:text-gray-500">
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Expanded body */}
      {isOpen && (
        <div className="flex flex-col bg-white dark:bg-gray-800 border-x border-b border-gray-200 dark:border-gray-700 rounded-b-2xl overflow-hidden">
          {/* Toolbar */}
          {doneCount > 0 && (
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 dark:border-gray-700">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {tasks.length} 个任务
              </span>
              <button
                onClick={clearDone}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition dark:text-gray-500"
              >
                <Trash2 className="h-3.5 w-3.5" />
                清除已完成
              </button>
            </div>
          )}

          {/* Task list */}
          <div className="overflow-y-auto max-h-72 p-1.5">
            {tasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-gray-400 dark:text-gray-600 gap-2 dark:text-gray-500">
                <UploadCloud className="h-8 w-8" />
                <p className="text-sm">暂无上传任务</p>
              </div>
            ) : (
              tasks.map(task => <TaskRow key={task.id} task={task} />)
            )}
          </div>
        </div>
      )}
    </div>
  );
}
