// src/components/Importer.tsx

import React, { useState } from 'react';
import { Button } from './Button';
import { ArrowLeft, Languages, Info, Code, CheckCircle2, AlertCircle } from 'lucide-react';
import { Phrase, DeckSubject, ContentType, StudyMode } from '../types';
import { v4 as uuidv4 } from 'uuid';

interface ImporterProps {
  onImport: (name: string, phrases: Phrase[], subject: DeckSubject, contentType?: ContentType, studyMode?: StudyMode, allowFreeze?: boolean) => void;
  onBack: () => void;
}

export const Importer: React.FC<ImporterProps> = ({ onImport, onBack }) => {
  const [deckName, setDeckName] = useState('');
  const [subject, setSubject] = useState<DeckSubject>('English');
  const [contentType, setContentType] = useState<ContentType>('PhraseSentence');
  const [studyMode, setStudyMode] = useState<StudyMode>('CN_EN');
  const [allowFreeze, setAllowFreeze] = useState(true);
  const [manualText, setManualText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleImport = () => {
    if (!deckName.trim()) { 
      setError("请输入词组本名称。"); 
      return; 
    }

    const lines = manualText.split('\n').filter(l => l.trim().length > 0);
    const today = Math.floor(Date.now() / 86400000); // 距纪元天数
    
    // 1. 逐行解析
    const parsedItems = lines.map((line, index) => {
       const parts = line.split('|').map(s => s.trim());
       if (parts.length < 2) return null;
       
       const chinese = parts[0];
       const english = parts[1];
       const noteRaw = parts[2] || '';
       
       // 进度解析：正数为连对，负数为连错
       let score: number | undefined = undefined;
       let totalWrong = 0;
       if (parts.length >= 4 && parts[3] !== '') {
           const val = parseInt(parts[3]);
           if (!isNaN(val) && val !== 0) {
               score = val;
               if (val < 0) totalWrong = Math.abs(val);
           }
       }

       // 位置解析：用于排序
       let position: number | null = null;
       if (parts.length >= 5 && parts[4] !== '') {
           const val = parseFloat(parts[4]);
           if (!isNaN(val)) position = val;
       }

       return { 
         chinese, 
         english, 
         note: noteRaw.replace(/\\n/g, '\n'), // 支持 \n 换行转换
         score, 
         position, 
         originalIndex: index,
         totalWrong 
       };
    }).filter(item => item !== null) as any[];

    if (parsedItems.length === 0 && manualText.trim().length > 0) {
      setError("格式无法识别。请确保至少包含：题目 | 答案");
      return;
    }

    // 2. 根据位置 (position) 进行排序
    parsedItems.sort((a, b) => {
      const posA = a.position !== null ? a.position : a.originalIndex;
      const posB = b.position !== null ? b.position : b.originalIndex;
      return posA - posB;
    });

    // 3. 映射为标准的 Phrase 对象
    const phrases: Phrase[] = parsedItems.map(item => ({
        id: uuidv4(),
        english: item.english,
        chinese: item.chinese,
        note: item.note,
        // V2 算法初始化
        score: item.score,      // undefined 代表新词
        diff: 2.5,              // 默认记忆难度
        back: 0,                // 初始 back 为 0，立马进入复习队列
        date: today,
        totalReviews: item.score ? Math.abs(item.score) : 0,
        totalWrong: item.totalWrong,
        mastery: 0
    }));

    onImport(deckName, phrases, subject, contentType, studyMode, allowFreeze);
  };

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6 pb-24">
      {/* 顶栏 */}
      <div className="flex items-center space-x-4 mb-8">
        <button onClick={onBack} className="p-2.5 hover:bg-slate-200 bg-slate-100 rounded-full transition-colors">
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>
        <div>
          <h2 className="text-2xl font-black text-slate-800 leading-tight">新建词组本</h2>
          <p className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-widest">Manual Import</p>
        </div>
      </div>

      <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-sm border border-slate-100 space-y-8">
        
        {/* === 1. 基础设置 === */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">词组本名称 Name</label>
            <input 
              type="text" 
              value={deckName} 
              onChange={(e) => setDeckName(e.target.value)} 
              placeholder="例如：高中英语核心词汇..." 
              className="w-full px-4 py-3 border-2 border-slate-100 rounded-xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all font-bold text-slate-800" 
            />
          </div>
          <div>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">学科分类 Subject</label>
            <div className="flex bg-slate-50 p-1.5 rounded-xl border border-slate-100">
               <button onClick={()=>setSubject('English')} className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-black rounded-lg transition-all ${subject==='English'?'bg-white shadow-sm text-indigo-600':'text-slate-400 hover:text-slate-600'}`}><Languages className="w-4 h-4"/> 英语</button>
               <button onClick={()=>setSubject('Chinese')} className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-black rounded-lg transition-all ${subject==='Chinese'?'bg-white shadow-sm text-emerald-600':'text-slate-400 hover:text-slate-600'}`}>语文</button>
            </div>
          </div>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 animate-in fade-in duration-300">
             <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">内容类型 Content</label>
                <div className="flex bg-slate-50 p-1.5 rounded-xl border border-slate-100">
                   <button onClick={()=>setContentType('Word')} className={`flex-1 py-2 text-sm font-black rounded-lg transition-all ${contentType==='Word' ? (subject==='English'?'bg-white shadow-sm text-indigo-600':'bg-white shadow-sm text-emerald-600') : 'text-slate-400 hover:text-slate-600'}`}>
                       {subject === 'English' ? '单词' : '文言实词'}
                   </button>
                   <button onClick={()=>setContentType('PhraseSentence')} className={`flex-1 py-2 text-sm font-black rounded-lg transition-all ${contentType==='PhraseSentence' ? (subject==='English'?'bg-white shadow-sm text-indigo-600':'bg-white shadow-sm text-emerald-600') : 'text-slate-400 hover:text-slate-600'}`}>
                       {subject === 'English' ? '词组 / 句子' : '其他'}
                   </button>
                </div>
             </div>
             
             {/* 英语特有：背诵模式 */}
             {subject === 'English' ? (
                 <div>
                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">背诵模式 Mode</label>
                    <div className="flex bg-slate-50 p-1.5 rounded-xl border border-slate-100">
                        <button onClick={()=>setStudyMode('CN_EN')} className={`flex-1 py-2 text-sm font-black rounded-lg transition-all ${studyMode==='CN_EN'?'bg-white shadow-sm text-indigo-600':'text-slate-400 hover:text-slate-600'}`}>中 → 英</button>
                        <button onClick={()=>setStudyMode('EN_CN')} className={`flex-1 py-2 text-sm font-black rounded-lg transition-all ${studyMode==='EN_CN'?'bg-white shadow-sm text-indigo-600':'text-slate-400 hover:text-slate-600'}`}>英 → 中</button>
                    </div>
                 </div>
             ) : (
                /* 语文特有：允许冻结开关 */
                 <div>
                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">学习选择 Options</label>
                    <label className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-100 rounded-xl cursor-pointer hover:bg-slate-100 transition-colors">
                      <div>
                        <div className="text-sm font-black text-slate-700">允许词条冻结</div>
                        <div className="text-[10px] font-bold text-slate-400 mt-0.5">后推超出队列时，将其冻结在队尾</div>
                      </div>
                      <div className={`w-12 h-6 rounded-full transition-colors relative shadow-inner ${allowFreeze ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                         <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${allowFreeze ? 'left-7' : 'left-1'}`}></div>
                      </div>
                    </label>
                 </div>
             )}
        </div>

        {/* 英语时的允许冻结开关（单列） */}
        {subject === 'English' && (
          <div>
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-2">学习选择 Options</label>
            <label className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl cursor-pointer hover:bg-slate-100 transition-colors max-w-sm">
              <div>
                <div className="text-sm font-black text-slate-700 flex items-center gap-2">允许词条冻结 {allowFreeze && <CheckCircle2 className="w-4 h-4 text-emerald-500"/>}</div>
                <div className="text-[10px] font-bold text-slate-400 mt-0.5">后推超出队列时，将其冻结在队尾</div>
              </div>
              <div className={`w-12 h-6 rounded-full transition-colors relative shadow-inner ${allowFreeze ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                 <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${allowFreeze ? 'left-7' : 'left-1'}`}></div>
              </div>
            </label>
          </div>
        )}

        {/* === 2. 格式说明框 === */}
        <div className="bg-[#fff8f0] p-5 rounded-2xl border border-[#ffedd5] space-y-5">
           
           <div className="flex items-start gap-3 text-[#9a3412]">
              <Info className="w-5 h-5 shrink-0 mt-0.5 text-[#ea580c]" />
              <div className="space-y-2">
                <p className="font-black text-base">基础格式：题目 | 答案</p>
                <p className="text-sm font-medium flex items-center gap-2 text-[#c2410c]">
                  示例：<code className="bg-white/80 px-2 py-0.5 rounded-md font-mono text-[#9a3412] shadow-sm">你好 | Hello</code>
                </p>
              </div>
           </div>
           
           <div className="w-full h-px bg-[#fed7aa]/50"></div>
           
           <div className="flex items-start gap-3 text-[#9a3412]">
              <Code className="w-5 h-5 shrink-0 mt-0.5 text-[#ea580c]" />
              <div className="space-y-3">
                <p className="font-black text-base">高级格式：题目 | 答案 | 笔记 | 进度 | 位置</p>
                <ul className="text-sm font-medium space-y-2 list-none text-[#c2410c]">
                  <li className="flex items-center gap-2">- 笔记中换行请使用 <code className="bg-white/80 px-1.5 py-0.5 rounded text-[#9a3412] font-mono font-black shadow-sm">\n</code></li>
                  <li>- 进度正数为连对次数，负数为连错次数</li>
                  <li>- 位置为数字，决定在队列中的初始排序</li>
                </ul>
              </div>
           </div>

        </div>

        {/* === 3. 输入区 === */}
        <div>
          <textarea 
            value={manualText} 
            onChange={(e) => setManualText(e.target.value)} 
            placeholder={`在此处粘贴内容...\n\n示例：\n你好 | Hello\n复杂的 | Complex | 笔记第一行\\n笔记第二行 | 2 | 1`} 
            className="w-full h-72 px-5 py-4 border-2 border-slate-100 rounded-2xl focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none font-mono text-sm shadow-inner leading-relaxed text-slate-700 bg-slate-50 placeholder:text-slate-300 transition-all" 
            spellCheck={false}
          />
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="p-4 bg-red-50 text-red-700 text-sm font-bold rounded-xl border border-red-100 flex items-center gap-2 animate-in slide-in-from-bottom-2">
            <AlertCircle className="w-5 h-5" /> {error}
          </div>
        )}

        <Button onClick={handleImport} fullWidth className="py-4 shadow-xl text-lg font-black bg-slate-900 hover:bg-slate-800 text-white rounded-2xl">
          导入并创建词本
        </Button>

      </div>
    </div>
  );
};