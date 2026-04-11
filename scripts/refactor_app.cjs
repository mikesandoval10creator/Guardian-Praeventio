const fs = require('fs');

let content = fs.readFileSync('src/App.tsx', 'utf-8');

// The regex to match page imports
const pageImportRegex = /import\s+\{\s*([a-zA-Z0-9_]+)\s*\}\s+from\s+"\.\/pages\/([a-zA-Z0-9_]+)";/g;

let lazyImports = "import { lazy, Suspense } from 'react';\n";
let match;
const importsToRemove = [];

while ((match = pageImportRegex.exec(content)) !== null) {
    const component = match[1];
    const path = match[2];
    importsToRemove.push(match[0]);
    lazyImports += `const ${component} = lazy(() => import('./pages/${path}').then(module => ({ default: module.${component} })));\n`;
}

// Remove original imports
for (const imp of importsToRemove) {
    content = content.replace(imp + '\n', '');
}

// Add lazy imports after react-router-dom
content = content.replace(
    'import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";',
    'import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";\n' + lazyImports
);

// Wrap Routes with Suspense
const suspenseStart = `<Suspense fallback={
                <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
                  <div className="flex flex-col items-center">
                    <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin mb-4" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Cargando Módulo...</span>
                  </div>
                </div>
              }>
              <Routes>`;
content = content.replace('<Routes>', suspenseStart);
content = content.replace('</Routes>', '</Routes>\n              </Suspense>');

fs.writeFileSync('src/App.tsx', content);
console.log('App.tsx refactored successfully.');
