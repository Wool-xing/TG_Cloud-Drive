import { useState, useCallback, useRef, useEffect } from 'react';
import { Bold, Italic, Plus, Trash2, Table as TableIcon } from 'lucide-react';
import { t } from '../../i18n/translations';

interface CellData {
  value: string;
  bold?: boolean;
  italic?: boolean;
}

interface Props {
  content: string; // JSON-encoded sheet data
  onChange: (json: string) => void;
}

const COLS = 26;
const ROWS = 50;
const COL_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function defaultSheet(): CellData[][] {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => ({ value: '' })));
}

function parseContent(content: string): CellData[][] {
  try { return JSON.parse(content); } catch { return defaultSheet(); }
}

export default function SpreadsheetEditor({ content, onChange }: Props) {
  const [data, setData] = useState<CellData[][]>(() => parseContent(content));
  const [editCell, setEditCell] = useState<{ r: number; c: number } | null>(null);
  const [colWidths, setColWidths] = useState<number[]>(() => Array(COLS).fill(80));
  const inputRef = useRef<HTMLInputElement>(null);

  const emit = useCallback((newData: CellData[][]) => {
    setData(newData);
    onChange(JSON.stringify(newData));
  }, [onChange]);

  useEffect(() => {
    if (editCell && inputRef.current) inputRef.current.focus();
  }, [editCell]);

  const updateCell = (r: number, c: number, value: string) => {
    const d = data.map(row => [...row]);
    d[r] = [...d[r]];
    d[r][c] = { ...d[r][c], value };
    emit(d);
  };

  const toggleBold = (r: number, c: number) => {
    const d = data.map(row => [...row]);
    d[r] = [...d[r]];
    d[r][c] = { ...d[r][c], bold: !d[r][c].bold };
    emit(d);
  };

  const toggleItalic = (r: number, c: number) => {
    const d = data.map(row => [...row]);
    d[r] = [...d[r]];
    d[r][c] = { ...d[r][c], italic: !d[r][c].italic };
    emit(d);
  };

  const addRow = () => {
    emit([...data, Array.from({ length: COLS }, () => ({ value: '' }))]);
  };

  const deleteRow = (idx: number) => {
    if (data.length <= 1) return;
    emit(data.filter((_, i) => i !== idx));
  };

  const addCol = () => {
    setColWidths(w => [...w, 80]);
    emit(data.map(row => [...row, { value: '' }]));
  };
  const deleteCol = (idx: number) => {
    if (data[0].length <= 1) return;
    setColWidths(w => w.filter((_, i) => i !== idx));
    emit(data.map(row => row.filter((_, i) => i !== idx)));
  };

  const handleKeyDown = (e: React.KeyboardEvent, r: number, c: number) => {
    if (e.key === 'Tab') { e.preventDefault(); setEditCell({ r, c: Math.min(c + 1, data[0].length - 1) }); }
    else if (e.key === 'Enter') { setEditCell({ r: Math.min(r + 1, data.length - 1), c }); }
    else if (e.key === 'ArrowUp') { setEditCell({ r: Math.max(0, r - 1), c }); }
    else if (e.key === 'ArrowDown') { setEditCell({ r: Math.min(data.length - 1, r + 1), c }); }
    else if (e.key === 'ArrowLeft' && !inputRef.current?.selectionStart) { setEditCell({ r, c: Math.max(0, c - 1) }); }
    else if (e.key === 'ArrowRight' && inputRef.current?.selectionStart === inputRef.current?.value.length) { setEditCell({ r, c: Math.min(c + 1, data[0].length - 1) }); }
  };

  const selectedCell = editCell ? data[editCell.r]?.[editCell.c] : null;

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-gray-950">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-1.5 bg-white/5 border-b border-white/10 flex-shrink-0">
        {editCell && (
          <>
            <span className="text-xs text-white/40 font-mono mr-2">{COL_LABELS[editCell.c]}{editCell.r + 1}</span>
            <button onClick={() => toggleBold(editCell.r, editCell.c)} className={`p-1 rounded ${selectedCell?.bold ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white'}`} title={t('editor.bold')}><Bold className="w-3 h-3" /></button>
            <button onClick={() => toggleItalic(editCell.r, editCell.c)} className={`p-1 rounded ${selectedCell?.italic ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white'}`} title={t('editor.italic')}><Italic className="w-3 h-3" /></button>
          </>
        )}
        <span className="flex-1" />
        <button onClick={addRow} className="p-1 rounded text-white/50 hover:text-white hover:bg-white/10" title={t('spreadsheet.addRow')}><Plus className="w-3.5 h-3.5" /></button>
        {editCell && <button onClick={() => deleteRow(editCell.r)} className="p-1 rounded text-white/50 hover:text-red-400 hover:bg-white/10" title={t('spreadsheet.deleteRow')}><Trash2 className="w-3.5 h-3.5" /></button>}
      </div>
      {/* Grid */}
      <div className="flex-1 overflow-auto">
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-20 bg-gray-800 border border-gray-700 w-10 h-7 text-xs text-gray-400 font-normal"></th>
              {data[0]?.map((_, c) => (
                <th key={c} className="sticky top-0 z-10 bg-gray-800 border border-gray-700 text-xs text-gray-400 font-normal px-2 select-none"
                  style={{ minWidth: colWidths[c] || 80 }}>
                  {COL_LABELS[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, r) => (
              <tr key={r}>
                <td className="sticky left-0 z-10 bg-gray-800 border border-gray-700 text-xs text-gray-400 text-center w-10 select-none">{r + 1}</td>
                {row.map((cell, c) => {
                  const isEditing = editCell?.r === r && editCell?.c === c;
                  return (
                    <td key={c} className={`border border-gray-700/50 p-0 cursor-cell ${isEditing ? 'ring-2 ring-blue-500 z-10 relative' : ''}`}
                      style={{ minWidth: colWidths[c] || 80 }}
                      onClick={() => setEditCell({ r, c })}>
                      {isEditing ? (
                        <input ref={inputRef} value={cell.value}
                          onChange={e => updateCell(r, c, e.target.value)}
                          onKeyDown={e => handleKeyDown(e, r, c)}
                          onBlur={() => setEditCell(null)}
                          className={`w-full h-7 px-1.5 bg-gray-900 text-gray-100 outline-none text-sm ${cell.bold ? 'font-bold' : ''} ${cell.italic ? 'italic' : ''}`} />
                      ) : (
                        <div className={`h-7 px-1.5 text-gray-200 truncate text-sm ${cell.bold ? 'font-bold' : ''} ${cell.italic ? 'italic' : ''}`}>
                          {cell.value || ' '}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
