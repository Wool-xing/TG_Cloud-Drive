import { useEffect, useState } from 'react';
import { X, Tag, Plus, Trash2, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { filesApi } from '../../api/client';
import { Node } from '../../types';

interface TagDialogProps {
  node: Node;
  onClose: () => void;
  onSuccess: () => void;
}

export default function TagDialog({ node, onClose, onSuccess }: TagDialogProps) {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const { data: tags = [], isLoading } = useQuery<any[]>({
    queryKey: ['tags'],
    queryFn: async () => {
      const res = await filesApi.listTags() as any;
      return Array.isArray(res) ? res : (res?.tags ?? []);
    },
    staleTime: 30_000,
  });

  const nodeTags: any[] = node.tags ?? [];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await filesApi.createTag(name);
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setNewName('');
      toast.success('标签已创建');
    } catch { /* handled */ } finally { setCreating(false); }
  };

  const handleToggle = async (tagId: string, assigned: boolean) => {
    try {
      if (assigned) {
        await filesApi.removeTag(node.id, tagId);
      } else {
        await filesApi.addTag(node.id, tagId);
      }
      onSuccess();
      queryClient.invalidateQueries({ queryKey: ['tags'] });
    } catch { /* handled */ }
  };

  const handleDeleteTag = async (tagId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await filesApi.deleteTag(tagId);
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      onSuccess();
    } catch { /* handled */ }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Tag className="w-5 h-5 text-blue-500" />
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">管理标签</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-700 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{node.name}</p>

          {/* Create new tag */}
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value.slice(0, 50))}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
              placeholder="新建标签…"
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            </button>
          </div>

          {/* Tag list */}
          {isLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
          ) : tags.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-2">暂无标签，请先创建</p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {tags.map((tag: any) => {
                const assigned = nodeTags.some((t: any) => t.id === tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => handleToggle(tag.id, assigned)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                      assigned
                        ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${tag.color ? '' : 'bg-blue-400'}`} style={tag.color ? { backgroundColor: tag.color } : {}} />
                      {tag.name}
                    </span>
                    <span className="flex items-center gap-1">
                      {assigned && <span className="text-xs text-blue-500">✓</span>}
                      <span
                        onClick={(e) => handleDeleteTag(tag.id, e)}
                        className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
