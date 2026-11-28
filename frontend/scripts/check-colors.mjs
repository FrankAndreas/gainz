// Components use the theme's roles (bg-surface, text-muted, ...), never palette colours or hex codes, so a second theme
// is only a set of values in family-hub-theme (themes design 2026-11-28). Hex codes may stay in .ts data files (a
// person's default colour). `node scripts/check-colors.mjs --self-test` checks this checker.
import fs from 'node:fs';
import path from 'node:path';

const PALETTE = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const UTILITY = 'bg|text|border|ring|from|via|to|fill|stroke|outline|divide|placeholder|shadow|decoration|accent|caret';
const CLASS = new RegExp(`(?<![\\w-])(?:${UTILITY})(?:-[trblxy])?-(?:(?:${PALETTE})-\\d{2,3}|white|black)(?:\\/\\d+)?(?![\\w-])`, 'g');
const HEX = /['"`]#[0-9a-fA-F]{3,8}['"`]/g;
// Colour functions in components (style props, chart options): they don't follow the theme either
const FUNCTION = /(?<![\w-])(?:rgba?|hsla?)\(\s*\d/g;

export function problems(file, text) {
    const found = [...text.matchAll(CLASS)].map(m => m[0]);
    if (file.endsWith('.tsx')) found.push(...[...text.matchAll(HEX)].map(m => m[0]), ...[...text.matchAll(FUNCTION)].map(m => m[0]));
    return found;
}

function selfTest() {
    const bad = [['A.tsx', 'className="p-2 text-slate-400"'], ['A.tsx', "'hover:bg-white/5'"], ['A.tsx', "style={{ color: '#123456' }}"],
        ['a.ts', "'border border-red-400/40'"], ['A.tsx', "cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }}"]];
    const good = [['A.tsx', 'className="text-muted bg-danger/15 border-line"'], ['a.ts', "export const C = '#64748b';"],
        ['A.tsx', 'className="text-xs border-2 bg-surface/50"']];
    const failed = [...bad.filter(([f, t]) => problems(f, t).length === 0), ...good.filter(([f, t]) => problems(f, t).length > 0)];
    if (failed.length) {
        console.error('check-colors self-test failed:', failed);
        process.exit(1);
    }
    console.log('check-colors self-test passed');
}

function files(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return files(full);
        return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
    });
}

if (process.argv.includes('--self-test')) {
    selfTest();
} else {
    const found = files(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'src')).flatMap(f => problems(f, fs.readFileSync(f, 'utf-8')).map(p => `${f}: ${p}`));
    if (found.length) {
        console.error(`Palette colours or hex codes in components (use the theme's roles):\n${found.join('\n')}`);
        process.exit(1);
    }
}
