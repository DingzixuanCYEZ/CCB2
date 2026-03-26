// src/components/ExamSession.tsx (Part 1)

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Deck, Phrase } from '../types';
import { Button } from './Button';
import { 
  ArrowLeft, CheckCircle2, XCircle, Trophy, Clock, StickyNote, 
  Shuffle, ArrowRight, AlertCircle, Settings2, Eye, RefreshCw, ListOrdered 
} from 'lucide-react';
import { 
  calculateNextState, calculateBack, calculateWatchBack, 
  getNScore, EPS, calculateMastery, getProficiencyLabel, 
  getScoreBadgeColor, getDynamicColor, mapSliderToBack, mapBackToSlider 
} from '../utils/algo';

interface ExamSessionProps {
  deck: Deck;
  questionCount: number;
  candidatePhraseIds?: string[];
  timeLimit?: number; // 单题限时
  onUpdateDeck: (updatedDeck: Deck) => void;
  onExit: () => void;
  onTimeUpdate: (seconds: number) => void;
  onSessionComplete?: (durationSeconds: number, counts: { count0_1: number; count2_3: number; count4_5: number }, cultivationGain: number) => void;
}

const ALGO_SETTINGS_KEY = 'recallflow_v2_algo_settings';
const ALGO_TIERS =[
  { name: '一档 (保守)', C: 3, base: 1.5 },
  { name: '二档 (稳健)', C: 3.5, base: 1.75 },
  { name: '三档 (标准)', C: 4, base: 2 },
  { name: '四档 (进阶)', C: 5, base: 2.5 },
  { name: '五档 (激进)', C: 6, base: 3 },
];

type ExamStep = 'QUESTION' | 'ANSWER' | 'RESULT';

const renderFormattedText = (text?: string) => {
  if (!text) return null;
  const parts = text.split(/\[(.*?)\]/g);
  return (
    <span className="overflow-wrap-anywhere break-words hyphens-none">
      {parts.map((part, i) => i % 2 === 1 ? <span key={i} className="text-orange-700 font-bold mx-0.5 border-b-2 border-orange-400">{part}</span> : <span key={i}>{part.replace(/\\n/g, '\n')}</span>)}
    </span>
  );
};

const cleanNote = (text?: string) => text ? text.replace(/\n\s*\n/g, '\n').trim() : "";
const formatTime = (totalSeconds: number) => `${Math.floor(totalSeconds / 60).toString().padStart(2, '0')}:${(totalSeconds % 60).toString().padStart(2, '0')}`;

export const ExamSession: React.FC<ExamSessionProps> = ({ 
  deck, questionCount, candidatePhraseIds, timeLimit = 0,
  onUpdateDeck, onExit, onTimeUpdate, onSessionComplete
}) => {
  // === 1. 考试数据与状态 ===
  const[questions, setQuestions] = useState<Phrase[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const[step, setStep] = useState<ExamStep>('QUESTION');
  const [isInitialized, setIsInitialized] = useState(false);
  
  // 成绩与统计
  const [results, setResults] = useState<{ phrase: Phrase, prof: number | 'watch', diff: number }[]>([]);
  const [profCounts, setProfCounts] = useState([0, 0, 0, 0, 0, 0]);
  const [cultivationGain, setCultivationGain] = useState<number>(0);
  
  const [sessionDuration, setSessionDuration] = useState(0);
  const[timeLeft, setTimeLeft] = useState(timeLimit);
  const [isTimeout, setIsTimeout] = useState(false);

  // 打分面板状态
  const [prof, setProf] = useState<number | null>(null);
  const[diff, setDiff] = useState<number>(2.5);
  const [customBack, setCustomBack] = useState<number | null>(null);
  const [computedBack, setComputedBack] = useState<number>(1);
  const[computedScore, setComputedScore] = useState<number>(0);
  const [isAntiTouchActive, setIsAntiTouchActive] = useState(false);

  // 考后处理配置
  const [postExamThreshold, setPostExamThreshold] = useState<number>(3); // 默认 <= 3 的词条将被提取重排
  const [interleaveRatio, setInterleaveRatio] = useState(1);

  const timerRef = useRef<number | null>(null);
  const questionTimerRef = useRef<number | null>(null);

  // 读取算法配置
  const algoSettings = useMemo(() => {
    try { const saved = localStorage.getItem(ALGO_SETTINGS_KEY); return saved ? JSON.parse(saved) : { tierIdx: 2, cap: 100 }; } 
    catch { return { tierIdx: 2, cap: 100 }; }
  },[]);

  // === 2. 初始化考卷 ===
  useEffect(() => {
    if (isInitialized) return;
    let pool = deck.phrases;
    if (candidatePhraseIds && candidatePhraseIds.length > 0) {
        pool = deck.phrases.filter(p => candidatePhraseIds.includes(p.id));
    }
    if (pool.length === 0) pool = deck.phrases;

    const shuffled = [...pool].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, Math.min(questionCount, pool.length));
    setQuestions(selected);
    setIsInitialized(true);
  },[deck.phrases, questionCount, candidatePhraseIds, isInitialized]);

  // === 3. 全局倒计时 ===
  useEffect(() => {
    if (step === 'RESULT' || !isInitialized) return;
    timerRef.current = window.setInterval(() => {
      onTimeUpdate(1);
      setSessionDuration(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timerRef.current!);
  }, [onTimeUpdate, step, isInitialized]);

  // === 4. 单题倒计时 ===
  useEffect(() => {
    if (step === 'QUESTION' && timeLimit > 0 && isInitialized) {
      setTimeLeft(timeLimit);
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
  },[step, timeLimit, isInitialized, currentIndex]);

  const currentPhrase = questions[currentIndex];

  // === 5. 动态计算观望和打分的预期值 ===
  const watchBackValue = useMemo(() => {
    if (!currentPhrase) return 1;
    const C = ALGO_TIERS[algoSettings.tierIdx].C;
    const base = ALGO_TIERS[algoSettings.tierIdx].base;
    const nscore = getNScore(currentPhrase.score ?? 0, diff);
    return calculateWatchBack(nscore, C, base);
  },[currentPhrase, diff, algoSettings]);

  useEffect(() => {
    if (step === 'ANSWER' && currentPhrase && prof !== null) {
      const todayDays = Math.floor(Date.now() / 86400000);
      const C = ALGO_TIERS[algoSettings.tierIdx].C;
      const base = ALGO_TIERS[algoSettings.tierIdx].base;
      const gap = (todayDays - (currentPhrase.date || todayDays)) + 1;
      
      const { newScore, nscore } = calculateNextState(currentPhrase.score, prof, diff, gap, C, base, algoSettings.cap);
      setComputedScore(newScore);
      setComputedBack(calculateBack(nscore, C, base));
    }
  },[step, prof, diff, currentPhrase, algoSettings]);

  // === 6. 快捷键支持 ===
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
        if (step === 'RESULT' || isAntiTouchActive || !isInitialized) return;
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

        if (step === 'QUESTION') {
            if (e.code === 'Space' || e.key === 'Enter') {
                e.preventDefault();
                if (currentPhrase) setDiff(currentPhrase.diff ?? 2.5);
                setStep('ANSWER');
            }
        } else if (step === 'ANSWER') {
            if (e.code === 'Space' || e.key === 'Enter') {
                e.preventDefault();
                if (prof !== null) handleVerdict(false);
            } else {
                const keyNum = parseInt(e.key);
                if (!isNaN(keyNum) && keyNum >= 0 && keyNum <= 5) {
                    e.preventDefault();
                    if (isTimeout && keyNum >= 4) return;
                    setProf(keyNum);
                } else if (e.code === 'KeyW') {
                    e.preventDefault();
                    handleVerdict(true);
                }
            }
        }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  },[step, isInitialized, prof, isTimeout, isAntiTouchActive, currentPhrase]);

  // === 7. 核心打分引擎 (不改变单本 Queue 顺序) ===
  const handleVerdict = useCallback((isWatch: boolean) => {
    if (currentIndex >= questions.length || isAntiTouchActive || !currentPhrase) return;

    setIsAntiTouchActive(true);
    setTimeout(() => setIsAntiTouchActive(false), 300);

    const todayDays = Math.floor(Date.now() / 86400000);
    const gap = (todayDays - (currentPhrase.date || todayDays)) + 1;
    const C = ALGO_TIERS[algoSettings.tierIdx].C;
    const base = ALGO_TIERS[algoSettings.tierIdx].base;

    let newScore = currentPhrase.score;
    let finalBack = currentPhrase.back || 1;

    // 统分逻辑
    if (isWatch) {
      finalBack = customBack ?? watchBackValue;
    } else {
      if (prof === null) { setIsAntiTouchActive(false); return; }
      const res = calculateNextState(currentPhrase.score, prof, diff, gap, C, base, algoSettings.cap);
      newScore = res.newScore;
      finalBack = customBack !== null ? customBack : computedBack;

      setProfCounts(prev => {
        const next = [...prev];
        next[prof!] += 1;
        return next;
      });

      const gainMap =[-1.0, -0.6, -0.2, 0.2, 0.6, 1.0];
      setCultivationGain(prev => prev + gainMap[prof]);
    }

    const isCleared = finalBack > algoSettings.cap;
    const updatedPhrase: Phrase = {
      ...currentPhrase,
      score: isWatch ? currentPhrase.score : newScore,
      diff: diff,
      date: todayDays,
      back: finalBack,
      totalReviews: currentPhrase.totalReviews + 1,
      mastery: calculateMastery(getNScore(isWatch ? (currentPhrase.score ?? 0) : newScore!, diff)),
      lastReviewedAt: Date.now(),
      clearedDate: isCleared ? todayDays : currentPhrase.clearedDate
    };

    // 记录结果（注意考试期间不立刻触发 onUpdateDeck 改变队列）
    setResults(prev =>[...prev, { phrase: updatedPhrase, prof: isWatch ? 'watch' : prof!, diff }]);

    // 进入下一题
    if (currentIndex < questions.length - 1) {
        setCurrentIndex(prev => prev + 1);
        setStep('QUESTION');
        setProf(null);
        setCustomBack(null);
        setIsTimeout(false);
        setTimeLeft(timeLimit);
    } else {
        setStep('RESULT');
    }
  },[currentIndex, questions, isAntiTouchActive, algoSettings, diff, prof, timeLimit, customBack, watchBackValue, computedBack]);

  // === 8. 考试结算与错题重排引擎 ===
  const handleFinishExam = (sortType: 'none' | 'top' | 'interleave' = 'none') => {
    let finalQueue = [...deck.queue];
    const updatedPhrasesMap = new Map(results.map(r =>[r.phrase.id, r.phrase]));

    // 仅针对非观望、且熟练度 <= threshold 的词条进行错题提取
    const targetIds = results
        .filter(r => r.prof !== 'watch' && r.prof <= postExamThreshold)
        .map(r => r.phrase.id);

    if (sortType !== 'none' && targetIds.length > 0) {
        const otherIds = finalQueue.filter(id => !targetIds.includes(id));
        let newQueue: string[] =[];

        if (sortType === 'top') {
            newQueue =[...targetIds, ...otherIds];
        } else if (sortType === 'interleave') {
            const ratio = Math.max(1, interleaveRatio);
            let tIdx = 0;
            for (let oIdx = 0; oIdx < otherIds.length; oIdx++) {
                newQueue.push(otherIds[oIdx]);
                if ((oIdx + 1) % ratio === 0 && tIdx < targetIds.length) {
                    newQueue.push(targetIds[tIdx++]);
                }
            }
            while (tIdx < targetIds.length) {
                newQueue.push(targetIds[tIdx++]);
            }
        }
        finalQueue = newQueue;
    }

    // 批量更新 Phrase 属性和新 Queue
    const finalPhrases = deck.phrases.map(p => updatedPhrasesMap.get(p.id) || p);
    onUpdateDeck({ ...deck, queue: finalQueue, phrases: finalPhrases });

    if (onSessionComplete && results.length > 0) {
        onSessionComplete(sessionDuration, profCounts, cultivationGain);
    }
    onExit();
  };

  if (questions.length === 0) return <div className="fixed inset-0 bg-white flex items-center justify-center font-black text-slate-400">准备试卷中...</div>;
// src/components/ExamSession.tsx (Part 2) 接着上文



  // ========== UI 渲染逻辑 ==========

  if (step === 'RESULT') {
    // 过滤掉观望的词条，计算实际得分百分比
    const validResults = results.filter(r => r.prof !== 'watch');
    const examScore = validResults.length > 0 
        ? (validResults.reduce((sum, r) => sum + ((r.prof as number) / 5), 0) / validResults.length) * 100 
        : 0;
    
    // 根据当前阈值计算被判定为“错题”的数量
    const wrongCount = validResults.filter(r => (r.prof as number) <= postExamThreshold).length;

    return (
      <div className="fixed inset-0 bg-slate-50 flex flex-col items-center justify-start p-4 overflow-y-auto custom-scrollbar z-50 animate-in fade-in duration-300">
        <div className="max-w-2xl w-full bg-white rounded-3xl shadow-2xl p-6 sm:p-10 space-y-8 my-6 flex flex-col">
          
          <div className="text-center">
            <div className="mx-auto w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mb-4"><Trophy className="w-10 h-10 text-indigo-600" /></div>
            <h2 className="text-3xl font-black text-slate-900">考试结算</h2>
            <p className="text-slate-400 text-sm font-bold uppercase tracking-widest mt-2">{deck.name}</p>
          </div>
          
          <div className="grid grid-cols-2 gap-6 py-6 border-t border-b border-slate-50 text-center">
             <div>
               <div className="text-slate-300 text-xs uppercase font-black tracking-wider mb-1">综合得分</div>
               <div className="text-4xl font-black" style={{ color: getDynamicColor(examScore) }}>{examScore.toFixed(1)}<span className="text-2xl">%</span></div>
               <div className="text-[10px] font-bold text-slate-400 mt-2">基于 0-5 分制精确映射</div>
             </div>
             <div className="flex flex-col justify-center">
               <div className="text-slate-300 text-xs uppercase font-black tracking-wider mb-1">考试耗时</div>
               <div className="text-4xl font-black text-slate-800">{formatTime(sessionDuration)}</div>
             </div>
          </div>
          
          <div className="space-y-4">
              <div className="flex justify-between items-center">
                  <h3 className="text-sm font-black text-slate-800 flex items-center gap-2"><ListOrdered className="w-4 h-4"/> 考卷复盘 ({results.length})</h3>
                  <div className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md">获得修为: {cultivationGain > 0 ? '+' : ''}{cultivationGain.toFixed(1)}</div>
              </div>
              <div className="space-y-2 max-h-[30vh] overflow-y-auto custom-scrollbar pr-2 border border-slate-100 p-2 rounded-2xl bg-slate-50/50">
                  {results.slice().sort((a,b) => {
                      const scoreA = a.prof === 'watch' ? 2.5 : a.prof;
                      const scoreB = b.prof === 'watch' ? 2.5 : b.prof;
                      return scoreA - scoreB;
                  }).map((item, idx) => (
                      <div key={idx} className="flex items-center p-3 rounded-xl bg-white border border-slate-100 shadow-sm">
                          <div className={`shrink-0 w-12 text-center text-xs font-black px-2 py-1 rounded-lg ${item.prof === 'watch' ? 'bg-slate-100 text-slate-500' : item.prof >= 4 ? 'bg-emerald-100 text-emerald-600' : item.prof >= 2 ? 'bg-amber-100 text-amber-600' : 'bg-rose-100 text-rose-600'}`}>
                             {item.prof === 'watch' ? '观望' : `${item.prof}分`}
                          </div>
                          <div className="flex-1 grid grid-cols-2 gap-4 ml-4 text-sm">
                              <div className="font-bold text-slate-700 truncate">{item.phrase.chinese}</div>
                              <div className="font-medium text-slate-500 truncate text-right">{item.phrase.english}</div>
                          </div>
                      </div>
                  ))}
              </div>
          </div>

          <div className="pt-6 border-t border-slate-100">
             <div className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 text-center">考后错题处理 (Post-Exam Action)</div>
             
             {/* 自定义重排阈值 */}
             <div className="flex items-center justify-center gap-3 mb-6 bg-slate-50 p-3 rounded-xl border border-slate-100">
                 <span className="text-xs font-bold text-slate-500">将熟练度 &le;</span>
                 <input type="number" min="0" max="5" value={postExamThreshold} onChange={e => setPostExamThreshold(Math.max(0, Math.min(5, parseInt(e.target.value) || 0)))} className="w-16 text-center text-base font-black p-1.5 rounded-lg border border-slate-200 text-indigo-600 outline-none focus:ring-2 ring-indigo-400 shadow-sm" />
                 <span className="text-xs font-bold text-slate-500">的词条提取重排：</span>
             </div>

             {wrongCount > 0 ? (
                 <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Button onClick={() => handleFinishExam('none')} variant="secondary" className="py-4 text-xs font-bold rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200">
                        保持原序 (不动)
                    </Button>
                    <Button onClick={() => handleFinishExam('top')} className="py-4 text-xs font-bold rounded-xl bg-rose-50 text-rose-600 border border-rose-100 hover:bg-rose-100 shadow-sm">
                        提取并全部置顶
                    </Button>
                    <div className="flex flex-col gap-2">
                      <Button onClick={() => handleFinishExam('interleave')} className="py-4 text-xs font-bold rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 hover:bg-indigo-100 shadow-sm flex-1">
                          按 1:{interleaveRatio} 比例穿插
                      </Button>
                      <div className="flex items-center justify-center gap-2 bg-indigo-50/50 px-2 py-1.5 rounded-lg border border-indigo-100">
                          <span className="text-[10px] font-bold text-indigo-400 uppercase">Ratio</span>
                          <input type="number" min="1" max="20" value={interleaveRatio} onChange={(e) => setInterleaveRatio(Math.max(1, parseInt(e.target.value) || 1))} className="w-12 text-center text-xs font-black p-1 rounded border border-indigo-200 text-indigo-900 focus:ring-2 ring-indigo-400 outline-none bg-white" />
                      </div>
                    </div>
                 </div>
             ) : (
                <div className="flex justify-center mt-2">
                    <Button onClick={() => handleFinishExam('none')} className="py-4 px-10 text-lg font-black bg-slate-900 text-white shadow-xl rounded-2xl">完成考试并返回</Button>
                </div>
             )}
          </div>
        </div>
      </div>
    );
  }

  // === 正常考试题目/答案视图 ===
  const isEnToCn = deck.studyMode === 'EN_CN';
  const questionText = isEnToCn ? currentPhrase.english : currentPhrase.chinese;
  const answerText = isEnToCn ? currentPhrase.chinese : currentPhrase.english;
  
  const isNew = currentPhrase.score === undefined || currentPhrase.score === 0;
  const profLabelsNew =["完全没思路", "思路大体对", "缺东西", "差一点", "正确但不确定", "正确"];
  const profLabelsOld =["完全没印象", "印象不清楚", "缺东西", "差一点", "勉强想出", "快速想出"];
  const currentLabels = isNew ? profLabelsNew : profLabelsOld;

  return (
    <div className="fixed inset-0 bg-slate-50 z-[100] flex flex-col h-full overflow-hidden">
      
      {/* 顶栏控制区 */}
      <div className="bg-white shadow-sm shrink-0 relative z-[60]">
        <div className="flex items-center justify-between px-3 py-2 gap-3 h-14">
          <button onClick={onExit} className="p-2 text-slate-400 hover:text-slate-600 active:scale-95 transition-transform shrink-0"><ArrowLeft className="w-5 h-5"/></button>
          
          <div className="flex-1 flex flex-col justify-center max-w-[70%] sm:max-w-[50%]">
            <div className="flex justify-between items-end mb-1 leading-none">
              <span className="text-[10px] text-slate-400 font-bold truncate pr-2">考试中 · {deck.name}</span>
              <span className="text-[10px] font-mono font-bold text-slate-400">{formatTime(sessionDuration)}</span>
            </div>
            
            {/* 考试进度条 */}
            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden relative border border-slate-50">
              <div className="absolute top-0 left-0 h-full bg-indigo-500 transition-all duration-300 ease-out" style={{ width: `${((currentIndex) / questions.length) * 100}%` }}></div>
            </div>
            
            <div className="flex justify-between items-start mt-1 leading-none">
              <span className="text-[10px] font-black text-indigo-500">{((currentIndex / questions.length) * 100).toFixed(0)}%</span>
              <span className="text-[10px] font-bold text-slate-400 flex items-center">
                题号: {currentIndex + 1} / {questions.length}
              </span>
            </div>
          </div>
          
          <div className="w-10 shrink-0" />
        </div>
      </div>

      <div className="flex-1 flex relative overflow-hidden">
        <div className="flex-1 flex flex-col items-center p-4 sm:p-6 transition-all duration-300">
          
          {/* 中心答题卡 */}
          <div className="w-full max-w-2xl bg-white rounded-3xl shadow-xl border border-slate-100 flex flex-col h-full max-h-[calc(100vh-90px)] sm:max-h-[600px] overflow-hidden relative">
            
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 sm:p-8 flex flex-col items-center w-full relative">
              
              <div className="w-full flex justify-between items-center mb-6">
                 <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest border px-2 py-0.5 rounded-full">
                    Question {currentIndex + 1}
                 </span>
              </div>

              {/* 题目 */}
              <div className="w-full flex flex-col items-center text-center pt-4 mb-6">
                <h1 className="text-2xl sm:text-3xl font-black text-slate-800 leading-snug break-words max-w-full">
                  {renderFormattedText(questionText)}
                </h1>
                
                {/* 倒计时条 */}
                {step === 'QUESTION' && timeLimit > 0 && (
                  <div className="mt-8 flex flex-col items-center animate-in fade-in">
                    <div className={`text-sm font-black tabular-nums mb-2 flex items-center justify-center gap-1 ${isTimeout ? 'text-rose-500' : 'text-indigo-400'}`}>
                      {isTimeout ? <><AlertCircle className="w-4 h-4"/> 已超时</> : <><Clock className="w-4 h-4"/> {timeLeft.toFixed(1)}s</>}
                    </div>
                    <div className="w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full transition-all duration-100 ease-linear ${isTimeout ? 'bg-rose-500' : 'bg-indigo-400'}`} style={{ width: `${isTimeout ? 100 : (timeLeft / timeLimit) * 100}%` }} />
                    </div>
                  </div>
                )}
              </div>

              {/* 答案区与打分控制台 */}
              {step === 'ANSWER' && (
                <div className="w-full flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-300 pb-4 mt-auto">
                  <div className="text-center py-2 px-4 rounded-xl w-full mb-4">
                    <p className="text-xl sm:text-2xl font-black text-indigo-600 leading-snug break-words max-w-full inline-block">
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
                    
                    {/* 难度 */}
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 shadow-sm">
                      <div className="flex justify-between items-center mb-3 ml-1">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">修正记忆难度 (Difficulty)</span>
                        <span className="font-black text-indigo-600 mr-2 text-sm">{diff}</span>
                      </div>
                      <div className="flex gap-1.5">
                        {[0, 1, 2, 3, 4, 5].map(v => (
                          <button key={v} onClick={() => setDiff(v)} className={`flex-1 py-2.5 rounded-lg font-black text-sm transition-all border-2 ${diff === v ? 'bg-indigo-500 border-indigo-500 text-white shadow-md transform scale-105' : 'bg-white border-slate-200 text-slate-400 hover:border-indigo-300'}`}>{v}</button>
                        ))}
                      </div>
                    </div>

                    {/* 熟练度 - 单行平铺 */}
                    <div>
                       <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 ml-1">该题真实得分 (Score 0-5)</span>
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

                    {/* 亮色后推面板与实时预测 */}
                    <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 shadow-sm animate-in slide-in-from-bottom-2">
                      <div className="flex justify-between items-center mb-4">
                          <div className="flex flex-col">
                            <span className="text-xs font-black text-indigo-900 uppercase tracking-widest flex items-center gap-1.5"><Settings2 size={14}/> 考后预期后推步数 (Back)</span>
                            <div className="text-[10px] font-bold text-slate-500 mt-1 flex items-center gap-1">
                              <span>状态预测:</span>
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
              
              {/* 阻挡层 */}
              {isAntiTouchActive && <div className="absolute inset-0 z-20 cursor-not-allowed"></div>}
            </div>
            
            {/* 底部操作区 */}
            <div className="p-4 sm:p-5 bg-white border-t border-slate-100 shrink-0">
              {step === 'QUESTION' ? (
                <Button fullWidth onClick={() => setStep('ANSWER')} className="py-4 text-lg font-black shadow-lg shadow-indigo-100">查看答案 (Space)</Button>
              ) : (
                <div className="flex gap-3">
                  <button onClick={() => handleVerdict(true)} className="flex-1 flex items-center justify-center gap-2 py-4 bg-slate-100 text-slate-600 rounded-xl font-black text-sm hover:bg-slate-200 transition-all border border-slate-200 shadow-sm"><Eye size={18}/> 不计分观望 (W)</button>
                  <Button disabled={prof === null || isAntiTouchActive} fullWidth onClick={() => handleVerdict(false)} className={`flex-[2] py-4 text-lg font-black shadow-lg transition-all ${prof === null ? 'bg-slate-200 text-slate-400 border-none' : 'bg-indigo-600 text-white shadow-indigo-200/50'}`}>
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
