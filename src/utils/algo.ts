// src/utils/algo.ts

export const EPS = 1e-6;

export const getNScore = (score: number, diff: number) => {
  return score - (diff - 2.5) * 0.5;
};

export const calculateBack = (nscore: number, C: number, base: number): number => {
  if (nscore > 0) {
    return Math.ceil(C * Math.pow(base, nscore));
  } else {
    return Math.ceil(C * Math.pow(1 - 1 / base, Math.log(-nscore + 1)));
  }
};

export const calculateWatchBack = (nscore: number, C: number, base: number): number => {
  return Math.ceil(Math.max(C, C * Math.pow(base, nscore / 2)));
};

export const calculateMastery = (nscore: number): number => {
  if (nscore <= -2) return 0;
  if (nscore < 0) return (1 - Math.pow(0.5, nscore / 2 + 1)) * 100;
  return (1 - Math.pow(0.5, nscore + 1)) * 100;
};

export const calculateNextState = (
  oscore: number | undefined,
  prof: number,
  diff: number,
  dateGap: number,
  C: number,
  base: number,
  cap: number
): { newScore: number; nscore: number } => {
  const isNew = oscore === undefined;
  let score = oscore ?? 0;
  let nscore = 0;

  if (isNew) {
    const mapping = [-2, -1, -EPS, 1, 2, 3];
    score = mapping[prof];
    nscore = getNScore(score, diff);
  } else if (score > 0) {
    const onscore = getNScore(score, diff);
    const expect = Math.floor((C * Math.pow(base, onscore)) / cap);
    const limit = dateGap >= expect ? Infinity : 1 / (1 + Math.log(expect / dateGap));
    const term = Math.min(4 / Math.max(EPS, score), 2);
    const scoreChanges =[term - 5, term - 4, term - 3, term - 2, term - 1, Math.max(1, term)];
    
    score += Math.min(limit, scoreChanges[prof]);
    if (score < 0) score = -Math.log(-score + 1);
    if (Math.abs(score) < EPS) score = -EPS;

    const shuMap =[-1, 0, 1, 2, 4, Infinity];
    const shu = shuMap[prof];
    nscore = getNScore(Math.min(shu, score), diff);
  } else {
    if (prof === 5) {
      score += 2;
      nscore = getNScore(Math.max(2, score), diff);
    } else if (prof === 4) {
      score += 1;
      nscore = getNScore(Math.max(1, score), diff);
    } else if (prof >= 1 && prof <= 3) {
      const targets = [0, -4, -2, 0];
      const target = targets[prof];
      let gap = (target - score) / 2;
      if (Math.abs(gap) > 1) gap = gap > 0 ? 1 : -1;
      score += gap;
      nscore = getNScore(score, diff);
    } else {
      score -= 1 / (-4 - Math.min(-4, score) + 1);
      nscore = getNScore(score, diff);
    }
    if (Math.abs(score) < EPS) score = -EPS;
  }

  return { newScore: score, nscore };
};

export const mapSliderToBack = (val: number) => {
  if (val <= 0) return 1;
  if (val >= 1000) return 100000;
  return Math.ceil(Math.pow(100000, val / 1000));
};

export const mapBackToSlider = (back: number) => {
  if (back <= 1) return 0;
  return (Math.log(back) / Math.log(100000)) * 1000;
};

// ========== UI 辅助与格式化函数 ==========

export const getProficiencyLabel = (isNew: boolean, prof: number): string => {
  const newLabels =["完全没思路", "思路大体对", "缺东西", "差一点", "正确但不确定", "正确"];
  const oldLabels =["完全没印象", "印象不清楚", "缺东西", "差一点", "勉强想出", "快速想出"];
  return isNew ? newLabels[prof] : oldLabels[prof];
};

export const getDynamicColor = (percent: number) => {
  const hue = (percent * 1.2);
  return `hsl(${hue}, 75%, 45%)`;
};

export const getScoreBadgeColor = (score: number | undefined) => {
  if (score === undefined || score === 0) return '#94a3b8'; // 新词 Slate
  if (score > 0) return getDynamicColor(Math.min(100, 40 + score * 12)); // 正分偏绿/蓝
  return getDynamicColor(Math.max(0, 40 + score * 10)); // 负分偏红/橙
};

export const getPhraseLabel = (score: number | undefined) => {
  if (score === undefined || score === 0) return '新';
  if (score > 0) return `对${Math.ceil(score)}`;
  return `错${Math.ceil(Math.abs(score))}`;
};