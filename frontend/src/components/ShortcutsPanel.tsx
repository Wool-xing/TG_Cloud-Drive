import { useEffect } from 'react';
import { X, Keyboard } from 'lucide-react';

interface Shortcut {
  keys: string[];
  label: string;
}

const SHORTCUTS: Shortcut[][] = [
  [
    { keys: ['?'], label: '显示键盘快捷键' },
    { keys: ['Esc'], label: '取消选择 / 关闭菜单' },
    { keys: ['Ctrl', 'A'], label: '全选当前目录文件' },
    { keys: ['Delete'], label: '删除选中文件' },
  ],
  [
    { keys: ['Ctrl', 'Click'], label: '多选切换' },
    { keys: ['Shift', 'Click'], label: '范围选择' },
    { keys: ['Enter'], label: '打开文件夹 / 预览文件' },
    { keys: ['Ctrl', 'F'], label: '聚焦搜索框' },
  ],
  [
    { keys: ['→'], label: '进入选中文件夹 (光标键)' },
    { keys: ['←'], label: '返回上级目录 (光标键)' },
    { keys: ['Ctrl', 'D'], label: '下载选中文件' },
    { keys: ['F2'], label: '重命名选中文件' },
  ],
];

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[22px] px-1.5 py-0.5 text-[11px] font-mono font-medium rounded border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 shadow-sm">
      {children}
    </kbd>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ShortcutsPanel({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-blue-500" />
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">键盘快捷键</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-700 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {SHORTCUTS.map((group, gi) => (
            <div key={gi} className="space-y-2">
              {group.map((s, si) => (
                <div key={si} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-300">{s.label}</span>
                  <span className="flex items-center gap-1">
                    {s.keys.map((k, ki) => (
                      <span key={ki} className="flex items-center gap-1">
                        {ki > 0 && <span className="text-gray-400 text-xs">+</span>}
                        <Kbd>{k}</Kbd>
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500">
          按 <Kbd>Esc</Kbd> 或点击遮罩关闭
        </div>
      </div>
    </div>
  );
}
