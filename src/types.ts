export type ContentType = 'Word' | 'PhraseSentence';
export type StudyMode = 'CN_EN' | 'EN_CN';

export interface Phrase {
  id: string;
  chinese: string;
  english: string;

  // ========== 新算法核心字段 ==========
  score?: number;     // 浮点数，>0 为对，<0 为错，未定或新词可为 undefined
  diff?: number;      // 记忆难度 (0-5)，默认 2.5
  back?: number;      // 后推位置数 / 长期复习队列等待值
  date?: number;      // 上次复习的日期（距离纪元的天数）
  clearedDate?: number; // 最新复习通过时间（距离纪元的天数）

  // ========== 统计与 UI 渲染字段 ==========
  totalReviews: number;
  totalWrong?: number;
  mastery?: number;   // 0-100 掌握度
  lastReviewedAt?: number;
  note?: string;

  // ========== 遗留字段（用于旧存档平滑过渡） ==========
  consecutiveCorrect?: number;
  consecutiveWrong?: number;
  maxConsecutiveCorrect?: number;
  previousStreak?: number;
}

export interface DeckStats {
  totalStudyTimeSeconds: number;
  totalReviewCount: number;
  firstMastery90Seconds?: number;
}

export interface DeckSessionLog {
  id: string;
  timestamp: number;
  mode: 'STUDY' | 'EXAM' | 'DAILY_REVIEW'; 
  durationSeconds: number;
  reviewCount: number;
  count0_1: number; 
  count2_3: number; 
  count4_5: number; 
  masteryStart?: number;
  masteryEnd?: number;
  masteryGain?: number;
  masteryTrend?: { t: number; v: number }[];
  examResults?: { q: string; a: string; isCorrect: boolean }[];
}

export type DeckSubject = 'English' | 'Chinese';

export interface Folder {
  id: string;
  parentId?: string;
  name: string;
  createdAt: number;
}

export interface DeckStatsOptions {
  includeInQuantity?: boolean;
  includeInQuality?: boolean;
}

export interface Deck {
  id: string;
  folderId?: string; 
  name: string;
  subject: DeckSubject;
  contentType?: ContentType;
  studyMode?: StudyMode;
  phrases: Phrase[];
  queue: string[];
  coolingPool?: { id: string; wait: number }[]; 
  stats?: DeckStats;
  sessionHistory?: DeckSessionLog[];
  totalWordCount?: number;
  statsOptions?: DeckStatsOptions;
}

export interface ActivityLog {
  deckId: string;
  deckName: string;
  deckSubject?: DeckSubject;
  mode: 'STUDY' | 'EXAM' | 'DAILY_REVIEW';
  count: number;
  count0_1: number;
  count2_3: number;
  count4_5: number;
  durationSeconds: number;
  masteryGain: number;
  timestamp: number;
}

export interface DailyStats {
  date: string;
  reviewCount: number;
  count0_1: number;
  count2_3: number;
  count4_5: number;
  reviewedPhraseIds: string[];
  studyTimeSeconds: number;
  activities?: ActivityLog[];
}

export interface SubjectStats {
  English: number; 
  Chinese: number; 
  qualityHistory?: { timestamp: number; value: number; weight: number; subject?: DeckSubject; deckName?: string; deckId?: string }[]; 
}

export interface PersistenceData {
  baseScore: number;
  lastDate: string;
  prevDayFinalScore: number;
}

export interface GlobalStats {
  totalReviewCount: number;
  totalPhrasesCount: number; 
  totalStudyTimeSeconds: number;
  subjectStats: SubjectStats;
  daily: DailyStats;
  persistence?: {
      English: PersistenceData;
      Chinese: PersistenceData;
  };
}

export interface BackupData {
  version: number;
  timestamp: number;
  folders?: Folder[];
  decks: Deck[];
  stats: GlobalStats;
}

export enum AppView {
  DASHBOARD = 'DASHBOARD',
  STUDY = 'STUDY',
  EXAM_SESSION = 'EXAM_SESSION',
  EDIT_DECK = 'EDIT_DECK',
  IMPORT = 'IMPORT',
  DAILY_REVIEW = 'DAILY_REVIEW'
}

export enum CardState {
  HIDDEN = 'HIDDEN',
  VERIFYING = 'VERIFYING',
  MISSED = 'MISSED',
  REVIEWED = 'REVIEWED',
}
