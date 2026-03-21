// src/App.tsx (Part 1)

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { AppView, Deck, GlobalStats, Folder, Phrase } from './types';
import { StudySession } from './components/StudySession';
import { DailyReviewSession } from './components/DailyReviewSession';
import { Button } from './components/Button';
import { 
  BookOpen, ArrowLeft, Flame, CheckCircle2, ChevronRight,
  Folder as FolderIcon, ScrollText, PlusCircle, Bug
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { getRealmInfo, getPersistenceGrade } from './utils/realms';

const STORAGE_KEY = 'recallflow_v2_decks';
const STATS_KEY = 'recallflow_v2_stats';
const FOLDERS_KEY = 'recallflow_v2_folders';

const DEFAULT_CAP = 100;

export const App: React.FC = () => {
  const [view, setView] = useState<AppView>(AppView.DASHBOARD);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const[activeDeckId, setActiveDeckId] = useState<string | null>(null);
  
  // 每日复习调度状态
  const [dailyReviewSetup, setDailyReviewSetup] = useState(false);
  const [selectedDeckIds, setSelectedDeckIds] = useState<Set<string>>(new Set());

  const[stats, setStats] = useState<GlobalStats>({
    totalReviewCount: 0,
    totalPhrasesCount: 0,
    totalStudyTimeSeconds: 0,
    subjectStats: { English: 0, Chinese: 0 },
    daily: { 
      date: new Date().toLocaleDateString('en-CA'), 
      reviewCount: 0, count0_1: 0, count2_3: 0, count4_5: 0, 
      reviewedPhraseIds:[], studyTimeSeconds: 0, activities:[] 
    },
    persistence: { 
        English: { baseScore: 0, lastDate: '', prevDayFinalScore: 0 }, 
        Chinese: { baseScore: 0, lastDate: '', prevDayFinalScore: 0 } 
    }
  });

  // ========== 1. 存档初始化、平滑迁移与每日衰减引擎 ==========
  useEffect(() => {
    const todayDays = Math.floor(Date.now() / 86400000);
    const todayStr = new Date().toLocaleDateString('en-CA');
    
    // 加载文件夹
    const storedFolders = localStorage.getItem(FOLDERS_KEY);
    if (storedFolders) setFolders(JSON.parse(storedFolders));

    // 加载全局统计与坚持衰减
    const storedStats = localStorage.getItem(STATS_KEY);
    if (storedStats) {
        try {
            const parsed = JSON.parse(storedStats);
            let baseStats = { ...parsed, subjectStats: parsed.subjectStats || { English: 0, Chinese: 0 } };
            
            // 坚持分数隔日衰减处理
            ['English', 'Chinese'].forEach(subj => {
                const subject = subj as 'English' | 'Chinese';
                const pData = baseStats.persistence[subject];
                if (pData && pData.lastDate !== todayStr) {
                    let lastX = 0;
                    if (parsed.daily && parsed.daily.date === pData.lastDate) {
                        const acts = parsed.daily.activities ||[];
                        lastX = acts.filter((a: any) => (a.deckSubject || 'English') === subject).reduce((sum: number, a: any) => sum + a.count, 0);
                    }
                    const finalScore = pData.baseScore + 100 * Math.log(1 + lastX / 100);
                    pData.prevDayFinalScore = finalScore;
                    pData.baseScore = finalScore * 0.98; // 衰减 2%
                    pData.lastDate = todayStr;
                }
            });

            if (baseStats.daily?.date !== todayStr) {
                baseStats.daily = { date: todayStr, reviewCount: 0, count0_1: 0, count2_3: 0, count4_5: 0, reviewedPhraseIds: [], studyTimeSeconds: 0, activities:[] };
            }
            setStats(baseStats);
        } catch(e) { console.error("Stats parse error", e); }
    }

    // 加载单词本，执行自动迁移与 Back 衰减
    const storedDecks = localStorage.getItem(STORAGE_KEY);
    if (storedDecks) {
      try {
        const parsed = JSON.parse(storedDecks) as Deck[];
        const migratedDecks = parsed.map(deck => ({
          ...deck,
          phrases: deck.phrases.map(p => {
            let updatedP = { ...p };
            // A. 旧数据迁移到浮点数系统
            if (updatedP.score === undefined) {
              const isNew = !updatedP.consecutiveCorrect && !updatedP.consecutiveWrong;
              let score = isNew ? undefined : (updatedP.consecutiveCorrect! > 0 ? updatedP.consecutiveCorrect : -updatedP.consecutiveWrong!);
              updatedP = { ...updatedP, score, diff: 2.5, back: 0, date: todayDays };
            }
            
            // B. 跨日自动扣减 Back (每日复习的核心触发器)
            if (updatedP.score !== undefined && updatedP.score !== 0) {
               const pDate = updatedP.date || todayDays;
               const gap = todayDays - pDate;
               if (gap > 0) {
                   const decay = DEFAULT_CAP * gap / 10 + DEFAULT_CAP;
                   updatedP.back = (updatedP.back || 0) - decay;
                   updatedP.date = todayDays;
               }
            }
            return updatedP;
          })
        }));
        setDecks(migratedDecks);
      } catch (e) { console.error("Decks parse error", e); }
    }
  },[]);

  // ========== 2. 持久化数据 ==========
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(decks)); }, [decks]);
  useEffect(() => { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); }, [stats]);
  useEffect(() => { localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders)); }, [folders]);

  // ========== 3. 用于测试的假数据生成器 ==========
  const handleAddTestDeck = () => {
    const newDeck: Deck = {
      id: uuidv4(),
      name: "🧪 测试修仙图谱 " + new Date().toLocaleTimeString().slice(0,5),
      subject: 'English',
      contentType: 'Word',
      studyMode: 'EN_CN',
      phrases:[
        { id: uuidv4(), english: "Epiphany", chinese: "顿悟", totalReviews: 0, score: undefined, diff: 2.5, back: 0, date: Math.floor(Date.now()/86400000) },
        { id: uuidv4(), english: "Tribulation", chinese: "天劫", totalReviews: 0, score: -2, diff: 3.5, back: -50, date: Math.floor(Date.now()/86400000) },
        { id: uuidv4(), english: "Nirvana", chinese: "涅槃", totalReviews: 0, score: 3.5, diff: 1.5, back: -10, date: Math.floor(Date.now()/86400000) },
        { id: uuidv4(), english: "Meridian", chinese: "经脉", totalReviews: 0, score: 5.2, diff: 2.0, back: 500, date: Math.floor(Date.now()/86400000) },
      ],
      queue:[],
      coolingPool:[]
    };
    newDeck.queue = newDeck.phrases.map(p => p.id);
    setDecks(prev => [...prev, newDeck]);
  };
// src/App.tsx (Part 2) 接着上文

  // ========== 4. 核心辅助函数 ==========
  const updateDeck = useCallback((updatedDeck: Deck) => { 
    setDecks(prev => prev.map(d => d.id === updatedDeck.id ? updatedDeck : d)); 
  },[]);

  const handleTimeUpdate = useCallback((seconds: number) => { 
    setStats(prev => ({ 
      ...prev, totalStudyTimeSeconds: (prev.totalStudyTimeSeconds || 0) + seconds, 
      daily: { ...prev.daily, studyTimeSeconds: (prev.daily?.studyTimeSeconds || 0) + seconds } 
    })); 
  },[]);

  const getPendingCount = useCallback((deck: Deck) => {
    return deck.phrases.filter(p => p.score !== undefined && (p.back || 0) <= 0).length;
  },[]);

  const hasPendingReviews = useCallback((scope: 'deck' | 'folder', id: string): boolean => {
    if (scope === 'deck') {
      return getPendingCount(decks.find(x => x.id === id)!) > 0;
    } else {
      const childDecks = decks.filter(d => d.folderId === id);
      if (childDecks.some(d => getPendingCount(d) > 0)) return true;
      const childFolders = folders.filter(f => f.parentId === id);
      return childFolders.some(f => hasPendingReviews('folder', f.id));
    }
  },[decks, folders, getPendingCount]);

  // ========== 5. 视图渲染：每日复习勾选面板 ==========
  const renderDailyReviewSetup = () => {
    const pendingDecks = decks.filter(d => getPendingCount(d) > 0);
    const totalPending = Array.from(selectedDeckIds).reduce((sum, id) => sum + getPendingCount(decks.find(d => d.id === id)!), 0);

    return (
      <div className="max-w-3xl mx-auto p-6 space-y-6 animate-in fade-in duration-300">
        <div className="flex items-center gap-4">
          <button onClick={() => setDailyReviewSetup(false)} className="p-2 hover:bg-slate-100 rounded-full"><ArrowLeft /></button>
          <div>
            <h2 className="text-2xl font-black text-slate-800 flex items-center gap-2"><Flame className="text-rose-500"/> 每日复习调度中心</h2>
            <p className="text-xs font-bold text-slate-400 mt-1">选中的词条在复习后 back &gt; 100 即视为通关并移出队列</p>
          </div>
        </div>

        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6">
          <div className="flex justify-between items-center mb-4 pb-4 border-b border-slate-50">
            <span className="text-sm font-black text-slate-600">待复习词组本 ({pendingDecks.length})</span>
            <Button variant="ghost" onClick={() => setSelectedDeckIds(new Set(pendingDecks.map(d => d.id)))}>全选 / 全不选</Button>
          </div>
          
          {pendingDecks.length === 0 ? (
            <div className="text-center py-12 text-slate-400 font-bold">今天没有需要复习的词条啦！🎉</div>
          ) : (
            <div className="space-y-3 max-h-[50vh] overflow-y-auto custom-scrollbar pr-2">
              {pendingDecks.map(deck => {
                const count = getPendingCount(deck);
                const isSelected = selectedDeckIds.has(deck.id);
                return (
                  <div key={deck.id} onClick={() => {
                    const next = new Set(selectedDeckIds);
                    if (next.has(deck.id)) next.delete(deck.id); else next.add(deck.id);
                    setSelectedDeckIds(next);
                  }} className={`p-4 rounded-2xl border-2 cursor-pointer transition-all flex items-center justify-between ${isSelected ? 'border-rose-500 bg-rose-50' : 'border-slate-100 hover:border-rose-200'}`}>
                    <div className="flex items-center gap-4">
                      <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${isSelected ? 'border-rose-500 bg-rose-500' : 'border-slate-300'}`}>
                        {isSelected && <CheckCircle2 className="w-4 h-4 text-white"/>}
                      </div>
                      <div>
                        <div className={`font-black ${isSelected ? 'text-rose-900' : 'text-slate-700'}`}>{deck.name}</div>
                        <div className="text-[10px] font-bold text-slate-400 mt-0.5">{deck.subject === 'English' ? '英语' : '语文'}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-black text-rose-500">{count}</span>
                      <span className="text-xs font-bold text-slate-400">词</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="fixed bottom-0 left-0 right-0 p-6 bg-white/90 backdrop-blur-md border-t border-slate-100 flex justify-center">
          <div className="w-full max-w-3xl flex gap-4">
            <Button variant="secondary" className="py-4 px-8 font-black" onClick={() => setDailyReviewSetup(false)}>取消</Button>
            <Button className="flex-1 py-4 text-lg font-black bg-rose-600 hover:bg-rose-700 shadow-lg shadow-rose-200" disabled={totalPending === 0} onClick={() => {
              setView(AppView.DAILY_REVIEW);
            }}>
              开始乱序复习 ({totalPending} 词)
            </Button>
          </div>
        </div>
      </div>
    );
  };

  // ========== 6. 主仪表盘 UI ==========
  const renderDashboard = () => {
    if (dailyReviewSetup) return renderDailyReviewSetup();

    const visibleFolders = folders.filter(f => (f.parentId || null) === currentFolderId);
    const visibleDecks = decks.filter(d => (d.folderId || null) === currentFolderId);
    
    const englishRealm = getRealmInfo(stats.subjectStats.English || 0, 'English');
    const chineseRealm = getRealmInfo(stats.subjectStats.Chinese || 0, 'Chinese');
    
    const getPersistence = (subj: 'English' | 'Chinese') => {
        const pData = stats.persistence?.[subj] || { baseScore: 0 };
        const acts = stats.daily.activities ||[];
        const dailyCount = acts.filter(a => (a.deckSubject || 'English') === subj).reduce((sum, a) => sum + a.count, 0);
        const score = pData.baseScore + 100 * Math.log(1 + dailyCount / 100);
        return { score, info: getPersistenceGrade(score) };
    };

    return (
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-indigo-50 rounded-2xl border border-indigo-100 shadow-sm cursor-pointer" onClick={() => setCurrentFolderId(null)}>
              <ScrollText className="text-indigo-600 w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight leading-none">Chant Cultivation Bureau</h1>
              <span className="text-sm font-bold text-slate-500 tracking-widest block mt-1.5">吟诵仙宗 V2 - 测试版</span>
            </div>
          </div>
          <div className="flex gap-3 flex-wrap">
            <Button onClick={handleAddTestDeck} variant="outline" className="text-sm font-bold border-emerald-200 text-emerald-700 bg-emerald-50"><Bug className="w-4 h-4 mr-1"/> 注入测试数据</Button>
            <Button onClick={() => setDailyReviewSetup(true)} className="px-5 py-2 text-sm font-black shadow-lg shadow-rose-200 bg-rose-500 hover:bg-rose-600"><Flame className="w-4 h-4 mr-2" /> 每日大盘复习</Button>
          </div>
        </div>
          
        {currentFolderId === null && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 英语境界 */}
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
              <div className="flex items-center justify-between mb-4">
                <span className="text-slate-400 font-bold uppercase text-xs tracking-wider">英语修为 (English)</span>
                <div className="text-4xl font-black text-indigo-600">{stats.subjectStats.English.toFixed(1)}</div>
              </div>
              <div className="mb-6">
                <div className="flex justify-between items-end mb-1.5">
                  <span className={`text-sm font-black ${englishRealm.color}`}>{englishRealm.name}</span>
                  <span className="text-[10px] text-slate-400 font-bold">距下阶还差 {englishRealm.remain}</span>
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full transition-all duration-1000 ${englishRealm.bg.replace('50', '500')}`} style={{ width: `${englishRealm.percent}%` }}></div>
                </div>
              </div>
              <div className="flex justify-between items-end mb-1">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">坚持等级</span>
                <span className={`text-xs font-black ${getPersistence('English').info.color}`}>{getPersistence('English').info.grade} <span className="text-[9px] text-slate-300">({Math.round(getPersistence('English').score)})</span></span>
              </div>
            </div>
            
            {/* 语文品阶 */}
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
              <div className="flex items-center justify-between mb-4">
                <span className="text-slate-400 font-bold uppercase text-xs tracking-wider">语文品阶 (Chinese)</span>
                <div className="text-4xl font-black text-emerald-600">{stats.subjectStats.Chinese.toFixed(1)}</div>
              </div>
              <div className="mb-6">
                <div className="flex justify-between items-end mb-1.5">
                  <span className={`text-sm font-black ${chineseRealm.color}`}>{chineseRealm.name}</span>
                  <span className="text-[10px] text-slate-400 font-bold">距下阶还差 {chineseRealm.remain}</span>
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full transition-all duration-1000 ${chineseRealm.bg.replace('50', '500')}`} style={{ width: `${chineseRealm.percent}%` }}></div>
                </div>
              </div>
              <div className="flex justify-between items-end mb-1">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">坚持等级</span>
                <span className={`text-xs font-black ${getPersistence('Chinese').info.color}`}>{getPersistence('Chinese').info.grade} <span className="text-[9px] text-slate-300">({Math.round(getPersistence('Chinese').score)})</span></span>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {visibleFolders.map(folder => (
            <div key={folder.id} onClick={() => setCurrentFolderId(folder.id)} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 hover:border-amber-200 cursor-pointer relative">
              <FolderIcon className="w-10 h-10 text-amber-400 mb-3" />
              <h3 className="font-black text-slate-800 text-lg">{folder.name}</h3>
              {hasPendingReviews('folder', folder.id) && <div className="absolute top-4 right-4 w-3 h-3 bg-rose-500 rounded-full shadow-md border-2 border-white animate-pulse"></div>}
            </div>
          ))}
          {visibleDecks.map(deck => {
            const pending = getPendingCount(deck);
            return (
              <div key={deck.id} onClick={() => { setActiveDeckId(deck.id); setView(AppView.STUDY); }} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 hover:border-indigo-200 cursor-pointer relative">
                <div className={`p-3 rounded-xl w-fit mb-3 ${deck.subject === 'Chinese' ? 'bg-emerald-50 text-emerald-600' : 'bg-indigo-50 text-indigo-600'}`}>
                  <BookOpen className="w-6 h-6" />
                </div>
                <h3 className="font-black text-lg text-slate-800 mb-1 truncate">{deck.name}</h3>
                <span className="text-xs font-bold text-slate-400">{deck.phrases.length} 词条</span>
                {pending > 0 && <div className="absolute top-4 right-4 bg-rose-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-md border-2 border-white animate-pulse">{pending} 待复习</div>}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ========== 7. 主路由与视图调度 ==========
  return (
    <>
      {view === AppView.DASHBOARD && renderDashboard()}
      
      {activeDeckId && view === AppView.STUDY && (
        <StudySession
          deck={decks.find(d => d.id === activeDeckId)!}
          onUpdateDeck={updateDeck}
          onExit={() => setView(AppView.DASHBOARD)}
          onTimeUpdate={handleTimeUpdate}
          onSessionComplete={(dur, counts, cultGain) => { // 注意这里加了 cultGain
            setStats(prev => {
              const total = counts.count0_1 + counts.count2_3 + counts.count4_5;
              const subj = decks.find(d => d.id === activeDeckId)?.subject || 'English';
              const activities =[...(prev.daily.activities || [])];
              activities.push({ deckId: activeDeckId, deckName: decks.find(d => d.id === activeDeckId)?.name || '', mode: 'STUDY', count: total, ...counts, durationSeconds: dur, masteryGain: 0, timestamp: Date.now(), deckSubject: subj });
              return {
                ...prev, totalReviewCount: prev.totalReviewCount + total,
                subjectStats: { ...prev.subjectStats,[subj]: Math.max(0, prev.subjectStats[subj] + cultGain) }, // 精准使用从底层传来的修为增量
                daily: { ...prev.daily, reviewCount: prev.daily.reviewCount + total, count0_1: prev.daily.count0_1 + counts.count0_1, count2_3: prev.daily.count2_3 + counts.count2_3, count4_5: prev.daily.count4_5 + counts.count4_5, activities }
              };
            });
          }}
        />
      )}
      
      {view === AppView.DAILY_REVIEW && (
        <DailyReviewSession 
          selectedDecks={decks.filter(d => selectedDeckIds.has(d.id))}
          onUpdateDecks={(updatedDecks) => {
            setDecks(prev => prev.map(old => updatedDecks.find(u => u.id === old.id) || old));
          }}
          onExit={() => setView(AppView.DASHBOARD)}
          onTimeUpdate={handleTimeUpdate}
          onSessionComplete={(dur, counts) => {
            // 每日跨本复习大盘结算
            setStats(prev => {
              const total = counts.count0_1 + counts.count2_3 + counts.count4_5;
              const gain = (counts.count4_5 * 0.8) - (counts.count0_1 * 0.8);
              const activities = [...(prev.daily.activities || [])];
              activities.push({ deckId: 'daily_hub', deckName: '每日跨本乱序复习', mode: 'DAILY_REVIEW', count: total, ...counts, durationSeconds: dur, masteryGain: 0, timestamp: Date.now(), deckSubject: 'English' });
              return {
                ...prev, totalReviewCount: prev.totalReviewCount + total,
                subjectStats: { ...prev.subjectStats, English: Math.max(0, prev.subjectStats.English + gain/2), Chinese: Math.max(0, prev.subjectStats.Chinese + gain/2) },
                daily: { ...prev.daily, reviewCount: prev.daily.reviewCount + total, count0_1: prev.daily.count0_1 + counts.count0_1, count2_3: prev.daily.count2_3 + counts.count2_3, count4_5: prev.daily.count4_5 + counts.count4_5, activities }
              };
            });
          }}
        />
      )}
    </>
  );
};