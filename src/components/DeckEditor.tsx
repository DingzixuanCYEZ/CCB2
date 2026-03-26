// src/components/DeckEditor.tsx

import React, { useState, useEffect, useMemo } from 'react';
import { Deck, Phrase, DeckSessionLog, DeckSubject, ContentType, StudyMode, Folder } from '../types';
import { Button } from './Button';
import { 
  ArrowLeft, Trash2, Save, Plus, X, Search, Edit2, FileText, Check, 
  History, Clock, GraduationCap, BookOpen, Shuffle, BarChart3, GripVertical, 
  Dices, Settings, ListOrdered, Scale, Hash, Split, CheckCircle2, RotateCcw, 
  ArrowRightLeft, AlignJustify, TrendingUp, Languages
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { getDynamicColor, getScoreBadgeColor } from '../utils/algo';

interface DeckEditorProps {
  deck: Deck;
  folders: Folder[]; // 新增
  onDeleteDeck: (id: string) => void; // 新增
  onUpdateDeck: (updatedDeck: Deck) => void;
  onAddDecks?: (newDecks: Deck[]) => void;
  onBack: () => void;
}

// === 辅助函数 ===
const getPhraseTag = (score: number | undefined) => {
  if (score === undefined || score === 0) return '新';
  if (score > 0) return `对${Math.ceil(score)}`;
  return `错${Math.ceil(Math.abs(score))}`;
};

const countWords = (text: string): number => {
  if (!text) return 0;
  const clean = text.replace(/['".,\/#!$%\^&\*;:{}=\-_`~()\[\]]/g, " ");
  const matches = clean.match(/[a-zA-Z0-9\u4e00-\u9fa5]+/g);
  return matches ? matches.length : 0;
};

const formatDuration = (s: number) => { 
  const m = Math.floor(s / 60); const rs = s % 60; return `${m}m${rs}s`; 
};

const formatSmartTime = (s: number) => { 
  if (s < 60) return `${s}s`; 
  if (s < 3600) return `${Math.floor(s/60)}m`; 
  return `${(s/3600).toFixed(1)}h`; 
};

const formatDate = (ts: number) => { 
  return new Date(ts).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); 
};

export const DeckEditor: React.FC<DeckEditorProps> = ({ deck, folders, onDeleteDeck, onUpdateDeck, onAddDecks, onBack }) => {
  // === 基础状态 ===
  const[activeTab, setActiveTab] = useState<'phrases' | 'history' | 'macro'>('phrases');
  const [historyMode, setHistoryMode] = useState<'study' | 'exam'>('study');
  
  const [deckName, setDeckName] = useState(deck.name);
  const[subject, setSubject] = useState<DeckSubject>(deck.subject || 'English');
  const[contentType, setContentType] = useState<ContentType>(deck.contentType || 'PhraseSentence');
  const[studyMode, setStudyMode] = useState<StudyMode>(deck.studyMode || 'CN_EN');
  const [phrases, setPhrases] = useState<Phrase[]>([...deck.phrases]);
  
  // === UI 交互状态 ===
  const[searchQuery, setSearchQuery] = useState('');
  const [editingPhraseId, setEditingPhraseId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ english: '', chinese: '', note: '', diff: 2.5 });
  const [phraseToDelete, setPhraseToDelete] = useState<string | null>(null);
  const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  // === 弹窗控制状态 ===
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const[showShuffleConfirm, setShowShuffleConfirm] = useState(false);
  const [showSmartSortModal, setShowSmartSortModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const[showSplitModal, setShowSplitModal] = useState(false);

  // === 弹窗内表单状态 ===
  const[resetInput, setResetInput] = useState('');
  const [batchText, setBatchText] = useState('');
  
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [sortStrategy, setSortStrategy] = useState<'head' | 'interleave'>('interleave');
  const[interleaveRatio, setInterleaveRatio] = useState(1);

  const [splitParts, setSplitParts] = useState(2);
  const [splitKeepProgress, setSplitKeepProgress] = useState(false);

  const[statsOptions, setStatsOptions] = useState({
      includeInQuantity: deck.statsOptions?.includeInQuantity ?? true,
      includeInQuality: deck.statsOptions?.includeInQuality ?? true
  });

  // 同步外部属性
  useEffect(() => {
    setPhrases(deck.phrases);
    setDeckName(deck.name);
    setSubject(deck.subject || 'English');
    setContentType(deck.contentType || 'PhraseSentence');
    setStudyMode(deck.studyMode || 'CN_EN');
    setStatsOptions({
        includeInQuantity: deck.statsOptions?.includeInQuantity ?? true,
        includeInQuality: deck.statsOptions?.includeInQuality ?? true
    });
  }, [deck]);

  const handleUpdate = (
    newSubject?: DeckSubject,
    newStudyMode?: StudyMode,
    newStatsOptions?: typeof statsOptions,
    newContentType?: ContentType
  ) => {
      onUpdateDeck({
          ...deck,
          name: deckName,
          subject: newSubject ?? subject,
          studyMode: newStudyMode ?? studyMode,
          contentType: newContentType ?? contentType,
          statsOptions: newStatsOptions ?? statsOptions
      });
  };

  // 搜索与排序后的词条展示
  const displayPhrases = useMemo(() => {
    let filtered = phrases;
    if (searchQuery) {
        const lowerQ = searchQuery.toLowerCase();
        filtered = phrases.filter(p => 
          p.english.toLowerCase().includes(lowerQ) || 
          p.chinese.includes(lowerQ) ||
          (p.note && p.note.toLowerCase().includes(lowerQ))
        );
    }
    return filtered.sort((a, b) => {
        const idxA = deck.queue.indexOf(a.id);
        const idxB = deck.queue.indexOf(b.id);
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
    });
  },[phrases, searchQuery, deck.queue]);

  // V2 统计数据推算 (Perfect 定义为 totalWrong === 0 且脱离新词状态)
  const stats = useMemo(() => {
      let totalW = 0;
      let perfW = 0;
      let perfectCount = 0;
      let totalWordCount = 0;
      let totalSqrtWordCount = 0;
      let perfectSqrtWordCount = 0;

      phrases.forEach(p => {
          const wordCount = subject === 'English' ? countWords(p.english) : countWords(p.chinese);
          const sqrtVal = Math.sqrt(wordCount);
          totalWordCount += wordCount;
          totalSqrtWordCount += sqrtVal;

          const weight = subject === 'English' ? wordCount : 1;
          totalW += weight;
          
          const tw = p.totalWrong ?? 0;
          const isPerfect = tw === 0 && p.score !== undefined && p.score > 0 && p.totalReviews > 0;
          
          if (isPerfect) {
              perfW += weight;
              perfectSqrtWordCount += sqrtVal;
              perfectCount++;
          }
      });
      return { totalW, perfW, perfectCount, totalWordCount, totalSqrtWordCount, perfectSqrtWordCount };
  }, [phrases, subject]);

  const availableTags = useMemo(() => {
      const tags = new Set<string>();
      tags.add('新');
      deck.phrases.forEach(p => { tags.add(getPhraseTag(p.score)); });
      return Array.from(tags).sort((a, b) => {
          if (a === '新') return -1;
          if (b === '新') return 1;
          const typeA = a.startsWith('错') ? 'W' : 'C';
          const typeB = b.startsWith('错') ? 'W' : 'C';
          const valA = parseInt(a.slice(1)) || 0;
          const valB = parseInt(b.slice(1)) || 0;
          if (typeA !== typeB) return typeA === 'W' ? -1 : 1;
          if (typeA === 'W') return valB - valA; 
          return valA - valB;
      });
  }, [deck.phrases]);

  // === 拖拽处理 ===
  const handleDragStart = (e: React.DragEvent, index: number) => {
      setDraggedItemIndex(index);
      e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
      e.preventDefault();
      if (draggedItemIndex === null || draggedItemIndex === targetIndex) return;
      
      const newQueue = [...deck.queue];
      const movedItemId = newQueue[draggedItemIndex];
      newQueue.splice(draggedItemIndex, 1);
      newQueue.splice(targetIndex, 0, movedItemId);
      
      onUpdateDeck({ ...deck, queue: newQueue });
      setDraggedItemIndex(null);
  };

  // === 操作处理函数 ===
  const generateBatchText = () => {
    const sortedIds = [...deck.queue];
    const phraseMap = new Map<string, Phrase>(phrases.map(p => [p.id, p]));

    return sortedIds.map((id, idx) => {
      const p = phraseMap.get(id);
      if (!p) return null;
      const note = (p.note || '').replace(/\n/g, '\\n');
      const score = p.score === undefined ? 'new' : p.score.toFixed(2);
      const diff = p.diff ?? 2.5;
      const back = p.back ?? 0;
      return `${p.chinese} | ${p.english} | ${note} | ${score} | ${diff} | ${back} | ${idx}`;
    }).filter(x => x).join('\n');
  };

  const confirmBatchSave = () => {
    const lines = batchText.split('\n').filter(l => l.trim());
    const parsedItems: any[] =[];

    lines.forEach((line, lineIndex) => {
      const parts = line.split('|').map(s => s.trim());
      if (parts.length < 2) return;
      const chi = parts[0];
      const eng = parts[1];
      const noteRaw = parts[2] || '';
      const scoreRaw = parts[3] || 'new';
      const diffRaw = parts[4] || '2.5';
      const backRaw = parts[5] || '0';
      const idxRaw = parts[6] || '';
      
      const note = noteRaw.replace(/\\n/g, '\n');
      const diff = parseFloat(diffRaw) || 2.5;
      const back = parseInt(backRaw) || 0;
      const score = scoreRaw === 'new' ? undefined : parseFloat(scoreRaw);
      
      let sortIdx = parseFloat(idxRaw);
      if (isNaN(sortIdx)) sortIdx = lineIndex; 

      const existing = phrases.find(p => p.english.toLowerCase() === eng.toLowerCase());
      const p: Phrase = {
        id: existing?.id || uuidv4(),
        english: eng,
        chinese: chi,
        note,
        score,
        diff,
        back,
        date: existing?.date || Math.floor(Date.now() / 86400000),
        clearedDate: existing?.clearedDate || Math.floor(Date.now() / 86400000),
        mastery: existing?.mastery || 0,
        totalReviews: existing?.totalReviews || 0,
        totalWrong: existing?.totalWrong || 0
      };
      
      parsedItems.push({ phrase: p, sortIdx, originalLineIndex: lineIndex });
    });

    parsedItems.sort((a, b) => {
        if (a.sortIdx !== b.sortIdx) return a.sortIdx - b.sortIdx;
        return a.originalLineIndex - b.originalLineIndex;
    });

    const newPhrases = parsedItems.map(item => item.phrase);
    const newQueue = parsedItems.map(item => item.phrase.id);

    onUpdateDeck({ ...deck, name: deckName, subject, phrases: newPhrases, queue: newQueue });
    setShowBatchModal(false);
  };

  const handleResetProgress = () => {
    if (resetInput !== 'RESET') return;
    const today = Math.floor(Date.now() / 86400000);
    const resetPhrases = phrases.map(p => ({ 
        ...p, 
        score: undefined, 
        diff: 2.5, 
        back: 0, 
        date: today,
        clearedDate: today,
        mastery: 0, 
        totalReviews: 0, 
        totalWrong: 0, 
        lastReviewedAt: undefined 
    }));
    const orderedQueue = resetPhrases.map(p => p.id);
    
    setPhrases(resetPhrases);
    onUpdateDeck({ 
        ...deck, 
        name: deckName, subject, 
        phrases: resetPhrases, queue: orderedQueue, 
        stats: { totalStudyTimeSeconds: 0, totalReviewCount: 0 }, 
        sessionHistory:[] 
    });
    setShowResetConfirm(false);
    setResetInput('');
  };

  const handleShuffle = () => {
      const newQueue =[...deck.queue];
      for (let i = newQueue.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [newQueue[i], newQueue[j]] = [newQueue[j], newQueue[i]];
      }
      onUpdateDeck({ ...deck, queue: newQueue });
      setShowShuffleConfirm(false);
  };

  const handleSmartSort = () => {
      const allIds = [...deck.queue];
      const targetIds: string[] = [];
      const otherIds: string[] =[];

      allIds.forEach(id => {
          const p = phrases.find(item => item.id === id);
          if (!p) return;
          const tag = getPhraseTag(p.score);
          if (selectedTags.has(tag)) {
              targetIds.push(id);
          } else {
              otherIds.push(id);
          }
      });

      let newQueue: string[] =[];

      if (sortStrategy === 'head') {
          newQueue = [...targetIds, ...otherIds];
      } else {
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
      onUpdateDeck({ ...deck, queue: newQueue });
      setShowSmartSortModal(false);
  };

  const toggleTag = (tag: string) => {
      const newSet = new Set(selectedTags);
      if (newSet.has(tag)) newSet.delete(tag); else newSet.add(tag);
      setSelectedTags(newSet);
  };

  const selectGroup = (type: 'New' | 'Wrong' | 'Correct') => {
      const newSet = new Set(selectedTags);
      const groupTags = availableTags.filter(t => {
          if (type === 'New') return t === '新';
          if (type === 'Wrong') return t.startsWith('错');
          if (type === 'Correct') return t.startsWith('对');
          return false;
      });
      const allSelected = groupTags.every(t => newSet.has(t));
      if (allSelected) { groupTags.forEach(t => newSet.delete(t)); } else { groupTags.forEach(t => newSet.add(t)); }
      setSelectedTags(newSet);
  };

  const handleSplitDeck = () => {
      if (!onAddDecks) return;
      const N = Math.max(2, splitParts);
      const total = deck.queue.length;
      if (total === 0) return;
      const chunkSize = Math.ceil(total / N);
      
      const newDecks: Deck[] =[];
      const phraseMap = new Map<string, Phrase>(phrases.map(p =>[p.id, p]));
      const today = Math.floor(Date.now() / 86400000);

      for (let i = 0; i < N; i++) {
          const start = i * chunkSize;
          const end = Math.min((i + 1) * chunkSize, total);
          if (start >= total) break;
          
          const sliceIds = deck.queue.slice(start, end);
          const slicePhrases: Phrase[] =[];
          
          sliceIds.forEach(id => {
              const originalPhrase = phraseMap.get(id);
              if (originalPhrase) {
                  const p: Phrase = splitKeepProgress ? { ...originalPhrase } : {
                      ...originalPhrase,
                      score: undefined,
                      diff: 2.5,
                      back: 0,
                      date: today,
                      mastery: 0,
                      clearedDate: today,
                      totalReviews: 0,
                      totalWrong: 0,
                      lastReviewedAt: undefined
                  };
                  slicePhrases.push(p);
              }
          });
          
          if (slicePhrases.length > 0) {
              const newDeck: Deck = {
                  ...deck,
                  id: uuidv4(),
                  name: `${deckName} (Part ${i + 1})`,
                  phrases: slicePhrases,
                  queue: slicePhrases.map(p => p.id),
                  stats: { totalStudyTimeSeconds: 0, totalReviewCount: 0 },
                  sessionHistory:[],
                  folderId: deck.folderId
              };
              newDecks.push(newDeck);
          }
      }
      
      onAddDecks(newDecks);
      setShowSplitModal(false);
  };

  const startEditing = (p: Phrase) => {
    setEditingPhraseId(p.id);
    setEditForm({ 
        english: p.english, 
        chinese: p.chinese, 
        note: (p.note || '').replace(/\\n/g, '\n'),
        diff: p.diff ?? 2.5
    });
  };

  const savePhrase = () => {
    const updated = phrases.map(p => {
      if (p.id === editingPhraseId) return { ...p, english: editForm.english, chinese: editForm.chinese, note: editForm.note, diff: editForm.diff };
      return p;
    });
    setPhrases(updated);
    onUpdateDeck({ ...deck, name: deckName, subject, phrases: updated });
    setEditingPhraseId(null);
  };

  const executeDelete = () => {
      if (!phraseToDelete) return;
      const id = phraseToDelete;
      const newPhrases = phrases.filter(p => p.id !== id);
      const newQueue = deck.queue.filter(q => q !== id);
      onUpdateDeck({ ...deck, phrases: newPhrases, queue: newQueue });
      setPhraseToDelete(null);
  };

  const handleSwapQA = () => {
      const newPhrases = phrases.map(p => ({ ...p, english: p.chinese, chinese: p.english }));
      setPhrases(newPhrases);
      onUpdateDeck({ ...deck, phrases: newPhrases });
      setShowSettingsModal(false);
  };

  // === 历史记录与宏观图表渲染 ===
  const filteredHistory = deck.sessionHistory?.filter(h => historyMode === 'study' ? h.mode === 'STUDY' : h.mode === 'EXAM') ||[];

  const renderChart = (log: DeckSessionLog) => {
    if (!log.masteryTrend || log.masteryTrend.length < 2) return null;
    const data = log.masteryTrend;
    const width = 300; const height = 120;
    const padding = { top: 10, right: 10, bottom: 20, left: 30 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const maxTime = Math.max(...data.map(d => d.t), 1);
    const allValues = data.map(d => d.v);
    const minY = Math.floor(Math.min(...allValues, 0));
    const maxY = Math.ceil(Math.max(...allValues, 100));
    const rangeY = maxY - minY || 100;

    const points = data.map(d => {
        const x = padding.left + (d.t / maxTime) * chartWidth;
        const y = padding.top + chartHeight - ((d.v - minY) / rangeY) * chartHeight; 
        return `${x},${y}`;
    }).join(' ');

    return (
      <div className="mt-4 pt-4 border-t border-slate-100">
         <div className="flex justify-between items-center mb-2">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Session Trend</div>
         </div>
         <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible bg-slate-50/50 rounded-xl border border-slate-100">
            <line x1={padding.left} y1={padding.top} x2={width-padding.right} y2={padding.top} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="4 2" />
            <line x1={padding.left} y1={padding.top + chartHeight/2} x2={width-padding.right} y2={padding.top + chartHeight/2} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="4 2" />
            <line x1={padding.left} y1={height-padding.bottom} x2={width-padding.right} y2={height-padding.bottom} stroke="#e2e8f0" strokeWidth="1" />
            <text x={5} y={padding.top + 4} className="text-[8px] fill-slate-400 font-medium">{maxY}%</text>
            <text x={15} y={padding.top + chartHeight/2 + 4} className="text-[8px] fill-slate-400 font-medium">{Math.round(minY + rangeY/2)}%</text>
            <text x={20} y={height-padding.bottom + 4} className="text-[8px] fill-slate-400 font-medium">{minY}%</text>
            <text x={width-padding.right} y={height-5} textAnchor="end" className="text-[8px] fill-slate-400 font-medium">{formatDuration(maxTime)}</text>
            <polyline points={points} fill="none" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
         </svg>
      </div>
    );
  };

  const renderLogCard = (log: DeckSessionLog) => {
    const accuracy = log.reviewCount > 0 ? ((log.count4_5 + log.count2_3 * 0.5) / log.reviewCount) * 100 : 0;
    const isExpanded = expandedLogId === log.id;

    return (
      <div key={log.id} className="bg-white rounded-xl border border-slate-100 overflow-hidden transition-all hover:shadow-md animate-in fade-in slide-in-from-bottom-2">
        <div className="p-4 cursor-pointer hover:bg-slate-50 transition-colors flex items-center justify-between" onClick={() => setExpandedLogId(isExpanded ? null : log.id)}>
             <div className="flex items-center gap-4">
                 <div className={`p-2 rounded-lg ${log.mode === 'EXAM' ? 'bg-amber-100 text-amber-600' : 'bg-indigo-100 text-indigo-600'}`}>
                     {log.mode === 'EXAM' ? <GraduationCap className="w-5 h-5"/> : <BookOpen className="w-5 h-5"/>}
                 </div>
                 <div>
                     <div className="font-bold text-slate-700 text-sm flex items-center gap-2">
                        {formatDate(log.timestamp)}
                        {log.masteryGain !== undefined && Math.abs(log.masteryGain) > 0.01 && (
                            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${log.masteryGain > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500'}`}>
                                {log.masteryGain > 0 ? '+' : ''}{log.masteryGain.toFixed(2)}%
                            </span>
                        )}
                     </div>
                     <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                         <span className="flex items-center gap-1"><Clock className="w-3 h-3"/> {formatDuration(log.durationSeconds)}</span>
                         <span>•</span>
                         <span>{log.reviewCount} interactions</span>
                     </div>
                 </div>
             </div>
             <div className="text-right">
                 <div className="text-lg font-black" style={{ color: getDynamicColor(accuracy) }}>{accuracy.toFixed(0)}%</div>
                 <div className="text-[10px] text-slate-400 font-bold">
                    {log.profCounts ? (log.profCounts[4]+log.profCounts[5]) : log.count4_5}优 / 
                    {log.profCounts ? (log.profCounts[2]+log.profCounts[3]) : log.count2_3}中 / 
                    {log.profCounts ? (log.profCounts[0]+log.profCounts[1]) : log.count0_1}差
                 </div>
             </div>
        </div>
        
        {isExpanded && (
            <div className="p-4 pt-0 border-t border-slate-50 bg-slate-50/30">
                 {renderChart(log)}
                 {log.examResults && log.examResults.length > 0 && (
                     <div className="mt-4 pt-4 border-t border-slate-100">
                         <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Exam Details</h4>
                         <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                             {log.examResults.map((res, idx) => (
                                 <div key={idx} className="flex items-center text-xs p-2 bg-white rounded-lg border border-slate-100">
                                     {res.isCorrect ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mr-2 shrink-0"/> : <X className="w-3.5 h-3.5 text-rose-500 mr-2 shrink-0"/>}
                                     <div className="flex-1 min-w-0 grid grid-cols-2 gap-2">
                                         <div className="truncate font-bold text-slate-700" title={res.q}>{res.q}</div>
                                         <div className="truncate text-slate-500 text-right" title={res.a}>{res.a}</div>
                                     </div>
                                 </div>
                             ))}
                         </div>
                     </div>
                 )}
            </div>
        )}
      </div>
    );
  };

  const renderMacroChart = () => {
      // 这里的逻辑已经很完整了，如果显示不出来，请检查 history 是否有数据
      const history = [...(deck.sessionHistory || [])].sort((a,b) => a.timestamp - b.timestamp);
      if (history.length === 0) return <div className="p-20 text-center"><BarChart3 className="w-12 h-12 text-slate-200 mx-auto mb-4" /><p className="text-slate-400 text-sm italic">暂无历史数据，去背诵一场吧！</p></div>;
      
      let accumulatedTime = 0;
      let allPoints: {t: number, v: number}[] =[{t: 0, v: 0}];

      history.forEach(h => {
          const startTime = accumulatedTime;
          if (h.masteryTrend && h.masteryTrend.length > 0) {
              h.masteryTrend.forEach(pt => {
                  allPoints.push({ t: Number(startTime) + Number(pt.t), v: Number(pt.v) });
              });
          } else {
              allPoints.push({ t: Number(startTime), v: h.masteryStart || 0 });
              allPoints.push({ t: Number(startTime) + Number(h.durationSeconds), v: h.masteryEnd || 0 });
          }
          accumulatedTime += Number(h.durationSeconds);
      });

      const width = 600; const height = 200;
      const padding = { top: 20, right: 20, bottom: 30, left: 40 };
      const chartWidth = width - padding.left - padding.right;
      const chartHeight = height - padding.top - padding.bottom;
      const maxTime = Math.max(accumulatedTime, 1);
      
      const points = allPoints.map(d => {
          const x = padding.left + (d.t / maxTime) * chartWidth;
          const val = Math.max(0, Math.min(100, d.v));
          const y = padding.top + chartHeight - (val / 100) * chartHeight; 
          return `${x},${y}`;
      }).join(' ');

      return (
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <h3 className="text-sm font-black text-slate-800 mb-4 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-indigo-600"/> 宏观掌握度趋势 (Macro Trend)</h3>
            <div className="w-full">
                <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
                    <line x1={padding.left} y1={padding.top} x2={width-padding.right} y2={padding.top} stroke="#e2e8f0" strokeWidth="1" />
                    <line x1={padding.left} y1={padding.top + chartHeight * 0.25} x2={width-padding.right} y2={padding.top + chartHeight * 0.25} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3 3"/>
                    <line x1={padding.left} y1={padding.top + chartHeight * 0.50} x2={width-padding.right} y2={padding.top + chartHeight * 0.50} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3 3"/>
                    <line x1={padding.left} y1={padding.top + chartHeight * 0.75} x2={width-padding.right} y2={padding.top + chartHeight * 0.75} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3 3"/>
                    <line x1={padding.left} y1={height-padding.bottom} x2={width-padding.right} y2={height-padding.bottom} stroke="#e2e8f0" strokeWidth="1" />
                    <text x={10} y={padding.top + 4} className="text-[10px] fill-slate-400 font-bold">100%</text>
                    <text x={10} y={padding.top + chartHeight * 0.5 + 4} className="text-[10px] fill-slate-400 font-bold">50%</text>
                    <text x={25} y={height-padding.bottom + 4} className="text-[10px] fill-slate-400 font-bold">0%</text>
                    <polygon points={`${padding.left},${height-padding.bottom} ${points} ${padding.left + chartWidth},${height-padding.bottom}`} fill="rgba(99, 102, 241, 0.1)" />
                    <polyline points={points} fill="none" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 font-bold mt-2 px-2 relative" style={{ marginLeft: padding.left, marginRight: padding.right, width: 'auto' }}>
                <span className="absolute left-0 -translate-x-1/2">0s</span>
                <span className="absolute left-1/4 -translate-x-1/2">{formatSmartTime(maxTime * 0.25)}</span>
                <span className="absolute left-1/2 -translate-x-1/2">{formatSmartTime(maxTime * 0.5)}</span>
                <span className="absolute left-3/4 -translate-x-1/2">{formatSmartTime(maxTime * 0.75)}</span>
                <span className="absolute right-0 translate-x-1/2">{formatSmartTime(maxTime)}</span>
            </div>
            <div className="text-center text-[10px] text-slate-300 font-bold uppercase tracking-widest mt-4">Total Study Time Spliced</div>
        </div>
      );
  };

  // ========== UI Render ==========
  return (
    <div className="max-w-4xl mx-auto p-3 sm:p-6 space-y-6 pb-24">
      {/* 1. 顶部控制栏 */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <button onClick={onBack} className="p-2.5 hover:bg-slate-100 rounded-full shrink-0"><ArrowLeft className="w-6 h-6"/></button>
        <div className="flex-1">
          <label className="text-xs font-black text-slate-400 uppercase tracking-widest">设置 Settings</label>
          <div className="flex flex-col sm:flex-row gap-4 sm:items-center mt-2">
            <input className="text-3xl font-black text-slate-900 flex-1 bg-transparent border-b border-transparent focus:border-indigo-500 outline-none pb-1" value={deckName} onChange={e=>{setDeckName(e.target.value);}} onBlur={() => handleUpdate()}/>
            <div className="flex flex-wrap gap-2">
              <div className="flex bg-slate-100 p-1.5 rounded-xl border border-slate-200 shadow-sm shrink-0 gap-1.5">
                 <button onClick={()=>{setSubject('English'); handleUpdate('English');}} className={`flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-black rounded-lg transition-all ${subject==='English'?'bg-white shadow-sm text-indigo-600':'text-slate-400 hover:text-slate-600'}`}><Languages className="w-4 h-4"/> 英语</button>
                 <button onClick={()=>{setSubject('Chinese'); handleUpdate('Chinese');}} className={`flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-black rounded-lg transition-all ${subject==='Chinese'?'bg-white shadow-sm text-emerald-600':'text-slate-400 hover:text-slate-600'}`}>语文</button>
              </div>
              {subject === 'English' && (
                <>
                  <div className="flex bg-slate-100 p-1.5 rounded-xl border border-slate-200 shadow-sm shrink-0 gap-1.5 animate-in fade-in duration-300">
                     <button onClick={()=>{setContentType('Word'); handleUpdate(undefined, undefined, undefined, 'Word');}} className={`flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-black rounded-lg transition-all ${contentType==='Word'?'bg-white shadow-sm text-indigo-600':'text-slate-400 hover:text-slate-600'}`}>单词</button>
                     <button onClick={()=>{setContentType('PhraseSentence'); handleUpdate(undefined, undefined, undefined, 'PhraseSentence');}} className={`flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-black rounded-lg transition-all ${contentType==='PhraseSentence'?'bg-white shadow-sm text-indigo-600':'text-slate-400 hover:text-slate-600'}`}>词组/句子</button>
                  </div>
                  <div className="flex bg-slate-100 p-1.5 rounded-xl border border-slate-200 shadow-sm shrink-0 gap-1.5 animate-in fade-in duration-300">
                      <button onClick={()=>{setStudyMode('CN_EN'); handleUpdate(undefined, 'CN_EN');}} className={`flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-black rounded-lg transition-all ${studyMode==='CN_EN'?'bg-white shadow-sm text-indigo-600':'text-slate-400 hover:text-slate-600'}`}>中→英</button>
                      <button onClick={()=>{setStudyMode('EN_CN'); handleUpdate(undefined, 'EN_CN');}} className={`flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-black rounded-lg transition-all ${studyMode==='EN_CN'?'bg-white shadow-sm text-indigo-600':'text-slate-400 hover:text-slate-600'}`}>英→中</button>
                  </div>
                </>
              )}
              {subject === 'Chinese' && (
                <div className="flex bg-slate-100 p-1.5 rounded-xl border border-slate-200 shadow-sm shrink-0 gap-1.5 animate-in fade-in duration-300">
                     <button onClick={()=>{setContentType('Word'); handleUpdate(undefined, undefined, undefined, 'Word');}} className={`flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-black rounded-lg transition-all ${contentType==='Word'?'bg-white shadow-sm text-emerald-600':'text-slate-400 hover:text-slate-600'}`}>文言实词</button>
                     <button onClick={()=>{setContentType('PhraseSentence'); handleUpdate(undefined, undefined, undefined, 'PhraseSentence');}} className={`flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-black rounded-lg transition-all ${contentType==='PhraseSentence'?'bg-white shadow-sm text-emerald-600':'text-slate-400 hover:text-slate-600'}`}>其他</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Tabs 切换栏 */}
      <div className="flex gap-4 border-b border-slate-200 overflow-x-auto no-scrollbar">
         <button onClick={()=>setActiveTab('phrases')} className={`pb-3 text-sm font-bold border-b-2 transition-all px-2 flex items-center gap-2 whitespace-nowrap ${activeTab==='phrases'?'border-indigo-600 text-indigo-600':'border-transparent text-slate-400'}`}><FileText className="w-4 h-4" />内容管理 ({phrases.length})</button>
         <button onClick={()=>setActiveTab('history')} className={`pb-3 text-sm font-bold border-b-2 transition-all px-2 flex items-center gap-2 whitespace-nowrap ${activeTab==='history'?'border-indigo-600 text-indigo-600':'border-transparent text-slate-400'}`}><History className="w-4 h-4" />学习历史</button>
         <button onClick={()=>setActiveTab('macro')} className={`pb-3 text-sm font-bold border-b-2 transition-all px-2 flex items-center gap-2 whitespace-nowrap ${activeTab==='macro'?'border-indigo-600 text-indigo-600':'border-transparent text-slate-400'}`}><BarChart3 className="w-4 h-4" />宏观趋势</button>
      </div>

      {/* 3. Phrases Tab 内容管理 */}
      {activeTab === 'phrases' && (
        <div className="animate-in fade-in">
          <div className="pt-2 pb-2 -mx-2 px-2 transition-all">
            <div className="flex flex-col sm:flex-row gap-4 items-center">
                <div className="relative flex-1 w-full"><Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400"/><input className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-2xl shadow-sm outline-none focus:ring-2 ring-indigo-500 text-base" placeholder="搜索英文、中文或笔记..." value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}/></div>
                <div className="flex gap-3 w-full sm:w-auto overflow-x-auto no-scrollbar pb-1 sm:pb-0">
                  <Button variant="outline" className="py-3 text-sm font-bold text-slate-500 border-slate-200 bg-white hover:bg-slate-50 whitespace-nowrap" onClick={() => setShowSettingsModal(true)}><Settings className="w-4 h-4 mr-2"/> 高级设置</Button>
                  <Button variant="outline" className="py-3 text-sm font-bold text-indigo-600 border-indigo-100 bg-indigo-50 hover:bg-indigo-100 whitespace-nowrap" onClick={() => setShowSmartSortModal(true)}><Shuffle className="w-4 h-4 mr-2"/> 智能重排</Button>
                  {onAddDecks && <Button variant="outline" className="py-3 text-sm font-bold text-slate-600 border-slate-200 bg-white hover:bg-slate-50 whitespace-nowrap" onClick={() => setShowSplitModal(true)}><Split className="w-4 h-4 mr-2"/> 拆分词本</Button>}
                  <Button variant="outline" className="py-3 text-sm font-bold text-slate-600 border-slate-200 bg-white hover:bg-slate-50 whitespace-nowrap" onClick={() => setShowShuffleConfirm(true)}><Dices className="w-4 h-4 mr-2"/> 随机打乱</Button>
                  <Button variant="ghost" className="py-3 text-sm font-bold text-red-500 hover:text-red-600 hover:bg-red-50 whitespace-nowrap" onClick={() => setShowResetConfirm(true)}><RotateCcw className="w-4 h-4 mr-2"/> 清空进度</Button>
                  <Button variant="outline" className="py-3 text-sm font-bold whitespace-nowrap" onClick={()=>{setBatchText(generateBatchText()); setShowBatchModal(true);}}><FileText className="w-4 h-4 mr-2"/> 批量编辑</Button>
                  <Button className="py-3 text-sm font-bold whitespace-nowrap" onClick={()=>{
                      const n: Phrase = { id: uuidv4(), english: '', chinese: '', note: '', diff: 2.5, back: 0, date: Math.floor(Date.now() / 86400000), clearedDate: Math.floor(Date.now() / 86400000), totalReviews: 0, score: undefined };
                      const newPs =[n,...phrases];
                      setPhrases(newPs);
                      onUpdateDeck({...deck, subject, phrases: newPs, queue:[n.id,...deck.queue]});
                      startEditing(n);
                  }}><Plus className="w-4 h-4 mr-2"/> 添加词条</Button>
                </div>
            </div>
          </div>
          
          <div className="flex flex-col gap-2 mt-2">
                <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-3 flex items-center justify-between text-xs font-bold text-indigo-800">
                   <div className="flex items-center gap-2"><Scale className="w-4 h-4 text-indigo-500"/> Perfect Weight Stats (Total Wrong=0 且已复习: {stats.perfectCount})</div>
                   <div className="tabular-nums font-black">{stats.perfW.toFixed(1)} <span className="text-indigo-400 font-normal">/</span> {stats.totalW.toFixed(1)} <span className="text-indigo-400 font-normal">total</span></div>
                </div>
                <div className="bg-slate-50/50 border border-slate-100 rounded-xl p-3 flex items-center justify-between text-xs font-bold text-slate-600">
                   <div className="flex items-center gap-2"><Hash className="w-4 h-4 text-slate-400"/> Word Stats</div>
                   <div className="flex gap-4">
                       <div className="tabular-nums"><span className="text-slate-400 font-normal mr-1">Total Words:</span>{stats.totalWordCount}</div>
                       <div className="tabular-nums"><span className="text-slate-400 font-normal mr-1">Sum Sqrt (T/P):</span>{stats.totalSqrtWordCount.toFixed(2)} <span className="text-slate-300">/</span> <span className="text-indigo-500">{stats.perfectSqrtWordCount.toFixed(2)}</span></div>
                   </div>
                </div>
          </div>

          <div className="grid gap-2 mt-4">
            {displayPhrases.map((p, index) => {
              const queueIndex = deck.queue.indexOf(p.id);
              const displayIndex = queueIndex >= 0 ? queueIndex + 1 : '-';
              const isDraggable = !searchQuery && editingPhraseId === null;
              
              if (editingPhraseId === p.id) {
                return (
                  <div key={p.id} className="bg-white p-6 rounded-2xl shadow-lg border-2 border-indigo-500 space-y-4 animate-in zoom-in-95">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div><label className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1 block">中文题目</label><input autoFocus className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 font-bold" value={editForm.chinese} onChange={e=>setEditForm({...editForm, chinese: e.target.value})}/></div>
                      <div><label className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1 block">英文答案</label><input className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 font-bold" value={editForm.english} onChange={e=>setEditForm({...editForm, english: e.target.value})}/></div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div><label className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1 block">笔记 (支持 \n 换行)</label><textarea className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 min-h-[80px]" value={editForm.note} onChange={e=>setEditForm({...editForm, note: e.target.value})}/></div>
                      <div>
                          <label className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1 block">记忆难度 (0-5)</label>
                          <input type="number" min="0" max="5" step="0.5" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 ring-indigo-500 font-black text-indigo-600" value={editForm.diff} onChange={e=>setEditForm({...editForm, diff: parseFloat(e.target.value) || 2.5})}/>
                          <p className="text-[10px] text-slate-400 mt-2">影响复习频率。数值越大难度越高，复习越频繁。默认 2.5。</p>
                      </div>
                    </div>
                    <div className="flex justify-end gap-3 pt-2">
                       <Button variant="ghost" onClick={()=>setEditingPhraseId(null)}>取消</Button>
                       <Button onClick={savePhrase}><Save className="w-4 h-4 mr-2"/> 保存</Button>
                    </div>
                  </div>
                );
              }

              const badgeColor = getScoreBadgeColor(p.score);
              const label = getPhraseTag(p.score);
              const wordCount = subject === 'English' ? countWords(p.english) : countWords(p.chinese);
              
              return (
                <div 
                  key={p.id} 
                  draggable={isDraggable ? "true" : "false"}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={(e) => handleDrop(e, index)}
                  className={`bg-white p-4 rounded-xl border border-slate-100 hover:border-indigo-200 transition-all flex items-center justify-between group ${draggedItemIndex === index ? 'opacity-50 bg-indigo-50 border-indigo-300' : ''}`}
                >
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                     <div className={`cursor-grab active:cursor-grabbing p-1 text-slate-300 hover:text-slate-500 ${isDraggable ? '' : 'opacity-0 pointer-events-none'}`}><GripVertical className="w-5 h-5"/></div>
                     <div className="flex flex-col items-center justify-center w-10 shrink-0">
                        <span className="text-xs font-black text-slate-300">#{displayIndex}</span>
                        <div className="mt-1 px-1.5 py-0.5 rounded text-[10px] font-black text-white" style={{ backgroundColor: badgeColor }}>{label}</div>
                     </div>
                     <div className="min-w-0 flex-1">
                        <div className="font-bold text-slate-800 text-sm truncate mb-0.5">{p.chinese}</div>
                        <div className="flex items-center gap-2">
                            <div className="font-medium text-slate-500 text-xs truncate max-w-[200px]">{p.english}</div>
                            <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-1.5 rounded border border-slate-200 tabular-nums shrink-0">{wordCount}w</span>
                            <span className="text-[9px] font-black px-1.5 rounded border shrink-0 text-slate-500 bg-slate-50 border-slate-200">Diff: {p.diff ?? 2.5}</span>
                            <span className={`text-[9px] font-black px-1.5 rounded border shrink-0 ${(p.back || 0) <= 0 ? 'text-rose-500 bg-rose-50 border-rose-200 animate-pulse' : 'text-slate-400 bg-slate-50 border-slate-200'}`}>Back: {p.back || 0}</span>
                        </div>
                     </div>
                  </div>
                  <div className="flex items-center gap-2 pl-4 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                     <button onClick={()=>startEditing(p)} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"><Edit2 className="w-4 h-4"/></button>
                     <button onClick={()=>setPhraseToDelete(p.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4"/></button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. History Tab 学习历史 */}
      {activeTab === 'history' && (
         <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
             <div className="flex bg-slate-100 p-1 rounded-xl w-fit">
                <button onClick={() => setHistoryMode('study')} className={`px-4 py-2 rounded-lg text-xs font-black transition-all ${historyMode === 'study' ? 'bg-white shadow text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>背诵记录</button>
                <button onClick={() => setHistoryMode('exam')} className={`px-4 py-2 rounded-lg text-xs font-black transition-all ${historyMode === 'exam' ? 'bg-white shadow text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>考试记录</button>
             </div>
             {filteredHistory.length === 0 ? (
                 <div className="text-center py-12 text-slate-400 italic">暂无{historyMode === 'study' ? '背诵' : '考试'}记录</div>
             ) : (
                 <div className="grid gap-3">
                     {filteredHistory.map(log => {
                       const accuracy = log.reviewCount > 0 ? ((log.count4_5 + log.count2_3 * 0.5) / log.reviewCount) * 100 : 0;
                       const isExpanded = expandedLogId === log.id;
                       return (
                         <div key={log.id} className="bg-white rounded-xl border border-slate-100 overflow-hidden transition-all hover:shadow-md">
                           <div className="p-4 cursor-pointer hover:bg-slate-50 transition-colors flex items-center justify-between" onClick={() => setExpandedLogId(isExpanded ? null : log.id)}>
                                <div className="flex items-center gap-4">
                                    <div className={`p-2 rounded-lg ${log.mode === 'EXAM' ? 'bg-amber-100 text-amber-600' : 'bg-indigo-100 text-indigo-600'}`}>
                                        {log.mode === 'EXAM' ? <GraduationCap className="w-5 h-5"/> : <BookOpen className="w-5 h-5"/>}
                                    </div>
                                    <div>
                                        <div className="font-bold text-slate-700 text-sm flex items-center gap-2">
                                           {formatDate(log.timestamp)}
                                        </div>
                                        <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                                            <span className="flex items-center gap-1"><Clock className="w-3 h-3"/> {formatDuration(log.durationSeconds)}</span>
                                            <span>•</span>
                                            <span>{log.reviewCount} interactions</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-lg font-black" style={{ color: getDynamicColor(accuracy) }}>{accuracy.toFixed(0)}%</div>
                                    <div className="text-[10px] text-slate-400 font-bold">{log.count4_5}优 / {log.count2_3}中 / {log.count0_1}差</div>
                                </div>
                           </div>
                           {isExpanded && (
                               <div className="p-4 pt-0 border-t border-slate-50 bg-slate-50/30">
                                    {renderChart(log)}
                                    {log.examResults && log.examResults.length > 0 && (
                                        <div className="mt-4 pt-4 border-t border-slate-100">
                                            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Exam Details</h4>
                                            <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                                                {log.examResults.map((res, idx) => (
                                                    <div key={idx} className="flex items-center text-xs p-2 bg-white rounded-lg border border-slate-100">
                                                        {res.isCorrect ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mr-2 shrink-0"/> : <X className="w-3.5 h-3.5 text-rose-500 mr-2 shrink-0"/>}
                                                        <div className="flex-1 min-w-0 grid grid-cols-2 gap-2">
                                                            <div className="truncate font-bold text-slate-700" title={res.q}>{res.q}</div>
                                                            <div className="truncate text-slate-500 text-right" title={res.a}>{res.a}</div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                               </div>
                           )}
                         </div>
                       );
                     })}
                 </div>
             )}
         </div>
      )}

      {/* 5. Macro Tab 宏观趋势 */}
      {activeTab === 'macro' && (
          <div className="animate-in fade-in slide-in-from-bottom-4">
             {renderMacroChart()}
          </div>
      )}

      {/* ========== Modals ========== */}
      
      {showBatchModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-6xl flex flex-col h-[80vh]">
             <div className="p-4 border-b border-slate-100 flex justify-between items-center shrink-0">
               <h3 className="font-bold text-lg">批量编辑</h3>
               <button onClick={()=>setShowBatchModal(false)}><X className="w-6 h-6 text-slate-400"/></button>
             </div>
             <div className="p-4 flex-1 overflow-hidden flex flex-col min-h-0">
               <div className="text-xs font-bold text-amber-800 mb-2 p-3 bg-amber-50 rounded-lg shrink-0">格式：题目 | 答案 | 笔记 | Score (输入 'new' 代表新词) | 记忆难度 | Back (后推步数) | 排序ID</div>
               <textarea className="flex-1 w-full p-4 border border-slate-200 rounded-xl font-mono text-sm leading-relaxed outline-none focus:ring-2 ring-indigo-500 resize-none overflow-y-auto whitespace-pre" value={batchText} onChange={e=>setBatchText(e.target.value)} spellCheck={false}/>
             </div>
             <div className="p-4 border-t border-slate-100 flex justify-end gap-3 shrink-0">
               <Button variant="ghost" onClick={()=>setShowBatchModal(false)}>取消</Button>
               <Button onClick={confirmBatchSave}>确认覆盖</Button>
             </div>
          </div>
        </div>
      )}

      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
             <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"><RotateCcw className="w-6 h-6 text-red-600"/></div>
             <h3 className="text-lg font-black text-slate-900 mb-2">确认清空进度？</h3>
             <p className="text-sm text-slate-500 mb-6">将重置所有词条的 Score、Diff 和 Back。此操作不可撤销。</p>
             <input autoFocus className="w-full p-3 border-2 border-slate-200 rounded-xl text-center font-bold mb-4 focus:border-red-500 outline-none" placeholder="输入 RESET 确认" value={resetInput} onChange={e=>setResetInput(e.target.value)}/>
             <div className="flex flex-col gap-2">
                <Button variant="danger" fullWidth disabled={resetInput !== 'RESET'} onClick={handleResetProgress}>确认重置</Button>
                <Button variant="ghost" fullWidth onClick={()=>{setShowResetConfirm(false); setResetInput('');}}>取消</Button>
             </div>
          </div>
        </div>
      )}

      {showShuffleConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
             <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4"><Dices className="w-6 h-6 text-indigo-600"/></div>
             <h3 className="text-lg font-black text-slate-900 mb-2">确认打乱顺序？</h3>
             <p className="text-sm text-slate-500 mb-6">将随机打乱所有词条的排列顺序。分数和难度将被保留。</p>
             <div className="flex flex-col gap-2">
                <Button onClick={handleShuffle} fullWidth className="py-3 font-black bg-indigo-600 shadow-lg shadow-indigo-200">确认打乱</Button>
                <Button variant="ghost" fullWidth onClick={()=>setShowShuffleConfirm(false)}>取消</Button>
             </div>
          </div>
        </div>
      )}

      {phraseToDelete && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center animate-in zoom-in-95">
             <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"><Trash2 className="w-6 h-6 text-red-600"/></div>
             <h3 className="text-lg font-black text-slate-900 mb-2">确认删除?</h3>
             <p className="text-sm text-slate-500 mb-6">删除后无法恢复。</p>
             <div className="flex flex-col gap-2">
                <Button variant="danger" fullWidth onClick={executeDelete}>确认删除</Button>
                <Button variant="ghost" fullWidth onClick={()=>setPhraseToDelete(null)}>取消</Button>
             </div>
          </div>
        </div>
      )}

      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
             <div className="flex items-center gap-3 mb-6"><div className="p-2 bg-slate-100 rounded-lg text-slate-600"><Settings className="w-6 h-6"/></div><h3 className="text-lg font-black text-slate-800">高级设置</h3></div>
             
             <div className="space-y-4 mb-8">
                 <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                     <label className="flex items-center justify-between cursor-pointer group">
                         <div className="pr-4">
                             <div className="text-sm font-black text-slate-800 mb-1">参与灵根数量 (Speed)</div>
                             <div className="text-xs text-slate-400">计入全局灵根评级</div>
                         </div>
                         <div className={`w-12 h-6 rounded-full transition-colors relative ${statsOptions.includeInQuantity ? 'bg-indigo-500' : 'bg-slate-300'}`} onClick={() => setStatsOptions(p => ({...p, includeInQuantity: !p.includeInQuantity}))}>
                             <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${statsOptions.includeInQuantity ? 'left-7' : 'left-1'}`}></div>
                         </div>
                     </label>
                 </div>
                 <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                     <label className="flex items-center justify-between cursor-pointer group">
                         <div className="pr-4">
                             <div className="text-sm font-black text-slate-800 mb-1">参与灵根质量 (Quality)</div>
                             <div className="text-xs text-slate-400">计入全局灵根评级</div>
                         </div>
                         <div className={`w-12 h-6 rounded-full transition-colors relative ${statsOptions.includeInQuality ? 'bg-indigo-500' : 'bg-slate-300'}`} onClick={() => setStatsOptions(p => ({...p, includeInQuality: !p.includeInQuality}))}>
                             <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${statsOptions.includeInQuality ? 'left-7' : 'left-1'}`}></div>
                         </div>
                     </label>
                 </div>
                 <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                     <label className="text-xs font-black text-slate-400 uppercase mb-2 block">移动到文件夹</label>
                     <select 
                        className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm font-bold"
                        value={deck.folderId || ""}
                        onChange={(e) => onUpdateDeck({...deck, folderId: e.target.value || undefined})}
                     >
                        <option value="">(无文件夹 - 根目录)</option>
                        {/* 这里假设你通过 props 传了全局 folders 进来 */}
                        {Array.isArray(folders) && folders.map((f: Folder) => <option key={f.id} value={f.id}>{f.name}</option>)}
                     </select>
                 </div>
                 
                 <div className="bg-rose-50 p-4 rounded-xl border border-rose-100 mt-4">
                     <div className="flex items-center justify-between">
                         <div className="pr-4">
                             <div className="text-sm font-black text-rose-900 mb-1">危险区域</div>
                             <div className="text-xs text-rose-700/70">永久删除本词组本及其所有历史记录</div>
                         </div>
                         <Button onClick={() => { if(confirm("确定要删除本词本吗？")) { onDeleteDeck(deck.id); onBack(); } }} variant="danger" className="text-xs px-3 py-1.5 h-auto font-black">删除词本</Button>
                     </div>
                 </div>
             </div>

             <div className="flex gap-3">
                 <Button variant="ghost" fullWidth onClick={() => setShowSettingsModal(false)}>取消</Button>
                 <Button fullWidth onClick={() => { handleUpdate(); setShowSettingsModal(false); }}>保存设置</Button>
             </div>
          </div>
        </div>
      )}

      {showSmartSortModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
           <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto custom-scrollbar">
              <div className="flex items-center gap-3 mb-6"><div className="p-2 bg-indigo-100 rounded-lg text-indigo-600"><Shuffle className="w-6 h-6"/></div><h3 className="text-lg font-black text-slate-800">智能重排</h3></div>
              
              <div className="mb-6">
                 <label className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 block">1. 筛选状态 (基于 Score)</label>
                 <div className="flex flex-wrap gap-2 mb-2">
                     <button onClick={()=>selectGroup('New')} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold hover:bg-slate-50">全选新词</button>
                     <button onClick={()=>selectGroup('Wrong')} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold hover:bg-slate-50 text-rose-500">全选错词</button>
                     <button onClick={()=>selectGroup('Correct')} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold hover:bg-slate-50 text-emerald-600">全选熟词</button>
                 </div>
                 <div className="flex flex-wrap gap-2 p-2 max-h-40 overflow-y-auto custom-scrollbar border border-slate-100 rounded-xl bg-slate-50/50">
                     {availableTags.map(tag => {
                         const isActive = selectedTags.has(tag);
                         const color = isActive ? (tag === '新' ? '#94a3b8' : tag.startsWith('对') ? getScoreBadgeColor(parseInt(tag.slice(1))) : getScoreBadgeColor(-parseInt(tag.slice(1)))) : 'transparent';
                         return (
                             <button key={tag} onClick={()=>toggleTag(tag)} className={`px-2 py-1.5 rounded-lg text-xs font-black border transition-all flex items-center gap-1 ${isActive ? 'text-white border-transparent shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300'}`} style={{ backgroundColor: color }}>
                                 {tag} {isActive && <Check className="w-3 h-3"/>}
                             </button>
                         );
                     })}
                 </div>
              </div>

              <div className="mb-8">
                 <label className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 block">2. 选择重排策略</label>
                 <div className="grid grid-cols-1 gap-3">
                    <button onClick={()=>setSortStrategy('head')} className={`p-3 rounded-xl border-2 text-left transition-all ${sortStrategy === 'head' ? 'border-indigo-500 bg-indigo-50' : 'border-slate-100 hover:border-slate-300'}`}>
                        <div className={`font-black text-sm mb-1 ${sortStrategy==='head'?'text-indigo-700':'text-slate-700'}`}>优先置顶 (Head)</div>
                        <div className="text-[10px] text-slate-400 leading-tight">选中的内容全部移动到队列最前方</div>
                    </button>
                    <div className={`p-3 rounded-xl border-2 text-left transition-all ${sortStrategy === 'interleave' ? 'border-indigo-500 bg-indigo-50' : 'border-slate-100 hover:border-slate-300'}`} onClick={()=>setSortStrategy('interleave')}>
                        <div className="flex justify-between items-start">
                            <div>
                                <div className={`font-black text-sm mb-1 ${sortStrategy==='interleave'?'text-indigo-700':'text-slate-700'}`}>穿插排列 (Interleave)</div>
                                <div className="text-[10px] text-slate-400 leading-tight">将选中内容均匀插入未选中内容中</div>
                            </div>
                            <AlignJustify className={`w-5 h-5 ${sortStrategy==='interleave'?'text-indigo-500':'text-slate-300'}`} />
                        </div>
                        {sortStrategy === 'interleave' && (
                            <div className="mt-3 pt-3 border-t border-indigo-200/50 flex items-center gap-3 animate-in fade-in">
                                <span className="text-xs font-bold text-indigo-700">每隔</span>
                                <input type="number" min="1" max="50" value={interleaveRatio} onChange={(e) => setInterleaveRatio(Math.max(1, parseInt(e.target.value) || 1))} onClick={(e)=>e.stopPropagation()} className="w-12 text-center text-sm font-black p-1 rounded border border-indigo-300 text-indigo-900 focus:ring-2 ring-indigo-400 outline-none" />
                                <span className="text-xs font-bold text-indigo-700">个未选中词插入 1 个选中词</span>
                            </div>
                        )}
                    </div>
                 </div>
              </div>

              <div className="flex gap-3">
                  <Button variant="ghost" fullWidth onClick={()=>setShowSmartSortModal(false)}>取消</Button>
                  <Button fullWidth onClick={handleSmartSort} disabled={selectedTags.size === 0}>确认重排</Button>
              </div>
           </div>
        </div>
      )}

      {showSplitModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
           <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center animate-in zoom-in-95">
              <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-600"><Split className="w-6 h-6" /></div>
              <h3 className="text-lg font-black text-slate-900 mb-2">拆分词组本</h3>
              <p className="text-sm text-slate-500 mb-6">将当前 {deck.queue.length} 个词组平均拆分为多个子本。</p>
              
              <div className="space-y-4 mb-6">
                  <div className="flex items-center justify-center gap-3 bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <span className="text-xs font-black text-slate-500">拆分为</span>
                      <input type="number" min="2" max="20" value={splitParts} onChange={e=>setSplitParts(Math.max(2, parseInt(e.target.value)||2))} className="w-16 p-1 text-center font-black border-2 border-slate-200 rounded-lg focus:border-indigo-500 outline-none text-slate-800 bg-white" />
                      <span className="text-xs font-black text-slate-500">份</span>
                  </div>
                  
                  <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-white cursor-pointer hover:bg-slate-50 transition-all text-left">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${splitKeepProgress ? 'border-indigo-500 bg-indigo-500' : 'border-slate-300'}`}>
                          {splitKeepProgress && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                      </div>
                      <input type="checkbox" checked={splitKeepProgress} onChange={e => setSplitKeepProgress(e.target.checked)} className="hidden" />
                      <div className="text-xs">
                          <span className="block font-black text-slate-700">保留进度 (Keep Progress)</span>
                          <span className="block text-slate-400">保留 Score、Diff 等状态</span>
                      </div>
                  </label>
              </div>

              <div className="flex gap-2">
                  <Button fullWidth onClick={handleSplitDeck} className="bg-indigo-600 hover:bg-indigo-700 text-white font-black shadow-lg">确认拆分</Button>
                  <Button variant="ghost" fullWidth onClick={()=>setShowSplitModal(false)}>取消</Button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
};
