// src/components/StudySession.tsx

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Deck, Phrase } from '../types';
import { Button } from './Button';
import { 
  ArrowLeft, Settings2, RefreshCw, Eye, ArrowRight, Clock, AlertCircle, 
  Edit2, BarChart2, ListOrdered, X, CheckCircle2, Trophy, StickyNote, 
  XCircle, ThermometerSnowflake, Waves, Hash, TrendingUp
} from 'lucide-react';
import { 
  calculateNextState, calculateBack, calculateWatchBack, 
  mapSliderToBack, mapBackToSlider, getNScore, EPS, calculateMastery,
  getDynamicColor, getScoreBadgeColor, getPhraseLabel
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

// === 外部格式化工具 ===
const formatHeaderTime = (seconds: number) => { 
  if (Number.isNaN(seconds)) return '00:00';
  const m = Math.floor(seconds / 60); const s = seconds % 60; 
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`; 
};

const formatFullTime = (seconds: number) => { 
  if (Number.isNaN(seconds) || seconds <= 0) return '0s'; 
  const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = seconds % 60; 
  return h > 0 ? `${h}h${m}m${s}s` : (m > 0 ? `${m}m${s}s` : `${s}s`); 
};

const cleanNote = (text?: string) => text ? text.replace(/\n\s*\n/g, '\n').trim() : "";

const renderFormattedText = (text?: string) => {
  if (!text) return null;
  const parts = text.split(/\[(.*?)\]/g);
  return (
    <span className="overflow-wrap-anywhere break-words hyphens-none">
      {parts.map((part, i) => i % 2 === 1 ? (
        <span key={i} className="text-orange-700 font-bold mx-0.5 border-b-2 border-orange-400">{part}</span>
      ) : (
        <span key={i}>{part.replace(/\\n/g, '\n')}</span>
      ))}
    </span>
  );
};

export const StudySession: React.FC<StudySessionProps> = ({ deck, onUpdateDeck, onExit, onTimeUpdate, onSessionComplete }) => {
  // === 1. 核心 Hook 状态 ===
  const [activeId, setActiveId] = useState<string | null>(deck.queue.length > 0 ? deck.queue[0] : null);
  const [phase, setPhase] = useState<'QUESTION' | 'ANSWER' | 'REPORT'>('QUESTION');
  const [isFinished, setIsFinished] = useState(false);
  
  const [algoSettings, setAlgoSettings] = useState(() => {
    try {
      const saved = localStorage.getItem(ALGO_SETTINGS_KEY);
      return saved ? JSON.parse(saved) : { tierIdx: 2, cap: 100, timeLimit: 10, allowFreeze: true };
    } catch {
      return { tierIdx: 2, cap: 100, timeLimit: 10, allowFreeze: true };
    }
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

  const [stats, setStats] = useState({ count0_1: 0, count2_3: 0, count4_5: 0 });
  const [cultivationGain, setCultivationGain] = useState<number>(0);
  const [sessionResults, setSessionResults] = useState<{phrase: Phrase, prof: number | 'watch', nscore: number}[]>([]);
  
  const [startMastery] = useState(() => deck.phrases.length === 0 ? 0 : deck.phrases.reduce((acc, p) => acc + (p.mastery || 0), 0) / deck.phrases.length);
  const [masteryTrend, setMasteryTrend] = useState<{ t: number; v: number }[]>([{ t: 0, v: startMastery }]);

  const timerRef = useRef<number | null>(null);
  const questionTimerRef = useRef<number | null>(null);

  // === 2. 派生计算 (必须放在辅助渲染函数之前) ===
  const currentPhrase = useMemo(() => deck.phrases.find(p => p.id === activeId), [activeId, deck.phrases]);
  const activeScore = useMemo(() => {
    if (!currentPhrase || currentPhrase.score === undefined) return undefined;
    const s = Number(currentPhrase.score);
    return Number.isNaN(s) ? undefined : s;
  }, [currentPhrase]);

  const liveMasteryValue = masteryTrend.length > 0 ? masteryTrend[masteryTrend.length - 1].v : startMastery;
  const isNew = activeScore === undefined || activeScore === 0;
  
  const currentBackDisplay = customBack ?? (prof !== null ? computedBack : 1); 
  const isNowFrozen = algoSettings.allowFreeze && currentBackDisplay > (deck.queue.length - 1);
  
  const currentLabels = isNew 
    ? ["完全没思路", "思路大体对", "缺东西", "差一点", "正确但不确定", "正确"]
    : ["完全没印象", "印象不清楚", "缺东西", "差一点", "勉强想出", "快速想出"];

  // === 3. 逻辑逻辑逻辑 ===
  useEffect(() => { localStorage.setItem(ALGO_SETTINGS_KEY, JSON.stringify(algoSettings)); }, [algoSettings]);

  useEffect(() => {
    if (isFinished || phase === 'REPORT') return;
    timerRef.current = window.setInterval(() => {
      onTimeUpdate(1);
      setSessionDuration(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timerRef.current!);
  }, [onTimeUpdate, isFinished, phase]);

  useEffect(() => {
    if (phase === 'QUESTION' && algoSettings.timeLimit > 0 && !isEditing && !isFinished) {
      setTimeLeft(algoSettings.timeLimit);
      setIsTimeout(false);
      questionTimerRef.current = window.setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 0.1) {
            clearInterval(questionTimerRef.current!);
            setIsTimeout(true);
            return 0;
          }
          return prev - 0.1;
        });
      }, 100);
    } else {
      if (questionTimerRef.current) clearInterval(questionTimerRef.current);
    }
    return () => { if (questionTimerRef.current) clearInterval(questionTimerRef.current); };
  }, [phase, algoSettings.timeLimit, isEditing, isFinished, activeId]);

  useEffect(() => {
    if (isEditing && currentPhrase) {
      setEditForm({
        english: currentPhrase.english,
        chinese: currentPhrase.chinese,
        note: (currentPhrase.note || '').replace(/\\n/g, '\n')
      });
    }
  }, [isEditing, currentPhrase]);

  const watchBackValue = useMemo(() => {
    if (!currentPhrase) return 1;
    const { C, base } = ALGO_TIERS[algoSettings.tierIdx];
    return calculateWatchBack(getNScore(activeScore ?? 0, diff), C, base);
  }, [currentPhrase, diff, algoSettings, activeScore]);

  useEffect(() => {
    if (phase === 'ANSWER' && currentPhrase && prof !== null) {
      const todayDays = Math.floor(Date.now() / 86400000);
      const { C, base } = ALGO_TIERS[algoSettings.tierIdx];
      const gap = (todayDays - (currentPhrase.date || todayDays)) + 1;
      const { newScore, nscore } = calculateNextState(activeScore, prof, diff, gap, C, base, algoSettings.cap);
      setComputedScore(Number.isNaN(newScore) ? 0 : newScore);
      setComputedBack(Number.isNaN(nscore) ? 1 : calculateBack(nscore, C, base));
    }
  }, [phase, prof, diff, currentPhrase, algoSettings, activeScore]);

  const handleShowAnswer = useCallback(() => {
    if (questionTimerRef.current) clearInterval(questionTimerRef.current);
    if (currentPhrase) setDiff(currentPhrase.diff ?? 2.5);
    setPhase('ANSWER');
  }, [currentPhrase]);

  const handleSaveEdit = useCallback(() => {
    if (!currentPhrase) return;
    const updatedPhrases = deck.phrases.map(p => p.id === currentPhrase.id ? { ...p, ...editForm } : p);
    onUpdateDeck({ ...deck, phrases: updatedPhrases });
    setIsEditing(false);
  }, [currentPhrase, editForm, deck, onUpdateDeck]);

  const handleFinishCard = useCallback((isWatch: boolean) => {
    if (!currentPhrase || isAntiTouchActive) return;
    setIsAntiTouchActive(true); setTimeout(() => setIsAntiTouchActive(false), 300);

    const todayDays = Math.floor(Date.now() / 86400000);
    const gap = (todayDays - (currentPhrase.date || todayDays)) + 1;
    const { C, base } = ALGO_TIERS[algoSettings.tierIdx];

    let finalBack = isWatch ? (customBack ?? watchBackValue) : (customBack ?? computedBack);
    let newScore = isWatch ? activeScore : computedScore;
    let finalNScore = isWatch ? getNScore(activeScore ?? 0, diff) : calculateNextState(activeScore, prof!, diff, gap, C, base, algoSettings.cap).nscore;

    if (!isWatch && prof !== null) {
      const pVal = prof as number;
      setStats(prev => ({ 
        count0_1: prev.count0_1 + (pVal <= 1 ? 1 : 0), 
        count2_3: prev.count2_3 + (pVal >= 2 && pVal <= 3 ? 1 : 0), 
        count4_5: prev.count4_5 + (pVal >= 4 ? 1 : 0) 
      }));
      const gainMap = [-1.0, -0.6, -0.2, 0.2, 0.6, 1.0];
      setCultivationGain(prev => prev + gainMap[pVal]);
      setSessionResults(prev => [...prev, { phrase: currentPhrase, prof: pVal, nscore: finalNScore }]);
    } else if (isWatch) {
      setSessionResults(prev => [...prev, { phrase: currentPhrase, prof: 'watch', nscore: finalNScore }]);
    }

    const updatedPhrase: Phrase = { 
      ...currentPhrase, score: newScore, diff, date: todayDays, back: finalBack, 
      totalReviews: currentPhrase.totalReviews + 1, 
      mastery: calculateMastery(getNScore(newScore ?? 0, diff)), 
      lastReviewedAt: Date.now() 
    };

    const updatedPhrases = deck.phrases.map(p => p.id === activeId ? updatedPhrase : p);
    let nextCoolingPool = [...(deck.coolingPool || [])];
    nextCoolingPool.forEach(c => c.wait -= 1);
    const ready = nextCoolingPool.filter(c => c.wait <= 0);
    nextCoolingPool = nextCoolingPool.filter(c => c.wait > 0);
    let nextQueue = deck.queue.filter(id => id !== activeId);
    nextQueue.push(...ready.map(c => c.id));

    if (algoSettings.allowFreeze && finalBack > nextQueue.length) {
      nextCoolingPool.push({ id: activeId!, wait: finalBack - nextQueue.length });
    } else {
      nextQueue.splice(Math.min(finalBack, nextQueue.length), 0, activeId!);
    }

    if (nextQueue.length === 0 && nextCoolingPool.length > 0) {
      const minWait = Math.min(...nextCoolingPool.map(c => c.wait));
      nextCoolingPool.forEach(c => c.wait -= minWait);
      const awakened = nextCoolingPool.filter(c => c.wait <= 0);
      nextCoolingPool = nextCoolingPool.filter(c => c.wait > 0);
      nextQueue.push(...awakened.map(c => c.id));
    }

    setMasteryTrend(prev => [...prev, { t: sessionDuration, v: updatedPhrases.reduce((acc, p) => acc + (p.mastery || 0), 0) / updatedPhrases.length }]);
    onUpdateDeck({ ...deck, queue: nextQueue, coolingPool: nextCoolingPool, phrases: updatedPhrases });
    setPhase('QUESTION'); setIsTimeout(false); setTimeLeft(algoSettings.timeLimit); setProf(null); setCustomBack(null);
    setActiveId(nextQueue.length > 0 ? nextQueue[0] : null);
  }, [currentPhrase, isAntiTouchActive, algoSettings, diff, customBack, prof, deck, activeId, sessionDuration, onUpdateDeck, activeScore, watchBackValue, computedBack, computedScore]);

  const handleRequestExit = () => { setIsFinished(true); setPhase('REPORT'); };
  const handleFinalExit = () => { if (onSessionComplete) onSessionComplete(sessionDuration, stats, cultivationGain); onExit(); };

  // === 4. 渲染辅助函数 (使用刚刚计算好的派生变量) ===

  const renderTrendChart = (data = masteryTrend, height = 100) => {
    if (data.length < 2) return null;
    const width = 240; const padding = { top: 10, right: 10, bottom: 20, left: 30 };
    const chartWidth = width - padding.left - padding.right; const chartHeight = height - padding.top - padding.bottom;
    const maxTime = Math.max(...data.map(d => d.t), 1); const minTime = data[0].t;
    const points = data.map(d => {
      const x = padding.left + ((d.t - minTime) / (maxTime - minTime || 1)) * chartWidth;
      const y = padding.top + chartHeight - (d.v / 100) * chartHeight;
      return `${x},${y}`;
    }).join(' ');
    return (
      <div className="relative w-full h-full flex items-center justify-center">
        <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
          <line x1={padding.left} y1={padding.top} x2={width - padding.right} y2={padding.top} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3 3" />
          <line x1={padding.left} y1={padding.top + chartHeight / 2} x2={width - padding.right} y2={padding.top + chartHeight / 2} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3 3" />
          <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke="#cbd5e1" strokeWidth="1" />
          <text x={25} y={padding.top + 4} className="text-[9px] fill-slate-400 font-bold" textAnchor="end">100%</text>
          <text x={25} y={padding.top + chartHeight / 2 + 4} className="text-[9px] fill-slate-400 font-bold" textAnchor="end">50%</text>
          <text x={25} y={height - padding.bottom - 2} className="text-[9px] fill-slate-400 font-bold" textAnchor="end">0%</text>
          <text x={width - padding.right} y={height - 2} className="text-[8px] fill-slate-400 font-bold" textAnchor="end">Time (s) &rarr;</text>
          <polyline points={points} fill="none" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  };

  // ========== UI 渲染分发 ==========

  if (phase === 'REPORT') {
    const endMastery = masteryTrend.length > 0 ? masteryTrend[masteryTrend.length - 1].v : startMastery;
    const gain = endMastery - startMastery;
    const activeTier = ALGO_TIERS[algoSettings.tierIdx];

    return (
      <div className="fixed inset-0 bg-slate-50 z-[200] flex flex-col items-center p-3 sm:p-6 overflow-y-auto custom-scrollbar animate-in fade-in zoom-in-95 duration-300">
        <div className="max-w-2xl w-full bg-white rounded-3xl shadow-2xl p-5 sm:p-8 flex flex-col space-y-4 my-2 sm:my-auto border border-slate-100">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-emerald-100 rounded-full text-emerald-600"><Trophy size={20} /></div>
              <div><h2 className="text-lg font-black text-slate-800">学习结算</h2><span className="text-[10px] text-slate-400 font-bold tracking-widest uppercase">{deck.name}</span></div>
            </div>
            <span className="text-xs font-mono font-bold text-slate-400">{new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-slate-50 p-3 rounded-2xl text-center border border-slate-100">
              <span className="text-[9px] text-slate-400 font-black uppercase block mb-1">本次复习</span>
              <span className="text-xl font-black text-slate-800">{stats.count0_1 + stats.count2_3 + stats.count4_5} <span className="text-[9px] text-slate-400">词</span></span>
              <div className="text-[8px] font-bold mt-1 flex justify-center gap-1"><span className="text-emerald-500">{stats.count4_5}优</span><span className="text-amber-500">{stats.count2_3}中</span><span className="text-rose-500">{stats.count0_1}差</span></div>
            </div>
            <div className="bg-slate-50 p-3 rounded-2xl text-center flex flex-col justify-center border border-slate-100">
              <span className="text-[9px] text-slate-400 font-black uppercase mb-1">专注时长</span>
              <span className="text-xl font-black text-slate-800">{formatFullTime(sessionDuration)}</span>
            </div>
            <div className="bg-indigo-50/60 p-3 rounded-2xl text-center flex flex-col justify-center border border-indigo-100">
              <span className="text-[9px] text-indigo-500 font-black uppercase mb-1">修为收益</span>
              <span className={`text-xl font-black ${cultivationGain >= 0 ? 'text-indigo-600' : 'text-rose-500'}`}>{cultivationGain > 0 ? '+' : ''}{cultivationGain.toFixed(1)}</span>
            </div>
          </div>
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
            <div className="flex justify-between items-center mb-3">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Mastery Gain</span>
              <div className="flex items-center gap-2"><span className="text-[9px] font-bold text-slate-400">{startMastery.toFixed(2)}% &rarr; {endMastery.toFixed(2)}%</span><span className={`text-base font-black ${gain >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{gain > 0 ? '+' : ''}{gain.toFixed(2)}%</span></div>
            </div>
            <div className="h-40 w-full">{renderTrendChart(masteryTrend, 160)}</div>
          </div>
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 flex justify-between items-center text-[10px] font-bold text-slate-500">
             <span>策略: <span className="text-indigo-600 font-black">{activeTier.name} (x{activeTier.base})</span></span>
             <span>冻结: {algoSettings.allowFreeze ? '开启' : '关闭'}</span>
             <span>Cap: {algoSettings.cap}</span>
          </div>
          {sessionResults.length > 0 && (
            <div className="border-t border-slate-100 pt-4">
               <h3 className="text-xs font-black text-slate-800 mb-3 flex items-center gap-2"><ListOrdered size={14} className="text-indigo-500"/> 详细复盘 (按表现升序)</h3>
               <div className="max-h-56 overflow-y-auto space-y-1.5 custom-scrollbar pr-1">
                  {sessionResults.slice().sort((a,b) => a.nscore - b.nscore).map((res, i) => (
                    <div key={i} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="flex flex-col min-w-0 pr-3"><span className="font-bold text-sm text-slate-700 truncate">{res.phrase.chinese}</span><span className="text-[10px] font-medium text-slate-400 truncate mt-0.5">{res.phrase.english}</span></div>
                      <div className={`px-2.5 py-1 rounded-lg text-[11px] font-black shadow-sm ${res.prof === 'watch' ? 'bg-slate-200 text-slate-600' : res.prof >= 4 ? 'bg-emerald-100 text-emerald-700' : res.prof >= 2 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{res.prof === 'watch' ? '观望' : `${res.prof} 分`}</div>
                    </div>
                  ))}
               </div>
            </div>
          )}
          <Button fullWidth onClick={handleFinalExit} className="py-4 text-base font-black rounded-2xl shadow-xl mt-2 bg-indigo-600 border-0 text-white hover:bg-indigo-700">确认并返回主页</Button>
        </div>
      </div>
    );
  }

  // 正常复习流程的 JSX
  const isEnToCn_Mode = deck.studyMode === 'EN_CN';

  return (
    <div className="fixed inset-0 bg-slate-50 z-[100] flex flex-col h-full overflow-hidden">
      
      {/* 顶栏 (极致紧凑 h-10) */}
      <div className="bg-white shadow-sm shrink-0 relative z-[60]">
        <div className="flex items-center justify-between px-3 py-1 h-10">
          <button onClick={handleRequestExit} className="p-1.5 text-slate-400 hover:text-slate-600 transition-all active:scale-90"><ArrowLeft size={18}/></button>
          <div className="flex-1 flex flex-col justify-center items-center max-w-[60%]">
              <div className="flex justify-between items-end w-full max-w-[200px] mb-0.5">
                <div className="flex items-center gap-1.5 truncate"><span className="text-[10px] font-black text-indigo-600">{(liveMasteryValue).toFixed(2)}%</span><span className="text-[9px] text-slate-300 font-bold truncate">/ {deck.name}</span></div>
                <span className="text-[9px] font-mono font-bold text-slate-400">{new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
              </div>
              <div className="h-1 w-full max-w-[200px] bg-slate-100 rounded-full overflow-hidden relative border border-slate-50">
                <div className="absolute top-0 left-0 h-full bg-lime-400 transition-all duration-700 ease-out" style={{ width: `${liveMasteryValue}%` }}></div>
              </div>
              <div className="flex justify-between items-start w-full max-w-[200px] mt-0.5 leading-none">
                <span className="text-[9px] font-mono font-black text-slate-300 tracking-tighter">{formatHeaderTime(sessionDuration)}</span>
                <span className="text-[9px] font-bold flex items-center gap-1"><span className="text-emerald-500">{stats.count4_5}</span><span className="text-slate-200">/</span><span className="text-amber-500">{stats.count2_3}</span><span className="text-slate-200">/</span><span className="text-rose-500">{stats.count0_1}</span></span>
              </div>
          </div>
          <div className="flex gap-0.5 shrink-0 items-center">
            <button onClick={() => setShowAlgoMenu(!showAlgoMenu)} className={`p-1.5 rounded-lg transition-colors ${showAlgoMenu ? 'text-indigo-600 bg-indigo-50' : 'text-slate-300'}`}><Settings2 size={18}/></button>
            <button onClick={()=>setShowStats(!showStats)} className={`p-1.5 rounded-lg transition-colors ${showStats ? 'text-indigo-600 bg-indigo-50' : 'text-slate-300'}`}><BarChart2 size={18}/></button>
            <button onClick={()=>setShowQueue(!showQueue)} className={`p-1.5 rounded-lg transition-colors relative ${showQueue ? 'text-indigo-600 bg-indigo-50' : 'text-slate-300'}`}><ListOrdered size={18}/></button>
          </div>
        </div>
        {showAlgoMenu && (
          <div className="absolute top-full right-2 mt-1 w-64 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden z-[100] animate-in slide-in-from-top-1">
             <div className="p-3 border-b border-slate-50 flex items-center justify-between bg-slate-50/50">
               <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Algorithm</span>
               <button onClick={()=>setShowAlgoMenu(false)}><X size={14} className="text-slate-400"/></button>
             </div>
             <div className="p-3 space-y-3">
               <div>
                 <div className="grid grid-cols-1 gap-1">
                   {ALGO_TIERS.map((tier, idx) => (
                     <button key={idx} onClick={() => setAlgoSettings({ ...algoSettings, tierIdx: idx })} className={`w-full text-left px-2 py-1.5 text-xs font-bold rounded-lg transition-all ${algoSettings.tierIdx === idx ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}>
                       {tier.name}
                     </button>
                   ))}
                 </div>
               </div>
               <label className="flex items-center justify-between p-2 bg-slate-50 rounded-xl cursor-pointer">
                 <div className="text-[11px] font-bold text-slate-600">允许词条冻结</div>
                 <div className={`w-8 h-4 rounded-full relative shadow-inner ${algoSettings.allowFreeze ? 'bg-emerald-500' : 'bg-slate-300'}`} onClick={() => setAlgoSettings({...algoSettings, allowFreeze: !algoSettings.allowFreeze})}>
                   <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${algoSettings.allowFreeze ? 'left-4.5' : 'left-0.5'}`}></div>
                 </div>
               </label>
               <div className="flex gap-2">
                 <div className="flex-1"><label className="text-[9px] font-black text-slate-400 uppercase block mb-0.5">Cap</label><input type="number" value={algoSettings.cap} onChange={(e) => setAlgoSettings({ ...algoSettings, cap: Math.max(10, parseInt(e.target.value) || 100) })} className="w-full p-1 bg-white border border-slate-200 rounded text-xs font-black outline-none" /></div>
                 <div className="flex-1"><label className="text-[9px] font-black text-slate-400 uppercase block mb-0.5">限时</label><input type="number" value={algoSettings.timeLimit} onChange={(e) => setAlgoSettings({ ...algoSettings, timeLimit: Math.max(0, parseInt(e.target.value) || 0) })} className="w-full p-1 bg-white border border-slate-200 rounded text-xs font-black outline-none" /></div>
               </div>
             </div>
          </div>
        )}
      </div>

      <div className="flex-1 flex relative overflow-hidden">
        
        <div className={`absolute top-0 left-0 h-full w-[280px] bg-white border-r border-slate-100 shadow-xl transition-transform duration-300 z-[70] flex flex-col ${showStats ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="p-4 flex justify-between items-center bg-slate-50 border-b shrink-0">
            <h3 className="font-black text-slate-800 text-xs flex items-center gap-2"><BarChart2 size={16} className="text-indigo-500"/> 状态大盘</h3>
            <button onClick={()=>setShowStats(false)} className="p-1 hover:bg-slate-200 rounded-full transition-colors"><X size={18} className="text-slate-500"/></button>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-6">
            <div><h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5"><TrendingUp size={12}/> Mastery Trend</h4>{renderTrendChart(masteryTrend, 120)}</div>
            <div className="border-t border-slate-50 pt-5">
               <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5"><Hash size={12}/> 全本状态分布</h4>
               <div className="grid grid-cols-2 gap-2">
                 {Object.entries(deck.phrases.reduce((acc, p) => { const tag = getPhraseLabel(p.score); acc[tag] = (acc[tag] || 0) + 1; return acc; }, {} as Record<string, number>))
                 .sort((a,b) => { if (a[0] === '新') return -1; if (b[0] === '新') return 1; const valA = parseInt(a[0].slice(1)) || 0; const valB = parseInt(b[0].slice(1)) || 0; if (a[0][0] !== b[0][0]) return a[0][0] === '错' ? -1 : 1; return a[0][0] === '错' ? valB - valA : valA - valB; })
                 .map(([tag, count]) => {
                   const scoreVal = tag === '新' ? undefined : (tag.startsWith('对') ? parseInt(tag.slice(1)) : -parseInt(tag.slice(1)));
                   return (
                     <div key={tag} className="flex justify-between items-center p-2 rounded-xl bg-slate-50 border border-slate-100 shadow-sm"><span className="text-[9px] font-black text-white px-2 py-0.5 rounded-md shadow-sm" style={{backgroundColor: getScoreBadgeColor(scoreVal)}}>{tag}</span><span className="font-mono font-black text-slate-700 text-xs">{count}</span></div>
                   )
                 })}
               </div>
            </div>
          </div>
        </div>

        <div className={`absolute top-0 right-0 h-full w-[280px] bg-white border-l border-slate-100 shadow-xl transition-transform duration-300 z-[70] flex flex-col ${showQueue ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="p-4 flex justify-between items-center bg-slate-50 border-b shrink-0">
            <h3 className="font-black text-slate-800 text-sm flex items-center gap-2"><ListOrdered size={16} className="text-indigo-500"/> 复习队列</h3>
            <button onClick={()=>setShowQueue(false)} className="p-1 hover:bg-slate-200 rounded-full transition-colors"><X size={18} className="text-slate-500"/></button>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1">
            {deck.queue.map((id, idx) => {
              const p = deck.phrases.find(item => item.id === id); if (!p) return null;
              const isCurrent = id === activeId;
              return (
                <div key={id} className={`flex items-center justify-between text-xs py-2 px-3 rounded-xl border transition-all ${isCurrent ? 'bg-indigo-50 border-indigo-200 shadow-sm scale-[1.02] z-10' : 'bg-white border-transparent hover:bg-slate-50'}`}><div className="flex items-center gap-2 min-w-0 flex-1"><span className={`font-black text-[10px] w-4 text-center shrink-0 ${isCurrent ? 'text-indigo-600' : 'text-slate-300'}`}>{idx+1}</span><div className={`truncate font-bold ${isCurrent ? 'text-indigo-900' : 'text-slate-600'}`}>{p.chinese}</div></div><div className="px-1.5 py-0.5 rounded-md text-[9px] font-black text-white shrink-0 ml-2 shadow-sm" style={{backgroundColor: getScoreBadgeColor(p.score)}}>{getPhraseLabel(p.score)}</div></div>
              )
            })}
            {deck.coolingPool && deck.coolingPool.length > 0 && (
              <>
                <div className="relative py-4"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-sky-100"></div></div><div className="relative flex justify-center"><span className="bg-white px-3 text-[9px] font-black text-sky-400 uppercase tracking-widest flex items-center gap-1.5"><ThermometerSnowflake size={12}/> Cooling Pool</span></div></div>
                {[...deck.coolingPool].sort((a,b)=>a.wait - b.wait).map((c) => {
                  const p = deck.phrases.find(item => item.id === c.id); if (!p) return null;
                  return (
                    <div key={c.id} className="flex items-center justify-between py-2 px-3 opacity-60"><div className="flex items-center gap-2 min-w-0 flex-1"><span className="font-black text-[10px] w-6 text-center shrink-0 text-sky-500 bg-sky-50 rounded-md border border-sky-100">{c.wait}</span><div className="truncate font-bold text-xs text-slate-500">{p.chinese}</div></div><div className="px-1.5 py-0.5 rounded-md text-[8px] font-black text-white shrink-0 ml-2 opacity-50 shadow-sm" style={{backgroundColor: getScoreBadgeColor(p.score)}}>{getPhraseLabel(p.score)}</div></div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        <div className={`flex-1 flex flex-col items-center p-2 sm:p-4 transition-all duration-300 ${showQueue ? 'lg:pr-[280px]' : ''} ${showStats ? 'lg:pl-[280px]' : ''}`}>
          <div className="w-full max-w-xl bg-white rounded-3xl shadow-xl border border-slate-100 flex flex-col h-full max-h-[600px] overflow-hidden relative">
            
            {!isEditing && phase !== 'QUESTION' && (
              <button onClick={() => setIsEditing(true)} className="absolute top-2 right-2 z-10 p-2 text-slate-300 hover:text-indigo-500 active:scale-90 bg-white/60 rounded-xl shadow-sm"><Edit2 size={16}/></button>
            )}

            {isEditing ? (
              <div className="flex-1 p-5 overflow-y-auto custom-scrollbar animate-in fade-in">
                <h3 className="font-black text-slate-800 mb-6 flex items-center gap-2 text-base"><Edit2 size={18}/> 编辑卡片</h3>
                <div className="space-y-4">
                  <div><label className="text-[10px] font-black text-slate-400 uppercase block mb-1">题目 ({isEnToCn_Mode ? '英文' : '中文'})</label><textarea className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 ring-indigo-500 text-sm shadow-inner" rows={2} value={editForm.chinese} onChange={e=>setEditForm({...editForm, chinese: e.target.value})}/></div>
                  <div><label className="text-[10px] font-black text-slate-400 uppercase block mb-1">答案 ({isEnToCn_Mode ? '中文' : '英文'})</label><textarea className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 ring-indigo-500 text-sm shadow-inner" rows={2} value={editForm.english} onChange={e=>setEditForm({...editForm, english: e.target.value})}/></div>
                  <div><label className="text-[10px] font-black text-slate-400 uppercase block mb-1">笔记 (Note)</label><textarea className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-600 outline-none focus:ring-2 ring-indigo-500 shadow-inner" rows={4} value={editForm.note} onChange={e=>setEditForm({...editForm, note: e.target.value})}/></div>
                  <div className="flex gap-2 pt-2"><Button variant="ghost" fullWidth onClick={() => setIsEditing(false)}>取消</Button><Button fullWidth className="bg-indigo-600 text-white border-0 shadow-lg" onClick={handleSaveEdit}>保存</Button></div>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6 flex flex-col items-center w-full relative">
                
                <div className="w-full flex flex-col items-center text-center pt-6 mb-6">
                  {/* QUESTION 阶段不显示 Score */}
                  {phase === 'ANSWER' && (
                    <div className="flex items-center gap-1.5 mb-2 bg-slate-50 border border-slate-100 px-2 py-0.5 rounded-full animate-in fade-in zoom-in-95">
                      <span className="text-[8px] font-black text-slate-300 uppercase">Score:</span>
                      <span className="text-[10px] font-black text-slate-600">{(activeScore ?? 0).toFixed(2)}</span>
                    </div>
                  )}
                  <h1 className="text-3xl sm:text-4xl font-black text-slate-800 leading-snug break-words max-w-full">{renderFormattedText(questionText)}</h1>
                  {phase === 'QUESTION' && algoSettings.timeLimit > 0 && (
                    <div className="mt-8 flex flex-col items-center animate-in fade-in">
                      <div className={`text-[10px] font-black tabular-nums mb-1.5 ${isTimeout ? 'text-rose-500' : 'text-slate-400'}`}>{isTimeout ? '已超过限时' : `${timeLeft.toFixed(1)}s`}</div>
                      <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden shadow-inner"><div className={`h-full transition-all duration-100 ease-linear ${isTimeout ? 'bg-rose-500' : 'bg-indigo-400'}`} style={{ width: `${isTimeout ? 100 : (timeLeft / algoSettings.timeLimit) * 100}%` }} /></div>
                    </div>
                  )}
                </div>

                {phase === 'ANSWER' && (
                  <div className="w-full flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300 pb-2 mt-auto">
                    <div className="text-center py-2 px-4 rounded-xl w-full mb-3 bg-indigo-50/40 border border-indigo-100/30 shadow-sm"><p className="text-xl font-black text-indigo-600 leading-snug break-words">{renderFormattedText(answerText)}</p></div>
                    {currentPhrase.note && (
                      <div className="w-full bg-amber-50/50 p-2.5 rounded-xl border border-amber-100 text-left relative mb-3 shadow-sm">
                        <div className="absolute top-2.5 left-2.5"><StickyNote size={12} className="text-amber-400" /></div>
                        <div className="pl-6 text-[10px] font-bold text-slate-600 whitespace-pre-wrap leading-normal">{renderFormattedText(cleanNote(currentPhrase.note))}</div>
                      </div>
                    )}
                    <div className="w-full space-y-2.5">
                      <div className="bg-slate-50/80 p-2 rounded-xl border border-slate-100 flex justify-between items-center gap-2 shadow-sm">
                        <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest pl-1 shrink-0">难度 {diff}</span>
                        <div className="flex gap-0.5 flex-1">
                          {[0, 1, 2, 3, 4, 5].map(v => (<button key={v} onClick={() => setDiff(v)} className={`flex-1 py-1 rounded font-black text-[10px] transition-all border ${diff === v ? 'bg-indigo-500 border-indigo-500 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-400'}`}>{v}</button>))}
                        </div>
                      </div>
                      <div className="grid grid-cols-6 gap-1">
                        {[0, 1, 2, 3, 4, 5].map(v => {
                          const disabled = isTimeout && v >= 4;
                          return (
                            <button key={v} disabled={disabled} onClick={() => setProf(v)} 
                              className={`flex flex-col items-center justify-center py-1.5 rounded-lg border transition-all ${disabled ? 'opacity-20 grayscale bg-slate-50' : prof === v ? 'bg-emerald-50 border-emerald-500 scale-105 z-10' : 'bg-white border-slate-100'}`}>
                              <span className={`text-xs font-black ${prof === v ? 'text-emerald-600' : 'text-slate-400'}`}>{v}</span>
                              <span className="text-[6px] font-bold mt-0.5 scale-90 whitespace-nowrap text-slate-500">{currentLabels[v]}</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="bg-indigo-50/50 p-3 rounded-xl border border-indigo-100 animate-in slide-in-from-bottom-1 shadow-sm">
                        <div className="flex justify-between items-start mb-2">
                            <div className="flex flex-col">
                              <span className="text-[8px] font-black text-indigo-900 uppercase tracking-widest flex items-center gap-1"><Settings2 size={10}/> Score 轨迹预测</span>
                              <div className="text-[9px] font-bold mt-0.5 flex items-center gap-1">
                                <span className="text-slate-400">{(activeScore ?? 0).toFixed(2)}</span><ArrowRight size={8} className="text-slate-300"/><span className={`font-black ${prof !== null ? (computedScore >= (activeScore ?? 0) ? 'text-emerald-600' : 'text-rose-500') : 'text-indigo-400'}`}>{(prof !== null ? computedScore : (activeScore ?? 0)).toFixed(2)}</span>
                              </div>
                            </div>
                            <div className="flex flex-col items-end">
                                <div className="flex items-center gap-1.5"><span className="font-mono font-black text-[10px] text-indigo-600 w-8 text-right">{currentBackDisplay}</span>
                                  {customBack !== null && (
                                    <button onClick={() => setCustomBack(null)} className="p-1 text-slate-400 hover:text-indigo-600 bg-white rounded-md border" title="恢复计算"><RefreshCw size={10}/></button>
                                  )}
                                </div>
                                {isNowFrozen && <div className="text-sky-500 font-black text-[7px] mt-1 italic animate-pulse"><Waves size={10} className="inline mr-0.5"/>冻结 (+{currentBackDisplay - (deck.queue.length-1)}步)</div>}
                            </div>
                        </div>
                        {/* 满行滑块 */}
                        <div className="px-1">
                          <input type="range" min="0" max="1000" step="1" 
                            value={mapBackToSlider(currentBackDisplay)} 
                            onChange={e => setCustomBack(mapSliderToBack(parseInt(e.target.value)))}
                            className={`w-full h-1 mt-1 rounded-lg appearance-none cursor-pointer ${isNowFrozen ? 'bg-sky-200 accent-sky-500' : 'bg-indigo-200 accent-indigo-600'}`} 
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="p-3 sm:p-4 bg-white border-t border-slate-100 shrink-0">
              {phase === 'QUESTION' ? (
                <Button fullWidth onClick={handleShowAnswer} className="py-3 text-base font-black shadow-lg bg-indigo-600 border-0 text-white hover:bg-indigo-700 active:scale-95">查看答案 (Space)</Button>
              ) : (
                <div className="flex gap-2">
                  <button onClick={() => handleFinishCard(true)} className="flex-1 flex items-center justify-center gap-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-black text-[10px] border-0 shadow-sm active:scale-95 transition-all"><Eye size={16}/> 观望 (W)</button>
                  <Button disabled={prof === null || isAntiTouchActive} fullWidth onClick={() => handleFinishCard(false)} className={`flex-[2.5] py-3 text-sm font-black shadow-lg border-0 transition-all active:scale-95 ${prof === null ? 'bg-slate-100 text-slate-400' : 'bg-indigo-600 text-white shadow-indigo-200'}`}>确认继续 (Enter) <ArrowRight size={18} className="ml-1.5" /></Button>
                </div>
              )}
            </div>
            {isAntiTouchActive && <div className="absolute inset-0 z-20 cursor-not-allowed"></div>}
          </div>
        </div>
      </div>
    </div>
  );
};
