"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Save, Download, Loader2, Undo2, Type, ImagePlus, Image as ImageIcon, Wallpaper, Trash2,
  Bold, Italic, AlignLeft, AlignCenter, AlignRight, ArrowUp, ArrowDown, Copy, Minus, Plus,
  BringToFront, SendToBack, CornerLeftUp, Pencil, CheckCircle2, AlertTriangle, Zap,
  Layers, Eye, EyeOff, Lock, Unlock, Square, BarChart3, Shapes, Blend,
  ChevronUp, ChevronDown, ClipboardCopy, ClipboardPaste, Circle, RectangleHorizontal, PaintBucket, CopyPlus,
} from 'lucide-react';
import { EDITOR_RUNTIME } from './runtime';

interface Deck {
  id: string;
  title: string;
  before: string;
  slides: string[];
  after: string;
  updatedAt: string;
}

interface Selection {
  tag: string;
  isImage: boolean;
  hasText: boolean;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: string;
  canParent: boolean;
  opacity: number;
  locked: boolean;
  hidden: boolean;
  isBackground: boolean;
  isShape: boolean;
  fill: string;
}

interface Layer {
  id: string;
  type: 'background' | 'text' | 'image' | 'chart' | 'icon' | 'shape';
  label: string;
  depth: number;
  hidden: boolean;
  locked: boolean;
  selected: boolean;
}

const LAYER_ICONS: Record<Layer['type'], any> = {
  background: Wallpaper, text: Type, image: ImageIcon, chart: BarChart3, icon: Shapes, shape: Square,
};

const SLIDE_W = 1920;
const SLIDE_H = 1080;
const THUMB_SCALE = 0.1;
const AUTOSAVE_MS = 5000;

const slideDoc = (deck: Deck, html: string, editable: boolean) =>
  `${deck.before}\n${html}\n${editable ? EDITOR_RUNTIME : ''}${deck.after}`;

/** Reduz a imagem no navegador antes de embutir no slide (máx. 2400px). */
async function fileToDataUrl(file: File, maxSide = 2400): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const keepAlpha = file.type === 'image/png' || file.type === 'image/webp';
  return canvas.toDataURL(keepAlpha ? 'image/png' : 'image/jpeg', 0.9);
}

export default function DeckEditor() {
  const { id } = useParams<{ id: string }>();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [slides, setSlides] = useState<string[]>([]);
  const [current, setCurrent] = useState(0);
  const [stageDoc, setStageDoc] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [fonts, setFonts] = useState<string[]>([]);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [hasClipboard, setHasClipboard] = useState(false);
  const [shapesOpen, setShapesOpen] = useState(false);
  // Área de transferência do editor: fica aqui (e não no iframe) para valer entre slides.
  const clipboard = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [scale, setScale] = useState(0.5);

  const stageRef = useRef<HTMLIFrameElement>(null);
  const stageBoxRef = useRef<HTMLDivElement>(null);
  const slidesRef = useRef<string[]>([]);
  const pending = useRef(new Map<string, (html: string) => void>());
  const fileAction = useRef<'replaceImage' | 'addImage' | 'replaceBackground'>('addImage');
  const fileInput = useRef<HTMLInputElement>(null);
  const autosave = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ---- carregar ----
  useEffect(() => {
    fetch(`/api/decks/${id}`)
      .then(async r => {
        if (!r.ok) throw new Error(r.status === 404 ? 'Apresentação não encontrada. Ela pode ter sido gerada antes do editor existir.' : 'Falha ao carregar.');
        return r.json();
      })
      .then((data: Deck) => {
        document.title = `Editar · ${data.title || 'Apresentação'} — XGEN`;
        setDeck(data);
        slidesRef.current = data.slides;
        setSlides(data.slides);
        setStageDoc(slideDoc(data, data.slides[0], true));
      })
      .catch(e => setError(e.message));
  }, [id]);

  // ---- escala do palco ----
  useEffect(() => {
    const box = stageBoxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(() => {
      const { width, height } = box.getBoundingClientRect();
      setScale(Math.max(0.1, Math.min((width - 48) / SLIDE_W, (height - 48) / SLIDE_H)));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [deck]);

  // ---- mensagens do iframe ----
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== stageRef.current?.contentWindow || e.data?.source !== 'xgen-editor') return;
      const msg = e.data;
      if (msg.type === 'select') setSelection(msg.info);
      if (msg.type === 'change') setDirty(true);
      if (msg.type === 'ready') setFonts(prev => Array.from(new Set([...prev, ...msg.fonts])));
      if (msg.type === 'layers') setLayers(msg.items);
      if (msg.type === 'clipboard') {
        clipboard.current = msg.html;
        setHasClipboard(true);
        notify('Copiado — cole com Ctrl+V (vale em outro slide também)');
      }
      if (msg.type === 'pasteRequest' && clipboard.current) {
        stageRef.current?.contentWindow?.postMessage({ target: 'xgen-editor', cmd: 'paste', html: clipboard.current }, '*');
      }
      if (msg.type === 'html') {
        pending.current.get(msg.requestId)?.(msg.html);
        pending.current.delete(msg.requestId);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const send = (cmd: string, extra: Record<string, unknown> = {}) =>
    stageRef.current?.contentWindow?.postMessage({ target: 'xgen-editor', cmd, ...extra }, '*');

  /** Traz o HTML atual do slide aberto para o estado (sem recarregar o palco). */
  const flush = useCallback((): Promise<string[]> => new Promise(resolve => {
    const requestId = Math.random().toString(36).slice(2);
    const done = (html?: string) => {
      if (html) {
        const next = [...slidesRef.current];
        next[current] = html;
        slidesRef.current = next;
        setSlides(next);
      }
      resolve(slidesRef.current);
    };
    const timer = setTimeout(() => { pending.current.delete(requestId); done(); }, 3000);
    pending.current.set(requestId, html => { clearTimeout(timer); done(html); });
    send('serialize', { requestId });
  }), [current]);

  const openSlide = (list: string[], index: number) => {
    if (!deck) return;
    slidesRef.current = list;
    setSlides(list);
    setCurrent(index);
    setSelection(null);
    setLayers([]);
    setStageDoc(slideDoc(deck, list[index], true));
  };

  const goTo = async (index: number) => {
    if (index === current) return;
    openSlide(await flush(), index);
  };

  const duplicate = async (index: number) => {
    const list = [...(await flush())];
    list.splice(index + 1, 0, list[index]);
    openSlide(list, index + 1);
    setDirty(true);
  };

  const removeSlide = async (index: number) => {
    if (slidesRef.current.length <= 1) return notify('A apresentação precisa ter ao menos um slide.', 'error');
    if (!confirm(`Apagar o slide ${index + 1}?`)) return;
    const list = [...(await flush())];
    list.splice(index, 1);
    openSlide(list, Math.min(index, list.length - 1));
    setDirty(true);
  };

  const moveSlide = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= slidesRef.current.length) return;
    const list = [...(await flush())];
    [list[index], list[target]] = [list[target], list[index]];
    openSlide(list, index === current ? target : target === current ? index : current);
    setDirty(true);
  };

  const save = useCallback(async (silent = false) => {
    setSaving(true);
    try {
      const list = await flush();
      const res = await fetch(`/api/decks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slides: list }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Falha ao salvar');
      setDirty(false);
      if (!silent) notify('Alterações salvas');
      return true;
    } catch (e: any) {
      notify(e.message, 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }, [flush, id]);

  const download = async () => {
    setExporting(true);
    try {
      if (!(await save(true))) return;
      const res = await fetch(`/api/decks/${id}/export`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao gerar o PPTX');
      window.location.href = data.url;
      notify('PPTX gerado — download iniciado');
    } catch (e: any) {
      notify(e.message, 'error');
    } finally {
      setExporting(false);
    }
  };

  // Salvamento automático alguns segundos depois da última alteração.
  useEffect(() => {
    if (!dirty) return;
    if (autosave.current) clearTimeout(autosave.current);
    autosave.current = setTimeout(() => { save(true); }, AUTOSAVE_MS);
    return () => { if (autosave.current) clearTimeout(autosave.current); };
  }, [dirty, slides, save]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const pickFile = (action: typeof fileAction.current) => {
    fileAction.current = action;
    fileInput.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const src = await fileToDataUrl(file);
      send(fileAction.current, { src });
    } catch {
      notify('Não consegui ler essa imagem.', 'error');
    }
  };

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="glass-panel p-8 max-w-md text-center">
          <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-3" />
          <p className="text-neutral-300">{error}</p>
        </div>
      </main>
    );
  }

  if (!deck) {
    return <main className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></main>;
  }

  const Btn = ({ icon: Icon, label, onClick, active = false, disabled = false }: any) => (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}
      className={`p-2 rounded-lg border text-sm transition-colors disabled:opacity-30 ${active ? 'bg-indigo-600/30 border-indigo-500/60 text-indigo-200' : 'border-transparent text-neutral-300 hover:bg-neutral-800 hover:border-neutral-700'}`}>
      <Icon className="w-4 h-4" />
    </button>
  );
  const Sep = () => <div className="w-px h-6 bg-neutral-800 mx-1" />;

  return (
    <main className="h-screen flex flex-col overflow-hidden text-neutral-200">
      <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={onFile} />

      {/* CABEÇALHO */}
      <header className="h-14 shrink-0 flex items-center justify-between px-4 border-b border-neutral-800 bg-neutral-950/80">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-1.5 bg-indigo-600/20 rounded-lg border border-indigo-500/30"><Zap className="w-4 h-4 text-indigo-400" /></div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold truncate">{deck.title || 'Apresentação'}</h1>
            <p className="text-[11px] text-neutral-500">
              {saving ? 'Salvando…' : dirty ? 'Alterações não salvas' : 'Tudo salvo'} · {slides.length} slides
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {toast && (
            <span className={`text-xs flex items-center gap-1 mr-2 ${toast.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
              {toast.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}{toast.msg}
            </span>
          )}
          <button type="button" onClick={() => save()} disabled={saving}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-neutral-700 text-sm hover:bg-neutral-800 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
          </button>
          <button type="button" onClick={download} disabled={exporting}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50">
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Baixar PPTX
          </button>
        </div>
      </header>

      {/* BARRA DE FERRAMENTAS */}
      <div className="h-12 shrink-0 flex items-center gap-1 px-3 border-b border-neutral-800 bg-neutral-950/60 overflow-x-auto">
        <Btn icon={Undo2} label="Desfazer (Ctrl+Z)" onClick={() => send('undo')} />
        <Sep />
        <Btn icon={Type} label="Adicionar texto" onClick={() => send('addText')} />
        <Btn icon={ImagePlus} label="Adicionar imagem" onClick={() => pickFile('addImage')} />
        <Btn icon={Wallpaper} label="Trocar fundo do slide" onClick={() => pickFile('replaceBackground')} />
        <div className="relative">
          <Btn icon={Shapes} label="Inserir forma" active={shapesOpen} onClick={() => setShapesOpen(o => !o)} />
          {shapesOpen && (
            <div className="absolute top-10 left-0 z-20 flex gap-1 p-1 rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl">
              {[
                { kind: 'rect', icon: Square, label: 'Retângulo' },
                { kind: 'rounded', icon: RectangleHorizontal, label: 'Retângulo arredondado' },
                { kind: 'circle', icon: Circle, label: 'Círculo' },
                { kind: 'line', icon: Minus, label: 'Linha' },
              ].map(s => (
                <Btn key={s.kind} icon={s.icon} label={s.label} onClick={() => { send('addShape', { kind: s.kind }); setShapesOpen(false); }} />
              ))}
            </div>
          )}
        </div>
        <Btn icon={ClipboardPaste} label="Colar (Ctrl+V)" disabled={!hasClipboard}
          onClick={() => clipboard.current && send('paste', { html: clipboard.current })} />

        {selection && (
          <>
            <Sep />
            {selection.hasText && !selection.isBackground && (
              <>
                <Btn icon={Pencil} label="Editar texto (Enter)" onClick={() => send('edit')} />
                <Btn icon={Minus} label="Diminuir fonte" onClick={() => send('fontScale', { factor: 1 / 1.1 })} />
                <span className="text-xs text-neutral-400 w-10 text-center tabular-nums">{selection.fontSize}px</span>
                <Btn icon={Plus} label="Aumentar fonte" onClick={() => send('fontScale', { factor: 1.1 })} />
                <label title="Cor do texto" className="p-1.5 rounded-lg hover:bg-neutral-800 cursor-pointer flex items-center">
                  <input type="color" value={selection.color} onChange={e => send('color', { value: e.target.value })}
                    className="w-6 h-6 rounded border border-neutral-700 bg-transparent cursor-pointer" />
                </label>
                <Btn icon={Bold} label="Negrito" active={selection.bold} onClick={() => send('bold')} />
                <Btn icon={Italic} label="Itálico" active={selection.italic} onClick={() => send('italic')} />
                <Btn icon={AlignLeft} label="Alinhar à esquerda" active={['left', 'start'].includes(selection.align)} onClick={() => send('align', { value: 'left' })} />
                <Btn icon={AlignCenter} label="Centralizar" active={selection.align === 'center'} onClick={() => send('align', { value: 'center' })} />
                <Btn icon={AlignRight} label="Alinhar à direita" active={['right', 'end'].includes(selection.align)} onClick={() => send('align', { value: 'right' })} />
              </>
            )}
            {selection.isImage && !selection.isBackground && <Btn icon={ImageIcon} label="Trocar imagem" onClick={() => pickFile('replaceImage')} />}
            {selection.isBackground && <Btn icon={Wallpaper} label="Trocar fundo" onClick={() => pickFile('replaceBackground')} />}
            <Sep />
            <label title="Opacidade" className="flex items-center gap-2 px-2 text-neutral-400">
              <Blend className="w-4 h-4" />
              <input type="range" min={0} max={100} value={selection.opacity}
                onChange={e => { const value = Number(e.target.value); setSelection(s => s && { ...s, opacity: value }); send('opacity', { value }); }}
                className="w-24 accent-indigo-500" aria-label="Opacidade" />
              <span className="text-xs w-9 tabular-nums">{selection.opacity}%</span>
            </label>
            <Sep />
            <Btn icon={CornerLeftUp} label="Selecionar o bloco em volta" disabled={!selection.canParent} onClick={() => send('parent')} />
            <Btn icon={BringToFront} label="Trazer para a frente de tudo" onClick={() => send('toTop')} />
            <Btn icon={ChevronUp} label="Uma camada para frente" onClick={() => send('forward')} />
            <Btn icon={ChevronDown} label="Uma camada para trás" onClick={() => send('backward')} />
            <Btn icon={SendToBack} label="Enviar para trás de tudo" onClick={() => send('toBottom')} />
            <Sep />
            {!selection.isBackground && (
              <>
                <Btn icon={CopyPlus} label="Duplicar (Ctrl+D)" onClick={() => send('duplicate')} />
                <Btn icon={ClipboardCopy} label="Copiar (Ctrl+C)" onClick={() => send('copy')} />
                <label title="Cor de preenchimento" className="p-1.5 rounded-lg hover:bg-neutral-800 cursor-pointer flex items-center gap-1">
                  <PaintBucket className="w-4 h-4 text-neutral-400" />
                  <input type="color" value={selection.fill} onChange={e => send('fill', { value: e.target.value })}
                    className="w-6 h-6 rounded border border-neutral-700 bg-transparent cursor-pointer" aria-label="Cor de preenchimento" />
                </label>
              </>
            )}
            <Btn icon={Trash2} label="Excluir elemento (Delete)" onClick={() => send('delete')} />
          </>
        )}
        <span className="ml-auto text-[11px] text-neutral-500 whitespace-nowrap pl-4 hidden lg:block">
          Clique seleciona · arraste move · duplo clique edita o texto · quadrado azul redimensiona
        </span>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* MINIATURAS */}
        <aside className="w-60 shrink-0 border-r border-neutral-800 overflow-y-auto p-3 space-y-3 bg-neutral-950/40">
          {slides.map((html, i) => (
            <div key={i} className="group">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-neutral-500">{i + 1}</span>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button type="button" title="Mover para cima" aria-label="Mover para cima" onClick={() => moveSlide(i, -1)} className="p-1 rounded hover:bg-neutral-800"><ArrowUp className="w-3 h-3" /></button>
                  <button type="button" title="Mover para baixo" aria-label="Mover para baixo" onClick={() => moveSlide(i, 1)} className="p-1 rounded hover:bg-neutral-800"><ArrowDown className="w-3 h-3" /></button>
                  <button type="button" title="Duplicar" aria-label="Duplicar" onClick={() => duplicate(i)} className="p-1 rounded hover:bg-neutral-800"><Copy className="w-3 h-3" /></button>
                  <button type="button" title="Apagar" aria-label="Apagar" onClick={() => removeSlide(i)} className="p-1 rounded hover:bg-red-900/40 text-red-400"><Trash2 className="w-3 h-3" /></button>
                </div>
              </div>
              <button type="button" onClick={() => goTo(i)}
                className={`block rounded-md overflow-hidden border-2 transition-colors ${i === current ? 'border-indigo-500' : 'border-neutral-800 hover:border-neutral-600'}`}
                style={{ width: SLIDE_W * THUMB_SCALE, height: SLIDE_H * THUMB_SCALE }}>
                <iframe title={`Slide ${i + 1}`} sandbox="allow-scripts" srcDoc={slideDoc(deck, html, false)} tabIndex={-1}
                  style={{ width: SLIDE_W, height: SLIDE_H, transform: `scale(${THUMB_SCALE})`, transformOrigin: '0 0', pointerEvents: 'none', border: 0 }} />
              </button>
            </div>
          ))}
        </aside>

        {/* PALCO */}
        <section ref={stageBoxRef} className="flex-1 min-w-0 flex flex-col items-center justify-center relative bg-neutral-900/40">
          <div style={{ width: SLIDE_W * scale, height: SLIDE_H * scale }} className="shadow-2xl shadow-black/50 rounded overflow-hidden">
            <iframe ref={stageRef} title="Slide em edição" sandbox="allow-scripts" srcDoc={stageDoc}
              style={{ width: SLIDE_W, height: SLIDE_H, transform: `scale(${scale})`, transformOrigin: '0 0', border: 0, background: '#fff' }} />
          </div>
          {fonts.length > 0 && (
            <p className="absolute bottom-2 left-4 right-4 text-[11px] text-neutral-500 text-center">
              Fontes usadas:{' '}
              {fonts.map((f, i) => (
                <span key={f}>
                  {i > 0 && ', '}
                  <a className="text-indigo-400 hover:underline" target="_blank" rel="noreferrer"
                    href={`https://fonts.google.com/specimen/${encodeURIComponent(f).replace(/%20/g, '+')}`}>{f}</a>
                </span>
              ))}
              {' '}— instale no computador para o PPTX abrir igual no PowerPoint.
            </p>
          )}
        </section>

        {/* CAMADAS */}
        <aside className="w-64 shrink-0 border-l border-neutral-800 bg-neutral-950/40 flex flex-col min-h-0">
          <div className="h-10 shrink-0 flex items-center gap-2 px-3 border-b border-neutral-800 text-xs font-semibold text-neutral-400 uppercase tracking-wider">
            <Layers className="w-3.5 h-3.5" /> Camadas
          </div>
          <ul className="flex-1 overflow-y-auto py-1 text-xs" onMouseLeave={() => send('hoverLayer', { id: null })}>
            {layers.length === 0 && <li className="px-3 py-4 text-neutral-600">Carregando camadas…</li>}
            {layers.map(layer => {
              const Icon = LAYER_ICONS[layer.type] || Square;
              return (
                <li key={layer.id}
                  onMouseEnter={() => send('hoverLayer', { id: layer.id })}
                  className={`group flex items-center gap-1 pr-1 h-8 cursor-pointer ${layer.selected ? 'bg-indigo-600/25 text-indigo-100' : 'hover:bg-neutral-800/70 text-neutral-300'}`}>
                  <button type="button" onClick={() => send('selectLayer', { id: layer.id })}
                    className="flex-1 min-w-0 flex items-center gap-2 h-full text-left"
                    style={{ paddingLeft: 10 + Math.min(layer.depth, 6) * 12 }}>
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${layer.selected ? 'text-indigo-300' : 'text-neutral-500'}`} />
                    <span className={`truncate ${layer.hidden ? 'opacity-40 line-through' : ''}`}>{layer.label}</span>
                  </button>
                  <button type="button" title={layer.locked ? 'Destravar' : 'Travar (não seleciona nem move pelo clique)'}
                    aria-label={layer.locked ? 'Destravar camada' : 'Travar camada'}
                    onClick={() => send('toggleLock', { id: layer.id })}
                    className={`p-1 rounded hover:bg-neutral-700 ${layer.locked ? 'text-amber-400' : 'text-neutral-500 opacity-0 group-hover:opacity-100'}`}>
                    {layer.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                  </button>
                  <button type="button" title={layer.hidden ? 'Mostrar' : 'Esconder'}
                    aria-label={layer.hidden ? 'Mostrar camada' : 'Esconder camada'}
                    onClick={() => send('toggleHidden', { id: layer.id })}
                    className={`p-1 rounded hover:bg-neutral-700 ${layer.hidden ? 'text-neutral-300' : 'text-neutral-500 opacity-0 group-hover:opacity-100'}`}>
                    {layer.hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="shrink-0 px-3 py-2 border-t border-neutral-800 text-[10px] text-neutral-600 leading-snug">
            A lista vai de trás (topo) para a frente (fim). Use os botões de camada na barra para reordenar.
            Escondidas não vão para o PPTX; travadas ficam protegidas contra cliques.
          </p>
        </aside>
      </div>
    </main>
  );
}
