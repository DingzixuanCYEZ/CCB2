// src/components/StudySession.tsx (Part 1 - 完整逻辑与细节版)

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Deck, Phrase } from '../types';
import { Button } from './Button';
import { 
  ArrowLeft, Settings2, RefreshCw, Eye, ArrowRight, Clock, AlertCircle, 
  Edit2, BarChart2, ListOrdered, X, CheckCircle2, Trophy, StickyNote, 
  XCircle, ThermometerSnowflake, Waves
} from 'lucide-react';
import { 
  calculateNextState, calculateBack, calculateWatchBack, 
  mapSliderToBack, mapBackToSlider, getNScore, EPS, calculateMastery,
  getProficiencyLabel, getDynamicColor, getScoreBadgeColor, getPhraseLabel
} from '../utils/algo';

interface StudySessionProps {
  deck: Deck;
  onUpdateDeck: (updatedDeck: Deck) => void;
  onExit: () => void;
  onTimeUpdate: (seconds: number) => void;
  onSessionComplete?: (durationSeconds: number, counts: { count0_1: number; count2_3: number; count4_5: number }, cultivationGain: number) => void;
}

const ALGO_TIERS =[
  { name: '一档 (保守)', C: 3, base: 1.5 },
  { name: '二档 (稳健)', C: 3.5, base: 1.75 },
  { name: '三档 (标准)', C: 4, base: 2 },
  { name: '四档 (进阶)', C: 5, base: 2.5 },
  { name: '五档 (激进)', C: 6, base: 3 },
];

const ALGO_SETTINGS_KEY = 'recallflow_v2_algo_settings';

const formatHeaderTime = (seconds: number) => { 
  if (Number.isNaN(seconds)) return '00:00';
  const m = Math.floor(seconds / 60); 
  const s = seconds % 60; 
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`; 
};

const formatFullTime = (seconds: number) => { 
  if (Number.isNaN(seconds) || seconds <= 0) return '0s'; 
  const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = seconds % 60; 
  if (h > 0) return `${h}h${m}m${s}s`; if (m > 0) return `${m}m${s}s`; return `${s}s`; 
};

const cleanNote = (text?: string) => text ? text.replace(/\n\s*\n/g, '\n').trim() : "";
const renderFormattedText = (text?: string) => {
  if (!text) return null;
  const parts = text.split(/\[(.*?)\]/g);
  return (
    <span className="overflow-wrap-anywhere break-words hyphens-none">
      {parts.map((part, i) => i % 2 === 1 ? <span key={i} className="text-orange-700 font-bold mx-0.5 border-b-2 border-orange-400">{part}</span> : <span key={i}>{part.replace(/\\n/g, '\n')}</span>)}
    </span>
  );
};

export const StudySession: React.FC<StudySessionProps> = ({ deck, onUpdateDeck, onExit, onTimeUpdate, onSessionComplete }) => {
  const [activeId, setActiveId] = useState<string | null>(deck.queue.length > 0 ? deck.queue[0] : null);
  const [phase, setPhase] = useState<'QUESTION' | 'ANSWER' | 'REPORT'>('QUESTION');
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

  const [stats, setStats] = useState({ count0_1: 0, count2_3: 0, count4_5: 0 });
  const [cultivationGain, setCultivationGain] = useState<number>(0);
  const [sessionResults, setSessionResults] = useState<{phrase: Phrase, prof: number | 'watch'}[]>([]);
  
  const [startMastery] = useState(() => deck.phrases.length === 0 ? 0 : deck.phrases.reduce((acc, p) => acc + (p.mastery || 0), 0) / deck.phrases.length);
  const [masteryTrend, setMasteryTrend] = useState<{ t: number; v: number }[]>([{ t: 0, v: startMastery }]);

  const currentPhrase = useMemo(() => deck.phrases.find(p => p.id === activeId), [activeId, deck.phrases]);
  const activeScore = useMemo(() => {
    if (!currentPhrase || currentPhrase.score === undefined) return undefined;
    const s = Number(currentPhrase.score);
    return Number.isNaN(s) ? undefined : s;
  },[currentPhrase]);

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
      setTimeLeft(algoSettings.timeLimit);
      setIsTimeout(false);
      questionTimerRef.current = window.setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 0.1) { clearInterval(questionTimerRef.current!); setIsTimeout(true); return 0; }
          return prev - 0.1;
        });
      }, 100);
    } else {
      if (questionTimerRef.current) clearInterval(questionTimerRef.current);
    }
    return () => { if (questionTimerRef.current) clearInterval(questionTimerRef.current); };
  },[phase, algoSettings.timeLimit, isEditing, isFinished, activeId]);

  const watchBackValue = useMemo(() => {
    if (!currentPhrase) return 1;
    const C = ALGO_TIERS[algoSettings.tierIdx].C;
    const base = ALGO_TIERS[algoSettings.tierIdx].base;
    const nscore = getNScore(activeScore ?? 0, diff);
    return calculateWatchBack(nscore, C, base);
  }, [currentPhrase, diff, algoSettings, activeScore]);

  useEffect(() => {
    if (phase === 'ANSWER' && currentPhrase && prof !== null) {
      const todayDays = Math.floor(Date.now() / 86400000);
      const C = ALGO_TIERS[algoSettings.tierIdx].C;
      const base = ALGO_TIERS[algoSettings.tierIdx].base;
      const gap = (todayDays - (currentPhrase.date || todayDays)) + 1;
      const { newScore, nscore } = calculateNextState(activeScore, prof, diff, gap, C, base, algoSettings.cap);
      setComputedScore(Number.isNaN(newScore) ? 0 : newScore);
      setComputedBack(Number.isNaN(nscore) ? 1 : calculateBack(nscore, C, base));
    }
  },[phase, prof, diff, currentPhrase, algoSettings, activeScore]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditing || isFinished || isAntiTouchActive || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (phase === 'QUESTION') {
        if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); handleShowAnswer(); }
      } else if (phase === 'ANSWER') {
        if (e.code === 'Space' || e.key === 'Enter') {
          e.preventDefault(); if (prof !== null) handleFinishCard(false);
        } else {
          const keyNum = parseInt(e.key);
          if (!isNaN(keyNum) && keyNum >= 0 && keyNum <= 5) { if (isTimeout && keyNum >= 4) return; setProf(keyNum); }
          else if (e.code === 'KeyW') handleFinishCard(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phase, isEditing, isFinished, prof, isTimeout, isAntiTouchActive]);

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
    const C = ALGO_TIERS[algoSettings.tierIdx].C;
    const base = ALGO_TIERS[algoSettings.tierIdx].base;
    let finalBack = isWatch ? (customBack ?? watchBackValue) : (customBack ?? computedBack);
    let newScore = isWatch ? activeScore : computedScore;

    if (!isWatch && prof !== null) {
      const pVal = prof as number;
      setStats(prev => ({ count0_1: prev.count0_1 + (pVal <= 1 ? 1 : 0), count2_3: prev.count2_3 + (pVal >= 2 && pVal <= 3 ? 1 : 0), count4_5: prev.count4_5 + (pVal >= 4 ? 1 : 0) }));
      const gainMap =[-1.0, -0.6, -0.2, 0.2, 0.6, 1.0];
      setCultivationGain(prev => prev + gainMap[pVal]);
    }
    setSessionResults(prev =>[...prev, { phrase: currentPhrase, prof: isWatch ? 'watch' : prof! }]);

    const updatedPhrase: Phrase = { ...currentPhrase, score: newScore, diff, date: todayDays, back: finalBack, totalReviews: currentPhrase.totalReviews + 1, mastery: calculateMastery(getNScore(newScore ?? 0, diff)), lastReviewedAt: Date.now() };
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

    setMasteryTrend(prev =>[...prev, { t: sessionDuration, v: updatedPhrases.reduce((acc, p) => acc + (p.mastery || 0), 0) / updatedPhrases.length }]);
    onUpdateDeck({ ...deck, queue: nextQueue, coolingPool: nextCoolingPool, phrases: updatedPhrases });
    setPhase('QUESTION'); setIsTimeout(false); setTimeLeft(algoSettings.timeLimit); setProf(null); setCustomBack(null);
    setActiveId(nextQueue.length > 0 ? nextQueue[0] : null);
  },[currentPhrase, isAntiTouchActive, algoSettings, diff, customBack, prof, deck, activeId, sessionDuration, onUpdateDeck, activeScore, watchBackValue, computedBack, computedScore]);

  const handleRequestExit = () => { setIsFinished(true); setPhase('REPORT'); };
  const handleFinalExit = () => { if (onSessionComplete) onSessionComplete(sessionDuration, stats, cultivationGain); onExit(); };

  const renderTrendChart = (data = masteryTrend, height = 100) => {
    if (data.length < 2) return null;
    const width = 240; const padding = { top: 10, right: 10, bottom: 20, left: 30 };
    const chartWidth = width - padding.left - padding.right; const chartHeight = height - padding.top - padding.bottom;
    const maxTime = Math.max(...data.map(d => d.t), 1); const minTime = data[0].t; const timeRange = maxTime - minTime || 1;
    const points = data.map(d => { const x = padding.left + ((d.t - minTime) / timeRange) * chartWidth; const y = padding.top + chartHeight - ((d.v) / 100) * chartHeight; return `${x},${y}`; }).join(' ');
    return (
      <div className="relative"><svg width="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible bg-slate-50/50 rounded-lg border border-slate-100"><line x1={padding.left} y1={padding.top} x2={width-padding.right} y2={padding.top} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3 3" /><line x1={padding.left} y1={padding.top + chartHeight/2} x2={width-padding.right} y2={padding.top + chartHeight/2} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3 3" /><line x1={padding.left} y1={height-padding.bottom} x2={width-padding.right} y2={height-padding.bottom} stroke="#e2e8f0" strokeWidth="1" /><text x={25} y={padding.top + 4} className="text-[9px] fill-slate-400 font-bold" textAnchor="end">100%</text><text x={25} y={padding.top + chartHeight/2 + 4} className="text-[9px] fill-slate-400 font-bold" textAnchor="end">50%</text><text x={25} y={height-padding.bottom - 2} className="text-[9px] fill-slate-400 font-bold" textAnchor="end">0%</text><polyline points={points} fill="none" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
    );
  };
// src/components/StudySession.tsx (Part 2)

  // ========== UI 渲染逻辑 ==========

  // 1. 专属的复盘报告页面 (REPORT Phase)
  if (phase === 'REPORT') {
    const endMastery = masteryTrend.length > 0 ? masteryTrend[masteryTrend.length - 1].v : startMastery;
    const gain = endMastery - startMastery;

    return (
      <div className="fixed inset-0 bg-slate-50 z-50 flex flex-col items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-300 overflow-y-auto custom-scrollbar">
        <div className="max-w-2xl w-full bg-white rounded-3xl shadow-2xl p-8 flex flex-col space-y-6 my-8">
          <div className="text-center">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4 text-emerald-600">
              <Trophy className="w-8 h-8" />
            </div>
            <h2 className="text-3xl font-black text-slate-800">学习报告</h2>
            <p className="text-slate-400 font-bold text-sm uppercase tracking-widest mt-1">{deck.name}</p>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 text-center">
              <div className="text-xs text-slate-400 font-black uppercase tracking-widest mb-1">本次复习总计</div>
              <div className="text-3xl font-black text-slate-800">{stats.count0_1 + stats.count2_3 + stats.count4_5} <span className="text-sm text-slate-400">词</span></div>
              <div className="text-xs font-bold mt-2 flex justify-center gap-2 whitespace-nowrap">
                <span className="text-emerald-500">{stats.count4_5} 优</span>
                <span className="text-slate-300">|</span>
                <span className="text-amber-500">{stats.count2_3} 中</span>
                <span className="text-slate-300">|</span>
                <span className="text-rose-500">{stats.count0_1} 差</span>
              </div>
            </div>
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 text-center flex flex-col justify-center">
              <div className="text-xs text-slate-400 font-black uppercase tracking-widest mb-1">本次获得修为</div>
              <div className={`text-3xl font-black ${cultivationGain >= 0 ? 'text-indigo-600' : 'text-rose-500'}`}>
                {cultivationGain > 0 ? '+' : ''}{cultivationGain.toFixed(1)}
              </div>
              <div className="text-[10px] font-bold text-slate-400 mt-2">精确累计打分分值</div>
            </div>
          </div>
          
          <div className="bg-indigo-50/50 p-6 rounded-2xl border border-indigo-100 shadow-inner">
            <div className="flex justify-between items-start mb-4">
              <div>
                <span className="text-xs font-black text-indigo-900 uppercase tracking-widest block mb-1">掌握度变化 Mastery Gain</span>
                <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                  <span>{startMastery.toFixed(2)}%</span>
                  <span className="text-slate-300">→</span>
                  <span>{endMastery.toFixed(2)}%</span>
                </div>
              </div>
              <span className={`text-xl font-black ${gain >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{gain > 0 ? '+' : ''}{gain.toFixed(2)}%</span>
            </div>
            {renderTrendChart(masteryTrend, 120)}
          </div>

          {/* 复盘详情列表 */}
          {sessionResults.length > 0 && (
            <div className="border-t border-slate-100 pt-6">
               <h3 className="text-sm font-black text-slate-800 mb-4 flex items-center gap-2"><ListOrdered className="w-4 h-4 text-indigo-500"/> 复盘详情 (按表现排序)</h3>
               <div className="max-h-64 overflow-y-auto space-y-2 custom-scrollbar pr-2">
                  {sessionResults.slice().sort((a,b) => {
                      const scoreA = a.prof === 'watch' ? 2.5 : a.prof;
                      const scoreB = b.prof === 'watch' ? 2.5 : b.prof;
                      return scoreA - scoreB;
                  }).map((res, i) => (
                      <div key={i} className="flex justify-between items-center p-4 bg-slate-50 rounded-xl border border-slate-100 group hover:border-indigo-200 transition-all">
                          <div className="flex flex-col min-w-0 pr-4">
                              <span className="font-bold text-base text-slate-700 truncate">{res.phrase.chinese}</span>
                              <span className="text-xs font-medium text-slate-400 truncate">{res.phrase.english}</span>
                          </div>
                          <div className={`px-3 py-1.5 rounded-lg text-sm font-black shrink-0 shadow-sm ${res.prof === 'watch' ? 'bg-slate-200 text-slate-600' : res.prof >= 4 ? 'bg-emerald-100 text-emerald-700' : res.prof >= 2 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>
                              {res.prof === 'watch' ? '观望' : `${res.prof} 分`}
                          </div>
                      </div>
                  ))}
               </div>
            </div>
          )}

          <Button fullWidth onClick={handleFinalExit} className="py-4 text-lg font-black rounded-2xl shadow-xl mt-4">确认返回主页</Button>
        </div>
      </div>
    );
  }

  // 2. 冷却池自动唤醒引导页 (拦截图 1 中的报错)
  if (!currentPhrase) {
    if (deck.coolingPool && deck.coolingPool.length > 0) {
      return (
        <div className="fixed inset-0 flex flex-col items-center justify-center bg-slate-50 z-[100] p-4 animate-in fade-in">
          <div className="bg-white p-8 rounded-3xl shadow-xl text-center max-w-sm w-full animate-in zoom-in-95 border border-slate-100">
            <div className="w-16 h-16 bg-sky-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Waves className="w-8 h-8 text-sky-500" />
            </div>
            <h2 className="text-2xl font-black text-slate-800 mb-2">发现冻结词条</h2>
            <p className="text-sm text-slate-500 mb-6 font-medium">当前队列已排空，但后台还有 <span className="text-sky-500 font-black text-xl">{deck.coolingPool.length}</span> 个词条正在冻结中。</p>
            <Button fullWidth onClick={() => {
                const awakenedIds = deck.coolingPool!.map(c => c.id);
                onUpdateDeck({ ...deck, queue: awakenedIds, coolingPool: [] });
                setActiveId(awakenedIds[0]); 
            }} className="py-4 text-lg font-black bg-sky-500 hover:bg-sky-600 shadow-lg shadow-sky-200 border-0 text-white">立即全部唤醒</Button>
            <Button fullWidth variant="ghost" onClick={handleRequestExit} className="mt-3 text-slate-400">退出查看报告</Button>
          </div>
        </div>
      );
    }
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-white z-[100] p-4">
         <AlertCircle className="w-16 h-16 text-rose-500 mb-4" />
         <h2 className="text-2xl font-black text-slate-800">数据加载异常</h2>
         <Button onClick={onExit} className="mt-6 px-8 py-3">强制退出</Button>
      </div>
    );
  }

  // 3. 实时变量计算
  const liveMasteryValue = masteryTrend.length > 0 ? masteryTrend[masteryTrend.length - 1].v : startMastery;
  const isEnToCn = deck.studyMode === 'EN_CN';
  const questionText = isEnToCn ? currentPhrase.english : currentPhrase.chinese;
  const answerText = isEnToCn ? currentPhrase.chinese : currentPhrase.english;
  const isNew = activeScore === undefined || activeScore === 0;
  const currentLabels = isNew 
    ? ["完全没思路", "思路大体对", "缺东西", "差一点", "正确但不确定", "正确"]
    : ["完全没印象", "印象不清楚", "缺东西", "差一点", "勉强想出", "快速想出"];

  const currentBackDisplay = customBack ?? (prof !== null ? computedBack : watchBackValue);
  const isNowFrozen = algoSettings.allowFreeze && currentBackDisplay > (deck.queue.length - 1);

  // 4. 主复习界面返回
  return (
    <div className="fixed inset-0 bg-slate-50 z-[100] flex flex-col h-full overflow-hidden">
      
      {/* 顶栏控制区 */}
      <div className="bg-white shadow-sm shrink-0 relative z-[60]">
        <div className="flex items-center justify-between px-3 py-2 gap-3 h-14">
          <button onClick={handleRequestExit} className="p-2 text-slate-400 hover:text-slate-600 active:scale-95 transition-transform shrink-0"><ArrowLeft className="w-5 h-5"/></button>
          
          <div className="flex-1 flex flex-col justify-center max-w-[70%] sm:max-w-[50%]">
            <div className="flex justify-between items-end mb-1 leading-none">
              <span className="text-[10px] text-slate-400 font-bold truncate pr-2">{deck.name}</span>
              <span className="text-[10px] font-mono font-bold text-slate-400">{formatHeaderTime(sessionDuration)}</span>
            </div>
            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden relative border border-slate-50">
              <div className="absolute top-0 left-0 h-full transition-all duration-700 ease-out" style={{ width: `${liveMasteryValue}%`, backgroundColor: getDynamicColor(liveMasteryValue) }}></div>
            </div>
            <div className="flex justify-between items-start mt-1 leading-none">
              <span className="text-[10px] font-black" style={{ color: getDynamicColor(liveMasteryValue) }}>{liveMasteryValue.toFixed(2)}%</span>
              <span className="text-[10px] font-bold text-slate-400">
                <span className="text-emerald-500">{stats.count4_5}</span>
                <span className="text-slate-300 mx-0.5">/</span><span className="text-amber-500">{stats.count2_3}</span>
                <span className="text-slate-300 mx-0.5">/</span><span className="text-rose-500">{stats.count0_1}</span>
              </span>
            </div>
          </div>
          
          <div className="flex gap-1 shrink-0 items-center">
            <div className="relative">
              <button onClick={() => setShowAlgoMenu(!showAlgoMenu)} className={`p-2 rounded-lg transition-colors flex items-center gap-1 ${showAlgoMenu ? 'text-indigo-600 bg-indigo-50' : 'text-slate-300 hover:text-slate-500'}`}><Settings2 className="w-5 h-5"/></button>
              {showAlgoMenu && (
                <div className="absolute top-full right-0 mt-2 w-72 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden z-50 animate-in fade-in zoom-in-95">
                  <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Algorithm Settings</span>
                    <button onClick={()=>setShowAlgoMenu(false)}><X className="w-3 h-3 text-slate-400"/></button>
                  </div>
                  <div className="p-4 border-b border-slate-100 max-h-[60vh] overflow-y-auto custom-scrollbar">
                    <label className="text-xs font-bold text-slate-600 block mb-2">学习节奏档位 (C & base)</label>
                    <div className="space-y-1 mb-4">
                      {ALGO_TIERS.map((tier, idx) => (
                        <button key={idx} onClick={() => setAlgoSettings({ ...algoSettings, tierIdx: idx })} className={`w-full text-left px-3 py-2 text-xs font-bold flex items-center justify-between rounded-lg transition-all ${algoSettings.tierIdx === idx ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' : 'text-slate-600 hover:bg-slate-50 border border-transparent'}`}>
                          <div>{tier.name} <span className="opacity-50 text-[9px] ml-1">C:{tier.C}, b:{tier.base}</span></div>
                          {algoSettings.tierIdx === idx && <div className="w-2 h-2 rounded-full bg-indigo-500"></div>}
                        </button>
                      ))}
                    </div>
                    <div className="mb-4 bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <label className="flex items-center justify-between cursor-pointer">
                        <div>
                          <div className="text-xs font-bold text-slate-700 flex items-center gap-2">允许词条冻结 {algoSettings.allowFreeze && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500"/>}</div>
                          <div className="text-[9px] font-bold text-slate-400 mt-0.5">后推超出队列时，将其冻结在后台</div>
                        </div>
                        <div className={`w-10 h-5 rounded-full transition-colors relative shadow-inner ${algoSettings.allowFreeze ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                           <div className={`absolute top-1 w-3 h-3 rounded-full bg-white shadow transition-transform ${algoSettings.allowFreeze ? 'left-6' : 'left-1'}`}></div>
                        </div>
                        <input type="checkbox" checked={algoSettings.allowFreeze} onChange={e => setAlgoSettings({...algoSettings, allowFreeze: e.target.checked})} className="hidden" />
                      </label>
                    </div>
                    <label className="text-xs font-bold text-slate-600 block mb-2">Cap (每日复习基准容量)</label>
                    <input type="number" min="10" value={algoSettings.cap} onChange={(e) => setAlgoSettings({ ...algoSettings, cap: Math.max(10, parseInt(e.target.value) || 100) })} className="w-full p-2 border border-slate-200 rounded-lg text-sm font-black outline-none focus:border-indigo-500 mb-4" />
                    <label className="text-xs font-bold text-slate-600 block mb-2">题目限时 (秒，0为不限)</label>
                    <input type="number" min="0" value={algoSettings.timeLimit} onChange={(e) => setAlgoSettings({ ...algoSettings, timeLimit: Math.max(0, parseInt(e.target.value) || 0) })} className="w-full p-2 border border-slate-200 rounded-lg text-sm font-black outline-none focus:border-indigo-500" />
                  </div>
                </div>
              )}
            </div>
            <button onClick={()=>setShowStats(!showStats)} className={`p-2 rounded-lg transition-colors ${showStats ? 'text-indigo-600 bg-indigo-50' : 'text-slate-300 hover:text-slate-500'}`}><BarChart2 className="w-5 h-5"/></button>
            <button onClick={()=>setShowQueue(!showQueue)} className={`p-2 rounded-lg transition-colors relative ${showQueue ? 'text-indigo-600 bg-indigo-50' : 'text-slate-300 hover:text-slate-500'}`}><ListOrdered className="w-5 h-5"/></button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex relative overflow-hidden">
        <div className={`flex-1 flex flex-col items-center p-4 sm:p-6 transition-all duration-300 ${showQueue ? 'lg:pr-[320px]' : ''} ${showStats ? 'lg:pl-[320px]' : ''}`}>
          <div className="w-full max-w-2xl bg-white rounded-3xl shadow-xl border border-slate-100 flex flex-col h-full max-h-[calc(100vh-90px)] sm:max-h-[600px] overflow-hidden relative">
            
            {phase !== 'QUESTION' && (
              <div className="absolute top-3 right-3 z-10">
                <button onClick={() => setIsEditing(true)} className="p-2 text-slate-200 hover:text-indigo-400 hover:bg-indigo-50 rounded-xl transition-all"><Edit2 className="w-4 h-4"/></button>
              </div>
            )}

            {isEditing ? (
              <div className="flex-1 p-6 overflow-y-auto custom-scrollbar animate-in fade-in">
                <h3 className="font-black text-slate-800 mb-6 flex items-center gap-2 text-lg"><Edit2 className="w-5 h-5"/> 编辑卡片</h3>
                <div className="space-y-4">
                  <div><label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-1">Chinese</label><textarea className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 ring-indigo-500 shadow-inner" rows={2} value={editForm.chinese} onChange={e=>setEditForm({...editForm, chinese: e.target.value})}/></div>
                  <div><label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-1">English</label><textarea className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 ring-indigo-500 shadow-inner" rows={2} value={editForm.english} onChange={e=>setEditForm({...editForm, english: e.target.value})}/></div>
                  <div><label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-1">Note</label><textarea className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-600 outline-none focus:ring-2 ring-indigo-500 shadow-inner" rows={4} value={editForm.note} onChange={e=>setEditForm({...editForm, note: e.target.value})}/></div>
                  <div className="flex gap-3 pt-4"><Button variant="ghost" fullWidth onClick={() => setIsEditing(false)}>取消</Button><Button fullWidth onClick={handleSaveEdit} className="bg-indigo-600 text-white shadow-lg">保存修改</Button></div>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto custom-scrollbar p-6 sm:p-8 flex flex-col items-center w-full relative">
                
                <div className="w-full flex flex-col items-center text-center pt-8 mb-6">
                  <div className="flex items-center gap-2 mb-4 bg-slate-50 border px-3 py-1 rounded-full shadow-sm">
                    <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Score:</span>
                    <span className="text-[11px] font-black text-slate-600">{activeScore?.toFixed(2) ?? 'NEW'}</span>
                  </div>
                  <h1 className="text-3xl sm:text-4xl font-black text-slate-800 leading-snug break-words max-w-full">
                    {renderFormattedText(questionText)}
                  </h1>
                  
                  {phase === 'QUESTION' && algoSettings.timeLimit > 0 && (
                    <div className="mt-10 flex flex-col items-center animate-in fade-in">
                      <div className={`text-sm font-black tabular-nums mb-3 flex items-center justify-center gap-1.5 ${isTimeout ? 'text-rose-500' : 'text-slate-400'}`}>
                        {isTimeout ? <><AlertCircle className="w-4 h-4"/> 已超时</> : <><Clock className="w-4 h-4"/> {timeLeft.toFixed(1)}s</>}
                      </div>
                      <div className="w-40 h-1.5 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                        <div className={`h-full transition-all duration-100 ease-linear ${isTimeout ? 'bg-rose-500' : 'bg-indigo-400'}`} style={{ width: `${isTimeout ? 100 : (timeLeft / algoSettings.timeLimit) * 100}%` }} />
                      </div>
                    </div>
                  )}
                </div>

                {phase === 'ANSWER' && (
                  <div className="w-full flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-300 pb-4 mt-auto">
                    <div className="text-center py-2 px-4 rounded-xl w-full mb-6">
                      <p className="text-3xl font-black text-indigo-600 leading-snug break-words max-w-full">
                        {renderFormattedText(answerText)}
                      </p>
                    </div>

                    {currentPhrase.note && (
                      <div className="w-full bg-amber-50/70 p-5 rounded-2xl border border-amber-100/50 text-left relative mb-8 shadow-sm">
                        <div className="absolute top-5 left-5"><StickyNote className="w-4 h-4 text-amber-400" /></div>
                        <div className="pl-8 text-sm font-bold text-slate-600 whitespace-pre-wrap leading-relaxed break-words">
                          {renderFormattedText(cleanNote(currentPhrase.note))}
                        </div>
                      </div>
                    )}

                    <div className="w-full mt-auto space-y-6">
                      <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 shadow-sm">
                        <div className="flex justify-between items-center mb-3 ml-1">
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">记忆难度 (Difficulty)</span>
                          <span className="font-black text-indigo-600 mr-2 text-sm">{diff}</span>
                        </div>
                        <div className="flex gap-1.5">
                          {[0, 1, 2, 3, 4, 5].map(v => (
                            <button key={v} onClick={() => setDiff(v)} className={`flex-1 py-2.5 rounded-xl font-black text-sm transition-all border-2 ${diff === v ? 'bg-indigo-500 border-indigo-500 text-white shadow-md transform scale-105' : 'bg-white border-slate-200 text-slate-400 hover:border-indigo-300'}`}>{v}</button>
                          ))}
                        </div>
                      </div>

                      <div>
                         <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-3 ml-1">熟练度评分 (Proficiency)</span>
                         <div className="grid grid-cols-6 gap-2">
                            {[0, 1, 2, 3, 4, 5].map(v => {
                              const disabled = isTimeout && v >= 4;
                              return (
                                <button key={v} disabled={disabled} onClick={() => setProf(v)} 
                                  className={`flex flex-col items-center justify-center p-2.5 rounded-xl border-2 transition-all group ${disabled ? 'opacity-30 cursor-not-allowed bg-slate-50 border-slate-100 grayscale' : prof === v ? 'bg-emerald-50 border-emerald-500 shadow-md transform scale-105' : 'bg-white border-slate-100 hover:border-emerald-300'}`}>
                                  <span className={`text-base font-black ${prof === v ? 'text-emerald-600' : 'text-slate-400'}`}>{v}</span>
                                  <span className={`text-[8px] font-bold mt-1 leading-tight text-center truncate w-full ${prof === v ? 'text-emerald-700' : 'text-slate-500'}`} title={currentLabels[v]}>{currentLabels[v]}</span>
                                </button>
                              );
                            })}
                         </div>
                      </div>

                      <div className="bg-indigo-50/50 p-5 rounded-2xl border border-indigo-100 shadow-sm animate-in slide-in-from-bottom-2">
                        <div className="flex justify-between items-start mb-5">
                            <div className="flex flex-col">
                              <span className="text-xs font-black text-indigo-900 uppercase tracking-widest flex items-center gap-1.5"><Settings2 size={14}/> 预期后推步数 (Back)</span>
                              <div className="text-[10px] font-bold text-slate-500 mt-2 flex items-center gap-1.5">
                                <span>Score 预测:</span>
                                <span className="text-slate-400">{getPhraseLabel(activeScore)}</span>
                                <ArrowRight size={10} className="text-slate-300"/>
                                <span className={`font-black ${prof !== null ? (computedScore >= (activeScore ?? 0) ? 'text-emerald-600' : 'text-rose-500') : 'text-indigo-500'}`}>
                                  {getPhraseLabel(prof !== null ? computedScore : activeScore)}
                                </span>
                              </div>
                            </div>
                            
                            <div className="flex flex-col items-end">
                                <div className="flex items-center gap-2">
                                  <input type="number" min="1" 
                                    value={currentBackDisplay} 
                                    onChange={e => setCustomBack(Math.max(1, parseInt(e.target.value) || 1))} 
                                    className={`w-16 bg-white border rounded-lg p-2 text-center font-mono font-black text-base outline-none transition-all shadow-sm ${isNowFrozen ? 'border-sky-300 text-sky-600 ring-2 ring-sky-100' : 'border-indigo-200 text-indigo-600 focus:ring-4 ring-indigo-500/10'}`} 
                                  />
                                  {customBack !== null && (
                                    <button onClick={() => setCustomBack(null)} className="p-1.5 text-slate-400 hover:text-indigo-600 bg-white rounded-md transition-colors shadow-sm border border-slate-200" title="恢复系统计算">
                                      <RefreshCw size={14}/>
                                    </button>
                                  )}
                                </div>
                                {isNowFrozen && (
                                    <div className="flex items-center gap-1.5 text-sky-600 font-black text-[10px] mt-2 animate-pulse bg-sky-50 px-2 py-0.5 rounded-full border border-sky-100 shadow-sm">
                                       <ThermometerSnowflake size={11}/> 冻结冷却 {currentBackDisplay - (deck.queue.length - 1)} 步
                                    </div>
                                )}
                            </div>
                        </div>
                        <input type="range" min="0" max="1000" step="1" 
                          value={mapBackToSlider(currentBackDisplay)} 
                          onChange={e => setCustomBack(mapSliderToBack(parseInt(e.target.value)))}
                          className={`w-full h-1.5 rounded-lg appearance-none cursor-pointer ${isNowFrozen ? 'bg-sky-200 accent-sky-500' : 'bg-indigo-200 accent-indigo-600'}`} 
                        />
                        <div className="flex justify-between text-[8px] font-black text-slate-400 mt-2 px-1 tracking-widest uppercase">
                          <span>1</span>
                          <span className={isNowFrozen ? 'text-sky-400 font-black italic' : ''}>{isNowFrozen ? 'FREEZING POOL' : 'LOG2 SCALE'}</span>
                          <span>100K+</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {isAntiTouchActive && <div className="absolute inset-0 z-20 cursor-not-allowed"></div>}
              </div>
            )}
            
            <div className="p-4 sm:p-6 bg-white border-t border-slate-100 shrink-0">
              {phase === 'QUESTION' ? (
                <Button fullWidth onClick={handleShowAnswer} className="py-4 text-lg font-black shadow-lg shadow-indigo-100 bg-indigo-600 text-white border-0 hover:bg-indigo-700 transition-all">查看答案 (Space)</Button>
              ) : (
                <div className="flex gap-4">
                  <button onClick={() => handleFinishCard(true)} className="flex-1 flex items-center justify-center gap-2 py-4 bg-slate-100 text-slate-600 rounded-2xl font-black text-sm hover:bg-slate-200 transition-all border border-slate-200 shadow-sm"><Eye size={18}/> 观望 (W)</button>
                  <Button disabled={prof === null || isAntiTouchActive} fullWidth onClick={() => handleFinishCard(false)} className={`flex-[2] py-4 text-lg font-black shadow-xl transition-all ${prof === null ? 'bg-slate-200 text-slate-400 border-0' : 'bg-indigo-600 text-white border-0 hover:bg-indigo-700 shadow-indigo-200/50'}`}>
                    确认继续 (Enter) <ArrowRight size={20} className="ml-2" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 侧边栏队列 - 包含有序冷却池 */}
        <div className={`absolute top-0 right-0 h-full w-[320px] bg-white border-l border-slate-100 shadow-2xl transition-transform duration-300 z-[70] flex flex-col ${showQueue ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="p-5 flex justify-between items-center bg-slate-50 border-b border-slate-100 shrink-0">
            <h3 className="font-black text-slate-800 text-sm flex items-center gap-2"><ListOrdered className="w-4 h-4 text-indigo-500"/> 实时复习队列</h3>
            <button onClick={()=>setShowQueue(false)} className="p-1 hover:bg-slate-200 rounded-full transition-colors"><X className="w-4 h-4 text-slate-500"/></button>
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1.5">
            {deck.queue.map((id, idx) => {
              const p = deck.phrases.find(item => item.id === id);
              if (!p) return null;
              const isCurrent = id === activeId;
              return (
                <div key={id} className={`flex items-center justify-between text-sm py-2.5 px-3 rounded-xl border transition-all ${isCurrent ? 'bg-indigo-50 border-indigo-200 shadow-sm scale-[1.02] z-10' : 'bg-white border-transparent hover:bg-slate-50 hover:border-slate-200'}`}>
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className={`font-black text-[10px] w-4 text-center shrink-0 ${isCurrent ? 'text-indigo-600' : 'text-slate-300'}`}>{idx+1}</span>
                    <div className={`truncate font-bold text-xs ${isCurrent ? 'text-indigo-900' : 'text-slate-600'}`}>{p.chinese}</div>
                  </div>
                  <div className="px-1.5 py-0.5 rounded-md text-[9px] font-black text-white shrink-0 ml-2 shadow-sm" style={{backgroundColor: getScoreBadgeColor(p.score)}}>{getPhraseLabel(p.score)}</div>
                </div>
              )
            })}

            {deck.coolingPool && deck.coolingPool.length > 0 && (
              <>
                <div className="relative py-6">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-sky-100"></div></div>
                  <div className="relative flex justify-center"><span className="bg-white px-4 text-[9px] font-black text-sky-400 uppercase tracking-widest flex items-center gap-2"><ThermometerSnowflake size={14}/> Cooling Pool</span></div>
                </div>
                {/* 核心：按 wait 升序排列 */}
                {[...(deck.coolingPool)].sort((a,b) => a.wait - b.wait).map((c) => {
                  const p = deck.phrases.find(item => item.id === c.id);
                  if (!p) return null;
                  return (
                    <div key={c.id} className="flex items-center justify-between text-sm py-2 px-3 rounded-xl opacity-70 grayscale-[0.3]">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="font-black text-[10px] w-8 text-center shrink-0 text-sky-500 bg-sky-50 py-1 rounded-md border border-sky-100">{c.wait}</span>
                        <div className="truncate font-bold text-xs text-slate-500">{p.chinese}</div>
                      </div>
                      <div className="px-1.5 py-0.5 rounded-md text-[9px] font-black text-white shrink-0 ml-2 opacity-50 shadow-sm" style={{backgroundColor: getScoreBadgeColor(p.score)}}>{getPhraseLabel(p.score)}</div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* 左侧抽屉保持一致 */}
        <div className={`absolute top-0 left-0 h-full w-[320px] bg-white border-r border-slate-100 shadow-2xl transition-transform duration-300 z-[70] flex flex-col ${showStats ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="p-5 flex justify-between items-center bg-slate-50 border-b border-slate-100 shrink-0">
            <h3 className="font-black text-slate-800 text-sm flex items-center gap-2"><BarChart2 className="w-4 h-4 text-indigo-500"/> 状态大盘 (Stats)</h3>
            <button onClick={()=>setShowStats(false)} className="p-1 hover:bg-slate-200 rounded-full transition-colors"><X className="w-4 h-4 text-slate-500"/></button>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
            <div><h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Mastery Trend</h4>{renderTrendChart(masteryTrend, 140)}</div>
          </div>
        </div>

      </div>
    </div>
  );
};
