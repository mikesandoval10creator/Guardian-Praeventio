const fs = require('fs');
const glob = require('glob');

const files = glob.sync('src/services/*Backend.ts');

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/gemini-1\.5-flash/g, 'gemini-3-flash-preview');
  content = content.replace(/gemini-1\.5-pro/g, 'gemini-3.1-pro-preview');
  fs.writeFileSync(file, content);
});

// also do geminiEngine.ts if it exists
if (fs.existsSync('src/services/geminiEngine.ts')) {
  let content = fs.readFileSync('src/services/geminiEngine.ts', 'utf8');
  content = content.replace(/gemini-1\.5-flash/g, 'gemini-3-flash-preview');
  content = content.replace(/gemini-1\.5-pro/g, 'gemini-3.1-pro-preview');
  fs.writeFileSync('src/services/geminiEngine.ts', content);
}

if (fs.existsSync('src/services/geminiBackend.ts')) {
    let content = fs.readFileSync('src/services/geminiBackend.ts', 'utf8');
    content = content.replace(/gemini-1\.5-flash/g, 'gemini-3-flash-preview');
    content = content.replace(/gemini-1\.5-pro/g, 'gemini-3.1-pro-preview');
    fs.writeFileSync('src/services/geminiBackend.ts', content);
}

console.log('models updated');
