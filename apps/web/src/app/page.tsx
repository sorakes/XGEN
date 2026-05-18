"use client";

import { useEffect, useState, useCallback } from 'react';
import { 
  Settings, Save, ShieldAlert, CheckCircle2, Loader2, KeyRound, 
  Image as ImageIcon, Repeat, Brain, Zap, Globe, Server, Palette,
  X, Activity, FileText, Download, AlertTriangle, Clock, ChevronRight
} from 'lucide-react';

type TabId = 'llm' | 'image' | 'engine';

interface SettingsData {
  openai_key: string; openai_model: string; openai_base_url: string;
  ollama_url: string; ollama_model: string;
  openrouter_key: string; openrouter_model: string;
  google_key: string; google_model: string;
  active_llm: string;
  pexels_key: string;
  comfyui_url: string; comfyui_workflow: string;
  gemini_img_key: string;
  active_image: string;
  max_retries: number;
}

interface Job {
  id: string; status: string; current_step: string | null; prompt: string; file_type: string;
  file_url: string | null; error_log: string | null;
  createdAt: string; updatedAt: string;
}

const API = typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.hostname}:3001` : 'http://localhost:3001';

const defaults: SettingsData = {
  openai_key: '', openai_model: 'gpt-4o', openai_base_url: 'https://api.openai.com/v1',
  ollama_url: 'http://localhost:11434', ollama_model: 'llama3',
  openrouter_key: '', openrouter_model: 'openai/gpt-4o',
  google_key: '', google_model: 'gemini-2.0-flash',
  active_llm: 'openai',
  pexels_key: '', comfyui_url: 'http://localhost:8188', comfyui_workflow: '',
  gemini_img_key: '', active_image: 'pexels', max_retries: 3,
};

export default function XGenDashboard() {
  const [data, setData] = useState<SettingsData>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{msg: string, type: 'success' | 'error'} | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('llm');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/settings`).then(r => r.json()).then(res => {
      const cleaned: any = {};
      for (const [k, v] of Object.entries(res)) { cleaned[k] = v ?? (defaults as any)[k] ?? ''; }
      setData({ ...defaults, ...cleaned }); setLoading(false);
    }).catch(() => {
      setToast({ msg: 'API não encontrada em :3001', type: 'error' }); setLoading(false);
    });
  }, []);

  const fetchJobs = useCallback(() => {
    setJobsLoading(true);
    fetch(`${API}/api/jobs`).then(r => r.json()).then(res => {
      setJobs(res); setJobsLoading(false);
    }).catch(() => setJobsLoading(false));
  }, []);

  useEffect(() => {
    if (drawerOpen) { fetchJobs(); const iv = setInterval(fetchJobs, 5000); return () => clearInterval(iv); }
  }, [drawerOpen, fetchJobs]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await fetch(`${API}/api/settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      setToast({ msg: 'Configurações salvas com sucesso!', type: 'success' });
      setTimeout(() => setToast(null), 4000);
    } catch { setToast({ msg: 'Erro ao salvar.', type: 'error' }); }
    setSaving(false);
  };

  const set = (key: keyof SettingsData, val: any) => setData(prev => ({ ...prev, [key]: val }));

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      queued: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      processing: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      completed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      failed: 'bg-red-500/20 text-red-400 border-red-500/30',
    };
    return map[s] || 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30';
  };

  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: 'llm', label: 'LLM Providers', icon: Brain },
    { id: 'image', label: 'Image Providers', icon: Palette },
    { id: 'engine', label: 'Engine', icon: Zap },
  ];

  const ProviderCard = ({ title, icon: Icon, active, onActivate, children }: any) => (
    <div className={`rounded-xl border p-5 transition-all duration-300 ${active ? 'border-indigo-500/60 bg-indigo-500/5 shadow-[0_0_15px_rgba(79,70,229,0.1)]' : 'border-neutral-800 bg-neutral-900/30 hover:border-neutral-700'}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-lg ${active ? 'bg-indigo-500/20' : 'bg-neutral-800'}`}>
            <Icon className={`w-4 h-4 ${active ? 'text-indigo-400' : 'text-neutral-500'}`} />
          </div>
          <h3 className="font-semibold text-sm text-white">{title}</h3>
        </div>
        <button type="button" onClick={onActivate}
          className={`text-xs px-3 py-1 rounded-full border font-medium transition-all ${active ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-transparent border-neutral-700 text-neutral-400 hover:border-neutral-500'}`}>
          {active ? '● Active' : 'Activate'}
        </button>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );

  const Input = ({ label, value, onChange, type = 'text', placeholder = '' }: any) => (
    <div>
      <label className="text-xs text-neutral-500 mb-1 block">{label}</label>
      <input type={type} value={value} onChange={(e: any) => onChange(e.target.value)}
        className="input-premium" placeholder={placeholder} />
    </div>
  );

  return (
    <main className="min-h-screen p-6 lg:p-16 font-sans">
      {/* HEADER */}
      <div className="max-w-5xl mx-auto mb-8 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="p-3 bg-indigo-600/20 rounded-2xl border border-indigo-500/30">
            <Zap className="w-6 h-6 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tighter bg-gradient-to-r from-white to-neutral-400 bg-clip-text text-transparent">XGEN</h1>
            <p className="text-xs text-neutral-500">Model Context Protocol Engine</p>
          </div>
        </div>
        <button type="button" onClick={() => setDrawerOpen(true)}
          className="flex items-center space-x-2 bg-neutral-800/50 hover:bg-neutral-700/50 border border-neutral-700 px-4 py-2 rounded-xl text-sm text-neutral-300 transition-all group">
          <Activity className="w-4 h-4 text-indigo-400 group-hover:animate-pulse" />
          <span>Queue Monitor</span>
          <ChevronRight className="w-3 h-3 text-neutral-500" />
        </button>
      </div>

      {/* TABS */}
      <div className="max-w-5xl mx-auto">
        <div className="flex space-x-1 bg-neutral-900/50 p-1 rounded-xl border border-neutral-800 mb-6">
          {tabs.map(tab => (
            <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center space-x-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-all duration-300 ${activeTab === tab.id ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 shadow-[0_0_10px_rgba(79,70,229,0.15)]' : 'text-neutral-500 hover:text-neutral-300'}`}>
              <tab.icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>
        ) : (
          <form onSubmit={handleSave}>
            {/* TAB: LLM */}
            {activeTab === 'llm' && (
              <div className="space-y-4">
                <ProviderCard title="OpenAI" icon={Brain} active={data.active_llm === 'openai'} onActivate={() => set('active_llm', 'openai')}>
                  <Input label="API Key" value={data.openai_key} onChange={(v: string) => set('openai_key', v)} type="password" placeholder="sk-proj-..." />
                  <Input label="Model" value={data.openai_model} onChange={(v: string) => set('openai_model', v)} placeholder="gpt-4o" />
                  <Input label="Base URL" value={data.openai_base_url} onChange={(v: string) => set('openai_base_url', v)} placeholder="https://api.openai.com/v1" />
                </ProviderCard>

                <ProviderCard title="Ollama (Local)" icon={Server} active={data.active_llm === 'ollama'} onActivate={() => set('active_llm', 'ollama')}>
                  <Input label="Server URL" value={data.ollama_url} onChange={(v: string) => set('ollama_url', v)} placeholder="http://localhost:11434" />
                  <Input label="Model" value={data.ollama_model} onChange={(v: string) => set('ollama_model', v)} placeholder="llama3" />
                </ProviderCard>

                <ProviderCard title="OpenRouter" icon={Globe} active={data.active_llm === 'openrouter'} onActivate={() => set('active_llm', 'openrouter')}>
                  <Input label="API Key" value={data.openrouter_key} onChange={(v: string) => set('openrouter_key', v)} type="password" placeholder="sk-or-..." />
                  <Input label="Model" value={data.openrouter_model} onChange={(v: string) => set('openrouter_model', v)} placeholder="openai/gpt-4o" />
                </ProviderCard>

                <ProviderCard title="Google Gemini" icon={Zap} active={data.active_llm === 'google'} onActivate={() => set('active_llm', 'google')}>
                  <Input label="API Key" value={data.google_key} onChange={(v: string) => set('google_key', v)} type="password" placeholder="AIza..." />
                  <Input label="Model" value={data.google_model} onChange={(v: string) => set('google_model', v)} placeholder="gemini-2.0-flash" />
                </ProviderCard>
              </div>
            )}

            {/* TAB: IMAGE */}
            {activeTab === 'image' && (
              <div className="space-y-4">
                <ProviderCard title="Pexels (Stock Images)" icon={ImageIcon} active={data.active_image === 'pexels'} onActivate={() => set('active_image', 'pexels')}>
                  <Input label="API Key" value={data.pexels_key} onChange={(v: string) => set('pexels_key', v)} type="password" placeholder="Pexels API token" />
                </ProviderCard>

                <ProviderCard title="ComfyUI (Local Generation)" icon={Palette} active={data.active_image === 'comfyui'} onActivate={() => set('active_image', 'comfyui')}>
                  <Input label="Server URL" value={data.comfyui_url} onChange={(v: string) => set('comfyui_url', v)} placeholder="http://localhost:8188" />
                  <div>
                    <label className="text-xs text-neutral-500 mb-1 block">Workflow JSON (Optional)</label>
                    <textarea value={data.comfyui_workflow} onChange={(e) => set('comfyui_workflow', e.target.value)}
                      className="input-premium min-h-[80px] resize-y" placeholder='{"3": {"class_type": "KSampler", ...}}' />
                  </div>
                </ProviderCard>

                <ProviderCard title="Google Gemini (AI Images)" icon={Zap} active={data.active_image === 'gemini'} onActivate={() => set('active_image', 'gemini')}>
                  <Input label="Gemini API Key" value={data.gemini_img_key} onChange={(v: string) => set('gemini_img_key', v)} type="password" placeholder="AIza..." />
                </ProviderCard>
              </div>
            )}

            {/* TAB: ENGINE */}
            {activeTab === 'engine' && (
              <div className="glass-panel p-6 space-y-5">
                <div className="flex items-center space-x-3 mb-2">
                  <div className="p-2 bg-neutral-800 rounded-lg"><Repeat className="w-4 h-4 text-neutral-300" /></div>
                  <h3 className="text-base font-semibold text-white">Agentic Reflection Engine</h3>
                </div>
                <div>
                  <label className="text-xs text-neutral-500 mb-1 block">Reflection Cycles (Auto-Correção)</label>
                  <input type="range" min="1" max="10" value={data.max_retries}
                    onChange={(e) => set('max_retries', parseInt(e.target.value))}
                    className="w-full accent-indigo-500" />
                  <div className="flex justify-between text-xs text-neutral-600 mt-1">
                    <span>1 (Rápido)</span>
                    <span className="text-indigo-400 font-bold text-sm">{data.max_retries}</span>
                    <span>10 (Ultra Crítico)</span>
                  </div>
                  <p className="text-xs text-neutral-500 mt-3 leading-snug">
                    Quantas vezes a IA vai criticar e reescrever o design até ficar satisfeita com a qualidade visual do documento final.
                  </p>
                </div>

                <div className="pt-4 border-t border-neutral-800/50">
                  <h4 className="text-xs text-neutral-400 font-semibold uppercase tracking-widest mb-3">Current Config Summary</h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="bg-neutral-900/50 rounded-lg p-3 border border-neutral-800">
                      <span className="text-neutral-500">Active LLM</span>
                      <p className="text-indigo-400 font-semibold mt-1 capitalize">{data.active_llm}</p>
                    </div>
                    <div className="bg-neutral-900/50 rounded-lg p-3 border border-neutral-800">
                      <span className="text-neutral-500">Active Image</span>
                      <p className="text-indigo-400 font-semibold mt-1 capitalize">{data.active_image}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SAVE BAR */}
            <div className="mt-6 flex items-center justify-between">
              <div>
                {toast && (
                  <div className={`flex items-center space-x-2 text-sm ${toast.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
                    <span>{toast.msg}</span>
                  </div>
                )}
              </div>
              <button type="submit" disabled={saving}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 flex items-center space-x-2 shadow-[0_0_15px_rgba(79,70,229,0.3)] hover:shadow-[0_0_25px_rgba(79,70,229,0.5)] disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>Save All Settings</span>
              </button>
            </div>
          </form>
        )}
      </div>

      {/* DRAWER OVERLAY */}
      {drawerOpen && <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={() => setDrawerOpen(false)} />}

      {/* DRAWER */}
      <div className={`fixed top-0 right-0 h-full w-full sm:w-[480px] bg-neutral-950/95 backdrop-blur-xl border-l border-neutral-800 z-50 transform transition-transform duration-500 ease-out ${drawerOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="p-6 h-full flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-indigo-500/20 rounded-lg"><Activity className="w-5 h-5 text-indigo-400" /></div>
              <div>
                <h2 className="text-lg font-bold text-white">Queue Monitor</h2>
                <p className="text-xs text-neutral-500">Auto-refresh every 5s</p>
              </div>
            </div>
            <button type="button" onClick={() => setDrawerOpen(false)}
              className="p-2 hover:bg-neutral-800 rounded-lg transition-colors">
              <X className="w-5 h-5 text-neutral-400" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {jobsLoading && jobs.length === 0 ? (
              <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 text-indigo-500 animate-spin" /></div>
            ) : jobs.length === 0 ? (
              <div className="text-center py-20 text-neutral-600">
                <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Nenhum job registrado ainda.</p>
                <p className="text-xs mt-1">Solicite um documento pelo OpenWebUI para iniciar.</p>
              </div>
            ) : (
              jobs.map(job => (
                <div key={job.id} className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-4 hover:border-neutral-700 transition-colors">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${statusBadge(job.status)}`}>
                        {job.status}
                      </span>
                      <span className="text-[10px] font-mono text-neutral-600 bg-neutral-800 px-2 py-0.5 rounded">{job.file_type}</span>
                    </div>
                    <span className="text-[10px] text-neutral-600 flex items-center space-x-1">
                      <Clock className="w-3 h-3" />
                      <span>{new Date(job.createdAt).toLocaleString('pt-BR')}</span>
                    </span>
                  </div>
                  {job.current_step && job.status === 'processing' && (
                    <div className="flex items-center space-x-2 mb-2">
                      <Loader2 className="w-3 h-3 text-indigo-400 animate-spin" />
                      <span className="text-xs text-indigo-300 font-medium">{job.current_step}</span>
                    </div>
                  )}
                  {job.current_step && job.status !== 'processing' && (
                    <p className="text-[10px] text-neutral-500 mb-1">{job.current_step}</p>
                  )}
                  <p className="text-xs text-neutral-400 line-clamp-2 mb-2">{job.prompt}</p>
                  {job.status === 'completed' && job.file_url && (
                    <a href={`${API}${job.file_url}`} target="_blank" rel="noreferrer"
                      className="inline-flex items-center space-x-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                      <Download className="w-3 h-3" /><span>Download {job.file_type}</span>
                    </a>
                  )}
                  {job.status === 'failed' && job.error_log && (
                    <div className="flex items-start space-x-1 text-xs text-red-400/80 mt-1">
                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                      <span className="line-clamp-2">{job.error_log}</span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
