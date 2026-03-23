// src/components/DailyReviewSession.tsx (Part 1)

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Deck, Phrase } from '../types';
import { Button } from './Button';
import { 
  ArrowLeft, Settings2, RefreshCw, Eye, ArrowRight, Clock, AlertCircle, 
  Trophy, XCircle, ListOrdered, BarChart2, X 
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
  const h = Math.floor(seconds / 3600); 
  const m = Math.floor((seconds % 3600) / 60); 
  const s = seconds % 60; 
  if (h > 0) return `${h}h${m}m${s}s`; 
  if (m > 0) return `${m}m${s}s`; 
  return `${s}s`; 
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
  // === 1. 跨词本工作区与队列初始化 ===
  const [workingDecks, setWorkingDecks] = useState<Deck[]>(selectedDecks);
  const [dailyQueue, setDailyQueue] = useState<DailyQueueItem[]>([]);
  const[isInitialized, setIsInitialized] = useState(false);
  const [totalPending, setTotalPending] = useState(0);

  useEffect(() => {
    if (isInitialized) return;
    const initialQueue: DailyQueueItem[] =[];
    workingDecks.forEach(deck => {
      deck.phrases.forEach(p => {
        if (p.score !== undefined && (p.back || 0) <= 0) {
          initialQueue.push({ deckId: deck.id, phraseId: p.id });
        }
      });
    });
    // 全局打乱
    for (let i = initialQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [initialQueue[i], initialQueue[j]] =[initialQueue[j], initialQueue[i]];
    }
    setDailyQueue(initialQueue);
    setTotalPending(initialQueue.length);
    setIsInitialized(true);
  },[workingDecks, isInitialized]);

  // === 2. 状态管理 ===
  const [phase, setPhase] = useState<'QUESTION' | 'ANSWER' | 'REPORT'>('QUESTION');
  const[isFinished, setIsFinished] = useState(false);
  
  const [algoSettings, setAlgoSettings] = useState(() => {
    try {
      const saved = localStorage.getItem(ALGO_SETTINGS_KEY);
      return saved ? JSON.parse(saved) : { tierIdx: 2, cap: 100, timeLimit: 10 };
    } catch {
      return { tierIdx: 2, cap: 100, timeLimit: 10 };
    }
  });

  const[showAlgoMenu, setShowAlgoMenu] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showStats, setShowStats] = useState(false);
  
  // 倒计时与时间
  const [sessionDuration, setSessionDuration] = useState(0);
  const[timeLeft, setTimeLeft] = useState<number>(algoSettings.timeLimit);
  const [isTimeout, setIsTimeout] = useState(false);

  // 打分机制
  const [prof, setProf] = useState<number | null>(null);
  const [diff, setDiff] = useState<number>(2.5);
  const [customBack, setCustomBack] = useState<number | null>(null);
  const[computedBack, setComputedBack] = useState<number>(1);
  const [computedScore, setComputedScore] = useState<number>(0);
  const [isAntiTouchActive, setIsAntiTouchActive] = useState(false);

  // 统计、修为与复盘记录
  const [stats, setStats] = useState({ count0_1: 0, count2_3: 0, count4_5: 0 });
  const[cultivationGain, setCultivationGain] = useState<number>(0);
  const [sessionResults, setSessionResults] = useState<{phrase: Phrase, prof: number | 'watch', isCleared: boolean}[]>([]);

  const timerRef = useRef<number | null>(null);
  const questionTimerRef = useRef<number | null>(null);

  const activeItem = dailyQueue.length > 0 ? dailyQueue[0] : null;
  const activeDeck = useMemo(() => workingDecks.find(d => d.id === activeItem?.deckId), [workingDecks, activeItem]);
  const currentPhrase = useMemo(() => activeDeck?.phrases.find(p => p.id === activeItem?.phraseId),[activeDeck, activeItem]);

  useEffect(() => {
    localStorage.setItem(ALGO_SETTINGS_KEY, JSON.stringify(algoSettings));
  }, [algoSettings]);

  // --- 全局倒计时 ---
  useEffect(() => {
    if (isFinished || !isInitialized || phase === 'REPORT') return;
    timerRef.current = window.setInterval(() => {
      onTimeUpdate(1);
      setSessionDuration(prev => prev + 1);
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [onTimeUpdate, isFinished, isInitialized, phase]);

  // --- 题目倒计时 ---
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
  },[phase, algoSettings.timeLimit, isFinished, isInitialized, activeItem]);

  // --- 动态计算观望的后推值 ---
  const watchBackValue = useMemo(() => {
    if (!currentPhrase) return 1;
    const C = ALGO_TIERS[algoSettings.tierIdx].C;
    const base = ALGO_TIERS[algoSettings.tierIdx].base;
    const nscore = getNScore(currentPhrase.score ?? 0, diff);
    return calculateWatchBack(nscore, C, base);
  }, [currentPhrase, diff, algoSettings]);

  // --- 实时计算预期后推值 ---
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
  },[phase, prof, diff, currentPhrase, algoSettings]);

  // --- 快捷键监听 ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isFinished || !isInitialized || isAntiTouchActive || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (phase === 'QUESTION') {
        if (e.code === 'Space' || e.key === 'Enter') {
          e.preventDefault();
          handleShowAnswer();
        }
      } else if (phase === 'ANSWER') {
        if (e.code === 'Space' || e.key === 'Enter') {
          e.preventDefault();
          if (prof !== null) handleFinishCard(false);
        } else {
          const keyNum = parseInt(e.key);
          if (!isNaN(keyNum) && keyNum >= 0 && keyNum <= 5) {
            e.preventDefault();
            if (isTimeout && keyNum >= 4) return; // 超时禁用4,5
            setProf(keyNum);
          } else if (e.code === 'KeyW') {
            e.preventDefault();
            handleFinishCard(true);
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  },[phase, isFinished, isInitialized, prof, isTimeout, isAntiTouchActive]);

  const handleShowAnswer = useCallback(() => {
    if (questionTimerRef.current) clearInterval(questionTimerRef.current);
    if (currentPhrase) setDiff(currentPhrase.diff ?? 2.5);
    setPhase('ANSWER');
  },[currentPhrase]);

  // === 3. 核心：完成卡片打分与每日循环队列管理 ===
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
      if (prof === null) {
        setIsAntiTouchActive(false);
        return;
      }
      const res = calculateNextState(currentPhrase.score, prof, diff, gap, C, base, algoSettings.cap);
      newScore = res.newScore;
      finalBack = customBack !== null ? customBack : computedBack;

      setStats(prev => ({
        count0_1: prev.count0_1 + (prof <= 1 ? 1 : 0),
        count2_3: prev.count2_3 + (prof >= 2 && prof <= 3 ? 1 : 0),
        count4_5: prev.count4_5 + (prof >= 4 ? 1 : 0),
      }));

      // 累计修为
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

    // 跨库持久化：修改原 Deck 中的 Phrase（不改变其在原 deck.queue 的位置）
    const updatedWorkingDecks = workingDecks.map(d => {
      if (d.id === activeDeck.id) {
        return { ...d, phrases: d.phrases.map(p => p.id === updatedPhrase.id ? updatedPhrase : p) };
      }
      return d;
    });
    setWorkingDecks(updatedWorkingDecks);
    onUpdateDecks(updatedWorkingDecks); 

    // 本地每日队列管理
    let newDailyQueue = [...dailyQueue];
    newDailyQueue.shift(); // 移除当前

    const isCleared = finalBack > 100;
    if (!isCleared) {
      const insertIdx = Math.min(finalBack, newDailyQueue.length);
      newDailyQueue.splice(insertIdx, 0, activeItem);
    } 
    
    // 记录结果（用于报告）
    setSessionResults(prev =>[...prev, { phrase: updatedPhrase, prof: isWatch ? 'watch' : prof!, isCleared }]);

    setDailyQueue(newDailyQueue);

    if (newDailyQueue.length === 0) {
      // 队列空了，自动进入报告
      setIsFinished(true);
      setPhase('REPORT');
    } else {
      setPhase('QUESTION');
      setIsTimeout(false);
      setTimeLeft(algoSettings.timeLimit);
      setProf(null);
      setCustomBack(null);
    }
  },[currentPhrase, activeDeck, activeItem, isAntiTouchActive, algoSettings, diff, customBack, prof, dailyQueue, workingDecks, onUpdateDecks, watchBackValue, computedBack]);

  const handleRequestExit = () => {
    setIsFinished(true);
    setPhase('REPORT');
  };

  const handleFinalExit = () => {
    if (onSessionComplete) onSessionComplete(sessionDuration, stats, cultivationGain);
    onExit();
  };
// src/components/DailyReviewSession.tsx (Part 2)

  // ========== UI 渲染逻辑 ==========

  if (!isInitialized) return <div className="fixed inset-0 flex items-center justify-center bg-white"><div className="text-xl font-bold text-slate-400">正在生成乱序复习大纲...</div></div>;

  // 1. 专属的复盘报告页面
  if (phase === 'REPORT') {
    return (
      <div className="fixed inset-0 bg-slate-50 z-50 flex flex-col items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-300 overflow-y-auto custom-scrollbar">
        <div className="max-w-2xl w-full bg-white rounded-3xl shadow-2xl p-8 flex flex-col space-y-6 my-8">
          <div className="text-center">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4 text-emerald-600"><Trophy className="w-8 h-8" /></div>
            <h2 className="text-3xl font-black text-slate-800">每日复习报告</h2>
            <p className="text-slate-400 font-bold text-sm uppercase tracking-widest mt-1">Daily Review Concluded</p>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 text-center">
              <div className="text-xs text-slate-400 font-black uppercase tracking-widest mb-1">已清空/总欠债词条</div>
              <div className="text-3xl font-black text-slate-800">{(totalPending - dailyQueue.length)} <span className="text-xl text-slate-400">/ {totalPending}</span></div>
              <div className="text-xs font-bold text-slate-400 mt-2">进度: {Math.min(100, Math.max(0, ((totalPending - dailyQueue.length) / totalPending) * 100)).toFixed(1)}%</div>
            </div>
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 text-center flex flex-col justify-center">
              <div className="text-xs text-slate-400 font-black uppercase tracking-widest mb-1">本次获得总修为</div>
              <div className={`text-3xl font-black ${cultivationGain >= 0 ? 'text-indigo-600' : 'text-rose-500'}`}>
                {cultivationGain > 0 ? '+' : ''}{cultivationGain.toFixed(1)}
              </div>
              <div className="text-xs font-bold text-slate-400 mt-2">基于精确打分累计</div>
            </div>
          </div>

          <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 text-center mt-2">
            <div className="text-xs text-slate-400 font-black uppercase tracking-widest mb-1">总计交互次数 (包含错误重插)</div>
            <div className="text-xl font-black text-slate-800">{stats.count0_1 + stats.count2_3 + stats.count4_5} <span className="text-xs text-slate-400">次</span></div>
            <div className="text-xs font-bold mt-2 flex justify-center gap-2">
              <span className="text-emerald-500">{stats.count4_5} 优</span>
              <span className="text-slate-300">|</span>
              <span className="text-amber-500">{stats.count2_3} 中</span>
              <span className="text-slate-300">|</span>
              <span className="text-rose-500">{stats.count0_1} 差</span>
            </div>
          </div>

          {/* 错题/复盘回顾列表 */}
          {sessionResults.length > 0 && (
            <div className="border-t border-slate-100 pt-6">
               <h3 className="text-sm font-black text-slate-800 mb-4 flex items-center gap-2"><ListOrdered className="w-4 h-4"/> 详细复盘 (Review Details)</h3>
               <div className="max-h-64 overflow-y-auto space-y-2 custom-scrollbar pr-2">
                  {/* 按打分排序 */}
                  {sessionResults.slice().sort((a,b) => {
                      const scoreA = a.prof === 'watch' ? 2.5 : a.prof;
                      const scoreB = b.prof === 'watch' ? 2.5 : b.prof;
                      return scoreA - scoreB;
                  }).map((res, i) => (
                      <div key={i} className="flex justify-between items-center p-4 bg-slate-50 rounded-xl border border-slate-100">
                          <div className="flex flex-col min-w-0 pr-4">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-bold text-base text-slate-700 truncate">{res.phrase.chinese}</span>
                                {res.isCleared ? 
                                  <span className="text-[9px] font-black bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded border border-emerald-200">已过关</span> : 
                                  <span className="text-[9px] font-black bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded border border-rose-200">重插队列</span>
                                }
                              </div>
                              <span className="text-sm font-medium text-slate-500 truncate">{res.phrase.english}</span>
                          </div>
                          <div className={`px-3 py-1.5 rounded-lg text-sm font-black shrink-0 ${res.prof === 'watch' ? 'bg-slate-200 text-slate-600' : res.prof >= 4 ? 'bg-emerald-100 text-emerald-700' : res.prof >= 2 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>
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

  // 2. 正常复习状态
  if (!currentPhrase || !activeDeck) return null; // 兜底防崩

  const isEnToCn = activeDeck.studyMode === 'EN_CN';
  const questionText = isEnToCn ? currentPhrase.english : currentPhrase.chinese;
  const answerText = isEnToCn ? currentPhrase.chinese : currentPhrase.english;
  
  const isNew = currentPhrase.score === undefined || currentPhrase.score === 0;
  const profLabelsNew =["完全没思路", "思路大体对", "缺东西", "差一点", "正确但不确定", "正确"];
  const profLabelsOld =["完全没印象", "印象不清楚", "缺东西", "差一点", "勉强想出", "快速想出"];
  const currentLabels = isNew ? profLabelsNew : profLabelsOld;

  const progressPercent = Math.min(100, Math.max(0, ((totalPending - dailyQueue.length) / totalPending) * 100));

  return (
    <div className="fixed inset-0 bg-slate-50 z-[100] flex flex-col h-full overflow-hidden">
      
      {/* 顶栏控制区 */}
      <div className="bg-white shadow-sm shrink-0 relative z-[60]">
        <div className="flex items-center justify-between px-3 py-2 gap-3 h-14">
          <button onClick={handleRequestExit} className="p-2 text-slate-400 hover:text-slate-600 active:scale-95 transition-transform shrink-0"><ArrowLeft className="w-5 h-5"/></button>
          
          <div className="flex-1 flex flex-col justify-center max-w-[70%] sm:max-w-[50%]">
            <div className="flex justify-between items-end mb-1 leading-none">
              <span className="text-[10px] text-slate-400 font-bold truncate pr-2">每日复习 · {activeDeck.name}</span>
              <span className="text-[10px] font-mono font-bold text-slate-400">{formatHeaderTime(sessionDuration)}</span>
            </div>
            
            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden relative border border-slate-50">
              <div className="absolute top-0 left-0 h-full bg-rose-400 transition-all duration-500 ease-out" style={{ width: `${progressPercent}%` }}></div>
            </div>
            
            <div className="flex justify-between items-start mt-1 leading-none">
              <span className="text-[10px] font-black text-rose-500">{progressPercent.toFixed(1)}%</span>
              <span className="text-[10px] font-bold text-slate-400 flex items-center">
                <span className="text-slate-500">剩余 {dailyQueue.length} 词汇散落</span>
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
                    <label className="text-xs font-bold text-slate-600 block mb-2">学习节奏 (C & base)</label>
                    <div className="space-y-1 mb-4">
                      {ALGO_TIERS.map((tier, idx) => (
                        <button key={idx} onClick={() => setAlgoSettings({ ...algoSettings, tierIdx: idx })} className={`w-full text-left px-3 py-2 text-xs font-bold flex items-center justify-between rounded-lg transition-all ${algoSettings.tierIdx === idx ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' : 'text-slate-600 hover:bg-slate-50 border border-transparent'}`}>
                          <div>{tier.name} <span className="opacity-50 text-[9px] ml-1">C:{tier.C}, b:{tier.base}</span></div>
                          {algoSettings.tierIdx === idx && <div className="w-2 h-2 rounded-full bg-indigo-500"></div>}
                        </button>
                      ))}
                    </div>
                    <label className="text-xs font-bold text-slate-600 block mb-2">Cap (每日复习容量上限)</label>
                    <input type="number" min="10" value={algoSettings.cap} onChange={(e) => setAlgoSettings({ ...algoSettings, cap: Math.max(10, parseInt(e.target.value) || 100) })} className="w-full p-2 border border-slate-200 rounded-lg text-sm font-black outline-none focus:border-indigo-500 mb-4" />
                    <label className="text-xs font-bold text-slate-600 block mb-2">题目限时 (秒，0为不限)</label>
                    <input type="number" min="0" value={algoSettings.timeLimit} onChange={(e) => setAlgoSettings({ ...algoSettings, timeLimit: Math.max(0, parseInt(e.target.value) || 0) })} className="w-full p-2 border border-slate-200 rounded-lg text-sm font-black outline-none focus:border-indigo-500" />
                  </div>
                </div>
              )}
            </div>
            <button onClick={()=>setShowStats(!showStats)} className={`p-2 rounded-lg transition-colors ${showStats ? 'text-rose-600 bg-rose-50' : 'text-slate-300 hover:text-slate-500'}`}><BarChart2 className="w-5 h-5"/></button>
            <button onClick={()=>setShowQueue(!showQueue)} className={`p-2 rounded-lg transition-colors relative ${showQueue ? 'text-rose-600 bg-rose-50' : 'text-slate-300 hover:text-slate-500'}`}><ListOrdered className="w-5 h-5"/></button>
          </div>
        </div>
      </div>

      {/* 主视图区域 */}
      <div className="flex-1 flex relative overflow-hidden">
        <div className={`flex-1 flex flex-col items-center p-4 sm:p-6 transition-all duration-300 ${showQueue ? 'lg:pr-[320px]' : ''} ${showStats ? 'lg:pl-[320px]' : ''}`}>
          
          {/* 中心答题卡 */}
          <div className="w-full max-w-2xl bg-white rounded-3xl shadow-xl border border-slate-100 flex flex-col h-full max-h-[calc(100vh-90px)] sm:max-h-[600px] overflow-hidden relative">
            
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 sm:p-8 flex flex-col items-center w-full relative">
              
              {/* 词条基本状态信息 */}
              <div className="w-full flex justify-between items-center mb-6">
                 <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest border px-2 py-0.5 rounded-full">
                    {isNew ? 'NEW' : `Score: ${currentPhrase.score?.toFixed(2)}`}
                 </span>
                 <span className="text-[10px] font-black text-slate-400 border border-slate-100 bg-slate-50 px-2 py-0.5 rounded-md truncate max-w-[120px]">
                    {activeDeck.name}
                 </span>
              </div>

              {/* 题目 */}
              <div className="w-full flex flex-col items-center text-center pt-4 mb-6">
                <h1 className="text-3xl sm:text-4xl font-black text-slate-800 leading-snug break-words max-w-full">
                  {renderFormattedText(questionText)}
                </h1>
                
                {phase === 'QUESTION' && algoSettings.timeLimit > 0 && (
                  <div className="mt-8 flex flex-col items-center animate-in fade-in">
                    <div className={`text-sm font-black tabular-nums mb-2 flex items-center justify-center gap-1 ${isTimeout ? 'text-rose-500' : 'text-indigo-400'}`}>
                      {isTimeout ? <><AlertCircle className="w-4 h-4"/> 已超时</> : <><Clock className="w-4 h-4"/> {timeLeft.toFixed(1)}s</>}
                    </div>
                    <div className="w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full transition-all duration-100 ease-linear ${isTimeout ? 'bg-rose-500' : 'bg-indigo-400'}`} style={{ width: `${isTimeout ? 100 : (timeLeft / algoSettings.timeLimit) * 100}%` }} />
                    </div>
                  </div>
                )}
              </div>

              {/* 答案区与打分控制台 */}
              {phase === 'ANSWER' && (
                <div className="w-full flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-300 pb-4 mt-auto">
                  <div className="text-center py-2 px-4 rounded-xl w-full mb-4">
                    <p className="text-3xl font-black text-indigo-600 leading-snug break-words max-w-full inline-block">
                      {renderFormattedText(answerText)}
                    </p>
                  </div>

                  {currentPhrase.note && (
                    <div className="w-full bg-amber-50 p-4 rounded-xl border border-amber-100 text-left relative mb-8">
                      <div className="absolute top-4 left-4"><StickyNote className="w-4 h-4 text-amber-400" /></div>
                      <div className="pl-8 text-sm font-medium text-slate-700 whitespace-pre-wrap leading-relaxed break-words">
                        {renderFormattedText(cleanNote(currentPhrase.note))}
                      </div>
                    </div>
                  )}

                  <div className="w-full mt-auto space-y-6">
                    {/* 记忆难度选取 */}
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 shadow-sm">
                      <div className="flex justify-between items-center mb-3 ml-1">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">记忆难度 (Difficulty)</span>
                        <span className="font-black text-indigo-600 mr-2 text-sm">{diff}</span>
                      </div>
                      <div className="flex gap-1.5">
                        {[0, 1, 2, 3, 4, 5].map(v => (
                          <button key={v} onClick={() => setDiff(v)} className={`flex-1 py-2.5 rounded-lg font-black text-sm transition-all border-2 ${diff === v ? 'bg-indigo-500 border-indigo-500 text-white shadow-md' : 'bg-white border-slate-200 text-slate-400 hover:border-indigo-300'}`}>{v}</button>
                        ))}
                      </div>
                    </div>

                    {/* 熟练度打分 */}
                    <div>
                       <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 ml-1">熟练度评分 (Proficiency)</span>
                       <div className="grid grid-cols-6 gap-1.5 sm:gap-2">
                          {[0, 1, 2, 3, 4, 5].map(v => {
                            const disabled = isTimeout && v >= 4;
                            return (
                              <button key={v} disabled={disabled} onClick={() => setProf(v)} 
                                className={`flex flex-col items-center justify-center p-2 sm:p-3 rounded-xl border-2 transition-all group ${disabled ? 'opacity-30 cursor-not-allowed bg-slate-50 border-slate-100' : prof === v ? 'bg-emerald-50 border-emerald-500 shadow-md transform scale-105' : 'bg-white border-slate-100 hover:border-emerald-300'}`}>
                                <span className={`text-base sm:text-lg font-black ${prof === v ? 'text-emerald-600' : 'text-slate-400'}`}>{v}</span>
                                <span className={`text-[8px] sm:text-[10px] font-bold mt-1 leading-tight text-center w-full truncate ${prof === v ? 'text-emerald-700' : 'text-slate-500'}`} title={currentLabels[v]}>{currentLabels[v]}</span>
                              </button>
                            );
                          })}
                       </div>
                    </div>

                    {/* 明亮风格后推面板，显示是否通关 */}
                    <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 shadow-sm animate-in slide-in-from-bottom-2">
                      <div className="flex justify-between items-center">
                        <div className="flex flex-col">
                          <span className="text-xs font-black text-indigo-900 uppercase tracking-widest flex items-center gap-1.5">单本内预期后推</span>
                          <div className="text-[10px] font-bold text-slate-500 mt-1 flex items-center gap-1">
                              <span>Score 预测:</span>
                              <span className="text-slate-400">{currentPhrase.score?.toFixed(2) ?? '0.00'}</span>
                              <ArrowRight size={10} className="text-slate-300"/>
                              <span className={`font-black ${prof !== null ? (computedScore >= (currentPhrase.score ?? 0) ? 'text-emerald-600' : 'text-rose-500') : 'text-indigo-500'}`}>
                                {prof !== null ? computedScore.toFixed(2) : (currentPhrase.score?.toFixed(2) ?? '0.00')}
                              </span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end">
                            <div className="flex items-center gap-3">
                                <span className="text-[10px] font-bold text-slate-400">通关需要 &gt; 100</span>
                                <span className={`font-mono font-black text-3xl ${computedBack > 100 ? 'text-emerald-500' : 'text-rose-500'}`}>{prof !== null ? computedBack : watchBackValue}</span>
                            </div>
                            {computedBack <= 100 && prof !== null && <span className="text-[10px] text-rose-400 font-bold mt-1 animate-pulse">将会在队尾重现</span>}
                            {computedBack > 100 && prof !== null && <span className="text-[10px] text-emerald-500 font-bold mt-1">达成过关条件！</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {isAntiTouchActive && <div className="absolute inset-0 z-20 cursor-not-allowed"></div>}
            </div>
            
            {/* 底部操作区 */}
            <div className="p-4 sm:p-5 bg-white border-t border-slate-100 shrink-0">
              {phase === 'QUESTION' ? (
                <Button fullWidth onClick={handleShowAnswer} className="py-4 text-lg font-black shadow-lg shadow-indigo-100">查看答案 (Space)</Button>
              ) : (
                <div className="flex gap-3">
                  <button onClick={() => handleFinishCard(true)} className="flex-1 flex items-center justify-center gap-2 py-4 bg-slate-50 text-slate-600 rounded-xl font-black text-sm hover:bg-slate-100 transition-all border border-slate-200 shadow-sm"><Eye size={18}/> 观望 (W)</button>
                  <Button disabled={prof === null || isAntiTouchActive} fullWidth onClick={() => handleFinishCard(false)} className={`flex-[2] py-4 text-lg font-black shadow-lg transition-all ${prof === null ? 'bg-slate-200 text-slate-400 border-none' : 'bg-indigo-600 text-white shadow-indigo-200/50'}`}>
                    确认继续 (Enter) <ArrowRight size={20} className="ml-2" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ===================== 右侧队列抽屉 ===================== */}
        <div className={`absolute top-0 right-0 h-full w-[320px] bg-white border-l border-slate-100 shadow-2xl transition-transform duration-300 z-[70] flex flex-col ${showQueue ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="p-4 flex justify-between items-center bg-slate-50 border-b border-slate-100 shrink-0">
            <h3 className="font-black text-slate-800 text-sm flex items-center gap-2"><ListOrdered className="w-4 h-4"/> 剩余 {dailyQueue.length} 词未通关</h3>
            <button onClick={()=>setShowQueue(false)} className="p-1 hover:bg-slate-200 rounded-full transition-colors"><X className="w-4 h-4 text-slate-500"/></button>
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1.5">
            {dailyQueue.map((item, idx) => {
              const p = workingDecks.find(d => d.id === item.deckId)?.phrases.find(ph => ph.id === item.phraseId);
              if (!p) return null;
              const isCurrent = item.phraseId === activeItem?.phraseId;
              const badgeColor = getScoreBadgeColor(p.score);
              const label = getPhraseLabel(p.score);
              
              return (
                <div key={`${item.deckId}-${item.phraseId}-${idx}`} className={`flex items-center justify-between text-sm py-2 px-3 rounded-lg border transition-all ${isCurrent ? 'bg-rose-50 border-rose-200 shadow-sm scale-[1.02]' : 'bg-white border-transparent hover:bg-slate-50 hover:border-slate-200'}`}>
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className={`font-black text-[10px] w-4 text-center shrink-0 ${isCurrent ? 'text-rose-600' : 'text-slate-300'}`}>{idx+1}</span>
                    <div className={`truncate font-bold text-xs ${isCurrent ? 'text-rose-800' : 'text-slate-600'}`}>{p.chinese}</div>
                  </div>
                  <div className="px-1.5 py-0.5 rounded text-[9px] font-black text-white shrink-0 ml-2 shadow-sm" style={{backgroundColor: badgeColor}}>{label}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ===================== 左侧图表抽屉 ===================== */}
        <div className={`absolute top-0 left-0 h-full w-[320px] bg-white border-r border-slate-100 shadow-2xl transition-transform duration-300 z-[70] flex flex-col ${showStats ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="p-5 flex justify-between items-center bg-slate-50 border-b border-slate-100 shrink-0">
            <h3 className="font-black text-slate-800 text-sm flex items-center gap-2"><BarChart2 className="w-4 h-4"/> 状态大盘 (Stats)</h3>
            <button onClick={()=>setShowStats(false)} className="p-1 hover:bg-slate-200 rounded-full transition-colors"><X className="w-4 h-4 text-slate-500"/></button>
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
            <div className="border-slate-100 pt-2">
               <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">打分记录</h4>
               <div className="grid grid-cols-2 gap-3">
                 <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-100 text-emerald-700">
                    <div className="text-[10px] font-bold opacity-80 uppercase">优秀 (4-5)</div>
                    <div className="text-xl font-black">{stats.count4_5} <span className="text-xs opacity-60">次</span></div>
                 </div>
                 <div className="bg-amber-50 p-3 rounded-xl border border-amber-100 text-amber-700">
                    <div className="text-[10px] font-bold opacity-80 uppercase">一般 (2-3)</div>
                    <div className="text-xl font-black">{stats.count2_3} <span className="text-xs opacity-60">次</span></div>
                 </div>
                 <div className="bg-rose-50 p-3 rounded-xl border border-rose-100 text-rose-700 col-span-2 flex justify-between items-center">
                    <div>
                        <div className="text-[10px] font-bold opacity-80 uppercase">困难 (0-1)</div>
                        <div className="text-xl font-black">{stats.count0_1} <span className="text-xs opacity-60">次</span></div>
                    </div>
                    <XCircle className="w-8 h-8 opacity-20" />
                 </div>
               </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};