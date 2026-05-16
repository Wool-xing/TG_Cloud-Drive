import { useState } from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown, Type } from 'lucide-react';

interface Slide {
  title: string;
  body: string;
}

interface Props {
  content: string;
  onChange: (json: string) => void;
}

function defaultSlides(): Slide[] {
  return [{ title: '', body: '' }];
}

function parseSlides(content: string): Slide[] {
  try { const v = JSON.parse(content); return Array.isArray(v) ? v : defaultSlides(); }
  catch { return defaultSlides(); }
}

export default function PresentationEditor({ content, onChange }: Props) {
  const [slides, setSlides] = useState<Slide[]>(() => parseSlides(content));
  const [activeSlide, setActiveSlide] = useState(0);

  const emit = (s: Slide[]) => { setSlides(s); onChange(JSON.stringify(s)); };

  const updateSlide = (idx: number, field: keyof Slide, value: string) => {
    const s = slides.map((sl, i) => i === idx ? { ...sl, [field]: value } : sl);
    emit(s);
  };

  const addSlide = () => {
    const s = [...slides, { title: '', body: '' }];
    emit(s);
    setActiveSlide(s.length - 1);
  };

  const deleteSlide = (idx: number) => {
    if (slides.length <= 1) return;
    const s = slides.filter((_, i) => i !== idx);
    emit(s);
    setActiveSlide(Math.min(activeSlide, s.length - 1));
  };

  const moveSlide = (from: number, to: number) => {
    if (to < 0 || to >= slides.length) return;
    const s = [...slides];
    [s[from], s[to]] = [s[to], s[from]];
    emit(s);
    setActiveSlide(to);
  };

  const slide = slides[activeSlide] || slides[0];

  return (
    <div className="flex flex-1 overflow-hidden bg-gray-950">
      {/* Slide list */}
      <div className="w-40 flex-shrink-0 border-r border-white/10 flex flex-col">
        <div className="flex items-center justify-between px-2 py-2 border-b border-white/10">
          <span className="text-xs text-white/50 font-medium">幻灯片</span>
          <button onClick={addSlide} className="p-0.5 rounded text-white/50 hover:text-white hover:bg-white/10"><Plus className="w-3.5 h-3.5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
          {slides.map((s, i) => (
            <div key={i}
              onClick={() => setActiveSlide(i)}
              className={`p-2 rounded cursor-pointer text-xs border transition-colors ${i === activeSlide ? 'bg-blue-600/30 border-blue-500/50 text-white' : 'border-transparent text-gray-400 hover:bg-white/5'}`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">{i + 1}</span>
                <div className="flex gap-0.5">
                  <button onClick={e => { e.stopPropagation(); moveSlide(i, i - 1); }} className="p-0.5 rounded hover:bg-white/10"><ChevronUp className="w-2.5 h-2.5" /></button>
                  <button onClick={e => { e.stopPropagation(); moveSlide(i, i + 1); }} className="p-0.5 rounded hover:bg-white/10"><ChevronDown className="w-2.5 h-2.5" /></button>
                  <button onClick={e => { e.stopPropagation(); deleteSlide(i); }} className="p-0.5 rounded hover:bg-red-500/30 text-red-400"><Trash2 className="w-2.5 h-2.5" /></button>
                </div>
              </div>
              <div className="mt-1 truncate">{s.title || '(无标题)'}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Slide editor */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-auto">
        <div className="w-full max-w-2xl aspect-[16/10] bg-white dark:bg-gray-800 rounded-lg shadow-2xl border border-white/10 flex flex-col overflow-hidden">
          {/* Title */}
          <div className="px-8 pt-8">
            <input
              value={slide.title}
              onChange={e => updateSlide(activeSlide, 'title', e.target.value)}
              placeholder="点击添加标题"
              className="w-full text-3xl font-bold text-gray-900 dark:text-white bg-transparent outline-none placeholder-gray-300 dark:placeholder-gray-600"
            />
          </div>
          <div className="mx-8 my-3 border-t border-gray-200 dark:border-gray-700" />
          {/* Body */}
          <div className="px-8 pb-8 flex-1">
            <textarea
              value={slide.body}
              onChange={e => updateSlide(activeSlide, 'body', e.target.value)}
              placeholder="点击添加内容"
              className="w-full h-full text-lg text-gray-700 dark:text-gray-300 bg-transparent outline-none resize-none placeholder-gray-300 dark:placeholder-gray-600 leading-relaxed"
            />
          </div>
          {/* Slide number */}
          <div className="px-8 pb-3 flex items-center justify-between">
            <span className="text-xs text-gray-400 flex items-center gap-1"><Type className="w-3 h-3" />演示文稿</span>
            <span className="text-xs text-gray-400">{activeSlide + 1} / {slides.length}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
