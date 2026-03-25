// src/components/StudySession.tsx (Part 1)

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Deck, Phrase } from '../types';
import { Button } from './Button';
import { 
  ArrowLeft, Settings2, RefreshCw, Eye, ArrowRight, Clock, AlertCircle, 
  Edit2, BarChart2, ListOrdered, X, CheckCircle2, TrendingUp, Trophy, 
  StickyNote, XCircle, Waves
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
  
  // 核心状态机：新增 FEEDBACK (反馈过渡页)
  const [phase, setPhase] = useState<'QUESTION' | 'ANSWER' | 'FEEDBACK' | 'REPORT'>('QUESTION');
  const[isFinished, setIsFinished] = useState(false);
  
  const [algoSettings, setAlgoSettings] = useState(() => {
    try { const saved = localStorage.getItem(ALGO_SETTINGS_KEY); return saved ? JSON.parse(saved) : { tierIdx: 2, cap: 100, timeLimit: 10, allowFreeze: true }; } 
    catch { return { tierIdx: 2, cap: 100, timeLimit: 10, allowFreeze: true }; }
  });

  const [showAlgoMenu, setShowAlgoMenu] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const[isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ english: '', chinese: '', note: '' });
  const [isAntiTouchActive, setIsAntiTouchActive] = useState(false); 

  const [sessionDuration, setSessionDuration] = useState(0);
  const[timeLeft, setTimeLeft] = useState<number>(algoSettings.timeLimit);
  const [isTimeout, setIsTimeout] = useState(false);

  const [prof, setProf] = useState<number | null>(null);
  const [diff, setDiff] = useState<number>(2.5);
  const[customBack, setCustomBack] = useState<number | null>(null);
  const [computedBack, setComputedBack] = useState<number>(1);
  const [computedScore, setComputedScore] = useState<number>(0);

  // 反馈页专属数据存储
  const [feedbackData, setFeedbackData] = useState<{
    isWatch: boolean; oldScore: number | undefined; newScore: number; 
    finalBack: number; isFrozen: boolean; coolingSteps: number; prof: number | 'watch'
  } | null>(null);

  const [stats, setStats] = useState({ count0_1: 0, count2_3: 0, count4_5: 0 });
  const [cultivationGain, setCultivationGain] = useState<number>(0);
  const [sessionResults, setSessionResults] = useState<{phrase: Phrase, prof: number | 'watch'}[]>([]);
  
  const [startMastery] = useState(() => deck.phrases.length === 0 ? 0 : deck.phrases.reduce((acc, p) => acc + (p.mastery || 0), 0) / deck.phrases.length);
  const[masteryTrend, setMasteryTrend] = useState<{ t: number; v: number }[]>([{ t: 0, v: startMastery }]);

  const currentPhrase = useMemo(() => deck.phrases.find(p => p.id === activeId), [activeId, deck.phrases]);
  
  // 100% 防止 NaN 的终极拦截器
  const activeScore = useMemo(() => {
    if (!currentPhrase || currentPhrase.score === undefined) return undefined;
    const s = Number(currentPhrase.score);
    return Number.isNaN(s) ? undefined : s;
  }, [currentPhrase]);

  const timerRef = useRef<number | null>(null);
  const questionTimerRef = useRef<number | null>(null);

  useEffect(() => { localStorage.setItem(ALGO_SETTINGS_KEY, JSON.stringify(algoSettings)); }, [algoSettings]);

  useEffect(() => {
    if (isFinished || phase === 'REPORT') return;
    if (masteryTrend.length === 0) setMasteryTrend([{ t: 0, v: startMastery }]);
    timerRef.current = window.setInterval(() => { onTimeUpdate(1); setSessionDuration(prev => prev + 1); }, 1000);
    return () => clearInterval(timerRef.current!);
  }, [onTimeUpdate, isFinished, phase, startMastery, masteryTrend.length]);

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

  useEffect(() => {
    if (isEditing && currentPhrase) {
      setEditForm({ english: currentPhrase.english, chinese: currentPhrase.chinese, note: (currentPhrase.note || '').replace(/\\n/g, '\n') });
    }
  }, [isEditing, currentPhrase]);

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
      
      // 绝对安全的计算，避免 NaN 污染 UI
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
          e.preventDefault();
          if (prof !== null) handleFinishCard(false);
        } else {
          const keyNum = parseInt(e.key);
          if (!isNaN(keyNum) && keyNum >= 0 && keyNum <= 5) {
            e.preventDefault();
            if (isTimeout && keyNum >= 4) return; 
            setProf(keyNum);
          } else if (e.code === 'KeyW') {
            e.preventDefault();
            handleFinishCard(true); 
          }
        }
      } else if (phase === 'FEEDBACK') {
        if (e.code === 'Space' || e.key === 'Enter' || e.key === '1' || e.key === '2' || e.key === '4') {
          e.preventDefault();
          handleNext();
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
    const updatedPhrases = deck.phrases.map(p => 
      p.id === currentPhrase.id ? { ...p, english: editForm.english, chinese: editForm.chinese, note: editForm.note } : p
    );
    onUpdateDeck({ ...deck, phrases: updatedPhrases });
    setIsEditing(false);
  }, [currentPhrase, editForm, deck, onUpdateDeck]);

  // 动作一：记录打分，计算冷却，进入反馈页 (FEEDBACK)
  const handleFinishCard = useCallback((isWatch: boolean) => {
    if (!currentPhrase || isAntiTouchActive) return;

    const todayDays = Math.floor(Date.now() / 86400000);
    const gap = (todayDays - (currentPhrase.date || todayDays)) + 1;
    const C = ALGO_TIERS[algoSettings.tierIdx].C;
    const base = ALGO_TIERS[algoSettings.tierIdx].base;

    let finalBack = 1;
    let newScore = activeScore;

    if (isWatch) {
      finalBack = customBack ?? watchBackValue;
    } else {
      if (prof === null) return;
      const res = calculateNextState(activeScore, prof, diff, gap, C, base, algoSettings.cap);
      newScore = Number.isNaN(res.newScore) ? 0 : res.newScore;
      finalBack = customBack !== null ? customBack : (Number.isNaN(computedBack) ? 1 : computedBack);
    }

    const queueLength = Math.max(0, deck.queue.length - 1);
    const isFrozen = algoSettings.allowFreeze && finalBack > queueLength;
    const coolingSteps = isFrozen ? finalBack - queueLength : 0;

    setFeedbackData({
      isWatch,
      oldScore: activeScore,
      newScore: isWatch ? (activeScore ?? 0) : newScore!,
      finalBack,
      isFrozen,
      coolingSteps,
      prof: isWatch ? 'watch' : prof!
    });

    setPhase('FEEDBACK');
  },[currentPhrase, isAntiTouchActive, algoSettings, diff, customBack, prof, deck.queue.length, activeScore, watchBackValue, computedBack]);

  // 动作二：确认反馈，更新队列池并进入下一题
  const handleNext = useCallback(() => {
    if (!currentPhrase || !feedbackData) return;
    setIsAntiTouchActive(true);
    setTimeout(() => setIsAntiTouchActive(false), 300);

    const todayDays = Math.floor(Date.now() / 86400000);

    if (!feedbackData.isWatch && feedbackData.prof !== 'watch') {
      setStats(prev => ({
        count0_1: prev.count0_1 + (feedbackData.prof! <= 1 ? 1 : 0),
        count2_3: prev.count2_3 + (feedbackData.prof! >= 2 && feedbackData.prof! <= 3 ? 1 : 0),
        count4_5: prev.count4_5 + (feedbackData.prof! >= 4 ? 1 : 0),
      }));
      const gainMap =[-1.0, -0.6, -0.2, 0.2, 0.6, 1.0];
      setCultivationGain(prev => prev + gainMap[feedbackData.prof as number]);
    }

    setSessionResults(prev =>[...prev, { phrase: currentPhrase, prof: feedbackData.prof }]);

    const updatedPhrase: Phrase = {
      ...currentPhrase,
      score: feedbackData.newScore,
      diff: diff,
      date: todayDays,
      back: feedbackData.finalBack,
      totalReviews: currentPhrase.totalReviews + 1,
      mastery: calculateMastery(getNScore(feedbackData.newScore, diff)),
      lastReviewedAt: Date.now()
    };

    const updatedPhrases = deck.phrases.map(p => p.id === activeId ? updatedPhrase : p);

    // V1 完全复刻版的 Cooling Pool 管理逻辑
    let nextCoolingPool = [...(deck.coolingPool || [])];
    nextCoolingPool.forEach(c => c.wait -= 1);
    const ready = nextCoolingPool.filter(c => c.wait <= 0);
    nextCoolingPool = nextCoolingPool.filter(c => c.wait > 0);

    let nextQueue = deck.queue.filter(id => id !== activeId);
    nextQueue.push(...ready.map(c => c.id));

    if (feedbackData.isFrozen) {
      nextCoolingPool.push({ id: activeId!, wait: feedbackData.coolingSteps });
    } else {
      const insertIdx = Math.min(feedbackData.finalBack, nextQueue.length);
      nextQueue.splice(insertIdx, 0, activeId!);
    }

    if (nextQueue.length === 0 && nextCoolingPool.length > 0) {
      const minWait = Math.min(...nextCoolingPool.map(c => c.wait));
      nextCoolingPool.forEach(c => c.wait -= minWait);
      const awakened = nextCoolingPool.filter(c => c.wait <= 0);
      nextCoolingPool = nextCoolingPool.filter(c => c.wait > 0);
      nextQueue.push(...awakened.map(c => c.id));
    }

    const currentGlobalMastery = updatedPhrases.reduce((acc, p) => acc + (p.mastery || 0), 0) / updatedPhrases.length;
    setMasteryTrend(prev =>[...prev, { t: sessionDuration, v: currentGlobalMastery }]);

    onUpdateDeck({ ...deck, queue: nextQueue, coolingPool: nextCoolingPool, phrases: updatedPhrases });

    setPhase('QUESTION');
    setIsTimeout(false);
    setTimeLeft(algoSettings.timeLimit);
    setProf(null);
    setCustomBack(null);
    setFeedbackData(null);
    setActiveId(nextQueue.length > 0 ? nextQueue[0] : null);
  },[currentPhrase, feedbackData, diff, activeId, deck, sessionDuration, algoSettings.timeLimit, onUpdateDeck]);

  const handleRequestExit = () => {
    setIsFinished(true);
    setPhase('REPORT');
  };

  const handleFinalExit = () => {
    if (onSessionComplete) onSessionComplete(sessionDuration, stats, cultivationGain);
    onExit();
  };

  const renderTrendChart = (data = masteryTrend, height = 100) => {
    if (data.length < 2) return null;
    const width = 240; const padding = { top: 10, right: 10, bottom: 20, left: 30 };
    const chartWidth = width - padding.left - padding.right; const chartHeight = height - padding.top - padding.bottom;
    const maxTime = Math.max(...data.map(d => d.t), 1); const minTime = data[0].t; const timeRange = maxTime - minTime || 1;
    const points = data.map(d => { const x = padding.left + ((d.t - minTime) / timeRange) * chartWidth; const y = padding.top + chartHeight - ((d.v) / 100) * chartHeight; return `${x},${y}`; }).join(' ');
    
    return (
      <div className="relative">
        <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible bg-slate-50/50 rounded-lg border border-slate-100">
          <line x1={padding.left} y1={padding.top} x2={width-padding.right} y2={padding.top} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3 3" />
          <line x1={padding.left} y1={padding.top + chartHeight/2} x2={width-padding.right} y2={padding.top + chartHeight/2} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3 3" />
          <line x1={padding.left} y1={height-padding.bottom} x2={width-padding.right} y2={height-padding.bottom} stroke="#e2e8f0" strokeWidth="1" />
          <text x={25} y={padding.top + 4} className="text-[9px] fill-slate-400 font-bold" textAnchor="end">100%</text>
          <text x={25} y={padding.top + chartHeight/2 + 4} className="text-[9px] fill-slate-400 font-bold" textAnchor="end">50%</text>
          <text x={25} y={height-padding.bottom - 2} className="text-[9px] fill-slate-400 font-bold" textAnchor="end">0%</text>
          <text x={width-padding.right} y={height-5} className="text-[9px] fill-slate-400 font-bold" textAnchor="end">Time (s) &rarr;</text>
          <polyline points={points} fill="none" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  };
  // src/components/StudySession.tsx (Part 2)

  // ========== UI 渲染逻辑 ==========

  // 1. 专属的复盘报告页面
  if (phase === 'REPORT') {
    const endMastery = masteryTrend.length > 0 ? masteryTrend[masteryTrend.length - 1].v : startMastery;
    const gain = endMastery - startMastery;

    return (
      <div className="fixed inset-0 bg-slate-50 z-50 flex flex-col items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-300 overflow-y-auto custom-scrollbar">
        <div className="max-w-2xl w-full bg-white rounded-3xl shadow-2xl p-8 flex flex-col space-y-6 my-8">
          <div className="text-center">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4 text-emerald-600"><Trophy className="w-8 h-8" /></div>
            <h2 className="text-3xl font-black text-slate-800">学习报告</h2>
            <p className="text-slate-400 font-bold text-sm uppercase tracking-widest mt-1">{deck.name}</p>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 text-center">
              <div className="text-xs text-slate-400 font-black uppercase tracking-widest mb-1">本次学习总计</div>
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
              <div className="text-[10px] font-bold text-slate-400 mt-2">基于精确打分累计</div>
            </div>
          </div>
          
          <div className="bg-indigo-50/50 p-6 rounded-2xl border border-indigo-100">
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

          {sessionResults.length > 0 && (
            <div className="border-t border-slate-100 pt-6">
               <h3 className="text-sm font-black text-slate-800 mb-4 flex items-center gap-2"><ListOrdered className="w-4 h-4"/> 详细复盘 (Review Details)</h3>
               <div className="max-h-64 overflow-y-auto space-y-2 custom-scrollbar pr-2">
                  {sessionResults.slice().sort((a,b) => {
                      const scoreA = a.prof === 'watch' ? 2.5 : a.prof;
                      const scoreB = b.prof === 'watch' ? 2.5 : b.prof;
                      return scoreA - scoreB;
                  }).map((res, i) => (
                      <div key={i} className="flex justify-between items-center p-4 bg-slate-50 rounded-xl border border-slate-100">
                          <div className="flex flex-col min-w-0 pr-4">
                              <span className="font-bold text-base text-slate-700 truncate">{res.phrase.chinese}</span>
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

  // 2. 异常拦截与“冷却池”自动唤醒机制 (解决你截图 1 中的报错)
  if (!currentPhrase) {
    if (deck.coolingPool && deck.coolingPool.length > 0) {
      return (
        <div className="fixed inset-0 flex flex-col items-center justify-center bg-slate-50 z-[100] p-4 animate-in fade-in">
          <div className="bg-white p-8 rounded-3xl shadow-xl text-center max-w-sm w-full animate-in zoom-in-95">
            <div className="w-16 h-16 bg-sky-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Waves className="w-8 h-8 text-sky-500" />
            </div>
            <h2 className="text-2xl font-black text-slate-800 mb-2">发现冻结词条</h2>
            <p className="text-sm text-slate-500 mb-6 font-medium">主队列已清空，但后台还有 <span className="text-sky-500 font-black text-lg">{deck.coolingPool.length}</span> 个词条正在冷却中。</p>
            <Button fullWidth onClick={() => {
                // 唤醒所有冷却中的词条
                const awakenedIds = deck.coolingPool!.map(c => c.id);
                onUpdateDeck({ ...deck, queue: awakenedIds, coolingPool: [] });
                setActiveId(awakenedIds[0]); // 重置当前索引
            }} className="py-4 text-lg font-black bg-sky-500 hover:bg-sky-600 shadow-lg shadow-sky-200">立即唤醒并继续</Button>
            <Button fullWidth variant="ghost" onClick={handleManualExit} className="mt-3">结束本次复习</Button>
          </div>
        </div>
      );
    }
    
    // 真正的兜底（比如词库完全为空被删光了）
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-slate-50 z-[100] p-4">
         <AlertCircle className="w-16 h-16 text-rose-500 mb-4" />
         <h2 className="text-2xl font-black text-slate-800">词库已空或数据异常</h2>
         <Button onClick={onExit} className="mt-6 px-8 py-3">返回主页</Button>
      </div>
    );
  }

  // 3. 渲染反馈过渡页 (FEEDBACK) - 完美还原你的截图 2
  if (phase === 'FEEDBACK' && feedbackData) {
    const oldLabel = getPhraseLabel(feedbackData.oldScore);
    const newLabel = getPhraseLabel(feedbackData.newScore);
    
    return (
      <div className="fixed inset-0 bg-slate-50 z-[100] flex flex-col h-full overflow-hidden animate-in fade-in">
        {/* 顶栏控制区（精简版） */}
        <div className="bg-white shadow-sm shrink-0 relative z-[60] flex items-center justify-between px-3 py-2 h-14">
          <button onClick={handleRequestExit} className="p-2 text-slate-400 hover:text-slate-600"><ArrowLeft className="w-5 h-5"/></button>
          <div className="text-[10px] text-slate-400 font-bold truncate">状态反馈 · {deck.name}</div>
          <div className="w-10" />
        </div>

        <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6">
          <div className="w-full max-w-xl bg-white rounded-3xl shadow-xl border border-slate-100 flex flex-col p-8 sm:p-12 text-center animate-in zoom-in-95">
            <h2 className="text-3xl sm:text-4xl font-black text-slate-800 mb-3 leading-snug break-words">{currentPhrase.chinese}</h2>
            <p className="text-lg font-bold text-indigo-600 mb-10 break-words">{currentPhrase.english}</p>
            
            <div className="py-8 border-t border-b border-slate-50 my-6">
              {feedbackData.isFrozen ? (
                 <div className="text-2xl font-black text-sky-500 flex items-center justify-center gap-3 mb-4">
                   <Waves className="w-6 h-6" /> 冻结冷却 {feedbackData.coolingSteps} 步
                 </div>
              ) : (
                 <div className="text-2xl font-black text-indigo-500 flex items-center justify-center gap-3 mb-4">
                   <ArrowRight className="w-6 h-6" /> 后推 {feedbackData.finalBack} 步
                 </div>
              )}
              
              <div className="flex items-center justify-center gap-3 text-base font-bold text-slate-500">
                 <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                 <span>{oldLabel}</span>
                 <ArrowRight className="w-4 h-4 text-slate-300" />
                 <span className="text-slate-800 font-black">{newLabel}</span>
              </div>
            </div>
            
            <Button onClick={handleNext} disabled={isAntiTouchActive} fullWidth className="py-4 mt-6 text-lg font-black bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200/50">
              复习下一个 (Space/Enter) <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const liveMasteryValue = masteryTrend.length > 0 ? masteryTrend[masteryTrend.length - 1].v : startMastery;
  const isEnToCn = deck.studyMode === 'EN_CN';
  const questionText = isEnToCn ? currentPhrase.english : currentPhrase.chinese;
  const answerText = isEnToCn ? currentPhrase.chinese : currentPhrase.english;
  
  const isNew = currentPhrase.score === undefined || currentPhrase.score === 0;
  const profLabelsNew =["完全没思路", "思路大体对", "缺东西", "差一点", "正确但不确定", "正确"];
  const profLabelsOld =["完全没印象", "印象不清楚", "缺东西", "差一点", "勉强想出", "快速想出"];
  const currentLabels = isNew ? profLabelsNew : profLabelsOld;

  return (
    <div className="fixed inset-0 bg-slate-50 z-[100] flex flex-col h-full overflow-hidden">
      {/* 顶栏 */}
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
                    
                    <div className="mb-4 bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <label className="flex items-center justify-between cursor-pointer group">
                        <div>
                          <div className="text-xs font-bold text-slate-700 flex items-center gap-2">允许词条冻结 {algoSettings.allowFreeze && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500"/>}</div>
                          <div className="text-[9px] font-bold text-slate-400 mt-0.5">后推超出队列时，将其冻结在队尾</div>
                        </div>
                        <div className={`w-10 h-5 rounded-full transition-colors relative shadow-inner ${algoSettings.allowFreeze ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                           <div className={`absolute top-1 w-3 h-3 rounded-full bg-white shadow transition-transform ${algoSettings.allowFreeze ? 'left-6' : 'left-1'}`}></div>
                        </div>
                        <input type="checkbox" checked={algoSettings.allowFreeze} onChange={e => setAlgoSettings({...algoSettings, allowFreeze: e.target.checked})} className="hidden" />
                      </label>
                    </div>

                    <label className="text-xs font-bold text-slate-600 block mb-2">Cap (每日复习容量上限)</label>
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
                <button onClick={() => setIsEditing(true)} className="p-2 text-slate-300 hover:text-indigo-500 hover:bg-indigo-50 rounded-xl transition-all"><Edit2 className="w-4 h-4"/></button>
              </div>
            )}

            {isEditing ? (
              <div className="flex-1 p-6 overflow-y-auto custom-scrollbar animate-in fade-in">
                <h3 className="font-black text-slate-800 mb-6 flex items-center gap-2"><Edit2 className="w-4 h-4"/> 编辑卡片</h3>
                <div className="space-y-4">
                  <div><label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-1">Chinese</label><textarea className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 ring-indigo-500" rows={2} value={editForm.chinese} onChange={e=>setEditForm({...editForm, chinese: e.target.value})}/></div>
                  <div><label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-1">English</label><textarea className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 ring-indigo-500" rows={2} value={editForm.english} onChange={e=>setEditForm({...editForm, english: e.target.value})}/></div>
                  <div><label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-1">Note</label><textarea className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-600 outline-none focus:ring-2 ring-indigo-500" rows={4} value={editForm.note} onChange={e=>setEditForm({...editForm, note: e.target.value})}/></div>
                  <div className="flex gap-3 pt-4"><Button variant="ghost" fullWidth onClick={() => setIsEditing(false)}>取消</Button><Button fullWidth onClick={handleSaveEdit}>保存修改</Button></div>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto custom-scrollbar p-6 sm:p-8 flex flex-col items-center w-full relative">
                
                {/* 题目区 */}
                <div className="w-full flex flex-col items-center text-center pt-4 mb-6">
                  <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-4 border px-2 py-0.5 rounded-full">
                    {isNew ? 'NEW' : `Score: ${currentPhrase.score?.toFixed(2)}`}
                  </span>
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

                {/* 答案区与打分 */}
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

                    <div className="w-full mt-auto space-y-5">
                      <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 shadow-sm">
                        <div className="flex justify-between items-center mb-3 ml-1">
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">记忆难度 (Difficulty)</span>
                          <span className="font-black text-indigo-600 mr-2 text-sm">{diff}</span>
                        </div>
                        <div className="flex gap-1.5">
                          {[0, 1, 2, 3, 4, 5].map(v => (
                            <button key={v} onClick={() => setDiff(v)} className={`flex-1 py-2.5 rounded-lg font-black text-sm transition-all border-2 ${diff === v ? 'bg-indigo-500 border-indigo-500 text-white shadow-md transform scale-105' : 'bg-white border-slate-200 text-slate-400 hover:border-indigo-300'}`}>{v}</button>
                          ))}
                        </div>
                      </div>

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

                      <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 shadow-sm animate-in slide-in-from-bottom-2">
                        <div className="flex justify-between items-center mb-4">
                            <div className="flex flex-col">
                              <span className="text-xs font-black text-indigo-900 uppercase tracking-widest flex items-center gap-1.5"><Settings2 size={14}/> 预期后推步数 (Back)</span>
                              <div className="text-[10px] font-bold text-slate-500 mt-1 flex items-center gap-1">
                                <span>Score 预测:</span>
                                <span className="text-slate-400">{currentPhrase.score?.toFixed(2) ?? '0.00'}</span>
                                <ArrowRight size={10} className="text-slate-300"/>
                                <span className={`font-black ${prof !== null ? (computedScore >= (currentPhrase.score ?? 0) ? 'text-emerald-600' : 'text-rose-500') : 'text-indigo-500'}`}>
                                  {prof !== null ? computedScore.toFixed(2) : (currentPhrase.score?.toFixed(2) ?? '0.00')}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <input type="number" min="1" 
                                value={customBack ?? (prof !== null ? computedBack : watchBackValue)} 
                                onChange={e => setCustomBack(Math.max(1, parseInt(e.target.value) || 1))} 
                                className="w-16 bg-white border border-indigo-200 rounded-lg p-1.5 text-center font-mono font-black text-indigo-600 text-sm focus:ring-2 ring-indigo-400 outline-none shadow-sm" 
                              />
                              {customBack !== null && (
                                <button onClick={() => setCustomBack(null)} className="p-1.5 text-slate-400 hover:text-indigo-600 bg-white rounded-md transition-colors shadow-sm border border-slate-200" title="恢复系统计算">
                                  <RefreshCw size={14}/>
                                </button>
                              )}
                            </div>
                        </div>
                        <input type="range" min="0" max="1000" step="1" 
                          value={mapBackToSlider(customBack ?? (prof !== null ? computedBack : watchBackValue))} 
                          onChange={e => setCustomBack(mapSliderToBack(parseInt(e.target.value)))}
                          className="w-full h-1.5 bg-indigo-200/60 rounded-lg appearance-none cursor-pointer accent-indigo-600" 
                        />
                        <div className="flex justify-between text-[8px] font-black text-indigo-300 mt-2 px-1 tracking-widest uppercase">
                          <span>1</span>
                          <span>Log2 Scale</span>
                          <span>100K+</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {isAntiTouchActive && <div className="absolute inset-0 z-20 cursor-not-allowed"></div>}
              </div>
            )}
            
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

        {/* 侧边栏 */}
        <div className={`absolute top-0 right-0 h-full w-[320px] bg-white border-l border-slate-100 shadow-2xl transition-transform duration-300 z-[70] flex flex-col ${showQueue ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="p-4 flex justify-between items-center bg-slate-50 border-b border-slate-100 shrink-0">
            <h3 className="font-black text-slate-800 text-sm flex items-center gap-2"><ListOrdered className="w-4 h-4"/> 实时复习队列</h3>
            <button onClick={()=>setShowQueue(false)} className="p-1 hover:bg-slate-200 rounded-full transition-colors"><X className="w-4 h-4 text-slate-500"/></button>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1.5">
            {deck.queue.map((id, idx) => {
              const p = deck.phrases.find(item => item.id === id);
              if (!p) return null;
              const isCurrent = id === activeId;
              const badgeColor = getScoreBadgeColor(p.score);
              const label = getPhraseLabel(p.score);
              return (
                <div key={id} className={`flex items-center justify-between text-sm py-2 px-3 rounded-lg border transition-all ${isCurrent ? 'bg-indigo-50 border-indigo-200 shadow-sm scale-[1.02]' : 'bg-white border-transparent hover:bg-slate-50 hover:border-slate-200'}`}>
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className={`font-black text-[10px] w-4 text-center shrink-0 ${isCurrent ? 'text-indigo-600' : 'text-slate-300'}`}>{idx+1}</span>
                    <div className={`truncate font-bold text-xs ${isCurrent ? 'text-indigo-800' : 'text-slate-600'}`}>{p.chinese}</div>
                  </div>
                  <div className="px-1.5 py-0.5 rounded text-[9px] font-black text-white shrink-0 ml-2 shadow-sm" style={{backgroundColor: badgeColor}}>{label}</div>
                </div>
              )
            })}
          </div>
        </div>

        <div className={`absolute top-0 left-0 h-full w-[320px] bg-white border-r border-slate-100 shadow-2xl transition-transform duration-300 z-[70] flex flex-col ${showStats ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="p-5 flex justify-between items-center bg-slate-50 border-b border-slate-100 shrink-0">
            <h3 className="font-black text-slate-800 text-sm flex items-center gap-2"><BarChart2 className="w-4 h-4"/> 状态大盘 (Stats)</h3>
            <button onClick={()=>setShowStats(false)} className="p-1 hover:bg-slate-200 rounded-full transition-colors"><X className="w-4 h-4 text-slate-500"/></button>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
            <div>
               <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Mastery Trend</h4>
               {renderTrendChart(masteryTrend, 140)}
            </div>
            <div className="border-t border-slate-100 pt-6">
               <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">本次学习比例</h4>
               <div className="grid grid-cols-2 gap-3">
                 <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-100 text-emerald-700">
                    <div className="text-[10px] font-bold opacity-80 uppercase">优秀 (4-5)</div>
                    <div className="text-xl font-black">{stats.count4_5}</div>
                 </div>
                 <div className="bg-amber-50 p-3 rounded-xl border border-amber-100 text-amber-700">
                    <div className="text-[10px] font-bold opacity-80 uppercase">一般 (2-3)</div>
                    <div className="text-xl font-black">{stats.count2_3}</div>
                 </div>
                 <div className="bg-rose-50 p-3 rounded-xl border border-rose-100 text-rose-700 col-span-2 flex justify-between items-center">
                    <div>
                        <div className="text-[10px] font-bold opacity-80 uppercase">困难 (0-1)</div>
                        <div className="text-xl font-black">{stats.count0_1}</div>
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
