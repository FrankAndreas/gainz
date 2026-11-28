// The tracker's shared classes, in Tailwind with the family look's roles (family-hub-theme, themes 2026-11-28): the
// cards, fields and buttons as in the hub; a theme changes their values, never these classes
export const CARD = 'glass-card mb-5 px-6 py-5';
export const H1 = 'm-0 text-[2rem] leading-tight';
// The tracker's title, in the accent colours
export const TITLE = `${H1} mb-1 inline-block bg-linear-to-r from-accent via-accent-3 to-accent-2 bg-clip-text text-transparent`;
// Without a top margin, each place sets its own (no conflicting margin classes)
export const H2 = 'mb-4 text-2xl';
export const LABEL = 'mb-1.5 block text-sm font-semibold text-ink';
// Without a width: FIELD fills its row; the weight and its unit share one (no conflicting width classes)
export const FIELD_BASE =
    'rounded-control border border-line-strong bg-field py-2.5 text-base text-ink placeholder:text-muted focus:border-accent focus:outline-none';
export const FIELD = `${FIELD_BASE} w-full px-3`;
export const BUTTON = 'btn-primary disabled:cursor-not-allowed disabled:opacity-40';
// Without a size: the normal and the small outlined button (no conflicting padding or text size classes)
const OUTLINED =
    'self-end whitespace-nowrap rounded-control border border-line-strong font-semibold text-ink hover:bg-hover disabled:opacity-30';
export const BUTTON_SECONDARY = `${OUTLINED} px-4 py-2`;
export const BUTTON_SMALL = `${OUTLINED} px-3 py-1 text-[13px]`;
// A panel inside a card (sets to log, the week's summary and records)
export const PANEL = 'rounded-xl border border-line bg-hover px-4 py-3.5';
export const PANEL_HEADING = 'mt-0 mb-3 text-[13px] uppercase tracking-[0.06em] text-muted';
export const STAT_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2.5';
export const STAT_CARD = 'rounded-[10px] border border-line bg-surface-strong px-3 py-2.5';
export const STAT_NAME = 'mb-1 truncate text-xs font-semibold text-ink';
export const STAT_SUB = 'text-[11px] text-muted';
// A personal record set this week: the warning colour (gold) instead of the muted one
export const STAT_SUB_RECORD = 'text-[11px] font-semibold text-warning';
export const HUB_PAGE = 'flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center';
