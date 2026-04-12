const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/services/geminiBackend.ts');
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(/, userApiKey\?: string/g, '');
content = content.replace(/const apiKeyToUse = userApiKey \|\| API_KEY;\n\s*/g, '');
content = content.replace(/apiKeyToUse/g, 'API_KEY');

fs.writeFileSync(filePath, content);
console.log('Done');
