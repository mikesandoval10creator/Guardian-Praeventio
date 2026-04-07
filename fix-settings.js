const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/pages/Settings.tsx');
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(/text-white/g, 'text-zinc-900 dark:text-white');
content = content.replace(/bg-zinc-900\/50/g, 'bg-white/50 dark:bg-zinc-900/50');
content = content.replace(/bg-zinc-900/g, 'bg-white/50 dark:bg-zinc-900');
content = content.replace(/text-zinc-500/g, 'text-zinc-700 dark:text-zinc-500');
content = content.replace(/text-zinc-400/g, 'text-zinc-600 dark:text-zinc-400');
content = content.replace(/border-white\/5/g, 'border-zinc-200 dark:border-white/5');
content = content.replace(/border-white\/10/g, 'border-zinc-200 dark:border-white/10');
content = content.replace(/bg-zinc-800/g, 'bg-white/40 dark:bg-zinc-800');
content = content.replace(/bg-white\/5/g, 'bg-zinc-100 dark:bg-white/5');
content = content.replace(/hover:bg-white\/10/g, 'hover:bg-zinc-200 dark:hover:bg-white/10');

// Fix some specific cases where the replacement might be wrong
content = content.replace(/text-zinc-900 dark:text-zinc-900 dark:text-white/g, 'text-zinc-900 dark:text-white');
content = content.replace(/bg-white\/50 dark:bg-white\/50 dark:bg-zinc-900/g, 'bg-white/50 dark:bg-zinc-900');
content = content.replace(/bg-zinc-100 dark:bg-zinc-100 dark:bg-white\/5/g, 'bg-zinc-100 dark:bg-white/5');

// Fix the "bg-emerald-500 hover:bg-emerald-600 text-white" case
content = content.replace(/bg-emerald-500 hover:bg-emerald-600 text-zinc-900 dark:text-white/g, 'bg-emerald-500 hover:bg-emerald-600 text-white');
content = content.replace(/bg-rose-500 hover:bg-rose-600 text-zinc-900 dark:text-white/g, 'bg-rose-500 hover:bg-rose-600 text-white');

fs.writeFileSync(filePath, content, 'utf8');
console.log('Done');
