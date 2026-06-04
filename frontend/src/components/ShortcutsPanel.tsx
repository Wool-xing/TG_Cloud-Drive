import { useEffect } from 'react';
import { X, Keyboard } from 'lucide-react';
import { t } from '../i18n/translations';

interface Shortcut {
  keys: string[];
  label: string;
}

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
  const groups: Shortcut[][] = [
    [
      { keys: ['?'], label: t('shortcuts.showHelp') },
      { keys: ['Esc'], label: t('shortcuts.deselect') },
      { keys: ['Ctrl', 'A'], label: t('shortcuts.selectAll') },
      { keys: ['Delete'], label: t('shortcuts.deleteSelected') },
    ],
    [
      { keys: ['Ctrl', 'Click'], label: t('shortcuts.multiSelect') },
      { keys: ['Shift', 'Click'], label: t('shortcuts.rangeSelect') },
      { keys: ['Enter'], label: t('shortcuts.openPreview') },
      { keys: ['Ctrl', 'F'], label: t('shortcuts.focusSearch') },
    ],
    [
      { keys: ['→'], label: t('shortcuts.enterFolder') },
      { keys: ['←'], label: t('shortcuts.backFolder') },
      { keys: ['Ctrl', 'D'], label: t('shortcuts.downloadFile') },
      { keys: ['F2'], label: t('shortcuts.renameFile') },
    ],
  ];

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
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{t('shortcuts.title')}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-700 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {groups.map((group, gi) => (
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
          {t('shortcuts.closeHint', { esc: 'Esc' })}
        </div>
      </div>
    </div>
  );
}
