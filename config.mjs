export const CATEGORIES = Object.freeze(['Summary','Vision＆Misson','Goal＆Isse','Direction Analysis','Current Anlysis','Strategy','Personality','Appendix','もろもろ']);
export const GRADES = Object.freeze(['1年','2年','3年','4年','大学院','その他']);
export const FIRST_URL = 'https://drive.google.com/file/d/1o19JfD3iWelpRjefFSz7JlY-iQ7SeVdX/view?usp=drive_link';
export const SCHEDULE = Object.freeze({
  second: Date.parse('2026-10-20T12:00:00+09:00'),
  third: Date.parse('2026-11-03T12:00:00+09:00'),
  end: Date.parse('2026-11-09T00:00:00+09:00'),
});
export function phase(now) { return now >= SCHEDULE.end ? 0 : now >= SCHEDULE.third ? 3 : now >= SCHEDULE.second ? 2 : 1; }
export function editionLabel(n) { return ['', '第一版', '第二版', '第三版'][n]; }
export function emptyData() { return {version:1, questions:[], answers:[], editions:{1:FIRST_URL,2:'',3:''}, sessions:[]}; }
