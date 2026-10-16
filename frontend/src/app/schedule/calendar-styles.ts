// T23: the calendar styles live in its lazy chunks, not in the global sheet, so the initial bundle does not grow.
// Today is a tag and an accent frame, never the hatching (hatching means only «the student does not see this»).

const LESSON_LIST = `
.upcoming-list { list-style: none; margin: 0; padding: 0; }
.upcoming-list > li { display: grid; gap: 4px; padding: 12px 0; border-bottom: 1px solid var(--rule); }
.upcoming-list > li.now { padding-left: 12px; box-shadow: inset 4px 0 0 var(--accent); }
.upcoming-list time { font: 400 14px/20px var(--font-mono); }
.upcoming-list .who { min-width: 0; }
.upcoming-list .who b { display: block; font: 600 15px/20px var(--font-sans); overflow-wrap: anywhere; }
.upcoming-list .who a { overflow-wrap: anywhere; }
.upcoming-list .tag, .upcoming-list .btn { justify-self: start; }
`;

export const MONTH_CALENDAR_STYLES = `
:host { display: block; }
.month-grid { width: 100%; border-collapse: collapse; table-layout: fixed; }
.month-grid th { padding: 0 8px 8px; font: 600 13px/18px var(--font-sans); color: var(--muted); text-align: left; }
.month-grid th abbr { text-decoration: none; }
.month-grid td { height: 112px; padding: 6px 8px; vertical-align: top; border: 1px solid var(--rule); }
.month-grid td.out { background: var(--surface-tint); color: var(--muted); }
.month-grid td.past .day-num { color: var(--muted); }
.month-grid td.today { box-shadow: inset 0 0 0 2px var(--accent); }
.day-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; }
.day-head .tag { padding: 0 6px; font-size: 11px; }
.day-num { font: 500 14px/20px var(--font-mono); }
.day-pick { display: none; }
.day-lessons { list-style: none; margin: 4px 0 0; padding: 0; font: 400 13px/18px var(--font-sans); }
.day-lessons li { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; margin-top: 4px; }
.day-lessons a { overflow-wrap: anywhere; }
.day-lessons li.done a { color: var(--muted); }
.day-lessons .tag { padding: 0 6px; font-size: 11px; }
.day-lessons .more { color: var(--muted); }
.day-agenda { display: none; margin-top: 16px; }
.day-agenda h3 { margin: 0 0 4px; font: 600 17px/24px var(--font-sans); }
${LESSON_LIST}
@media (max-width: 599px) {
  .month-grid th { padding: 0 0 6px; text-align: center; }
  .month-grid td { height: auto; padding: 2px; text-align: center; }
  .month-grid td.today { box-shadow: none; }
  .day-head { justify-content: center; }
  .day-head .day-num, .day-head .tag, .day-lessons { display: none; }
  .day-pick { display: inline-flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; min-height: 44px; padding: 0; border: 0; border-radius: 6px; background: none; color: inherit; font: 500 15px/20px var(--font-mono); cursor: pointer; }
  .today .day-pick { box-shadow: inset 0 0 0 2px var(--accent); }
  .day-pick[aria-pressed="true"] { background: var(--ink); color: var(--surface); }
  .day-pick .dot { width: 6px; height: 6px; margin-top: 2px; border-radius: 50%; background: currentColor; }
  .day-agenda { display: block; }
}
`;

export const UPCOMING_STYLES = `
:host { display: block; min-width: 0; }
.upcoming h2 { margin: 0 0 8px; font-size: 22px; line-height: 28px; }
${LESSON_LIST}
`;

export const CALENDAR_PAGE_STYLES = `
.calendar-filter { min-width: 220px; margin: 0; }
.calendar-layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 24px 32px; align-items: start; margin-top: 20px; }
.calendar-main { min-width: 0; }
.calendar-empty { margin: 12px 0 0; }
@media (max-width: 1099px) { .calendar-layout { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 599px) { .schedule-toolbar .seg button, .schedule-week-nav .btn { min-height: 44px; } }
`;
