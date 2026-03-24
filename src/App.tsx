// src/App.tsx (Part 1)
import { DeckEditor } from './components/DeckEditor';
import { Importer } from './components/Importer';
import { Database, PlusCircle } from 'lucide-react'; // 确保加上这几个图标
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { AppView, Deck, Phrase, GlobalStats, Folder } from './types';
import { StudySession } from './components/StudySession';
import { DailyReviewSession } from './components/DailyReviewSession';
import { ExamSession } from './components/ExamSession';
import { Button } from './components/Button';
import { 
  PlusCircle, BookOpen, ArrowLeft, X, Clock, Edit, Trash2, CopyPlus, GitMerge,
  FolderPlus, Folder as FolderIcon, Home, ScrollText, Play, GraduationCap,
  Flame, CheckCircle2, ChevronRight, Settings, FileText, Hash, Languages
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { getRealmInfo, getPersistenceGrade } from './utils/realms';
import { getScoreBadgeColor, getDynamicColor } from './utils/algo';

const STORAGE_KEY = 'recallflow_v2_decks';
const STATS_KEY = 'recallflow_v2_stats';
const FOLDERS_KEY = 'recallflow_v2_folders';
const DEFAULT_CAP = 100;

const getPhraseTag = (p: Phrase) => {
  if (p.score === undefined || p.score === 0) return '新';
  if (p.score > 0) return `对${Math.ceil(p.score)}`;
  return `错${Math.ceil(Math.abs(p.score))}`;
};

export const formatFullTime = (seconds: number) => { 
  if (seconds <= 0) return '0s'; 
  const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = seconds % 60; 
  if (h > 0) return `${h}h${m}m${s}s`; if (m > 0) return `${m}m${s}s`; return `${s}s`; 
};

export const App: React.FC = () => {
  const [view, setView] = useState<AppView>(AppView.DASHBOARD);
  const [decks, setDecks] = useState<Deck[]>([]);
  const[folders, setFolders] = useState<Folder[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  
  // 每日复习调度状态
  const[dailyReviewSetup, setDailyReviewSetup] = useState(false);
  const [selectedDeckIds, setSelectedDeckIds] = useState<Set<string>>(new Set());
// 弹窗状态
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const[showSettings, setShowSettings] = useState(false);

  // 建文件夹逻辑
  const handleCreateFolder = () => {
    if(!newFolderName.trim()) return;
    setFolders(prev =>[...prev, { id: uuidv4(), name: newFolderName, createdAt: Date.now(), parentId: currentFolderId || undefined }]);
    setNewFolderName('');
    setShowNewFolderModal(false);
  };

  // 建单词本逻辑
  const handleCreateDeck = (name: string, phrases: Phrase[], subject: DeckSubject, contentType: ContentType = 'PhraseSentence', studyMode: StudyMode = 'CN_EN') => {
    const newDeck: Deck = { 
      id: uuidv4(), name, subject, contentType, studyMode, phrases, queue: phrases.map(p => p.id), 
      stats: { totalStudyTimeSeconds: 0, totalReviewCount: 0 }, sessionHistory: [], 
      folderId: currentFolderId || undefined 
    }; 
    setDecks(prev =>[...prev, newDeck]); 
    setView(AppView.DASHBOARD); 
  };
  // 考试配置状态
  const [showExamSetup, setShowExamSetup] = useState(false);
  const [examConfig, setExamConfig] = useState<{ count: number; candidateIds?: string[] } | null>(null);
  const [tempExamCount, setTempExamCount] = useState(20);
  const [examTags, setExamTags] = useState<Set<string>>(new Set());

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

  // ========== 1. 存档初始化与跨日衰减 ==========
  useEffect(() => {
    const todayDays = Math.floor(Date.now() / 86400000);
    const todayStr = new Date().toLocaleDateString('en-CA');
    
    const storedFolders = localStorage.getItem(FOLDERS_KEY);
    if (storedFolders) setFolders(JSON.parse(storedFolders));

    const storedStats = localStorage.getItem(STATS_KEY);
    if (storedStats) {
        try {
            const parsed = JSON.parse(storedStats);
            let baseStats = { ...parsed, subjectStats: parsed.subjectStats || { English: 0, Chinese: 0 } };
            
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
                    pData.baseScore = finalScore * 0.98; 
                    pData.lastDate = todayStr;
                }
            });

            if (baseStats.daily?.date !== todayStr) {
                baseStats.daily = { date: todayStr, reviewCount: 0, count0_1: 0, count2_3: 0, count4_5: 0, reviewedPhraseIds:[], studyTimeSeconds: 0, activities:[] };
            }
            setStats(baseStats);
        } catch(e) { console.error(e); }
    }

    const storedDecks = localStorage.getItem(STORAGE_KEY);
    if (storedDecks) {
      try {
        const parsed = JSON.parse(storedDecks) as Deck[];
        const migratedDecks = parsed.map(deck => ({
          ...deck,
          phrases: deck.phrases.map(p => {
            let updatedP = { ...p };
            if (updatedP.score === undefined) {
              const isNew = !updatedP.consecutiveCorrect && !updatedP.consecutiveWrong;
              let score = isNew ? undefined : (updatedP.consecutiveCorrect! > 0 ? updatedP.consecutiveCorrect : -updatedP.consecutiveWrong!);
              updatedP = { ...updatedP, score, diff: 2.5, back: 0, date: todayDays };
            }
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
      } catch (e) { console.error(e); }
    }
  },[]);

  // ========== 2. 持久化 ==========
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(decks)); }, [decks]);
  useEffect(() => { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); }, [stats]);
  useEffect(() => { localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders)); }, [folders]);

  // ========== 3. 核心方法 ==========
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

  const handleSessionComplete = useCallback((deckId: string, dur: number, counts: any, cultGain: number, mode: 'STUDY'|'EXAM'|'DAILY_REVIEW' = 'STUDY') => {
    const total = counts.count0_1 + counts.count2_3 + counts.count4_5;
    if (total === 0) return;
    setStats(prev => {
      const subj = decks.find(d => d.id === deckId)?.subject || 'English';
      const activities =[...(prev.daily.activities || [])];
      activities.push({ deckId, deckName: decks.find(d => d.id === deckId)?.name || '每日复习', mode, count: total, ...counts, durationSeconds: dur, masteryGain: 0, timestamp: Date.now(), deckSubject: subj });
      
      // 英文与语文各自增加修为（每日复习平均分给两科）
      const engGain = mode === 'DAILY_REVIEW' ? cultGain / 2 : (subj === 'English' ? cultGain : 0);
      const cnGain = mode === 'DAILY_REVIEW' ? cultGain / 2 : (subj === 'Chinese' ? cultGain : 0);

      return {
        ...prev, totalReviewCount: prev.totalReviewCount + total,
        subjectStats: { 
           ...prev.subjectStats,
           English: Math.max(0, prev.subjectStats.English + engGain),
           Chinese: Math.max(0, prev.subjectStats.Chinese + cnGain)
        },
        daily: { ...prev.daily, reviewCount: prev.daily.reviewCount + total, count0_1: prev.daily.count0_1 + counts.count0_1, count2_3: prev.daily.count2_3 + counts.count2_3, count4_5: prev.daily.count4_5 + counts.count4_5, activities }
      };
    });
  },[decks]);
// src/App.tsx (Part 2)

  // ========== 4. UI 渲染：每日复习勾选面板 ==========
  const renderDailyReviewSetup = () => {
    const pendingDecks = decks.filter(d => getPendingCount(d) > 0);
    const totalPending = Array.from(selectedDeckIds).reduce((sum, id) => sum + getPendingCount(decks.find(d => d.id === id)!), 0);

    return (
      <div className="max-w-3xl mx-auto p-6 space-y-6 animate-in fade-in duration-300">
        <div className="flex items-center gap-4">
          <button onClick={() => setDailyReviewSetup(false)} className="p-2 hover:bg-slate-100 rounded-full"><ArrowLeft /></button>
          <div>
            <h2 className="text-2xl font-black text-slate-800 flex items-center gap-2"><Flame className="text-rose-500"/> 每日复习调度中心</h2>
            <p className="text-xs font-bold text-slate-400 mt-1">选中的词条在复习后 back &gt; cap 即视为通关并移出队列</p>
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

        <div className="fixed bottom-0 left-0 right-0 p-6 bg-white/90 backdrop-blur-md border-t border-slate-100 flex justify-center z-50">
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

  // ========== 5. 视图渲染：主仪表盘与卡片 ==========
  const renderDashboard = () => {
    if (dailyReviewSetup) return renderDailyReviewSetup();

    const breadcrumbs =[];
    let currId = currentFolderId;
    while (currId) {
        const f = folders.find(f => f.id === currId);
        if (f) { breadcrumbs.unshift(f); currId = f.parentId || null; } else break;
    }

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
        
        {/* 顶部控制区 */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-indigo-50 rounded-2xl border border-indigo-100 shadow-sm cursor-pointer" onClick={() => setCurrentFolderId(null)}>
              <ScrollText className="text-indigo-600 w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight leading-none">Chant Cultivation Bureau</h1>
              <span className="text-sm font-bold text-slate-500 tracking-widest block mt-1.5">吟诵仙宗 V2</span>
            </div>
          </div>
          <div className="flex gap-3 flex-wrap">
            <Button onClick={() => setShowSettings(true)} variant="outline" className="text-sm font-bold border-slate-200 text-slate-700 bg-white"><Database className="w-4 h-4 mr-1"/> 数据中心</Button>
            <Button onClick={() => setShowNewFolderModal(true)} variant="outline" className="text-sm font-bold border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100"><FolderPlus className="w-4 h-4 mr-1" /> 建文件夹</Button>
            <Button onClick={() => setView(AppView.IMPORT)} className="px-5 py-2 text-sm font-black shadow-lg shadow-indigo-100 bg-indigo-600 text-white hover:bg-indigo-700"><PlusCircle className="w-4 h-4 mr-2" /> 新建词本</Button>
            <Button onClick={() => setDailyReviewSetup(true)} className="px-5 py-2 text-sm font-black shadow-lg shadow-rose-200 bg-rose-500 hover:bg-rose-600"><Flame className="w-4 h-4 mr-2" /> 每日大盘</Button>
          </div>
        </div>

        {/* 导航面包屑 */}
        {currentFolderId !== null && (
          <div className="flex items-center gap-2 text-sm font-bold text-slate-500">
            <button onClick={() => setCurrentFolderId(null)} className="flex items-center hover:text-indigo-600"><Home className="w-4 h-4 mr-1" /> 首页</button>
            {breadcrumbs.map((f, i) => (
              <React.Fragment key={f.id}>
                <ChevronRight className="w-4 h-4 text-slate-300" />
                <button onClick={() => setCurrentFolderId(f.id)} className={`flex items-center hover:text-indigo-600 ${i === breadcrumbs.length - 1 ? 'text-indigo-600' : ''}`}><FolderIcon className="w-4 h-4 mr-1.5" />{f.name}</button>
              </React.Fragment>
            ))}
          </div>
        )}
          
        {/* 修为看板 (仅在首页显示) */}
        {currentFolderId === null && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

        {/* 文件夹与词本列表 (原版完美UI还原) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          
          {visibleFolders.map(folder => {
            const childDecks = decks.filter(d => d.folderId === folder.id);
            const childFolders = folders.filter(f => f.parentId === folder.id);
            return (
              <div key={folder.id} onClick={() => setCurrentFolderId(folder.id)} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 hover:border-amber-200 cursor-pointer relative group flex flex-col h-[16rem]">
                <FolderIcon className="w-10 h-10 text-amber-400 mb-3 shrink-0" />
                <h3 className="font-black text-slate-800 text-lg leading-tight truncate">{folder.name}</h3>
                <span className="text-[9px] font-bold text-amber-600/60 uppercase tracking-widest mt-0.5 block">文件夹 FOLDER</span>
                
                <div className="mt-3 flex-1 overflow-y-auto custom-scrollbar space-y-1.5">
                  {childFolders.map(f => <div key={f.id} className="text-[10px] text-slate-500 font-bold truncate flex items-center gap-1.5"><FolderIcon className="w-3 h-3 text-amber-300 shrink-0"/>{f.name}</div>)}
                  {childDecks.map(d => <div key={d.id} className="text-[10px] text-slate-500 font-bold truncate flex items-center gap-1.5"><div className={`w-1.5 h-1.5 rounded-full shrink-0 ${d.subject==='Chinese'?'bg-emerald-400':'bg-indigo-400'}`}></div>{d.name}</div>)}
                </div>

                <div className="mt-auto pt-3 border-t border-slate-50 text-[10px] font-black text-slate-400 flex justify-between">
                  <span>{childFolders.length} 目录 / {childDecks.length} 本</span>
                </div>
                {hasPendingReviews('folder', folder.id) && <div className="absolute top-4 right-4 w-3 h-3 bg-rose-500 rounded-full shadow-md border-2 border-white animate-pulse"></div>}
              </div>
            );
          })}

          {visibleDecks.map(deck => {
            const pending = getPendingCount(deck);
            const mastery = deck.phrases.length > 0 ? deck.phrases.reduce((acc, p) => acc + (p.mastery || 0), 0) / deck.phrases.length : 0;
            
            // 词条状态分布统计
            const statsMap = deck.phrases.reduce((acc, p) => {
                const key = getPhraseTag(p);
                acc[key] = (acc[key] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);
            const keys = Object.keys(statsMap).sort((a,b) => {
                if (a === '新') return -1; if (b === '新') return 1;
                const typeA = a[0], typeB = b[0], valA = parseInt(a.slice(1)), valB = parseInt(b.slice(1));
                if (typeA !== typeB) return typeA === '错' ? -1 : 1;
                if (typeA === '错') return valB - valA;
                return valA - valB;
            });

            return (
              <div key={deck.id} className="group bg-white rounded-2xl p-5 shadow-sm border border-slate-100 hover:border-indigo-200 transition-all flex flex-col relative h-[16rem]">
                <div className="cursor-pointer flex-1 flex flex-col min-h-0" onClick={() => { setActiveDeckId(deck.id); setView(AppView.STUDY); }}>
                  <div className="flex justify-between items-start mb-2">
                    <div className={`p-2.5 rounded-xl ${deck.subject === 'Chinese' ? 'bg-emerald-50 text-emerald-600' : 'bg-indigo-50 text-indigo-600'}`}>
                        {deck.subject === 'Chinese' ? <FileText className="w-5 h-5" /> : <BookOpen className="w-5 h-5" />}
                    </div>
                  </div>
                  <h3 className="font-black text-slate-800 text-base leading-tight mb-1.5 truncate">{deck.name}</h3>
                  <div className="flex gap-1.5 flex-wrap">
                    <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${deck.subject === 'Chinese' ? 'bg-emerald-50 text-emerald-600' : 'bg-indigo-50 text-indigo-600'}`}>{deck.subject === 'Chinese' ? '语文' : '英语'}</span>
                    <span className="text-[9px] font-bold text-slate-400 bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded">{deck.phrases.length} 词</span>
                  </div>
                  
                  <div className="mt-auto">
                    <div className="flex justify-between text-[9px] font-black uppercase mb-1" style={{ color: getDynamicColor(mastery) }}><span>掌握度</span><span>{mastery.toFixed(1)}%</span></div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden shadow-inner relative"><div className="h-full transition-all duration-700 ease-out" style={{width: `${mastery}%`, backgroundColor: getDynamicColor(mastery)}}></div></div>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-slate-50 shrink-0">
                  <Button variant="primary" className="text-xs py-2 font-black shadow-sm" onClick={() => { setActiveDeckId(deck.id); setView(AppView.STUDY); }}><Play className="w-3.5 h-3.5 mr-1" /> 复习</Button>
                  <Button variant="outline" className="text-xs py-2 font-black border-slate-200 text-slate-600 hover:bg-slate-50" onClick={(e) => { 
                      e.stopPropagation(); 
                      setActiveDeckId(deck.id); 
                      // 准备考试弹窗
                      const tags = new Set<string>();
                      tags.add('新'); deck.phrases.forEach(p => tags.add(getPhraseTag(p)));
                      setExamTags(tags);
                      setTempExamCount(Math.min(20, deck.phrases.length));
                      setShowExamSetup(true); 
                  }}><GraduationCap className="w-3.5 h-3.5 mr-1" /> 考试</Button>
                </div>
                
                {/* 底部状态分布标签 */}
                <div className="flex gap-1.5 overflow-x-auto no-scrollbar mt-3 shrink-0">
                  {keys.length > 0 ? keys.map(k => {
                      const isNew = k === '新';
                      return (
                        <span key={k} className={`text-[9px] px-1.5 py-0.5 rounded font-black whitespace-nowrap ${isNew ? 'bg-slate-100 text-slate-500' : 'text-white'}`} style={!isNew ? { backgroundColor: k.startsWith('对') ? getScoreBadgeColor(parseInt(k.slice(1))) : getScoreBadgeColor(-parseInt(k.slice(1))) } : {}}>
                          {k}:{statsMap[k]}
                        </span>
                      );
                  }) : <span className="text-[9px] text-slate-300 italic">暂无内容</span>}
                </div>

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
      
      {/* --- 考试配置弹窗 --- */}
      {showExamSetup && activeDeckId && (() => {
          const deck = decks.find(d => d.id === activeDeckId);
          if (!deck) return null;
          
          const availableTags = Array.from(new Set(['新', ...deck.phrases.map(p => getPhraseTag(p))])).sort((a,b) => {
              if (a === '新') return -1; if (b === '新') return 1;
              const typeA = a[0], typeB = b[0], valA = parseInt(a.slice(1)), valB = parseInt(b.slice(1));
              if (typeA !== typeB) return typeA === '错' ? -1 : 1;
              if (typeA === '错') return valB - valA; 
              return valA - valB;
          });

          const toggleTag = (tag: string) => {
              const newSet = new Set(examTags);
              if (newSet.has(tag)) newSet.delete(tag); else newSet.add(tag);
              setExamTags(newSet);
          };

          const filteredPhrases = deck.phrases.filter(p => examTags.has(getPhraseTag(p)));
          const maxCount = filteredPhrases.length;

          return (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-in fade-in">
              <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full animate-in zoom-in-95">
                <div className="text-center mb-6">
                   <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-4 text-indigo-600"><GraduationCap className="w-8 h-8" /></div>
                   <h3 className="text-2xl font-black text-slate-800">考试准备</h3>
                   <p className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-widest">{deck.name}</p>
                </div>
                
                <div className="space-y-6 mb-8">
                  <div>
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-3">1. 选择出题范围 (包含的状态)</label>
                    <div className="flex flex-wrap gap-2 p-3 bg-slate-50 border border-slate-100 rounded-xl max-h-32 overflow-y-auto">
                        {availableTags.map(tag => {
                           const isNew = tag === '新';
                           const isActive = examTags.has(tag);
                           const color = !isNew ? (tag.startsWith('对') ? getScoreBadgeColor(parseInt(tag.slice(1))) : getScoreBadgeColor(-parseInt(tag.slice(1)))) : '#94a3b8';
                           return (
                             <button key={tag} onClick={()=>toggleTag(tag)} className={`px-2 py-1 rounded-lg text-xs font-black border transition-all ${isActive ? 'text-white border-transparent shadow-sm' : 'bg-white text-slate-400 border-slate-200'}`} style={isActive ? {backgroundColor: color} : {}}>{tag}</button>
                           );
                        })}
                    </div>
                    <div className="text-right text-xs font-bold text-slate-500 mt-2">题库余量: <span className="text-indigo-600">{maxCount}</span> 词</div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                       <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-2">2. 考题数量</label>
                       <input type="number" min="1" max={Math.max(1, maxCount)} value={Math.min(tempExamCount, maxCount)} onChange={e => setTempExamCount(parseInt(e.target.value) || 1)} className="w-full p-3 border-2 border-slate-200 rounded-xl text-center font-black text-xl outline-none focus:border-indigo-500" disabled={maxCount === 0} />
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button variant="ghost" fullWidth onClick={() => setShowExamSetup(false)}>取消</Button>
                  <Button fullWidth className="font-black py-4 shadow-lg shadow-indigo-100" disabled={maxCount === 0} onClick={() => {
                      setExamConfig({ count: Math.min(tempExamCount, maxCount), candidateIds: filteredPhrases.map(p => p.id) });
                      setShowExamSetup(false);
                      setView(AppView.EXAM_SESSION);
                  }}>开始考试</Button>
                </div>
              </div>
            </div>
          );
      })()}

      {activeDeckId && view === AppView.STUDY && (
        <StudySession
          deck={decks.find(d => d.id === activeDeckId)!}
          onUpdateDeck={updateDeck}
          onExit={() => setView(AppView.DASHBOARD)}
          onTimeUpdate={handleTimeUpdate}
          onSessionComplete={(dur, counts, cultGain) => handleSessionComplete(activeDeckId, dur, counts, cultGain, 'STUDY')}
        />
      )}

      {activeDeckId && view === AppView.EXAM_SESSION && examConfig && (
        <ExamSession
          deck={decks.find(d => d.id === activeDeckId)!}
          questionCount={examConfig.count}
          candidatePhraseIds={examConfig.candidateIds}
          onUpdateDeck={updateDeck}
          onExit={() => setView(AppView.DASHBOARD)}
          onTimeUpdate={handleTimeUpdate}
          onSessionComplete={(dur, counts, cultGain) => handleSessionComplete(activeDeckId, dur, counts, cultGain, 'EXAM')}
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
          onSessionComplete={(dur, counts, cultGain) => handleSessionComplete('daily_hub', dur, counts, cultGain, 'DAILY_REVIEW')}
        />
      )}
    </>
  );
};