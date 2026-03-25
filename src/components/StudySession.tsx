// src/components/StudySession.tsx

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Deck, Phrase } from '../types';
import { Button } from './Button';
import { 
  ArrowLeft, Settings2, RefreshCw, Eye, ArrowRight, Clock, AlertCircle, 
  Edit2, BarChart2, ListOrdered, X, CheckCircle2, Trophy, 
  StickyNote, XCircle, Waves 
} from 'lucide-react';
import { 
  calculateNextState, calculateBack, calculateWatchBack, 
  mapSliderToBack, mapBackToSlider, getNScore, calculateMastery,
  getProficiencyLabel, getDynamicColor, getScoreBadgeColor, getPhraseLabel
} from '../utils/algo';

interface StudySessionProps {
  deck: Deck;
  onUpdateDeck: (updatedDeck: Deck) => void;
  onExit: () => void;
  onTimeUpdate: (seconds: number) => void;
  onSessionComplete?: (durationSeconds: number, counts: { count0_1: number; count2_3: number; count4_5: number }, cultivationGain: number) => void;
}

const ALGO_TIERS = [
  { name: '一档 (保守)', C: 3, base: 1.5 },
  { name: '二档 (稳健)', C: 3.5, base: 1.75 },
  { name: '三档 (标准)', C: 4, base: 2 },
  { name: '四档 (进阶)', C: 5, base: 2.5 },
  { name: '五档 (激进)', C: 6, base: 3 },
];

const ALGO_SETTINGS_KEY = 'recallflow_v2_algo_settings';

const formatHeaderTime = (seconds: number) => { 
  const m = Math.floor(seconds / 60); 
  const s = seconds % 60; 
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`; 
};

const formatFullTime = (seconds: number) => { 
  if (seconds <= 0) return '0s'; 
  const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = seconds % 60; 
  if (h > 0) return `${h}h${m}m${s}s`; if (m > 0) return `${m}m${s}s`; return `${s}s`; 
};

const renderFormattedText = (text?: string) => {
  if (!text) return null;
  const parts = text.split(/\[(.*?)\]/g);
  return (
    <span className="overflow-wrap-anywhere break-words">
      {parts.map((part, i) => i % 2 === 1 ? <span key={i} className="text-orange-700 font-bold border-b-2 border-orange-400">{part}</span> : <span key={i}>{part.replace(/\\n/g, '\n')}</span>)}
    </span>
  );
};

export const StudySession: React.FC<StudySessionProps> = ({ deck, onUpdateDeck, onExit, onTimeUpdate, onSessionComplete }) => {
  const [activeId, setActiveId] = useState<string | null>(deck.queue.length > 0 ? deck.queue[0] : null);
  const [phase, setPhase] = useState<'QUESTION' | 'ANSWER' | 'FEEDBACK' | 'REPORT'>('QUESTION');
  const [isFinished, setIsFinished] = useState(false);
  const [algoSettings, setAlgoSettings] = useState(() => {
    try { const saved = localStorage.getItem(ALGO_SETTINGS_KEY); return saved ? JSON.parse(saved) : { tierIdx: 2, cap: 100, timeLimit: 10, allowFreeze: true }; } 
    catch { return { tierIdx: 2, cap: 100, timeLimit: 10, allowFreeze: true }; }
  });

  const [showAlgoMenu, setShowAlgoMenu] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ english: '', chinese: '', note: '' });
  const [isAntiTouchActive, setIsAntiTouchActive] = useState(false); 
  const [sessionDuration, setSessionDuration] = useState(0);
  const [timeLeft, setTimeLeft] = useState<number>(algoSettings.timeLimit);
  const [isTimeout, setIsTimeout] = useState(false);

  const [prof, setProf] = useState<number | null>(null);
  const [diff, setDiff] = useState<number>(2.5);
  const [customBack, setCustomBack] = useState<number | null>(null);
  const [computedBack, setComputedBack] = useState<number>(1);
  const [computedScore, setComputedScore] = useState<number>(0);

  const [feedbackData, setFeedbackData] = useState<{
    isWatch: boolean; oldScore: number | undefined; newScore: number; 
    finalBack: number; isFrozen: boolean; coolingSteps: number; prof: number | 'watch'
  } | null>(null);

  const [stats, setStats] = useState({ count0_1: 0, count2_3: 0, count4_5: 0 });
  const [cultivationGain, setCultivationGain] = useState<number>(0);
  const [sessionResults, setSessionResults] = useState<{phrase: Phrase, prof: number | 'watch'}[]>([]);
  const [startMastery] = useState(() => deck.phrases.length === 0 ? 0 : deck.phrases.reduce((acc, p) => acc + (p.mastery || 0), 0) / deck.phrases.length);
  const [masteryTrend, setMasteryTrend] = useState<{ t: number; v: number }[]>([{ t: 0, v: startMastery }]);

  const currentPhrase = useMemo(() => deck.phrases.find(p => p.id === activeId), [activeId, deck.phrases]);
  const timerRef = useRef<number | null>(null);
  const questionTimerRef = useRef<number | null>(null);

  useEffect(() => { localStorage.setItem(ALGO_SETTINGS_KEY, JSON.stringify(algoSettings)); }, [algoSettings]);
  useEffect(() => {
    if (isFinished || phase === 'REPORT') return;
    timerRef.current = window.setInterval(() => { onTimeUpdate(1); setSessionDuration(prev => prev + 1); }, 1000);
    return () => clearInterval(timerRef.current!);
  }, [onTimeUpdate, isFinished, phase]);

  useEffect(() => {
    if (phase === 'QUESTION' && algoSettings.timeLimit > 0 && !isEditing && !isFinished) {
      setTimeLeft(algoSettings.timeLimit); setIsTimeout(false);
      questionTimerRef.current = window.setInterval(() => {
        setTimeLeft(prev => { if (prev <= 0.1) { clearInterval(questionTimerRef.current!); setIsTimeout(true); return 0; } return prev - 0.1; });
      }, 100);
    } else { if (questionTimerRef.current) clearInterval(questionTimerRef.current); }
    return () => clearInterval(questionTimerRef.current!);
  }, [phase, algoSettings.timeLimit, isEditing, isFinished, activeId]);

  const watchBackValue = useMemo(() => {
    if (!currentPhrase) return 1;
    const { C, base } = ALGO_TIERS[algoSettings.tierIdx];
    return calculateWatchBack(getNScore(currentPhrase.score ?? 0, diff), C, base);
  }, [currentPhrase, diff, algoSettings]);

  useEffect(() => {
    if (phase === 'ANSWER' && currentPhrase && prof !== null) {
      const today = Math.floor(Date.now() / 86400000);
      const { C, base } = ALGO_TIERS[algoSettings.tierIdx];
      const { newScore, nscore } = calculateNextState(currentPhrase.score, prof, diff, (today - (currentPhrase.date || today)) + 1, C, base, algoSettings.cap);
      setComputedScore(newScore); setComputedBack(calculateBack(nscore, C, base));
    }
  }, [phase, prof, diff, currentPhrase, algoSettings]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (isEditing || isFinished || isAntiTouchActive || e.ctrlKey || e.metaKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (phase === 'QUESTION' && (e.code === 'Space' || e.key === 'Enter')) { e.preventDefault(); handleShowAnswer(); }
      else if (phase === 'ANSWER') {
        if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); if (prof !== null) handleFinishCard(false); }
        else if (parseInt(e.key) >= 0 && parseInt(e.key) <= 5) { if (isTimeout && parseInt(e.key) >= 4) return; setProf(parseInt(e.key)); }
        else if (e.code === 'KeyW') handleFinishCard(true);
      } else if (phase === 'FEEDBACK' && (e.code === 'Space' || e.key === 'Enter' || e.key === '1')) handleNext();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [phase, isEditing, isFinished, prof, isTimeout, isAntiTouchActive]);

  const handleShowAnswer = () => { if (currentPhrase) { setDiff(currentPhrase.diff ?? 2.5); setPhase('ANSWER'); } };
  const handleManualExit = () => { if (onSessionComplete) onSessionComplete(sessionDuration, stats, cultivationGain); onExit(); };
  const handleRequestExit = () => { setIsFinished(true); setPhase('REPORT'); };

  const handleFinishCard = (isWatch: boolean) => {
    if (!currentPhrase || isAntiTouchActive) return;
    const { C, base } = ALGO_TIERS[algoSettings.tierIdx];
    let finalBack = isWatch ? (customBack ?? watchBackValue) : (customBack ?? computedBack);
    let newScore = isWatch ? (currentPhrase.score ?? 0) : computedScore;
    const queueLength = Math.max(0, deck.queue.length - 1);
    const isFrozen = algoSettings.allowFreeze && finalBack > queueLength;
    setFeedbackData({ isWatch, oldScore: currentPhrase.score, newScore, finalBack, isFrozen, coolingSteps: isFrozen ? finalBack - queueLength : 0, prof: isWatch ? 'watch' : prof! });
    setPhase('FEEDBACK');
  };

  const handleNext = () => {
    if (!currentPhrase || !feedbackData) return;
    setIsAntiTouchActive(true); setTimeout(() => setIsAntiTouchActive(false), 300);
    if (feedbackData.prof !== 'watch') {
      const p = feedbackData.prof as number;
      setStats(prev => ({ count0_1: prev.count0_1 + (p <= 1 ? 1 : 0), count2_3: prev.count2_3 + (p >= 2 && p <= 3 ? 1 : 0), count4_5: prev.count4_5 + (p >= 4 ? 1 : 0) }));
      setCultivationGain(prev => prev + [-1.0, -0.6, -0.2, 0.2, 0.6, 1.0][p]);
    }
    setSessionResults(prev => [...prev, { phrase: currentPhrase, prof: feedbackData.prof }]);
    const updatedPhrase: Phrase = { ...currentPhrase, score: feedbackData.newScore, diff, date: Math.floor(Date.now() / 86400000), back: feedbackData.finalBack, totalReviews: currentPhrase.totalReviews + 1, mastery: calculateMastery(getNScore(feedbackData.newScore, diff)), lastReviewedAt: Date.now() };
    let nextCoolingPool = [...(deck.coolingPool || [])].map(c => ({ ...c, wait: c.wait - 1 }));
    const ready = nextCoolingPool.filter(c => c.wait <= 0); nextCoolingPool = nextCoolingPool.filter(c => c.wait > 0);
    let nextQueue = deck.queue.filter(id => id !== activeId); nextQueue.push(...ready.map(c => c.id));
    if (feedbackData.isFrozen) nextCoolingPool.push({ id: activeId!, wait: feedbackData.coolingSteps });
    else nextQueue.splice(Math.min(feedbackData.finalBack, nextQueue.length), 0, activeId!);
    if (nextQueue.length === 0 && nextCoolingPool.length > 0) {
      const minW = Math.min(...nextCoolingPool.map(c => c.wait));
      nextCoolingPool = nextCoolingPool.map(c => ({ ...c, wait: c.wait - minW }));
      const awakened = nextCoolingPool.filter(c => c.wait <= 0); nextCoolingPool = nextCoolingPool.filter(c => c.wait > 0);
      nextQueue.push(...awakened.map(c => c.id));
    }
    const upPhrases = deck.phrases.map(p => p.id === activeId ? updatedPhrase : p);
    setMasteryTrend(prev => [...prev, { t: sessionDuration, v: upPhrases.reduce((acc, p) => acc + (p.mastery || 0), 0) / upPhrases.length }]);
    onUpdateDeck({ ...deck, queue: nextQueue, coolingPool: nextCoolingPool, phrases: upPhrases });
    setPhase('QUESTION'); setProf(null); setCustomBack(null); setFeedbackData(null); setActiveId(nextQueue[0] || null);
  };

  const renderTrendChart = (data: {t: number, v: number}[], height = 100) => {
    if (data.length < 2) return null;
    const width = 240; const padding = { top: 10, right: 10, bottom: 20, left: 30 };
    const chartW = width - padding.left - padding.right; const chartH = height - padding.top - padding.bottom;
    const maxT = Math.max(...data.map(d => d.t), 1); const minT = data[0].t;
    const pts = data.map(d => `${padding.left + ((d.t - minT) / (maxT - minT || 1)) * chartW},${padding.top + chartH - (d.v / 100) * chartH}`).join(' ');
    return <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="bg-slate-50/50 rounded border"><polyline points={pts} fill="none" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" /></svg>;
  };

  if (phase === 'REPORT') return (
    <div className="fixed inset-0 bg-slate-50 z-50 flex flex-col items-center justify-center p-4 overflow-y-auto custom-scrollbar">
      <div className="max-w-2xl w-full bg-white rounded-3xl shadow-2xl p-8 flex flex-col space-y-6 my-8 animate-in zoom-in-95">
        <div className="text-center"><Trophy className="w-16 h-16 text-emerald-600 mx-auto mb-4" /><h2 className="text-3xl font-black">学习报告</h2><p className="text-slate-400 font-bold text-sm uppercase">{deck.name}</p></div>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-slate-50 p-6 rounded-2xl border text-center"><div className="text-xs text-slate-400 font-black uppercase">本次复习</div><div className="text-3xl font-black">{stats.count0_1 + stats.count2_3 + stats.count4_5} 词</div><div className="text-xs font-bold mt-2"><span className="text-emerald-500">{stats.count4_5} 优</span> | <span className="text-amber-500">{stats.count2_3} 中</span> | <span className="text-rose-500">{stats.count0_1} 差</span></div></div>
          <div className="bg-slate-50 p-6 rounded-2xl border text-center flex flex-col justify-center"><div className="text-xs text-slate-400 font-black uppercase">本次修为</div><div className={`text-3xl font-black ${cultivationGain >= 0 ? 'text-indigo-600' : 'text-rose-500'}`}>{cultivationGain > 0 ? '+' : ''}{cultivationGain.toFixed(1)}</div></div>
        </div>
        <div className="bg-indigo-50/50 p-6 rounded-2xl border border-indigo-100"><div className="flex justify-between items-start mb-4"><span className="text-xs font-black text-indigo-900 uppercase">掌握度变化 Mastery Gain</span><span className="text-xl font-black text-emerald-600">{(masteryTrend[masteryTrend.length-1].v - startMastery).toFixed(2)}%</span></div>{renderTrendChart(masteryTrend, 120)}</div>
        {sessionResults.length > 0 && <div className="border-t pt-6"><h3 className="text-sm font-black mb-4 flex items-center gap-2"><ListOrdered className="w-4 h-4"/> 复盘细节</h3><div className="max-h-64 overflow-y-auto space-y-2 custom-scrollbar">{sessionResults.sort((a,b) => (a.prof === 'watch' ? 2.5 : a.prof) - (b.prof === 'watch' ? 2.5 : b.prof)).map((res, i) => <div key={i} className="flex justify-between items-center p-4 bg-slate-50 rounded-xl border"><div><div className="font-bold text-slate-700">{res.phrase.chinese}</div><div className="text-sm text-slate-500">{res.phrase.english}</div></div><div className={`px-3 py-1.5 rounded-lg text-sm font-black ${res.prof === 'watch' ? 'bg-slate-200' : res.prof >= 4 ? 'bg-emerald-100 text-emerald-700' : res.prof >= 2 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{res.prof === 'watch' ? '观望' : `${res.prof} 分`}</div></div>)}</div></div>}
        <Button fullWidth onClick={handleManualExit} className="py-4 text-lg font-black rounded-2xl shadow-xl">确认并返回主页</Button>
      </div>
    </div>
  );

  if (!currentPhrase) return (
    <div className="fixed inset-0 bg-slate-50 z-[100] flex flex-col items-center justify-center p-4 animate-in fade-in">
      <div className="bg-white p-8 rounded-3xl shadow-xl text-center max-w-sm w-full">
        {deck.coolingPool?.length ? <><Waves className="w-16 h-16 text-sky-500 mx-auto mb-4" /><h2 className="text-2xl font-black mb-2">发现冻结词条</h2><p className="text-sm text-slate-500 mb-6">主队列已空，还有 <span className="text-sky-500 font-black">{deck.coolingPool.length}</span> 个正在冷却。</p><Button fullWidth onClick={() => { const ids = deck.coolingPool!.map(c => c.id); onUpdateDeck({ ...deck, queue: ids, coolingPool: [] }); setActiveId(ids[0]); }} className="py-4 bg-sky-500">立即唤醒</Button></> : <><XCircle className="w-16 h-16 text-rose-500 mx-auto mb-4" /><h2 className="text-2xl font-black mb-2">学习结束</h2><Button onClick={handleManualExit} className="mt-4 px-8 py-3">返回主页</Button></>}
      </div>
    </div>
  );

  if (phase === 'FEEDBACK' && feedbackData) return (
    <div className="fixed inset-0 bg-slate-50 z-[100] flex flex-col h-full"><div className="bg-white shadow-sm flex items-center justify-between px-3 h-14"><button onClick={handleRequestExit} className="p-2 text-slate-400"><ArrowLeft /></button><div className="text-[10px] text-slate-400 font-bold">状态反馈 · {deck.name}</div><div className="w-10" /></div><div className="flex-1 flex flex-col items-center justify-center p-4"><div className="w-full max-w-xl bg-white rounded-3xl shadow-xl border p-8 text-center animate-in zoom-in-95"><h2 className="text-3xl font-black mb-3">{currentPhrase.chinese}</h2><p className="text-lg font-bold text-indigo-600 mb-10">{currentPhrase.english}</p><div className="py-8 border-t border-b my-6">{feedbackData.isFrozen ? <div className="text-2xl font-black text-sky-500 flex items-center justify-center gap-3 mb-4"><Waves /> 冻结冷却 {feedbackData.coolingSteps} 步</div> : <div className="text-2xl font-black text-indigo-500 flex items-center justify-center gap-3 mb-4"><ArrowRight /> 后推 {feedbackData.finalBack} 步</div>}<div className="flex items-center justify-center gap-3 text-slate-500 font-bold"><CheckCircle2 className="w-5 text-emerald-500" /><span>{getPhraseLabel(feedbackData.oldScore)}</span><ArrowRight className="w-4 text-slate-300" /><span className="text-slate-800 font-black">{getPhraseLabel(feedbackData.newScore)}</span></div></div><Button onClick={handleNext} fullWidth className="py-4 text-lg font-black bg-indigo-600">复习下一个 (Space/Enter)</Button></div></div></div>
  );

  return (
    <div className="fixed inset-0 bg-slate-50 z-[100] flex flex-col h-full overflow-hidden">
      <div className="bg-white shadow-sm flex items-center justify-between px-3 h-14"><button onClick={handleRequestExit} className="p-2 text-slate-400"><ArrowLeft /></button><div className="flex-1 flex flex-col items-center justify-center"><div className="flex justify-between w-full max-w-[200px] mb-1"><span className="text-[10px] text-slate-400 truncate">{deck.name}</span><span className="text-[10px] font-mono text-slate-400">{formatHeaderTime(sessionDuration)}</span></div><div className="h-1.5 w-full max-w-[200px] bg-slate-100 rounded-full overflow-hidden"><div className="h-full transition-all duration-700" style={{ width: `${liveMasteryValue}%`, backgroundColor: getDynamicColor(liveMasteryValue) }} /></div></div><div className="flex gap-1 items-center"><div className="relative"><button onClick={() => setShowAlgoMenu(!showAlgoMenu)} className="p-2 text-slate-300"><Settings2 className="w-5" /></button>{showAlgoMenu && <div className="absolute top-full right-0 mt-2 w-72 bg-white rounded-2xl shadow-2xl border p-4 z-50 animate-in fade-in"><div className="p-3 border-b flex items-center justify-between"><span className="text-[10px] font-black uppercase">Settings</span><button onClick={()=>setShowAlgoMenu(false)}><X className="w-3 text-slate-400"/></button></div><div className="p-4 max-h-[60vh] overflow-y-auto"><label className="text-xs font-bold block mb-2">学习节奏</label><div className="space-y-1 mb-4">{ALGO_TIERS.map((t, idx) => <button key={idx} onClick={() => setAlgoSettings({ ...algoSettings, tierIdx: idx })} className={`w-full text-left px-3 py-2 text-xs font-bold rounded-lg ${algoSettings.tierIdx === idx ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50 text-slate-600'}`}>{t.name} <span className="opacity-50 text-[9px]">C:{t.C}, b:{t.base}</span></button>)}</div><div className="mb-4 bg-slate-50 p-3 rounded-xl border"><label className="flex items-center justify-between cursor-pointer"><div><div className="text-xs font-bold text-slate-700">允许冻结 {algoSettings.allowFreeze && <CheckCircle2 className="inline w-3 text-emerald-500"/>}</div><div className="text-[9px] text-slate-400">后推超出队列时冻结</div></div><div className={`w-10 h-5 rounded-full relative shadow-inner ${algoSettings.allowFreeze ? 'bg-emerald-500' : 'bg-slate-300'}`}><div className={`absolute top-1 w-3 h-3 rounded-full bg-white shadow transition-transform ${algoSettings.allowFreeze ? 'left-6' : 'left-1'}`} /></div><input type="checkbox" checked={algoSettings.allowFreeze} onChange={e => setAlgoSettings({...algoSettings, allowFreeze: e.target.checked})} className="hidden" /></label></div><label className="text-xs font-bold block mb-2">Cap</label><input type="number" min="10" value={algoSettings.cap} onChange={(e) => setAlgoSettings({ ...algoSettings, cap: Math.max(10, parseInt(e.target.value) || 100) })} className="w-full p-2 border rounded-lg text-sm font-black mb-4" /><label className="text-xs font-bold block mb-2">限时 (s)</label><input type="number" min="0" value={algoSettings.timeLimit} onChange={(e) => setAlgoSettings({ ...algoSettings, timeLimit: Math.max(0, parseInt(e.target.value) || 0) })} className="w-full p-2 border rounded-lg text-sm font-black" /></div></div>}</div><button onClick={()=>setShowStats(!showStats)} className="p-2 text-slate-300"><BarChart2 className="w-5" /></button><button onClick={()=>setShowQueue(!showQueue)} className="p-2 text-slate-300"><ListOrdered className="w-5" /></button></div></div>
      <div className="flex-1 flex relative overflow-hidden"><div className={`flex-1 flex flex-col items-center p-4 transition-all duration-300 ${showQueue ? 'lg:pr-[320px]' : ''} ${showStats ? 'lg:pl-[320px]' : ''}`}><div className="w-full max-w-2xl bg-white rounded-3xl shadow-xl border flex flex-col h-full max-h-[600px] overflow-hidden relative">{phase !== 'QUESTION' && <div className="absolute top-3 right-3 z-10"><button onClick={() => setIsEditing(true)} className="p-2 text-slate-300 hover:text-indigo-500"><Edit2 className="w-4"/></button></div>}{isEditing ? <div className="flex-1 p-6 overflow-y-auto animate-in fade-in"><h3 className="font-black mb-6 flex items-center gap-2"><Edit2 className="w-4"/> 编辑卡片</h3><div className="space-y-4"><div><label className="text-xs font-black uppercase mb-1 block">Chinese</label><textarea className="w-full p-4 bg-slate-50 border rounded-xl font-bold outline-none focus:ring-2" rows={2} value={editForm.chinese} onChange={e=>setEditForm({...editForm, chinese: e.target.value})}/></div><div><label className="text-xs font-black uppercase mb-1 block">English</label><textarea className="w-full p-4 bg-slate-50 border rounded-xl font-bold outline-none focus:ring-2" rows={2} value={editForm.english} onChange={e=>setEditForm({...editForm, english: e.target.value})}/></div><div><label className="text-xs font-black uppercase mb-1 block">Note</label><textarea className="w-full p-4 bg-slate-50 border rounded-xl text-sm outline-none focus:ring-2" rows={4} value={editForm.note} onChange={e=>setEditForm({...editForm, note: e.target.value})}/></div><div className="flex gap-3 pt-4"><Button variant="ghost" fullWidth onClick={() => setIsEditing(false)}>取消</Button><Button fullWidth onClick={handleSaveEdit}>保存</Button></div></div></div> : <div className="flex-1 overflow-y-auto custom-scrollbar p-6 flex flex-col items-center w-full relative"><div className="w-full text-center pt-4 mb-6"><span className="text-[10px] font-black text-slate-300 uppercase border px-2 py-0.5 rounded-full mb-4 inline-block">{isNew ? 'NEW' : `Score: ${currentPhrase.score?.toFixed(2)}`}</span><h1 className="text-3xl font-black leading-snug">{renderFormattedText(questionText)}</h1>{phase === 'QUESTION' && algoSettings.timeLimit > 0 && <div className="mt-8 flex flex-col items-center animate-in fade-in"><div className={`text-sm font-black tabular-nums mb-2 ${isTimeout ? 'text-rose-500' : 'text-indigo-400'}`}>{isTimeout ? '超时' : `${timeLeft.toFixed(1)}s`}</div><div className="w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className={`h-full transition-all duration-100 ease-linear ${isTimeout ? 'bg-rose-500' : 'bg-indigo-400'}`} style={{ width: `${isTimeout ? 100 : (timeLeft / algoSettings.timeLimit) * 100}%` }} /></div></div>}</div>{phase === 'ANSWER' && <div className="w-full flex flex-col animate-in fade-in slide-in-from-bottom-4 pb-2 mt-auto"><div className="text-center py-2 px-4 rounded-xl w-full mb-4"><p className="text-3xl font-black text-indigo-600">{renderFormattedText(answerText)}</p></div>{currentPhrase.note && <div className="w-full bg-amber-50 p-4 rounded-xl border border-amber-100 text-left relative mb-8"><StickyNote className="absolute top-4 left-4 w-4 text-amber-400" /><div className="pl-8 text-sm font-medium text-slate-700 whitespace-pre-wrap">{renderFormattedText(currentPhrase.note)}</div></div>}<div className="w-full mt-auto space-y-5"><div className="bg-slate-50 p-4 rounded-xl border"><div className="flex justify-between items-center mb-3"><span className="text-[10px] font-black uppercase">记忆难度</span><span className="font-black text-indigo-600 text-sm">{diff}</span></div><div className="flex gap-1.5">{[0, 1, 2, 3, 4, 5].map(v => <button key={v} onClick={() => setDiff(v)} className={`flex-1 py-2 rounded font-black text-sm border-2 ${diff === v ? 'bg-indigo-500 border-indigo-500 text-white shadow-md' : 'bg-white border-slate-200 text-slate-400'}`}>{v}</button>)}</div></div><div><span className="text-[10px] font-black uppercase block mb-2">熟练度</span><div className="grid grid-cols-6 gap-1">{[0, 1, 2, 3, 4, 5].map(v => <button key={v} disabled={isTimeout && v >= 4} onClick={() => setProf(v)} className={`flex flex-col items-center py-2 rounded-xl border-2 transition-all ${isTimeout && v >= 4 ? 'opacity-30' : prof === v ? 'bg-emerald-50 border-emerald-500' : 'bg-white border-slate-100 hover:border-emerald-300'}`}><span className={`text-base font-black ${prof === v ? 'text-emerald-600' : 'text-slate-400'}`}>{v}</span><span className="text-[8px] font-bold truncate w-full text-center px-1">{currentLabels[v]}</span></button>)}</div></div><div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 shadow-sm"><div className="flex justify-between items-center mb-4"><div className="flex flex-col"><span className="text-xs font-black uppercase">后推 (Back)</span><div className="text-[10px] font-bold text-slate-500 mt-1">Score: {currentPhrase.score?.toFixed(2) ?? '0.00'} <ArrowRight className="inline w-2 text-slate-300"/> <span className={`font-black ${prof !== null && computedScore >= (currentPhrase.score ?? 0) ? 'text-emerald-600' : 'text-rose-500'}`}>{prof !== null ? computedScore.toFixed(2) : (currentPhrase.score?.toFixed(2) ?? '0.00')}</span></div></div><div className="flex items-center gap-2"><input type="number" min="1" value={customBack ?? (prof !== null ? computedBack : watchBackValue)} onChange={e => setCustomBack(Math.max(1, parseInt(e.target.value) || 1))} className="w-16 bg-white border border-indigo-200 rounded-lg p-1.5 text-center font-black text-sm focus:ring-2" />{customBack !== null && <button onClick={() => setCustomBack(null)} className="p-1.5 bg-white rounded shadow-sm border"><RefreshCw className="w-3 text-indigo-600"/></button>}</div></div><input type="range" min="0" max="1000" step="1" value={mapBackToSlider(customBack ?? (prof !== null ? computedBack : watchBackValue))} onChange={e => setCustomBack(mapSliderToBack(parseInt(e.target.value)))} className="w-full h-1.5 bg-indigo-200 rounded appearance-none accent-indigo-600" /></div></div></div>}</div>}</div><div className="p-4 bg-white border-t shrink-0">{phase === 'QUESTION' ? <Button fullWidth onClick={handleShowAnswer} className="py-4 text-lg font-black shadow-lg">查看答案 (Space)</Button> : <div className="flex gap-3"><button onClick={() => handleFinishCard(true)} className="flex-1 py-4 bg-slate-100 text-slate-600 rounded-xl font-black flex items-center justify-center gap-2 border"><Eye className="w-4"/> 观望 (W)</button><Button disabled={prof === null || isAntiTouchActive} fullWidth onClick={() => handleFinishCard(false)} className={`flex-[2] py-4 text-lg font-black shadow-lg ${prof === null ? 'bg-slate-200' : 'bg-indigo-600'}`}>确认继续 (Enter) <ArrowRight className="ml-2 w-5" /></Button></div>}</div></div></div><div className={`absolute top-0 right-0 h-full w-[320px] bg-white border-l shadow-2xl transition-transform duration-300 z-[70] flex flex-col ${showQueue ? 'translate-x-0' : 'translate-x-full'}`}><div className="p-4 flex justify-between items-center bg-slate-50 border-b"><h3 className="font-black text-sm">实时队列</h3><button onClick={()=>setShowQueue(false)}><X className="w-4 text-slate-500"/></button></div><div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1.5">{deck.queue.map((id, idx) => { const p = deck.phrases.find(it => it.id === id); if (!p) return null; return <div key={id} className={`flex justify-between py-2 px-3 rounded-lg border ${id === activeId ? 'bg-indigo-50 border-indigo-200 shadow-sm' : 'bg-white border-transparent'}`}><div className="flex gap-3 truncate flex-1"><span className="text-[10px] text-slate-300 font-black w-4">{idx+1}</span><div className="truncate font-bold text-xs">{p.chinese}</div></div><div className="px-1.5 py-0.5 rounded text-[9px] font-black text-white" style={{backgroundColor: getScoreBadgeColor(p.score)}}>{getPhraseTag(p.score)}</div></div> })}</div></div><div className={`absolute top-0 left-0 h-full w-[320px] bg-white border-r shadow-2xl transition-transform duration-300 z-[70] flex flex-col ${showStats ? 'translate-x-0' : '-translate-x-full'}`}><div className="p-5 flex justify-between bg-slate-50 border-b"><h3 className="font-black text-sm">状态大盘</h3><button onClick={()=>setShowStats(false)}><X className="w-4 text-slate-500"/></button></div><div className="flex-1 overflow-y-auto p-6 space-y-6"><div><h4 className="text-[10px] font-black text-slate-400 uppercase mb-3">Mastery Trend</h4>{renderTrendChart(masteryTrend, 140)}</div><div className="border-t pt-6"><h4 className="text-[10px] font-black text-slate-400 uppercase mb-3">复习比例</h4><div className="grid grid-cols-2 gap-3"><div className="bg-emerald-50 p-3 rounded-xl border text-emerald-700"><div className="text-[10px] opacity-80 uppercase">优</div><div className="text-xl font-black">{stats.count4_5}</div></div><div className="bg-amber-50 p-3 rounded-xl border text-amber-700"><div className="text-[10px] opacity-80 uppercase">中</div><div className="text-xl font-black">{stats.count2_3}</div></div><div className="bg-rose-50 p-3 rounded-xl border text-rose-700 col-span-2 flex justify-between items-center"><div><div className="text-[10px] opacity-80 uppercase">差</div><div className="text-xl font-black">{stats.count0_1}</div></div><XCircle className="w-8 h-8 opacity-20" /></div></div></div></div></div></div>
    </div>
  );
};
