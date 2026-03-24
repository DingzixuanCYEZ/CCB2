import React, { useState } from 'react';
import { DailyStats, Deck, ActivityLog, DeckSubject } from '../types';
import { 
  X, Clock, Target, BookOpen, TrendingUp, GraduationCap, Zap, 
  FileText, CheckCircle2, Languages, Award, Swords, ScrollText, 
  Info, Calendar, Flame 
} from 'lucide-react';
import { Button } from './Button';

// 核心修复：只从正确的 utils 路径导入，严禁从 ../App 导入这些函数
import { getDynamicColor } from '../utils/algo'; 
import { getRealmInfo, getPersistenceGrade } from '../utils/realms';

// 只从 App 导入格式化时间的函数
import { formatFullTime } from '../App'; 

// 注意：请确保下方没有任何其他 import 语句了

interface DailyReportProps {
  stats: DailyStats;
  globalStats: { English: number; Chinese: number }; 
  decks: Deck[];
  onClose: () => void;
  persistence: any;
}

export const DailyReport: React.FC<DailyReportProps> = ({ stats, globalStats, decks, onClose, persistence }) => {
  // === 1. 基础数据统计 ===
  const totalInteractions = stats.count0_1 + stats.count2_3 + stats.count4_5;
  
  // 计算综合正确率 (权重映射：4-5分算高权，2-3分中权，0-1分低权)
  const accuracy = totalInteractions > 0 
    ? ((stats.count4_5 + stats.count2_3 * 0.5) / totalInteractions) * 100 
    : 0;

  const activities = stats.activities || [];
  
  // 分类：日常复习 vs 考试 vs 每日大盘
  const studyActivities = activities.filter(a => a.mode === 'STUDY').sort((a, b) => b.timestamp - a.timestamp);
  const examActivities = activities.filter(a => a.mode === 'EXAM').sort((a, b) => b.timestamp - a.timestamp);
  const hubActivities = activities.filter(a => a.mode === 'DAILY_REVIEW').sort((a, b) => b.timestamp - a.timestamp);

  // 计算单科今日数据
  const calculateSubjectMetrics = (subject: DeckSubject) => {
    const relevant = activities.filter(a => a.deckSubject === subject);
    const total = relevant.reduce((sum, a) => sum + a.count, 0);
    const time = relevant.reduce((sum, a) => sum + a.durationSeconds, 0);
    // 估算单科修为增量
    const gain = relevant.reduce((sum, a) => sum + (a.count4_5 * 0.8 - a.count0_1 * 0.8), 0);
    return { total, time, gain };
  };

  const enMetrics = calculateSubjectMetrics('English');
  const cnMetrics = calculateSubjectMetrics('Chinese');

  const englishRealm = getRealmInfo(globalStats.English, 'English');
  const chineseRealm = getRealmInfo(globalStats.Chinese, 'Chinese');

  // 时间格式化辅助
  const formatHeaderTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h${m}m` : `${m}m`;
  };
// src/components/DailyReport.tsx (Part 2) 接着上文

  return (
    <div className="fixed inset-0 bg-white z-[1000] flex flex-col h-full w-full overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
      {/* 1. 顶部标题栏 */}
      <div className="bg-white border-b border-slate-100 flex justify-between items-center px-5 py-3 shrink-0 h-16 shadow-sm relative z-10">
         <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-900 rounded-xl shadow-lg"><ScrollText className="w-6 h-6 text-white" /></div>
            <div>
               <h2 className="text-sm font-black text-slate-800 tracking-tight leading-none">今日学习日报</h2>
               <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Growth Tracker</span>
                  <span className="text-[10px] font-bold text-slate-300">|</span>
                  <span className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
                     <Calendar className="w-3.5 h-3.5"/> {stats.date}
                  </span>
               </div>
            </div>
         </div>
         <button onClick={onClose} className="p-2 text-slate-300 hover:text-slate-600 transition-colors bg-slate-50 rounded-full"><X className="w-6 h-6" /></button>
      </div>

      {/* 2. 滚动内容区 */}
      <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-50/30 pb-32">
        <div className="max-w-2xl mx-auto p-5 space-y-6">
          
          {/* A. 核心数据三连卡片 */}
          <div className="grid grid-cols-3 gap-4">
             <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-center items-center text-center">
                <Clock className="w-6 h-6 text-blue-500 mb-2" />
                <div className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-1">学习时长</div>
                <div className="text-lg font-black text-slate-800">{formatFullTime(stats.studyTimeSeconds)}</div>
             </div>
             <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-center items-center text-center">
                <Target className="w-6 h-6 text-indigo-600 mb-2" />
                <div className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-1">交互统计</div>
                <div className="text-lg font-black text-slate-800 leading-tight">{totalInteractions} <span className="text-xs text-slate-300">次</span></div>
                <div className="flex gap-2 mt-1 text-[9px] font-black uppercase">
                   <span className="text-emerald-500">{stats.count4_5}优</span>
                   <span className="text-rose-400">{stats.count0_1}差</span>
                </div>
             </div>
             <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-center items-center text-center">
                 <Zap className="w-6 h-6 text-amber-500 mb-2" />
                 <div className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-1">综合正确率</div>
                 <div className="text-2xl font-black text-slate-800 mb-1">{accuracy.toFixed(1)}<span className="text-xs text-slate-300">%</span></div>
                 <div className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded-lg">基于权重映射</div>
             </div>
          </div>

          {/* B. 修为境界详细看板 */}
          <div className="space-y-4">
             {/* 英语修为卡片 */}
             <div className="bg-white p-6 rounded-[2.5rem] border border-indigo-100 shadow-lg relative overflow-hidden flex flex-col gap-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl border border-indigo-100"><Languages className="w-6 h-6" /></div>
                    <div>
                      <h3 className="text-lg font-black text-slate-800">英语修为 (English)</h3>
                      <div className="flex flex-col items-start gap-0.5 mt-1">
                          <span className={`text-sm font-black ${englishRealm.color} flex items-center gap-1.5`}><Swords className="w-4 h-4"/>{englishRealm.name}</span>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total Score: {globalStats.English.toFixed(1)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-indigo-400 font-black uppercase tracking-widest">今日净增长</div>
                    <div className={`text-3xl font-black ${enMetrics.gain >= 0 ? 'text-indigo-600' : 'text-rose-500'}`}>
                      {enMetrics.gain > 0 ? '+' : ''}{enMetrics.gain.toFixed(1)}
                    </div>
                  </div>
                </div>
                
                {/* 坚持等级条 */}
                <div>
                    <div className="flex justify-between items-end mb-1.5">
                        <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-1"><Flame className="w-3.5 h-3.5 text-orange-500"/> 坚持 (Persistence)</span>
                        <span className="text-xs font-black text-slate-600">Grade {persistence.English.grade || 'F'}</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-400 rounded-full transition-all duration-700" style={{ width: `${(persistence.English.progress || 0) * 100}%` }}></div>
                    </div>
                </div>

                {/* 修仙进度条 */}
                <div className="space-y-2">
                   <div className="flex justify-between items-end">
                      <span className="text-xs font-black text-slate-400 uppercase">NEXT REALM: {englishRealm.percent.toFixed(1)}%</span>
                      <span className="text-xs font-black text-indigo-500 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-100">还需 {englishRealm.remain} 修为</span>
                   </div>
                   <div className="h-4 bg-slate-100 rounded-full overflow-hidden p-0.5 shadow-inner border border-slate-50">
                      <div className="h-full bg-gradient-to-r from-indigo-400 to-indigo-700 rounded-full transition-all duration-1000 ease-out shadow-[0_0_15px_rgba(79,70,229,0.4)] relative" style={{ width: `${englishRealm.percent}%` }}>
                         <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                      </div>
                   </div>
                </div>
             </div>

             {/* 语文品阶卡片 */}
             <div className="bg-white p-6 rounded-[2.5rem] border border-emerald-100 shadow-lg relative overflow-hidden flex flex-col gap-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl border border-emerald-100"><ScrollText className="w-6 h-6" /></div>
                    <div>
                      <h3 className="text-lg font-black text-slate-800">语文品阶 (Chinese)</h3>
                      <div className="flex flex-col items-start gap-0.5 mt-1">
                          <span className={`text-sm font-black ${chineseRealm.color} flex items-center gap-1.5`}><Swords className="w-4 h-4"/>{chineseRealm.name}</span>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total Score: {globalStats.Chinese.toFixed(1)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-emerald-400 font-black uppercase tracking-widest">今日净增长</div>
                    <div className={`text-3xl font-black ${cnMetrics.gain >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {cnMetrics.gain > 0 ? '+' : ''}{cnMetrics.gain.toFixed(1)}
                    </div>
                  </div>
                </div>

                {/* 坚持等级条 */}
                <div>
                    <div className="flex justify-between items-end mb-1.5">
                        <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest flex items-center gap-1"><Flame className="w-3.5 h-3.5 text-orange-500"/> 坚持 (Persistence)</span>
                        <span className="text-xs font-black text-slate-600">Grade {persistence.Chinese.grade || 'F'}</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-400 rounded-full transition-all duration-700" style={{ width: `${(persistence.Chinese.progress || 0) * 100}%` }}></div>
                    </div>
                </div>

                <div className="space-y-2">
                   <div className="flex justify-between items-end">
                      <span className="text-xs font-black text-slate-400 uppercase">NEXT RANK: {chineseRealm.percent.toFixed(1)}%</span>
                      <span className="text-xs font-black text-emerald-500 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-100">还需 {chineseRealm.remain} 修为</span>
                   </div>
                   <div className="h-4 bg-slate-100 rounded-full overflow-hidden p-0.5 shadow-inner border border-slate-50">
                      <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-700 rounded-full transition-all duration-1000 ease-out shadow-[0_0_15px_rgba(16,185,129,0.4)] relative" style={{ width: `${chineseRealm.percent}%` }}>
                         <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                      </div>
                   </div>
                </div>
             </div>
          </div>
// src/components/DailyReport.tsx (Part 3) 接着上文

          {/* C. 详细复盘记录 BREAKDOWN */}
          <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden flex flex-col mt-2">
             <div className="px-6 py-4 border-b border-slate-50 bg-slate-50/50 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-500" />
                <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">详细复盘记录 BREAKDOWN</h3>
             </div>

             <div className="divide-y divide-slate-50">
               {/* 1. 每日大盘乱序复习 (Hub) */}
               {hubActivities.length > 0 && (
                 <>
                   <div className="px-4 py-2 bg-rose-50/30 text-[9px] font-black text-rose-400 uppercase tracking-widest flex items-center gap-2">
                      <Flame className="w-3 h-3" /> 每日大盘结算 HUB SESSIONS
                   </div>
                   {hubActivities.map((activity, idx) => renderActivityRow(activity, `hub-${idx}`))}
                 </>
               )}

               {/* 2. 日常背诵 Sessions */}
               {studyActivities.length > 0 && (
                 <>
                   <div className="px-4 py-2 bg-slate-50/30 text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Zap className="w-3 h-3" /> 日常背诵模块 SESSIONS
                   </div>
                   {studyActivities.map((activity, idx) => renderActivityRow(activity, `study-${idx}`))}
                 </>
               )}

               {/* 3. 模拟考试 Trials */}
               {examActivities.length > 0 && (
                 <>
                   <div className="px-4 py-2 bg-amber-50/30 text-[9px] font-black text-amber-500 uppercase tracking-widest flex items-center gap-2">
                      <GraduationCap className="w-3 h-3" /> 模拟考试测验 TRIALS
                   </div>
                   {examActivities.map((activity, idx) => renderActivityRow(activity, `exam-${idx}`))}
                 </>
               )}

               {activities.length === 0 && (
                 <div className="text-center py-16 text-slate-300 text-sm font-medium italic">
                    今日尚无有效修为记录
                 </div>
               )}
             </div>
          </div>
        </div>
      </div>
      
      {/* 3. 底部固定按钮 (还原截图样式) */}
      <div className="fixed bottom-0 left-0 right-0 p-6 bg-white/95 backdrop-blur-lg border-t border-slate-100 shadow-[0_-10px_30px_-15px_rgba(0,0,0,0.1)] z-20">
         <div className="max-w-xl mx-auto">
            <Button 
               fullWidth 
               onClick={onClose} 
               className="py-4 text-base font-black rounded-2xl bg-slate-900 text-white shadow-xl hover:bg-slate-800 active:scale-95 transition-all"
            >
               确认并关闭日报
            </Button>
         </div>
      </div>
    </div>
  );

  // === 内部组件：渲染每一行活动记录 ===
  function renderActivityRow(activity: ActivityLog, key: string) {
    const relatedDeck = decks.find(d => d.id === activity.deckId);
    
    // 计算掌握度 (基于当前词库的实时平均值)
    const currentMastery = relatedDeck 
      ? (relatedDeck.phrases.reduce((acc, p) => acc + (p.mastery || 0), 0) / relatedDeck.phrases.length) 
      : 0;

    // 这一场的综合正确率
    const sessionAcc = activity.count > 0 
      ? ((activity.count4_5 + activity.count2_3 * 0.5) / activity.count) * 100 
      : 0;

    const isChinese = activity.deckSubject === 'Chinese';

    return (
      <div key={key} className="group hover:bg-slate-50 px-4 py-3 transition-colors border-b border-slate-50 last:border-0 flex flex-col gap-1.5">
        <div className="flex justify-between items-start min-w-0">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
               <div className="font-black text-slate-800 text-sm truncate max-w-[140px]">{activity.deckName}</div>
               <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase border shrink-0 ${isChinese ? 'text-emerald-500 border-emerald-100 bg-emerald-50/50' : 'text-indigo-500 border-indigo-100 bg-indigo-50/50'}`}>
                  {isChinese ? '语文' : '英语'}
               </span>
               <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 shrink-0">
                  {relatedDeck?.contentType === 'Word' ? (isChinese ? '文言实词' : '单词') : '词组/句子'}
               </span>
               <span className="text-[9px] font-bold text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100 shrink-0">
                  {relatedDeck?.studyMode === 'EN_CN' ? '英→中' : '中→英'}
               </span>
            </div>
            <div className="text-[10px] font-black shrink-0 whitespace-nowrap ml-2" style={{ color: getDynamicColor(sessionAcc) }}>
                正确率 {sessionAcc.toFixed(2)}%
            </div>
        </div>

        <div className="flex items-center justify-between">
           <div className="flex items-center gap-x-3 text-[10px] text-slate-400 font-bold whitespace-nowrap overflow-x-auto no-scrollbar">
                <span className="flex items-center gap-1 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">
                   <Clock className="w-2.5 h-2.5" />{formatHeaderTime(activity.durationSeconds)}
                </span>
                <span className="flex items-center gap-1.5 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">
                   <span className="text-slate-500 font-black">{activity.count} 总</span>
                   <span className="text-slate-300">|</span>
                   <span className="text-emerald-600 font-black">{activity.count4_5} 优</span>
                </span>
           </div>
           
           <div className="flex items-center gap-1.5 text-[10px] font-black">
              <span style={{ color: getDynamicColor(currentMastery) }}>掌握 {currentMastery.toFixed(2)}%</span>
              {activity.masteryGain !== 0 && (
                <span className={`flex items-center ${activity.masteryGain > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                  <TrendingUp className={`w-2.5 h-2.5 mr-0.5 ${activity.masteryGain < 0 ? 'rotate-180' : ''}`} />
                  {Math.abs(activity.masteryGain).toFixed(2)}%
                </span>
              )}
           </div>
        </div>
      </div>
    );
  }
};