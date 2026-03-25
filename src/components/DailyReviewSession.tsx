// src/components/DailyReviewSession.tsx (Part 1)

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Deck, Phrase } from '../types';
import { Button } from './Button';
import { 
  ArrowLeft, Settings2, RefreshCw, Eye, ArrowRight, Clock, AlertCircle, 
  Trophy, XCircle, ListOrdered, BarChart2, X, StickyNote, CheckCircle2 
} from 'lucide-react';
import { 
  calculateNextState, calculateBack, calculateWatchBack, 
  mapSliderToBack, mapBackToSlider, getNScore, EPS, calculateMastery,
  getProficiencyLabel, getScoreBadgeColor, getPhraseLabel, getDynamicColor
} from '../utils/algo';

interface DailyReviewSessionProps {
  selectedDecks: Deck[];
  onUpdateDecks: (updatedDecks: Deck[]) => void;
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

interface DailyQueueItem {
  deckId: string;
  phraseId: string;
}

const renderFormattedText = (text?: string) => {
  if (!text) return null;
  const parts = text.split(/\[(.*?)\]/g);
  return (
    <span className="overflow-wrap-anywhere break-words hyphens-none">
      {parts.map((part, i) => (
        i % 2 === 1 ? (
          <span key={i} className="text-orange-700 font-bold mx-0.5 border-b-2 border-orange-400">{part}</span>
        ) : (
          <span key={i}>{part.replace(/\\n/g, '\n')}</span>
        )
      ))}
    </span>
  );
};

const formatFullTime = (seconds: number) => { 
  if (seconds <= 0) return '0s'; 
  const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = seconds % 60; 
  if (h > 0) return `${h}h${m}m${s}s`; if (m > 0) return `${m}m${s}s`; return `${s}s`; 
};

function formatHeaderTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

const cleanNote = (text?: string) => text ? text.replace(/\n\s*\n/g, '\n').trim() : "";

export const DailyReviewSession: React.FC<DailyReviewSessionProps> = ({ 
  selectedDecks, onUpdateDecks, onExit, onTimeUpdate, onSessionComplete 
}) => {
  // === 1. 初始化与队列 ===
  const [workingDecks, setWorkingDecks] = useState<Deck[]>(selectedDecks);
  const [dailyQueue, setDailyQueue] = useState<DailyQueueItem[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const [totalPending, setTotalPending] = useState(0);

  useEffect(() => {
    if (isInitialized) return;
    const initialQueue: DailyQueueItem[] = [];
    workingDecks.forEach(deck => {
      deck.phrases.forEach(p => {
        if (p.score !== undefined && (p.back || 0) <= 0) {
          initialQueue.push({ deckId: deck.id, phraseId: p.id });
        }
      });
    });
    for (let i = initialQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [initialQueue[i], initialQueue[j]] = [initialQueue[j], initialQueue[i]];
    }
    setDailyQueue(initialQueue);
    setTotalPending(initialQueue.length);
    setIsInitialized(true);
  }, [workingDecks, isInitialized]);

  // === 2. 状态管理 ===
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
  const [showQueue, setShowQueue] = useState(false);
  const [showStats, setShowStats] = useState(false);
  
  const [sessionDuration, setSessionDuration] = useState(0);
  const [timeLeft, setTimeLeft] = useState<number>(algoSettings.timeLimit);
  const [isTimeout, setIsTimeout] = useState(false);

  const [prof, setProf] = useState<number | null>(null);
  const [diff, setDiff] = useState<number>(2.5);
  const [customBack, setCustomBack] = useState<number | null>(null);
  const [computedBack, setComputedBack] = useState<number>(1);
  const [computedScore, setComputedScore] = useState<number>(0);
  const [isAntiTouchActive, setIsAntiTouchActive] = useState(false);

  const [stats, setStats] = useState({ count0_1: 0, count2_3: 0, count4_5: 0 });
  const [cultivationGain, setCultivationGain] = useState<number>(0);
  const [sessionResults, setSessionResults] = useState<{phrase: Phrase, prof: number | 'watch', isCleared: boolean}[]>([]);

  const timerRef = useRef<number | null>(null);
  const questionTimerRef = useRef<number | null>(null);

  const activeItem = dailyQueue.length > 0 ? dailyQueue[0] : null;
  const activeDeck = useMemo(() => workingDecks.find(d => d.id === activeItem?.deckId), [workingDecks, activeItem]);
  const currentPhrase = useMemo(() => activeDeck?.phrases.find(p => p.id === activeItem?.phraseId), [activeDeck, activeItem]);

  useEffect(() => { localStorage.setItem(ALGO_SETTINGS_KEY, JSON.stringify(algoSettings)); }, [algoSettings]);

  useEffect(() => {
    if (isFinished || !isInitialized || phase === 'REPORT') return;
    timerRef.current = window.setInterval(() => {
      onTimeUpdate(1);
      setSessionDuration(prev => prev + 1);
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [onTimeUpdate, isFinished, isInitialized, phase]);

  useEffect(() => {
    if (phase === 'QUESTION' && algoSettings.timeLimit > 0 && !isFinished && isInitialized && activeItem) {
      setTimeLeft(algoSettings.timeLimit);
      setIsTimeout(false);
      questionTimerRef.current = window.setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 0.1) {
            if (questionTimerRef.current) clearInterval(questionTimerRef.current);
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
  }, [phase, algoSettings.timeLimit, isFinished, isInitialized, activeItem]);

  const watchBackValue = useMemo(() => {
    if (!currentPhrase) return 1;
    const C = ALGO_TIERS[algoSettings.tierIdx].C;
    const base = ALGO_TIERS[algoSettings.tierIdx].base;
    const nscore = getNScore(currentPhrase.score ?? 0, diff);
    return calculateWatchBack(nscore, C, base);
  }, [currentPhrase, diff, algoSettings]);

  useEffect(() => {
    if (phase === 'ANSWER' && currentPhrase && prof !== null) {
      const todayDays = Math.floor(Date.now() / 86400000);
      const C = ALGO_TIERS[algoSettings.tierIdx].C;
      const base = ALGO_TIERS[algoSettings.tierIdx].base;
      const gap = (todayDays - (currentPhrase.date || todayDays)) + 1;
      
      const { newScore, nscore } = calculateNextState(currentPhrase.score, prof, diff, gap, C, base, algoSettings.cap);
      setComputedScore(newScore);
      setComputedBack(calculateBack(nscore, C, base));
    }
  }, [phase, prof, diff, currentPhrase, algoSettings]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isFinished || !isInitialized || isAntiTouchActive || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (phase === 'QUESTION') {
        if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); handleShowAnswer(); }
      } else if (phase === 'ANSWER') {
        if (e.code === 'Space' || e.key === 'Enter') {
          e.preventDefault(); if (prof !== null) handleFinishCard(false);
        } else {
          const keyNum = parseInt(e.key);
          if (!isNaN(keyNum) && keyNum >= 0 && keyNum <= 5) {
            e.preventDefault(); if (isTimeout && keyNum >= 4) return;
            setProf(keyNum);
          } else if (e.code === 'KeyW') { e.preventDefault(); handleFinishCard(true); }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phase, isFinished, isInitialized, prof, isTimeout, isAntiTouchActive]);

  const handleShowAnswer = useCallback(() => {
    if (questionTimerRef.current) clearInterval(questionTimerRef.current);
    if (currentPhrase) setDiff(currentPhrase.diff ?? 2.5);
    setPhase('ANSWER');
  }, [currentPhrase]);

  const handleFinishCard = useCallback((isWatch: boolean) => {
    if (!currentPhrase || !activeDeck || !activeItem || isAntiTouchActive) return;
    setIsAntiTouchActive(true);
    setTimeout(() => setIsAntiTouchActive(false), 300);

    const todayDays = Math.floor(Date.now() / 86400000);
    const gap = (todayDays - (currentPhrase.date || todayDays)) + 1;
    const C = ALGO_TIERS[algoSettings.tierIdx].C;
    const base = ALGO_TIERS[algoSettings.tierIdx].base;

    let finalBack = 1;
    let newScore = currentPhrase.score;

    if (isWatch) {
      finalBack = customBack ?? watchBackValue;
    } else {
      if (prof === null) { setIsAntiTouchActive(false); return; }
      const res = calculateNextState(currentPhrase.score, prof, diff, gap, C, base, algoSettings.cap);
      newScore = res.newScore;
      finalBack = customBack !== null ? customBack : calculateBack(res.nscore, C, base);

      setStats(prev => ({
        count0_1: prev.count0_1 + (prof <= 1 ? 1 : 0),
        count2_3: prev.count2_3 + (prof >= 2 && prof <= 3 ? 1 : 0),
        count4_5: prev.count4_5 + (prof >= 4 ? 1 : 0),
      }));
      const gainMap = [-1.0, -0.6, -0.2, 0.2, 0.6, 1.0];
      setCultivationGain(prev => prev + gainMap[prof]);
    }

    const updatedPhrase: Phrase = {
      ...currentPhrase,
      score: isWatch ? currentPhrase.score : newScore,
      diff: diff,
      date: todayDays,
      back: finalBack,
      totalReviews: currentPhrase.totalReviews + 1,
      mastery: calculateMastery(getNScore(isWatch ? (currentPhrase.score ?? 0) : newScore!, diff)),
      lastReviewedAt: Date.now()
    };

    const updatedWorkingDecks = workingDecks.map(d => {
      if (d.id === activeDeck.id) {
        return { ...d, phrases: d.phrases.map(p => p.id === updatedPhrase.id ? updatedPhrase : p) };
      }
      return d;
    });
    setWorkingDecks(updatedWorkingDecks);
    onUpdateDecks(updatedWorkingDecks); 

    let newDailyQueue = [...dailyQueue];
    newDailyQueue.shift(); 

    const isCleared = finalBack > algoSettings.cap;
    if (!isCleared) {
      const insertIdx = Math.min(finalBack, newDailyQueue.length);
      newDailyQueue.splice(insertIdx, 0, activeItem);
    } 
    
    setSessionResults(prev => {
      const existingIdx = prev.findIndex(r => r.phrase.id === updatedPhrase.id);
      const newItem = { phrase: updatedPhrase, prof: isWatch ? 'watch' as const : prof!, isCleared };
      if (existingIdx >= 0) { const next = [...prev]; next[existingIdx] = newItem; return next; }
      return [...prev, newItem];
    });
    setDailyQueue(newDailyQueue);

    if (newDailyQueue.length === 0) {
      setIsFinished(true);
      setPhase('REPORT');
    } else {
      setPhase('QUESTION');
      setIsTimeout(false);
      setTimeLeft(algoSettings.timeLimit);
      setProf(null);
      setCustomBack(null);
    }
  },[currentPhrase, activeDeck, activeItem, isAntiTouchActive, algoSettings, diff, customBack, prof, dailyQueue, workingDecks, onUpdateDecks, watchBackValue, computedBack, computedScore]);

  const handleRequestExit = () => { setIsFinished(true); setPhase('REPORT'); };
  const handleFinalExit = () => { if (onSessionComplete) onSessionComplete(sessionDuration, stats, cultivationGain); onExit(); };

  // ========== UI 渲染逻辑 ==========

  if (!isInitialized) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white z-[200]">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-10 h-10 text-rose-500 animate-spin" />
          <div className="text-xl font-black text-slate-400 tracking-widest">正在萃取待复习词条...</div>
        </div>
      </div>
    );
  }

  if (phase === 'REPORT') {
    const clearedCount = totalPending - dailyQueue.length;
    const progressPercent = (clearedCount / totalPending) * 100;

    return (
      <div className="fixed inset-0 bg-slate-50 z-[200] flex flex-col items-center p-3 sm:p-6 overflow-y-auto custom-scrollbar animate-in fade-in zoom-in-95 duration-300">
        <div className="max-w-2xl w-full bg-white rounded-3xl shadow-2xl p-5 sm:p-8 flex flex-col space-y-4 my-2 sm:my-auto border border-slate-100">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-rose-100 rounded-full text-rose-500 shadow-sm"><Trophy size={20} /></div>
              <div><h2 className="text-lg font-black text-slate-800 leading-tight">每日大盘结算</h2><span className="text-[10px] text-slate-400 font-bold tracking-widest uppercase">Daily Review Summary</span></div>
            </div>
            <span className="text-xs font-mono font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded-md">{new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center flex flex-col justify-center">
              <div className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-1">通关进度</div>
              <div className="text-3xl font-black text-slate-800">{clearedCount} <span className="text-xl text-slate-400">/ {totalPending}</span></div>
              <div className="w-full bg-slate-200 h-1.5 rounded-full mt-3 overflow-hidden">
                <div className="bg-rose-500 h-full transition-all duration-1000" style={{ width: `${progressPercent}%` }}></div>
              </div>
            </div>
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center flex flex-col justify-center">
              <div className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-1">本次累计修为</div>
              <div className={`text-3xl font-black ${cultivationGain >= 0 ? 'text-indigo-600' : 'text-rose-500'}`}>
                {cultivationGain > 0 ? '+' : ''}{cultivationGain.toFixed(1)}
              </div>
              <div className="text-[10px] font-bold text-slate-400 mt-2">基于本次所有交互打分</div>
            </div>
          </div>

          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
            <div className="flex justify-between items-center mb-3">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">打分分布 (含重刷次数)</span>
              <span className="text-[10px] font-bold text-slate-800">总计 {stats.count0_1 + stats.count2_3 + stats.count4_5} 次交互</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-100 text-center">
                <div className="text-xl font-black text-emerald-600">{stats.count4_5}</div>
                <div className="text-[10px] font-bold text-emerald-700/60 uppercase">优秀</div>
              </div>
              <div className="bg-amber-50 p-3 rounded-xl border border-amber-100 text-center">
                <div className="text-xl font-black text-amber-600">{stats.count2_3}</div>
                <div className="text-[10px] font-bold text-amber-700/60 uppercase">一般</div>
              </div>
              <div className="bg-rose-50 p-3 rounded-xl border border-rose-100 text-center">
                <div className="text-xl font-black text-rose-600">{stats.count0_1}</div>
                <div className="text-[10px] font-bold text-rose-700/60 uppercase">困难</div>
              </div>
            </div>
          </div>

          {sessionResults.length > 0 && (
            <div className="border-t border-slate-100 pt-4">
               <h3 className="text-xs font-black text-slate-800 mb-3 flex items-center gap-2"><ListOrdered size={14} className="text-rose-500"/> 详细复盘记录</h3>
               <div className="max-h-56 overflow-y-auto space-y-1.5 custom-scrollbar pr-1">
                  {sessionResults.slice().sort((a,b) => {
                      const scoreA = a.prof === 'watch' ? 2.5 : a.prof;
                      const scoreB = b.prof === 'watch' ? 2.5 : b.prof;
                      return scoreA - scoreB;
                  }).map((res, i) => (
                    <div key={i} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="flex flex-col min-w-0 pr-3">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-bold text-sm text-slate-700 truncate">{res.phrase.chinese}</span>
                          {res.isCleared ? 
                            <span className="text-[9px] font-black bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded border border-emerald-200 shrink-0">已通关</span> : 
                            <span className="text-[9px] font-black bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded border border-rose-200 shrink-0">队中重现</span>
                          }
                        </div>
                        <span className="text-[10px] font-medium text-slate-400 truncate">{res.phrase.english}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-slate-400">Score: {(res.phrase.score ?? 0).toFixed(2)}</span>
                        <div className={`px-2.5 py-1 rounded-lg text-[11px] font-black shadow-sm ${res.prof === 'watch' ? 'bg-slate-200 text-slate-600' : res.prof >= 4 ? 'bg-emerald-100 text-emerald-700' : res.prof >= 2 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>
                          {res.prof === 'watch' ? '观望' : `${res.prof} 分`}
                        </div>
                      </div>
                    </div>
                  ))}
               </div>
            </div>
          )}

          <Button fullWidth onClick={handleFinalExit} className="py-4 text-base font-black rounded-2xl shadow-xl mt-2 bg-slate-900 text-white hover:bg-slate-800 transition-all">
            保存并返回主页
          </Button>
        </div>
      </div>
    );
  }

  // 正常复习状态
  if (!currentPhrase || !activeDeck) return null;

  const isEnToCn_Mode = activeDeck.studyMode === 'EN_CN';
  const questionText = isEnToCn_Mode ? currentPhrase.english : currentPhrase.chinese;
  const answerText = isEnToCn_Mode ? currentPhrase.chinese : currentPhrase.english;

  const progressPercent = Math.min(100, Math.max(0, ((totalPending - dailyQueue.length) / totalPending) * 100));
  const isNew = currentPhrase.score === undefined || currentPhrase.score === 0;
  const profLabelsNew =["完全没思路", "思路大体对", "缺东西", "差一点", "正确但不确定", "正确"];
  const profLabelsOld =["完全没印象", "印象不清楚", "缺东西", "差一点", "勉强想出", "快速想出"];
  const currentLabels = isNew ? profLabelsNew : profLabelsOld;
  const currentBackDisplay = customBack ?? (prof !== null ? computedBack : watchBackValue);
  const isClearedDisplay = currentBackDisplay > algoSettings.cap;

  return (
    <div className="fixed inset-0 bg-slate-50 z-[150] flex flex-col h-full overflow-hidden">
      
      {/* 顶栏 */}
      <div className="bg-white shadow-sm shrink-0 relative z-[60]">
        <div className="flex items-center justify-between px-2 py-2">
          <button onClick={handleRequestExit} className="p-2 text-slate-400 hover:text-rose-500 transition-all active:scale-90"><ArrowLeft size={20}/></button>
          <div className="flex-1 flex flex-col justify-center px-3 max-w-[65%]">
              <div className="flex justify-between items-center w-full mb-1.5">
                <span className="text-xs text-slate-500 font-bold truncate pr-2">每日大盘 · {activeDeck.name}</span>
                <span className="text-[10px] font-mono font-bold text-slate-400">{formatHeaderTime(sessionDuration)}</span>
              </div>
              <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden relative">
                <div className="absolute top-0 left-0 h-full bg-rose-400 transition-all duration-700 ease-out" style={{ width: `${progressPercent}%` }}></div>
              </div>
              <div className="flex justify-between items-center w-full mt-1.5 leading-none">
                <span className="text-[10px] font-black text-rose-500">{progressPercent.toFixed(1)}%</span>
                <span className="text-[9px] font-bold text-slate-400">剩余 {dailyQueue.length} 词</span>
              </div>
          </div>
          <div className="flex gap-0.5 shrink-0 items-center">
            <button onClick={() => setShowAlgoMenu(!showAlgoMenu)} className={`p-1.5 rounded-lg transition-colors ${showAlgoMenu ? 'text-rose-600 bg-rose-50' : 'text-slate-300 hover:text-slate-500'}`}><Settings2 size={18}/></button>
            <button onClick={()=>setShowStats(!showStats)} className={`p-1.5 rounded-lg transition-colors ${showStats ? 'text-rose-600 bg-rose-50' : 'text-slate-300 hover:text-slate-500'}`}><BarChart2 size={18}/></button>
            <button onClick={()=>setShowQueue(!showQueue)} className={`p-1.5 rounded-lg transition-colors relative ${showQueue ? 'text-rose-600 bg-rose-50' : 'text-slate-300 hover:text-slate-500'}`}><ListOrdered size={18}/></button>
          </div>
        </div>
        {showAlgoMenu && (
          <div className="absolute top-full right-2 mt-2 w-72 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden z-[200] animate-in fade-in zoom-in-95">
            <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Algorithm Settings</span>
              <button onClick={()=>setShowAlgoMenu(false)}><X size={14} className="text-slate-400"/></button>
            </div>
            <div className="p-4 border-b border-slate-100 max-h-[60vh] overflow-y-auto custom-scrollbar">
              <label className="text-xs font-bold text-slate-600 block mb-2">学习节奏 (C & base)</label>
              <div className="space-y-1 mb-4">
                {ALGO_TIERS.map((tier, idx) => (
                  <button key={idx} onClick={() => setAlgoSettings({ ...algoSettings, tierIdx: idx })} className={`w-full text-left px-3 py-2 text-xs font-bold flex items-center justify-between rounded-lg transition-all ${algoSettings.tierIdx === idx ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' : 'text-slate-600 hover:bg-slate-50 border border-transparent'}`}>
                    <div>{tier.name} <span className="opacity-50 text-[9px] ml-1">C:{tier.C}, b:{tier.base}</span></div>
                    {algoSettings.tierIdx === idx && <div className="w-2 h-2 rounded-full bg-indigo-500"></div>}
                  </button>
                ))}
              </div>
              <label className="text-xs font-bold text-slate-600 block mb-2">Cap (每日复习通关门槛)</label>
              <input type="number" min="10" value={algoSettings.cap} onChange={(e) => setAlgoSettings({ ...algoSettings, cap: Math.max(10, parseInt(e.target.value) || 100) })} className="w-full p-2 border border-slate-200 rounded-lg text-sm font-black outline-none focus:border-indigo-500 mb-4" />
              <label className="text-xs font-bold text-slate-600 block mb-2">题目限时 (秒，0为不限)</label>
              <input type="number" min="0" value={algoSettings.timeLimit} onChange={(e) => setAlgoSettings({ ...algoSettings, timeLimit: Math.max(0, parseInt(e.target.value) || 0) })} className="w-full p-2 border border-slate-200 rounded-lg text-sm font-black outline-none focus:border-indigo-500" />
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 flex relative overflow-hidden">
        
        {/* 左侧抽屉：分布大盘 */}
        <div className={`absolute top-0 left-0 h-full w-[280px] bg-white border-r border-slate-100 shadow-xl transition-transform duration-300 z-[70] flex flex-col ${showStats ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="p-4 flex justify-between items-center bg-slate-50 border-b shrink-0">
            <h3 className="font-black text-slate-800 text-sm flex items-center gap-2"><BarChart2 size={16} className="text-rose-500"/> 大盘统计</h3>
            <button onClick={()=>setShowStats(false)} className="p-1 hover:bg-slate-200 rounded-full transition-colors"><X size={18} className="text-slate-500"/></button>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-6">
            <div className="bg-rose-50 p-4 rounded-2xl border border-rose-100">
              <div className="text-[10px] font-black text-rose-400 uppercase tracking-widest mb-1">今日大盘通关率</div>
              <div className="text-3xl font-black text-rose-600">{progressPercent.toFixed(1)}%</div>
            </div>
            <div className="space-y-4">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">本次修为累计</h4>
              <div className="grid grid-cols-1 gap-2">
                 <div className="bg-indigo-50 p-3 rounded-xl border border-indigo-100 text-indigo-700 flex justify-between items-center">
                    <span className="text-[10px] font-bold uppercase">获得修为</span>
                    <span className="text-xl font-black">{cultivationGain.toFixed(1)}</span>
                 </div>
              </div>
            </div>
          </div>
        </div>

        {/* 右侧抽屉：队列 */}
        <div className={`absolute top-0 right-0 h-full w-[280px] bg-white border-l border-slate-100 shadow-xl transition-transform duration-300 z-[70] flex flex-col ${showQueue ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="p-4 flex justify-between items-center bg-slate-50 border-b shrink-0">
            <h3 className="font-black text-slate-800 text-sm flex items-center gap-2"><ListOrdered size={16} className="text-rose-500"/> 待通关列表</h3>
            <button onClick={()=>setShowQueue(false)} className="p-1 hover:bg-slate-200 rounded-full transition-colors"><X size={18} className="text-slate-500"/></button>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1">
            {dailyQueue.map((item, idx) => {
              const p = workingDecks.find(d => d.id === item.deckId)?.phrases.find(ph => ph.id === item.phraseId);
              if (!p) return null;
              const isCurrent = item.phraseId === activeItem?.phraseId;
              const label = getPhraseLabel(p.score);
              return (
                <div key={`${item.deckId}-${item.phraseId}-${idx}`} className={`flex items-center justify-between text-xs py-2 px-3 rounded-xl border transition-all ${isCurrent ? 'bg-rose-50 border-rose-200 shadow-sm scale-[1.02] z-10' : 'bg-white border-transparent hover:bg-slate-50'}`}>
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className={`font-black text-[10px] w-4 text-center shrink-0 ${isCurrent ? 'text-rose-600' : 'text-slate-300'}`}>{idx+1}</span>
                    <div className={`truncate font-bold ${isCurrent ? 'text-rose-900' : 'text-slate-600'}`}>{p.chinese}</div>
                  </div>
                  <div className="px-1.5 py-0.5 rounded-md text-[9px] font-black text-white shrink-0 ml-2 shadow-sm" style={{backgroundColor: getScoreBadgeColor(p.score)}}>{label}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 中心主体 */}
        <div className={`flex-1 flex flex-col items-center p-2 sm:p-4 transition-all duration-300 ${showQueue ? 'lg:pr-[280px]' : ''} ${showStats ? 'lg:pl-[280px]' : ''}`}>
          <div className="w-full max-w-xl bg-white rounded-3xl shadow-xl border border-slate-100 flex flex-col h-full max-h-[85vh] overflow-hidden relative">
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6 flex flex-col items-center w-full relative">
                <div className="w-full flex flex-col items-center text-center pt-6 mb-4">
                  {phase === 'ANSWER' && (
                    <div className="flex items-center gap-1.5 mb-2 bg-slate-50 border border-slate-100 px-2.5 py-0.5 rounded-full animate-in fade-in zoom-in-95 shadow-sm">
                      <span className="text-[8px] font-black text-slate-300 uppercase">Score:</span>
                      <span className="text-[10px] font-black text-slate-600">{(currentPhrase.score ?? 0).toFixed(2)}</span>
                    </div>
                  )}
                  <h1 className="text-3xl sm:text-4xl font-black text-slate-800 leading-snug break-words max-w-full">{renderFormattedText(questionText)}</h1>
                  {phase === 'QUESTION' && algoSettings.timeLimit > 0 && (
                    <div className="mt-8 flex flex-col items-center animate-in fade-in">
                      <div className={`text-[10px] font-black tabular-nums mb-1.5 ${isTimeout ? 'text-rose-500' : 'text-slate-400'}`}>{isTimeout ? '已超过限时' : `${timeLeft.toFixed(1)}s`}</div>
                      <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden shadow-inner"><div className={`h-full transition-all duration-100 ease-linear ${isTimeout ? 'bg-rose-500' : 'bg-rose-400'}`} style={{ width: `${isTimeout ? 100 : (timeLeft / algoSettings.timeLimit) * 100}%` }} /></div>
                    </div>
                  )}
                </div>

                {phase === 'ANSWER' && (
                  <div className="w-full flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-300 pb-2 mt-auto">
                    {currentPhrase.note && (
                      <div className="w-full bg-amber-50/50 p-4 rounded-xl border border-amber-100 text-left relative mb-5 shadow-sm"><div className="absolute top-4 left-4"><StickyNote size={16} className="text-amber-400" /></div><div className="pl-7 text-sm font-bold text-slate-600 whitespace-pre-wrap leading-normal">{renderFormattedText(cleanNote(currentPhrase.note))}</div></div>
                    )}
                    <div className="text-center py-2 px-4 rounded-xl w-full mb-6"><p className="text-3xl font-black text-rose-600 leading-tight break-words">{renderFormattedText(answerText)}</p></div>
                    <div className="w-full mt-auto space-y-4">
                      <div className="flex items-center gap-3 mb-2 pl-1">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest shrink-0">难度 {diff}</span>
                        <div className="flex gap-1 flex-1">
                          {[0, 1, 2, 3, 4, 5].map(v => (<button key={v} onClick={() => setDiff(v)} className={`flex-1 py-1 rounded-lg font-black text-[10px] transition-all border-2 ${diff === v ? 'bg-rose-500 border-rose-500 text-white shadow-md transform scale-105' : 'bg-white border-slate-200 text-slate-400'}`}>{v}</button>))}
                        </div>
                      </div>
                      <div>
                         <div className="grid grid-cols-6 gap-1 sm:gap-2">
                            {[0, 1, 2, 3, 4, 5].map(v => {
                              const disabled = isTimeout && v >= 4;
                              return (
                                <button key={v} disabled={disabled} onClick={() => setProf(v)} 
                                  className={`flex flex-col items-center justify-center p-2 sm:p-2.5 rounded-xl border-2 transition-all group ${disabled ? 'opacity-20 grayscale bg-slate-50 border-slate-100' : prof === v ? 'bg-rose-50 border-rose-500 scale-105 z-10 shadow-md' : 'bg-white border-slate-100 hover:border-rose-300'}`}>
                                  <span className={`text-sm sm:text-base font-black ${prof === v ? 'text-rose-600' : 'text-slate-400'}`}>{v}</span>
                                  <span className={`text-[8px] font-bold mt-1 leading-tight text-center w-full whitespace-normal break-words ${prof === v ? 'text-rose-700' : 'text-slate-500'}`} style={{ letterSpacing: '-0.5px' }}>{currentLabels[v]}</span>
                                </button>
                              );
                            })}
                         </div>
                      </div>
                      <div className="bg-rose-50/50 p-4 rounded-xl border border-rose-100 shadow-sm animate-in slide-in-from-bottom-2 mt-2 w-full">
                        <div className="flex justify-between items-start mb-3">
                            <div className="flex flex-col">
                              <span className="text-[10px] font-black text-rose-900 uppercase tracking-widest flex items-center gap-1.5"><Settings2 size={12}/> 预期后推 (BACK)</span>
                              <div className="text-[11px] font-bold mt-1.5 flex items-center gap-1.5">
                                <span className="text-slate-500">Score 预测:</span>
                                <span className="text-slate-400">{(currentPhrase.score ?? 0).toFixed(2)}</span><ArrowRight size={10} className="text-slate-300"/><span className={`font-black ${prof !== null ? (computedScore >= (currentPhrase.score ?? 0) ? 'text-emerald-600' : 'text-rose-500') : 'text-rose-400'}`}>{(prof !== null ? computedScore : (currentPhrase.score ?? 0)).toFixed(2)}</span>
                              </div>
                            </div>
                            <div className="flex flex-col items-end">
                                <div className="flex items-center gap-2">
                                  {customBack !== null && (<button onClick={() => setCustomBack(null)} className="p-1.5 text-slate-400 hover:text-rose-500 bg-white rounded-md transition-colors border" title="恢复"><RefreshCw size={14}/></button>)}
                                  <input type="number" min="1" value={currentBackDisplay} onChange={e => setCustomBack(Math.max(1, parseInt(e.target.value) || 1))} className={`w-20 bg-white border-2 rounded-lg p-1.5 text-center font-mono font-black text-base outline-none transition-all shadow-sm ${isClearedDisplay ? 'border-emerald-300 text-emerald-600 focus:ring-2 ring-emerald-100' : 'border-rose-200 text-rose-600 focus:ring-2 ring-rose-100'}`} />
                                </div>
                            </div>
                        </div>
                        <input type="range" min="0" max="1000" step="1" value={mapBackToSlider(currentBackDisplay)} onChange={e => setCustomBack(mapSliderToBack(parseInt(e.target.value)))} className={`w-full h-1.5 mt-2 rounded-lg appearance-none cursor-pointer ${isClearedDisplay ? 'bg-emerald-200 accent-emerald-500' : 'bg-rose-200 accent-rose-600'}`} />
                        <div className="flex justify-between text-[8px] font-black text-slate-400 mt-2 tracking-widest uppercase">
                          {isClearedDisplay ? (
                             <span className="text-emerald-500 font-bold flex items-center gap-1 w-full justify-center"><CheckCircle2 size={10}/> 达成通关条件！( &gt; {algoSettings.cap} )</span>
                          ) : (
                             <><span>NEAR</span><span className="text-rose-500 font-bold flex items-center gap-1 animate-pulse"><RefreshCw size={10}/> 将在队列中重现 (+{currentBackDisplay}步)</span><span>FAR</span></>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {isAntiTouchActive && <div className="absolute inset-0 z-20 cursor-not-allowed"></div>}
            </div>
            <div className="p-3 sm:p-5 bg-white border-t border-slate-100 shrink-0">
              {phase === 'QUESTION' ? (
                <Button fullWidth onClick={handleShowAnswer} className="py-4 text-lg font-black shadow-lg bg-rose-600 border-0 text-white hover:bg-rose-700 transition-all active:scale-95">查看答案</Button>
              ) : (
                <div className="flex gap-2.5">
                  <button onClick={() => handleFinishCard(true)} className="flex-1 flex items-center justify-center gap-1.5 py-4 bg-slate-100 text-slate-600 rounded-xl font-black text-xs border-0 shadow-sm active:scale-95 transition-all"><Eye size={18}/> 观望 (W)</button>
                  <Button disabled={prof === null || isAntiTouchActive} fullWidth onClick={() => handleFinishCard(false)} className={`flex-[2.5] py-4 text-lg font-black shadow-lg transition-all ${prof === null ? 'bg-slate-200 text-slate-400' : 'bg-rose-600 text-white shadow-rose-200/50'}`}>确认继续 (Enter) <ArrowRight size={20} className="ml-2" /></Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
