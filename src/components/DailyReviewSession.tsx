// src/components/DailyReviewSession.tsx

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Deck, Phrase } from '../types';
import { Button } from './Button';
import { 
  ArrowLeft, Settings2, RefreshCw, Eye, ArrowRight, Clock, AlertCircle, 
  Trophy, XCircle 
} from 'lucide-react';
import { 
  calculateNextState, calculateBack, calculateWatchBack, 
  mapSliderToBack, mapBackToSlider, getNScore, EPS, calculateMastery,
  getProficiencyLabel, getScoreBadgeColor, getPhraseLabel
} from '../utils/algo';

interface DailyReviewSessionProps {
  selectedDecks: Deck[];
  onUpdateDecks: (updatedDecks: Deck[]) => void;
  onExit: () => void;
  onTimeUpdate: (seconds: number) => void;
  onSessionComplete?: (durationSeconds: number, counts: { count0_1: number; count2_3: number; count4_5: number }) => void;
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

export const DailyReviewSession: React.FC<DailyReviewSessionProps> = ({ 
  selectedDecks, onUpdateDecks, onExit, onTimeUpdate, onSessionComplete 
}) => {
  const[workingDecks, setWorkingDecks] = useState<Deck[]>(selectedDecks);
  const[dailyQueue, setDailyQueue] = useState<DailyQueueItem[]>([]);
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
    for (let i = initialQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [initialQueue[i], initialQueue[j]] =[initialQueue[j], initialQueue[i]];
    }
    setDailyQueue(initialQueue);
    setTotalPending(initialQueue.length);
    setIsInitialized(true);
  },[workingDecks, isInitialized]);

  const[phase, setPhase] = useState<'QUESTION' | 'ANSWER'>('QUESTION');
  const[isFinished, setIsFinished] = useState(false);
  
  const [algoSettings, setAlgoSettings] = useState(() => {
    try {
      const saved = localStorage.getItem(ALGO_SETTINGS_KEY);
      return saved ? JSON.parse(saved) : { tierIdx: 2, cap: 100, timeLimit: 10 };
    } catch {
      return { tierIdx: 2, cap: 100, timeLimit: 10 };
    }
  });

  const[sessionDuration, setSessionDuration] = useState(0);
  const [timeLeft, setTimeLeft] = useState<number>(algoSettings.timeLimit);
  const [isTimeout, setIsTimeout] = useState(false);

  const [prof, setProf] = useState<number | null>(null);
  const [diff, setDiff] = useState<number>(2.5);
  const[customBack, setCustomBack] = useState<number | null>(null);
  const [computedBack, setComputedBack] = useState<number>(1);
  const[isAntiTouchActive, setIsAntiTouchActive] = useState(false);

  const [stats, setStats] = useState({ count0_1: 0, count2_3: 0, count4_5: 0 });

  const timerRef = useRef<number | null>(null);
  const questionTimerRef = useRef<number | null>(null);

  const activeItem = dailyQueue.length > 0 ? dailyQueue[0] : null;
  const activeDeck = useMemo(() => workingDecks.find(d => d.id === activeItem?.deckId),[workingDecks, activeItem]);
  const currentPhrase = useMemo(() => activeDeck?.phrases.find(p => p.id === activeItem?.phraseId), [activeDeck, activeItem]);

  useEffect(() => {
    localStorage.setItem(ALGO_SETTINGS_KEY, JSON.stringify(algoSettings));
  },[algoSettings]);

  useEffect(() => {
    if (isFinished || !isInitialized) return;
    timerRef.current = window.setInterval(() => {
      onTimeUpdate(1);
      setSessionDuration(prev => prev + 1);
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  },[onTimeUpdate, isFinished, isInitialized]);

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

  useEffect(() => {
    if (phase === 'ANSWER' && currentPhrase && prof !== null) {
      const todayDays = Math.floor(Date.now() / 86400000);
      const C = ALGO_TIERS[algoSettings.tierIdx].C;
      const base = ALGO_TIERS[algoSettings.tierIdx].base;
      const gap = (todayDays - (currentPhrase.date || todayDays)) + 1;
      
      const { nscore } = calculateNextState(currentPhrase.score, prof, diff, gap, C, base, algoSettings.cap);
      setComputedBack(calculateBack(nscore, C, base));
    }
  },[phase, prof, diff, currentPhrase, algoSettings]);

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
            if (isTimeout && keyNum >= 4) return; 
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
      const nscore = getNScore(currentPhrase.score ?? 0, diff);
      finalBack = customBack ?? calculateWatchBack(nscore, C, base);
    } else {
      if (prof === null) {
        setIsAntiTouchActive(false);
        return;
      }
      const res = calculateNextState(currentPhrase.score, prof, diff, gap, C, base, algoSettings.cap);
      newScore = res.newScore;
      finalBack = customBack !== null ? customBack : calculateBack(res.nscore, C, base);

      setStats(prev => ({
        count0_1: prev.count0_1 + (prof <= 1 ? 1 : 0),
        count2_3: prev.count2_3 + (prof >= 2 && prof <= 3 ? 1 : 0),
        count4_5: prev.count4_5 + (prof >= 4 ? 1 : 0),
      }));
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

    if (finalBack <= 100) {
      const insertIdx = Math.min(finalBack, newDailyQueue.length);
      newDailyQueue.splice(insertIdx, 0, activeItem);
    } 
    
    setDailyQueue(newDailyQueue);

    if (newDailyQueue.length === 0) {
      setIsFinished(true);
    } else {
      setPhase('QUESTION');
      setIsTimeout(false);
      setTimeLeft(algoSettings.timeLimit);
      setProf(null);
      setCustomBack(null);
    }
  },[currentPhrase, activeDeck, activeItem, isAntiTouchActive, algoSettings, diff, customBack, prof, dailyQueue, workingDecks, onUpdateDecks]);

  const handleManualExit = () => {
    if (onSessionComplete) onSessionComplete(sessionDuration, stats);
    onExit();
  };

  if (!isInitialized) return <div className="fixed inset-0 flex items-center justify-center bg-white"><div className="text-xl font-bold text-slate-400">正在生成乱序复习大纲...</div></div>;

  if (isFinished || !currentPhrase || !activeDeck) {
    return (
      <div className="fixed inset-0 bg-slate-50 z-50 flex flex-col items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-300">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl p-8 flex flex-col space-y-6">
          <div className="text-center">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4 text-emerald-600"><Trophy className="w-8 h-8" /></div>
            <h2 className="text-2xl font-black text-slate-800">每日复习完成</h2>
            <p className="text-slate-400 font-bold text-xs uppercase tracking-widest mt-1">Daily Review Concluded</p>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center">
              <div className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-1">通关词汇</div>
              <div className="text-3xl font-black text-slate-800">{totalPending} <span className="text-sm text-slate-400">词</span></div>
            </div>
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center">
              <div className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-1">专注时长</div>
              <div className="text-3xl font-black text-slate-800">{formatFullTime(sessionDuration)}</div>
            </div>
          </div>
          
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center mt-2">
            <div className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-1">总计交互次数 (包含重复)</div>
            <div className="text-xl font-black text-slate-800">{stats.count0_1 + stats.count2_3 + stats.count4_5} <span className="text-xs text-slate-400">次</span></div>
            <div className="text-[10px] font-bold mt-2 flex justify-center gap-2">
              <span className="text-emerald-500">{stats.count4_5} 优</span>
              <span className="text-slate-300">|</span>
              <span className="text-amber-500">{stats.count2_3} 中</span>
              <span className="text-slate-300">|</span>
              <span className="text-rose-500">{stats.count0_1} 差</span>
            </div>
          </div>
          
          <Button fullWidth onClick={handleManualExit} className="py-4 text-lg font-black rounded-2xl shadow-xl mt-4">确认返回主页</Button>
        </div>
      </div>
    );
  }

  const isEnToCn = activeDeck.studyMode === 'EN_CN';
  const questionText = isEnToCn ? currentPhrase.english : currentPhrase.chinese;
  const answerText = isEnToCn ? currentPhrase.chinese : currentPhrase.english;
  
  const isNew = currentPhrase.score === undefined || currentPhrase.score === 0;
  const currentLabels = isNew 
    ?["完全没思路", "思路大体对", "缺东西", "差一点", "正确但不确定", "正确"]
    :["完全没印象", "印象不清楚", "缺东西", "差一点", "勉强想出", "快速想出"];

  const progressPercent = Math.min(100, Math.max(0, ((totalPending - dailyQueue.length) / totalPending) * 100));

  return (
    <div className="fixed inset-0 bg-slate-50 z-[100] flex flex-col h-full overflow-hidden">
      
      <div className="bg-white shadow-sm shrink-0 relative z-[60]">
        <div className="flex items-center justify-between px-3 py-2 gap-3 h-14">
          <button onClick={handleManualExit} className="p-2 text-slate-400 hover:text-slate-600 active:scale-95 transition-transform shrink-0"><ArrowLeft className="w-5 h-5"/></button>
          
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
                <span className="text-slate-500">剩余 {dailyQueue.length} 词</span>
              </span>
            </div>
          </div>
          
          <div className="w-10 flex justify-end shrink-0" />
        </div>
      </div>

      <div className="flex-1 flex relative overflow-hidden">
        <div className="flex-1 flex flex-col items-center p-4 sm:p-6 transition-all duration-300">
          <div className="w-full max-w-2xl bg-white rounded-3xl shadow-xl border border-slate-100 flex flex-col h-full max-h-[calc(100vh-90px)] sm:max-h-[600px] overflow-hidden relative">
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 sm:p-8 flex flex-col items-center w-full relative">
              <div className="w-full flex justify-between items-center mb-6">
                 <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest border px-2 py-0.5 rounded-full">
                    {isNew ? 'NEW' : `Score: ${currentPhrase.score?.toFixed(2)}`}
                 </span>
                 <span className="text-[10px] font-black text-slate-400 border border-slate-100 bg-slate-50 px-2 py-0.5 rounded-md truncate max-w-[120px]">
                    {activeDeck.name}
                 </span>
              </div>

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

              {phase === 'ANSWER' && (
                <div className="w-full flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-300 pb-4 mt-auto">
                  <div className="text-center py-2 px-4 rounded-xl w-full mb-4">
                    <p className="text-3xl font-black text-indigo-600 leading-snug break-words max-w-full inline-block">
                      {renderFormattedText(answerText)}
                    </p>
                  </div>

                  {currentPhrase.note && (
                    <div className="w-full bg-amber-50 p-4 rounded-xl border border-amber-100 text-left relative mb-8">
                      <div className="absolute top-4 left-4"><span className="text-lg">💡</span></div>
                      <div className="pl-8 text-sm font-medium text-slate-700 whitespace-pre-wrap leading-relaxed break-words">
                        {renderFormattedText(currentPhrase.note)}
                      </div>
                    </div>
                  )}

                  <div className="w-full mt-auto space-y-6">
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

                    <div>
                       <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 ml-1">熟练度评分 (Proficiency)</span>
                       <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {[0, 1, 2, 3, 4, 5].map(v => {
                            const disabled = isTimeout && v >= 4;
                            return (
                              <button key={v} disabled={disabled} onClick={() => setProf(v)} 
                                className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all group ${disabled ? 'opacity-30 cursor-not-allowed bg-slate-50 border-slate-100' : prof === v ? 'bg-emerald-50 border-emerald-500 shadow-md' : 'bg-white border-slate-100 hover:border-emerald-300'}`}>
                                <span className={`text-xl font-black ${prof === v ? 'text-emerald-600' : 'text-slate-400'}`}>{v}</span>
                                <span className={`text-[10px] font-bold mt-1 leading-tight text-center ${prof === v ? 'text-emerald-700' : 'text-slate-500'}`}>{currentLabels[v]}</span>
                              </button>
                            );
                          })}
                       </div>
                    </div>

                    <div className="bg-slate-900 p-5 rounded-xl shadow-xl flex justify-between items-center animate-in slide-in-from-bottom-2">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">单本内预期后推位置</span>
                        <div className="flex items-center gap-3">
                            <span className="text-[10px] font-bold text-slate-400">通关需要 &gt; 100</span>
                            <span className={`font-mono font-black text-xl ${computedBack > 100 ? 'text-emerald-400' : 'text-rose-400'}`}>{prof !== null ? computedBack : '-'}</span>
                        </div>
                    </div>

                  </div>
                </div>
              )}
              {isAntiTouchActive && <div className="absolute inset-0 z-20 cursor-not-allowed"></div>}
            </div>
            
            <div className="p-4 sm:p-5 bg-white border-t border-slate-100 shrink-0">
              {phase === 'QUESTION' ? (
                <Button fullWidth onClick={handleShowAnswer} className="py-4 text-lg font-black shadow-lg shadow-indigo-100">查看答案 (Space)</Button>
              ) : (
                <div className="flex gap-3">
                  <button onClick={() => handleFinishCard(true)} className="flex-1 flex items-center justify-center gap-2 py-4 bg-slate-100 text-slate-600 rounded-xl font-black text-sm hover:bg-slate-200 transition-all border border-slate-200 shadow-sm"><Eye size={18}/> 观望 (W)</button>
                  <Button disabled={prof === null || isAntiTouchActive} fullWidth onClick={() => handleFinishCard(false)} className={`flex-[2] py-4 text-lg font-black shadow-lg ${prof === null ? 'bg-slate-200 text-slate-400 border-none' : 'bg-indigo-600 text-white'}`}>
                    确认继续 (Enter) <ArrowRight size={20} className="ml-2" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};