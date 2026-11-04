// 밸런스 표 출력: npx vite-node tools/ttk-table.ts (rows from tools/ttk-rows.ts)
import { ttkRows } from './ttk-rows'

console.log(['구역', '총', 'DPS', '일반hp', '일반s', '기사s', '엘리트hp', '엘리트s', '보스hp', '보스s(총만)'].join('\t'))
for (const r of ttkRows()) console.log([r.area, r.gun, Math.round(r.dps), r.normalHp, r.normal.toFixed(2), r.knight.toFixed(2), r.eliteHp, r.elite.toFixed(1), r.bossHp, r.boss.toFixed(0)].join('\t'))
