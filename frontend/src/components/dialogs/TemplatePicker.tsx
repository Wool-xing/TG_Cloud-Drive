import { useState, useEffect } from 'react';
import { X, FileText, Search, ChevronRight } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { filesApi } from '../../api/client';
import { useI18n } from '../../i18n/context';

interface NoteTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  content: string;
  isSystem: boolean;
}

interface TemplatePickerProps {
  parentId: string | null;
  isPrivate: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const CATEGORY_ICONS: Record<string, string> = {
  meeting: '📋',
  report: '📊',
  plan: '🗂️',
  todo: '✅',
  reading: '📖',
};

export default function TemplatePicker({ parentId, isPrivate, onClose, onSuccess }: TemplatePickerProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const categoryLabels: Record<string, string> = {
    meeting: t('template.category.meeting'),
    report: t('template.category.report'),
    plan: t('template.category.plan'),
    todo: t('template.category.todo'),
    reading: t('template.category.reading'),
  };
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: templates = [], isLoading } = useQuery<NoteTemplate[]>({
    queryKey: ['templates'],
    queryFn: async () => (await filesApi.listTemplates()) as unknown as NoteTemplate[],
    staleTime: 60_000,
  });

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const filtered = templates.filter(tmpl =>
    !search || tmpl.name.includes(search) || (tmpl.description || '').includes(search),
  );

  const selected = templates.find(t => t.id === selectedId) ?? null;

  const handleCreate = async () => {
    if (!selected) return;
    setCreating(true);
    try {
      // Backend expects base64-encoded content. Use TextEncoder for UTF-8 safety.
      const bytes = new TextEncoder().encode(selected.content);
      const contentBase64 = btoa(String.fromCharCode(...bytes));
      await filesApi.createDocument({
        name: `${selected.name}.md`,
        parentId,
        mimeType: 'text/markdown',
        content: contentBase64,
        private: isPrivate,
      });
      toast.success(t('template.created', { name: selected.name }));
      queryClient.invalidateQueries({ queryKey: ['files'] });
      onSuccess();
      onClose();
    } catch {
      // handled by interceptor
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('template.title')}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-700/50">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('template.search')}
              className="w-full pl-9 pr-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex">
          {/* Template list */}
          <div className="w-72 border-r border-gray-100 dark:border-gray-700/50 overflow-y-auto p-3 space-y-1">
            {isLoading ? (
              <div className="text-center py-8 text-sm text-gray-400">{t('toolbar.loading')}</div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-8 text-sm text-gray-400">{t('template.empty')}</div>
            ) : (
              filtered.map(tmpl => (
                <button
                  key={tmpl.id}
                  onClick={() => setSelectedId(tmpl.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors flex items-center gap-3 ${
                    selectedId === tmpl.id
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <span className="text-lg">{CATEGORY_ICONS[tmpl.category] || '📄'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{tmpl.name}</div>
                    <div className="text-xs text-gray-400 truncate">
                      {tmpl.isSystem ? t('template.system') : t('template.my')} · {categoryLabels[tmpl.category] || tmpl.category}
                    </div>
                  </div>
                  {selectedId === tmpl.id && <ChevronRight className="w-4 h-4 shrink-0" />}
                </button>
              ))
            )}
          </div>

          {/* Preview */}
          <div className="flex-1 overflow-y-auto p-4">
            {selected ? (
              <div className="h-full flex flex-col">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">{CATEGORY_ICONS[selected.category] || '📄'}</span>
                  <div>
                    <div className="font-medium text-gray-900 dark:text-gray-100">{selected.name}</div>
                    {selected.description && (
                      <div className="text-sm text-gray-500">{selected.description}</div>
                    )}
                  </div>
                </div>
                <div className="flex-1 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4 overflow-y-auto">
                  <pre className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono leading-relaxed">
                    {selected.content.slice(0, 2000)}
                    {selected.content.length > 2000 && '\n\n…'}
                  </pre>
                </div>
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="mt-4 w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <FileText className="w-4 h-4" />
                  {creating ? t('toolbar.creating') : t('template.create')}
                </button>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-gray-400">
                {t('template.preview')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
