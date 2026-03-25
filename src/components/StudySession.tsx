// src/components/StudySession.tsx (Part 1 - 紧凑版 & 状态分布逻辑)

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
  { name: '一档', C: 3, base: 1.5 },
  { name: '二档', C: 3.5, base: 1.75 },
  { name: '三档', C: 4, base: 2 },
  { name: '四档', C: 5, base: 2.5 },
  { name: '五档', C: 6, base: 3 },
];

const ALGO_SETTINGS_KEY = 'recallflow_v2_algo_settings';

const formatHeaderTime = (seconds: number) => { 
  if (Number.isNaN(seconds)) return '00:00';
  const m = Math.floor(seconds / 60); const s = seconds % 60; 
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`; 
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

  const [feedbackData, setFeedbackData] = useState<{isWatch: boolean; oldScore: number | undefined; newScore: number; finalBack: number; isFrozen: boolean; coolingSteps: number; prof: number | 'watch'} | null>(null);
  const [stats, setStats] = useState({ count0_1: 0, count2_3: 0, count4_5: 0 });
  const [cultivationGain, setCultivationGain] = useState<number>(0);
  const [sessionResults, setSessionResults] = useState<{phrase: Phrase, prof: number | 'watch'}[]>([]);
  
  const [startMastery] = useState(() => deck.phrases.length === 0 ? 0 : deck.phrases.reduce((acc, p) => acc + (p.mastery || 0), 0) / deck.phrases.length);
  const [masteryTrend, setMasteryTrend] = useState<{ t: number; v: number }[]>([{ t: 0, v: startMastery }]);

  // 计算状态全分布图 (用于左侧抽屉)
  const distributionData = useMemo(() => {
    const map: Record<string, { count: number; score: number | undefined }> = {};
    deck.phrases.forEach(p => {
      const tag = getPhraseLabel(p.score);
      if (!map[tag]) map[tag] = { count: 0, score: p.score };
      map[tag].count++;
    });
    return Object.entries(map).sort((a, b) => {
        const sA = a[1].score ?? 0; const sB = b[1].score ?? 0;
        return sA - sB; // 从错到对排列
    });
  }, [deck.phrases]);

  const currentPhrase = useMemo(() => deck.phrases.find(p => p.id === activeId), [activeId, deck.phrases]);
  const activeScore = currentPhrase?.score;

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
  },[phase, algoSettings.timeLimit, isEditing, isFinished, activeId]);

  const watchBackValue = useMemo(() => {
    if (!currentPhrase) return 1;
    const nscore = getNScore(activeScore ?? 0, diff);
    return calculateWatchBack(nscore, ALGO_TIERS[algoSettings.tierIdx].C, ALGO_TIERS[algoSettings.tierIdx].base);
  }, [currentPhrase, diff, algoSettings, activeScore]);

  useEffect(() => {
    if (phase === 'ANSWER' && currentPhrase && prof !== null) {
      const today = Math.floor(Date.now() / 86400000);
      const res = calculateNextState(activeScore, prof, diff, (today - (currentPhrase.date || today)) + 1, ALGO_TIERS[algoSettings.tierIdx].C, ALGO_TIERS[algoSettings.tierIdx].base, algoSettings.cap);
      setComputedScore(res.newScore); setComputedBack(calculateBack(res.nscore, ALGO_TIERS[algoSettings.tierIdx].C, ALGO_TIERS[algoSettings.tierIdx].base));
    }
  },[phase, prof, diff, currentPhrase, algoSettings, activeScore]);

  const timerRef = useRef<number | null>(null);
  const questionTimerRef = useRef<number | null>(null);

  const handleShowAnswer = useCallback(() => {
    if (questionTimerRef.current) clearInterval(questionTimerRef.current);
    if (currentPhrase) setDiff(currentPhrase.diff ?? 2.5);
    setPhase('ANSWER');
  }, [currentPhrase]);

  const handleFinishCard = useCallback((isWatch: boolean) => {
    if (!currentPhrase || isAntiTouchActive) return;
    setIsAntiTouchActive(true); setTimeout(() => setIsAntiTouchActive(false), 300);
    const today = Math.floor(Date.now() / 86400000);
    let finalBack = isWatch ? (customBack ?? watchBackValue) : (customBack ?? computedBack);
    let newScore = isWatch ? activeScore : computedScore;

    if (!isWatch && prof !== null) {
        const pVal = prof as number;
        setStats(prev => ({ count0_1: prev.count0_1 + (pVal <= 1 ? 1 : 0), count2_3: prev.count2_3 + (pVal >= 2 && pVal <= 3 ? 1 : 0), count4_5: prev.count4_5 + (pVal >= 4 ? 1 : 0) }));
        const gainMap =[-1.0, -0.6, -0.2, 0.2, 0.6, 1.0]; setCultivationGain(prev => prev + gainMap[pVal]);
    }
    setSessionResults(prev => [...prev, { phrase: currentPhrase, prof: isWatch ? 'watch' : prof! }]);

    const updatedPhrase: Phrase = { ...currentPhrase, score: newScore, diff, date: today, back: finalBack, totalReviews: currentPhrase.totalReviews + 1, mastery: calculateMastery(getNScore(newScore ?? 0, diff)), lastReviewedAt: Date.now() };
    const updatedPhrases = deck.phrases.map(p => p.id === activeId ? updatedPhrase : p);
    
    let nextQueue = deck.queue.filter(id => id !== activeId);
    let nextCoolingPool = [...(deck.coolingPool || [])];
    nextCoolingPool.forEach(c => c.wait -= 1);
    const ready = nextCoolingPool.filter(c => c.wait <= 0);
    nextCoolingPool = nextCoolingPool.filter(c => c.wait > 0);
    nextQueue.push(...ready.map(r => r.id));

    if (algoSettings.allowFreeze && finalBack > nextQueue.length) nextCoolingPool.push({ id: activeId!, wait: finalBack - nextQueue.length });
    else nextQueue.splice(Math.min(finalBack, nextQueue.length), 0, activeId!);

    if (nextQueue.length === 0 && nextCoolingPool.length > 0) {
      const minW = Math.min(...nextCoolingPool.map(c => c.wait));
      nextCoolingPool.forEach(c => c.wait -= minW);
      const wake = nextCoolingPool.filter(c => c.wait <= 0);
      nextCoolingPool = nextCoolingPool.filter(c => c.wait > 0);
      nextQueue.push(...wake.map(c => c.id));
    }
    onUpdateDeck({ ...deck, queue: nextQueue, coolingPool: nextCoolingPool, phrases: updatedPhrases });
    setMasteryTrend(prev => [...prev, { t: sessionDuration, v: updatedPhrases.reduce((acc, p) => acc + (p.mastery || 0), 0) / updatedPhrases.length }]);
    setPhase('QUESTION'); setIsTimeout(false); setTimeLeft(algoSettings.timeLimit); setProf(null); setCustomBack(null); setActiveId(nextQueue.length > 0 ? nextQueue[0] : null);
  },[currentPhrase, isAntiTouchActive, algoSettings, diff, customBack, prof, deck, activeId, sessionDuration, onUpdateDeck, activeScore, watchBackValue, computedBack, computedScore]);

  const handleRequestExit = () => { setIsFinished(true); setPhase('REPORT'); };
  const handleFinalExit = () => { if (onSessionComplete) onSessionComplete(sessionDuration, stats, cultivationGain); onExit(); };

  const renderTrendChart = (data = masteryTrend, height = 100) => {
    if (data.length < 2) return null;
    const width = 240; const p = { t: 10, r: 10, b: 20, l: 30 };
    const maxT = Math.max(...data.map(d => d.t), 1); const minT = data[0].t;
    const points = data.map(d => `${p.l + ((d.t - minT) / (maxT - minT || 1)) * (width - p.l - p.r)},${p.t + (height - p.t - p.b) - (d.v / 100) * (height - p.t - p.b)}`).join(' ');
    return (
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="bg-slate-50/50 rounded-lg border">
        <line x1={p.l} y1={p.t} x2={width-p.r} y2={p.t} stroke="#e2e8f0" strokeDasharray="3 3" />
        <line x1={p.l} y1={height-p.b} x2={width-p.r} y2={height-p.b} stroke="#e2e8f0" />
        <polyline points={points} fill="none" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  };
  // src/components/StudySession.tsx (Part 2 - 极致紧凑 & 预测版)

  // ========== UI 渲染逻辑 ==========

  // 1. 复盘报告页面
  if (phase === 'REPORT') {
    const endM = masteryTrend.length > 0 ? masteryTrend[masteryTrend.length - 1].v : startMastery;
    return (
      <div className="fixed inset-0 bg-slate-50 z-50 flex flex-col items-center justify-center p-4 animate-in fade-in overflow-y-auto custom-scrollbar">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-2xl p-6 flex flex-col space-y-4 my-4 border">
          <div className="text-center">
            <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-2 text-emerald-600"><Trophy size={24}/></div>
            <h2 className="text-xl font-black text-slate-800">学习报告</h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{deck.name}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 p-4 rounded-xl border text-center">
              <div className="text-[10px] text-slate-400 font-black uppercase mb-1">本次复习</div>
              <div className="text-xl font-black">{stats.count0_1+stats.count2_3+stats.count4_5} <span className="text-xs">词</span></div>
            </div>
            <div className="bg-slate-50 p-4 rounded-xl border text-center">
              <div className="text-[10px] text-slate-400 font-black uppercase mb-1">获得修为</div>
              <div className={`text-xl font-black ${cultivationGain>=0?'text-indigo-600':'text-rose-500'}`}>{cultivationGain>0?'+':''}{cultivationGain.toFixed(1)}</div>
            </div>
          </div>
          <div className="bg-indigo-50/30 p-4 rounded-xl border border-indigo-100">
            <div className="flex justify-between items-end mb-2">
              <span className="text-[10px] font-black text-indigo-900 uppercase">掌握度: {endM.toFixed(2)}%</span>
              <span className="text-[10px] font-bold text-emerald-600">+{ (endM-startMastery).toFixed(2) }%</span>
            </div>
            {renderTrendChart(masteryTrend, 80)}
          </div>
          <div className="max-h-40 overflow-y-auto space-y-1 custom-scrollbar pr-1">
             {sessionResults.slice().sort((a,b)=>(a.prof==='watch'?2.5:a.prof)-(b.prof==='watch'?2.5:b.prof)).map((res, i)=>(
               <div key={i} className="flex justify-between items-center p-2 bg-slate-50 rounded-lg text-xs">
                 <span className="font-bold text-slate-700 truncate mr-2">{res.phrase.chinese}</span>
                 <span className={`px-2 py-0.5 rounded font-black shrink-0 ${res.prof==='watch'?'bg-slate-200':res.prof>=4?'bg-emerald-100 text-emerald-700':'bg-rose-100 text-rose-700'}`}>{res.prof==='watch'?'观望':`${res.prof}分`}</span>
               </div>
             ))}
          </div>
          <Button fullWidth onClick={handleFinalExit} className="py-3 font-black rounded-xl shadow-lg">确认返回</Button>
        </div>
      </div>
    );
  }

  // 2. 唤醒冷却词条页面
  if (!currentPhrase) {
    if (deck.coolingPool && deck.coolingPool.length > 0) {
      return (
        <div className="fixed inset-0 flex flex-col items-center justify-center bg-slate-50 z-[100] p-4">
          <div className="bg-white p-6 rounded-3xl shadow-xl text-center max-w-sm w-full border animate-in zoom-in-95">
            <Waves className="w-10 h-10 text-sky-500 mx-auto mb-3" />
            <h2 className="text-xl font-black text-slate-800 mb-1">发现冻结词条</h2>
            <p className="text-xs text-slate-500 mb-6">主队列已空，冷却池中还有 <span className="text-sky-500 font-black">{deck.coolingPool.length}</span> 个词。</p>
            <Button fullWidth onClick={()=>{
                const awakened = deck.coolingPool!.map(c=>c.id);
                onUpdateDeck({...deck, queue:awakened, coolingPool:[]}); setActiveId(awakened[0]);
            }} className="py-3 bg-sky-500 hover:bg-sky-600 border-0 text-white font-black rounded-xl shadow-lg shadow-sky-100">立即唤醒</Button>
            <Button fullWidth variant="ghost" onClick={handleRequestExit} className="mt-2 text-slate-400 text-xs">结束本次复习</Button>
          </div>
        </div>
      );
    }
    return <div className="fixed inset-0 flex items-center justify-center bg-white"><Button onClick={onExit}>数据异常，返回主页</Button></div>;
  }

  // 3. 计算实时属性
  const currentBackVal = customBack ?? (prof !== null ? computedBack : watchBackValue);
  const isNowFrozen = algoSettings.allowFreeze && currentBackVal > (deck.queue.length - 1);

  return (
    <div className="fixed inset-0 bg-slate-50 z-[100] flex flex-col h-full overflow-hidden">
      {/* 极简顶栏 */}
      <div className="bg-white shadow-sm shrink-0 z-[60] border-b">
        <div className="flex items-center justify-between px-3 h-12">
          <button onClick={handleRequestExit} className="p-2 text-slate-400 hover:text-slate-600"><ArrowLeft size={20}/></button>
          <div className="flex-1 flex flex-col justify-center items-center px-4">
            <div className="flex justify-between w-full text-[9px] font-black text-slate-400 mb-0.5">
               <span className="truncate">{deck.name}</span>
               <span>{formatHeaderTime(sessionDuration)}</span>
            </div>
            <div className="h-1 w-full bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 transition-all duration-700" style={{ width: `${liveMasteryValue}%` }}></div>
            </div>
          </div>
          <div className="flex gap-0.5">
            <button onClick={()=>setShowAlgoMenu(!showAlgoMenu)} className={`p-1.5 rounded-lg ${showAlgoMenu?'text-indigo-600 bg-indigo-50':'text-slate-300'}`}><Settings2 size={18}/></button>
            <button onClick={()=>setShowStats(!showStats)} className={`p-1.5 rounded-lg ${showStats?'text-indigo-600 bg-indigo-50':'text-slate-300'}`}><BarChart2 size={18}/></button>
            <button onClick={()=>setShowQueue(!showQueue)} className={`p-1.5 rounded-lg ${showQueue?'text-indigo-600 bg-indigo-50':'text-slate-300'}`}><ListOrdered size={18}/></button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex relative overflow-hidden">
        <div className={`flex-1 flex flex-col items-center p-3 transition-all duration-300 ${showQueue?'lg:pr-[300px]':''} ${showStats?'lg:pl-[300px]':''}`}>
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-lg border flex flex-col h-full overflow-hidden relative">
            
            {/* 打分区只在非问题阶段显示 Score */}
            {phase === 'ANSWER' && !isEditing && (
              <div className="absolute top-3 left-4 animate-in fade-in">
                 <div className="flex items-center gap-1.5 bg-slate-50 border px-2 py-0.5 rounded-full shadow-sm">
                   <span className="text-[9px] font-black text-slate-300 uppercase">Score</span>
                   <span className="text-[10px] font-black text-slate-600">{activeScore?.toFixed(2) ?? 'NEW'}</span>
                 </div>
              </div>
            )}
            
            <div className="flex-1 overflow-y-auto custom-scrollbar p-5 flex flex-col">
              {isEditing ? (
                <div className="space-y-3 pt-2">
                  <h3 className="font-black text-slate-800 text-sm flex items-center gap-2"><Edit2 size={14}/> 编辑</h3>
                  <textarea className="w-full p-3 bg-slate-50 border rounded-xl font-bold text-sm outline-none focus:ring-2 ring-indigo-500" rows={2} value={editForm.chinese} onChange={e=>setEditForm({...editForm, chinese:e.target.value})}/>
                  <textarea className="w-full p-3 bg-slate-50 border rounded-xl font-bold text-sm outline-none focus:ring-2 ring-indigo-500" rows={2} value={editForm.english} onChange={e=>setEditForm({...editForm, english:e.target.value})}/>
                  <textarea className="w-full p-3 bg-slate-50 border rounded-xl text-xs outline-none focus:ring-2 ring-indigo-500" rows={3} value={editForm.note} onChange={e=>setEditForm({...editForm, note:e.target.value})}/>
                  <div className="flex gap-2 pt-2"><Button variant="ghost" fullWidth onClick={()=>setIsEditing(false)} className="text-xs">取消</Button><Button fullWidth onClick={handleSaveEdit} className="text-xs">保存</Button></div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col h-full">
                  {/* 题目/答案展示区 - 垂直居中且紧凑 */}
                  <div className="flex-1 flex flex-col items-center justify-center text-center py-4 min-h-[140px]">
                    <h1 className="text-2xl sm:text-3xl font-black text-slate-800 leading-snug mb-2">{renderFormattedText(questionText)}</h1>
                    {phase === 'ANSWER' && (
                      <div className="animate-in slide-in-from-top-2 duration-300">
                        <p className="text-xl font-black text-indigo-600">{renderFormattedText(answerText)}</p>
                      </div>
                    )}
                    {phase === 'QUESTION' && algoSettings.timeLimit > 0 && (
                      <div className="w-24 mt-4 opacity-50">
                        <div className="h-1 w-full bg-slate-100 rounded-full overflow-hidden"><div className={`h-full transition-all linear ${isTimeout?'bg-rose-500':'bg-indigo-400'}`} style={{width:`${isTimeout?100:(timeLeft/algoSettings.timeLimit)*100}%`}}></div></div>
                      </div>
                    )}
                  </div>

                  {phase === 'ANSWER' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 pb-2">
                      {currentPhrase.note && (
                        <div className="bg-amber-50/60 p-3 rounded-xl border border-amber-100 relative">
                          <StickyNote className="w-3 h-3 text-amber-400 absolute top-3 left-3" />
                          <div className="pl-6 text-[11px] font-bold text-slate-600 leading-relaxed whitespace-pre-wrap">{renderFormattedText(cleanNote(currentPhrase.note))}</div>
                        </div>
                      )}

                      <div className="space-y-4">
                        {/* 难度选择器 - 高度压缩 */}
                        <div className="flex items-center justify-between px-1">
                           <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">记忆难度</span>
                           <div className="flex gap-1">
                              {[0,1,2,3,4,5].map(v => (
                                <button key={v} onClick={()=>setDiff(v)} className={`w-7 h-7 rounded-lg text-[11px] font-black border-2 transition-all ${diff===v?'bg-indigo-600 border-indigo-600 text-white shadow-md':'bg-white text-slate-400 border-slate-100 hover:border-indigo-200'}`}>{v}</button>
                              ))}
                           </div>
                        </div>

                        {/* 熟练度 - 极致单行 */}
                        <div className="grid grid-cols-6 gap-1">
                          {[0,1,2,3,4,5].map(v => {
                            const d = isTimeout && v>=4;
                            return (
                              <button key={v} disabled={d} onClick={()=>setProf(v)} className={`flex flex-col items-center justify-center py-2 rounded-xl border-2 transition-all ${d?'opacity-20 grayscale':prof===v?'bg-emerald-50 border-emerald-500 shadow-sm scale-105':'bg-white border-slate-100 hover:border-emerald-300'}`}>
                                <span className={`text-sm font-black ${prof===v?'text-emerald-600':'text-slate-400'}`}>{v}</span>
                                <span className="text-[7px] font-bold mt-0.5 truncate w-full px-0.5 text-center text-slate-500">{currentLabels[v].slice(0,2)}</span>
                              </button>
                            );
                          })}
                        </div>

                        {/* 明亮预测面板 - 紧凑型 */}
                        <div className="bg-indigo-50/40 p-3 rounded-xl border border-indigo-100/50">
                           <div className="flex justify-between items-center mb-2">
                             <div className="flex flex-col gap-0.5">
                               <div className="text-[9px] font-black text-indigo-900 uppercase flex items-center gap-1"><Settings2 size={10}/> Score 预测</div>
                               <div className="flex items-center gap-1 text-[11px] font-mono font-black">
                                 <span className="text-slate-400">{activeScore?.toFixed(2) ?? 'NEW'}</span>
                                 <ArrowRight size={10} className="text-slate-300"/>
                                 <span className={prof!==null ? (computedScore>=(activeScore||0)?'text-emerald-600':'text-rose-500') : 'text-indigo-400'}>
                                   {prof!==null ? computedScore.toFixed(2) : (activeScore?.toFixed(2)||'0.00')}
                                 </span>
                               </div>
                             </div>
                             <div className="flex flex-col items-end">
                                <div className="flex items-center gap-1.5 bg-white border rounded-lg px-1.5 py-1">
                                   <span className="text-[9px] font-black text-slate-400">BACK</span>
                                   <input type="number" min="1" value={currentBackVal} onChange={e=>setCustomBack(Math.max(1,parseInt(e.target.value)||1))} className={`w-9 text-center font-mono font-black text-xs outline-none ${isNowFrozen?'text-sky-600':'text-indigo-600'}`}/>
                                   {customBack!==null && <button onClick={()=>setCustomBack(null)} className="text-slate-300 hover:text-indigo-500"><RefreshCw size={10}/></button>}
                                </div>
                                {isNowFrozen && <div className="text-[8px] text-sky-500 font-black mt-1 flex items-center gap-1"><Waves size={8}/> 冻结中</div>}
                             </div>
                           </div>
                           <input type="range" min="0" max="1000" step="1" value={mapBackToSlider(currentBackVal)} onChange={e=>setCustomBack(mapSliderToBack(parseInt(e.target.value)))} className={`w-full h-1 rounded-lg appearance-none cursor-pointer ${isNowFrozen?'bg-sky-100 accent-sky-500':'bg-indigo-100 accent-indigo-500'}`} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {isAntiTouchActive && <div className="absolute inset-0 z-20 cursor-not-allowed"></div>}
            </div>
            
            <div className="p-3 bg-white border-t shrink-0">
              {phase === 'QUESTION' ? (
                <Button fullWidth onClick={handleShowAnswer} className="py-3.5 text-base font-black shadow-lg bg-indigo-600 text-white border-0">查看答案 (Space)</Button>
              ) : (
                <div className="flex gap-2">
                  <button onClick={()=>handleFinishCard(true)} className="flex-1 py-3 bg-slate-50 text-slate-500 rounded-xl font-black text-xs border border-slate-100 hover:bg-slate-100 active:scale-95 transition-all flex items-center justify-center gap-1.5"><Eye size={16}/> 观望</button>
                  <Button disabled={prof===null || isAntiTouchActive} fullWidth onClick={()=>handleFinishCard(false)} className={`flex-[2.5] py-3.5 text-base font-black border-0 shadow-lg ${prof===null?'bg-slate-100 text-slate-300':'bg-indigo-600 text-white active:scale-95'}`}>确认继续 (Enter) <ArrowRight size={18} className="ml-1.5"/></Button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 侧边栏 - 复习队列 */}
        <div className={`absolute top-0 right-0 h-full w-[300px] bg-white border-l shadow-2xl transition-transform duration-300 z-[70] flex flex-col ${showQueue?'translate-x-0':'translate-x-full'}`}>
          <div className="p-4 flex justify-between items-center border-b shrink-0 bg-slate-50">
            <h3 className="font-black text-slate-800 text-xs flex items-center gap-2"><ListOrdered size={14}/> 队列</h3>
            <button onClick={()=>setShowQueue(false)}><X size={18} className="text-slate-400"/></button>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
            {deck.queue.map((id, idx) => {
              const p = deck.phrases.find(it => it.id === id); if(!p) return null;
              return (
                <div key={id} className={`flex items-center justify-between p-2 rounded-lg border text-[11px] ${id===activeId?'bg-indigo-50 border-indigo-200 shadow-sm':'border-transparent hover:bg-slate-50'}`}>
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className={`font-black w-4 text-center ${id===activeId?'text-indigo-600':'text-slate-300'}`}>{idx+1}</span>
                    <div className="truncate font-bold text-slate-700">{p.chinese}</div>
                  </div>
                  <div className="px-1.5 py-0.5 rounded text-[9px] font-black text-white shrink-0 ml-2" style={{backgroundColor:getScoreBadgeColor(p.score)}}>{getPhraseLabel(p.score)}</div>
                </div>
              );
            })}
            {deck.coolingPool && deck.coolingPool.length > 0 && (
              <>
                <div className="relative py-4 flex items-center justify-center"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-sky-100"></div></div><span className="relative bg-white px-3 text-[8px] font-black text-sky-400 tracking-widest uppercase">Cooling Pool</span></div>
                {[...deck.coolingPool].sort((a,b)=>a.wait-b.wait).map((c) => {
                  const p = deck.phrases.find(it => it.id === c.id); if(!p) return null;
                  return (
                    <div key={c.id} className="flex items-center justify-between p-2 rounded-lg opacity-60 text-[10px]">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="font-black w-7 text-center text-sky-500 bg-sky-50 rounded py-0.5 border border-sky-100">{c.wait}</span>
                        <div className="truncate text-slate-500 font-medium">{p.chinese}</div>
                      </div>
                      <div className="px-1 py-0.5 rounded text-[8px] font-black text-white opacity-40" style={{backgroundColor:getScoreBadgeColor(p.score)}}>{getPhraseLabel(p.score)}</div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* 侧边栏 - 状态大盘分布 */}
        <div className={`absolute top-0 left-0 h-full w-[300px] bg-white border-r shadow-2xl transition-transform duration-300 z-[70] flex flex-col ${showStats?'translate-x-0':'-translate-x-full'}`}>
          <div className="p-4 flex justify-between items-center border-b shrink-0 bg-slate-50">
            <h3 className="font-black text-slate-800 text-xs flex items-center gap-2"><BarChart2 size={14}/> 状态统计</h3>
            <button onClick={()=>setShowStats(false)}><X size={18} className="text-slate-400"/></button>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-6">
            <div className="space-y-3">
               <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2"><TrendingUp size={12}/> Mastery Trend</h4>
               {renderTrendChart(masteryTrend, 120)}
            </div>
            <div className="pt-4 border-t">
               <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">全词库分布</h4>
               <div className="space-y-1">
                 {distributionData.map(([label, data]) => (
                    <div key={label} className="flex justify-between items-center p-2 bg-slate-50 rounded-lg border border-slate-100/50">
                      <span className="px-2 py-0.5 rounded text-[9px] font-black text-white shadow-sm" style={{backgroundColor: getScoreBadgeColor(data.score)}}>{label}</span>
                      <div className="flex items-center gap-1.5"><span className="text-xs font-black text-slate-700 font-mono">{data.count}</span><span className="text-[9px] text-slate-400 font-bold">词</span></div>
                    </div>
                 ))}
               </div>
            </div>
          </div>
        </div>

      </div>

      {/* 超出菜单范围的设置，如果需要的话可以放一个 Modal，目前 Settings2 已接管 */}
    </div>
  );
};
