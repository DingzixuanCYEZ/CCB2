// src/utils/realms.ts

// 英语修为境界表 (保持你要求的名称与四段划分)
export const REALM_THRESHOLDS_EN =[
  { name: "凡人", subs: [{ suffix: "", threshold: 0 }], color: "text-slate-500", bg: "bg-slate-100", border: "border-slate-300" },
  { name: "炼气期", subs:[{ suffix: "初期", threshold: 200 }, { suffix: "中期", threshold: 550 }, { suffix: "后期", threshold: 950 }, { suffix: "圆满", threshold: 1300 }], color: "text-slate-500", bg: "bg-slate-50", border: "border-slate-200" },
  { name: "筑基期", subs:[{ suffix: "初期", threshold: 1700 }, { suffix: "中期", threshold: 2400 }, { suffix: "后期", threshold: 3100 }, { suffix: "圆满", threshold: 3800 }], color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200" },
  { name: "结丹期", subs:[{ suffix: "初期", threshold: 4550 }, { suffix: "中期", threshold: 5600 }, { suffix: "后期", threshold: 6650 }, { suffix: "圆满", threshold: 7700 }], color: "text-cyan-600", bg: "bg-cyan-50", border: "border-cyan-200" },
  { name: "元婴期", subs:[{ suffix: "初期", threshold: 8750 }, { suffix: "中期", threshold: 10150 }, { suffix: "后期", threshold: 11550 }, { suffix: "圆满", threshold: 12900 }], color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-200" },
  { name: "化神期", subs:[{ suffix: "初期", threshold: 14300 }, { suffix: "中期", threshold: 16000 }, { suffix: "后期", threshold: 17750 }, { suffix: "圆满", threshold: 19500 }], color: "text-indigo-600", bg: "bg-indigo-50", border: "border-indigo-200" },
  { name: "炼虚期", subs:[{ suffix: "初期", threshold: 21200 }, { suffix: "中期", threshold: 23250 }, { suffix: "后期", threshold: 25300 }, { suffix: "圆满", threshold: 27400 }], color: "text-violet-600", bg: "bg-violet-50", border: "border-violet-200" },
  { name: "合体期", subs:[{ suffix: "初期", threshold: 29450 }, { suffix: "中期", threshold: 31850 }, { suffix: "后期", threshold: 34250 }, { suffix: "圆满", threshold: 36650 }], color: "text-fuchsia-600", bg: "bg-fuchsia-50", border: "border-fuchsia-200" },
  { name: "大乘期", subs:[{ suffix: "初期", threshold: 39050 }, { suffix: "中期", threshold: 41800 }, { suffix: "后期", threshold: 44550 }, { suffix: "圆满", threshold: 47300 }], color: "text-rose-600", bg: "bg-rose-50", border: "border-rose-200" },
  { name: "渡劫期", subs:[{ suffix: "初期", threshold: 50000 }, { suffix: "中期", threshold: 53000 }, { suffix: "后期", threshold: 56000 }, { suffix: "圆满", threshold: 59000 }], color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200" },
];

// 语文品阶表（完美还原原版“守拙/若愚/斗力”等称号，数值严格为英语的一半）
export const REALM_THRESHOLDS_CN =[
  { name: "不入格", subs:[{ suffix: "", threshold: 0 }], color: "text-slate-500", bg: "bg-slate-100", border: "border-slate-300" },
  { name: "九品·守拙", subs:[{ suffix: "前境", threshold: 100 }, { suffix: "中境", threshold: 275 }, { suffix: "深境", threshold: 475 }, { suffix: "圆满", threshold: 650 }], color: "text-slate-500", bg: "bg-slate-50", border: "border-slate-200" },
  { name: "八品·若愚", subs:[{ suffix: "前境", threshold: 850 }, { suffix: "中境", threshold: 1200 }, { suffix: "深境", threshold: 1550 }, { suffix: "圆满", threshold: 1900 }], color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200" },
  { name: "七品·斗力", subs:[{ suffix: "前境", threshold: 2275 }, { suffix: "中境", threshold: 2800 }, { suffix: "深境", threshold: 3325 }, { suffix: "圆满", threshold: 3850 }], color: "text-cyan-600", bg: "bg-cyan-50", border: "border-cyan-200" },
  { name: "六品·小巧", subs:[{ suffix: "前境", threshold: 4375 }, { suffix: "中境", threshold: 5075 }, { suffix: "深境", threshold: 5775 }, { suffix: "圆满", threshold: 6450 }], color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-200" },
  { name: "五品·用智", subs:[{ suffix: "前境", threshold: 7150 }, { suffix: "中境", threshold: 8000 }, { suffix: "深境", threshold: 8875 }, { suffix: "圆满", threshold: 9750 }], color: "text-indigo-600", bg: "bg-indigo-50", border: "border-indigo-200" },
  { name: "四品·通幽", subs:[{ suffix: "前境", threshold: 10600 }, { suffix: "中境", threshold: 11625 }, { suffix: "深境", threshold: 12650 }, { suffix: "圆满", threshold: 13700 }], color: "text-violet-600", bg: "bg-violet-50", border: "border-violet-200" },
  { name: "三品·具体", subs:[{ suffix: "前境", threshold: 14725 }, { suffix: "中境", threshold: 15925 }, { suffix: "深境", threshold: 17125 }, { suffix: "圆满", threshold: 18325 }], color: "text-fuchsia-600", bg: "bg-fuchsia-50", border: "border-fuchsia-200" },
  { name: "二品·坐照", subs:[{ suffix: "前境", threshold: 19525 }, { suffix: "中境", threshold: 20900 }, { suffix: "深境", threshold: 22275 }, { suffix: "圆满", threshold: 23650 }], color: "text-rose-600", bg: "bg-rose-50", border: "border-rose-200" },
  { name: "一品·入神", subs:[{ suffix: "前境", threshold: 25000 }, { suffix: "中境", threshold: 26500 }, { suffix: "深境", threshold: 28000 }, { suffix: "圆满", threshold: 29500 }], color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200" },
];

// 计算修为进度信息
export const getRealmInfo = (score: number, subject: string = 'English') => {
  const thresholds = subject === 'English' ? REALM_THRESHOLDS_EN : REALM_THRESHOLDS_CN;
  
  let currentMajor = thresholds[0];
  let currentSub = currentMajor.subs[0];
  let nextSub = currentMajor.subs[0];
  
  for (let i = 0; i < thresholds.length; i++) {
    const major = thresholds[i];
    if (score >= major.subs[0].threshold) {
      currentMajor = major;
      for (let j = 0; j < major.subs.length; j++) {
        if (score >= major.subs[j].threshold) {
          currentSub = major.subs[j];
          if (j + 1 < major.subs.length) {
            nextSub = major.subs[j + 1];
          } else if (i + 1 < thresholds.length) {
            nextSub = thresholds[i + 1].subs[0];
          } else {
            nextSub = currentSub;
          }
        }
      }
    }
  }

  const isMax = nextSub.threshold === currentSub.threshold;
  const currentValInSub = Math.max(0, score - currentSub.threshold);
  const targetValInSub = isMax ? 1 : (nextSub.threshold - currentSub.threshold);
  const percent = isMax ? 100 : Math.min(100, (currentValInSub / targetValInSub) * 100);
  const remain = isMax ? 0 : (nextSub.threshold - score);

  // 直接相加：如 “九品·守拙前境” 或 “炼气期初期”
  const fullName = currentSub.suffix 
    ? `${currentMajor.name}${currentSub.suffix}` 
    : currentMajor.name;
  
  return { 
    name: fullName, 
    color: currentMajor.color, 
    bg: currentMajor.bg, 
    border: currentMajor.border, 
    percent, 
    remain: Math.max(0, remain).toFixed(1) 
  };
};

// 坚持得分梯度表
export const PERSISTENCE_GRADES =[
  { score: 0, grade: 'F', color: 'text-slate-400' },
  { score: 500, grade: 'E', color: 'text-zinc-500' },
  { score: 1000, grade: 'D', color: 'text-stone-500' },
  { score: 1500, grade: 'D+', color: 'text-stone-600' },
  { score: 2000, grade: 'C-', color: 'text-sky-500' },
  { score: 2500, grade: 'C', color: 'text-sky-600' },
  { score: 3000, grade: 'C+', color: 'text-cyan-600' },
  { score: 3500, grade: 'B-', color: 'text-blue-500' },
  { score: 4000, grade: 'B', color: 'text-blue-600' },
  { score: 4500, grade: 'B+', color: 'text-indigo-500' },
  { score: 5000, grade: 'A', color: 'text-indigo-600' },
  { score: 5500, grade: 'A+', color: 'text-violet-600' },
  { score: 6000, grade: 'S', color: 'text-fuchsia-500' },
  { score: 6500, grade: 'S+', color: 'text-fuchsia-600' },
  { score: 7000, grade: 'SS', color: 'text-pink-500' },
  { score: 7500, grade: 'SS+', color: 'text-pink-600' },
  { score: 8000, grade: 'SSS', color: 'text-rose-500' },
  { score: 8500, grade: 'SSS+', color: 'text-red-600' },
];

export const getPersistenceGrade = (score: number) => {
  let current = PERSISTENCE_GRADES[0];
  for (const g of PERSISTENCE_GRADES) {
    if (score >= g.score) current = g; 
    else break;
  }
  const nextIdx = PERSISTENCE_GRADES.indexOf(current) + 1;
  const next = PERSISTENCE_GRADES[nextIdx];
  const progress = next ? (score - current.score) / (next.score - current.score) : 1;
  
  return { 
    grade: current.grade,
    color: current.color,
    next, 
    progress: Math.min(1, Math.max(0, progress)) 
  };
};