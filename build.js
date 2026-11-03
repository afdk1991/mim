const fs = require('fs');
const path = require('path');
const dist = path.join(__dirname, 'dist');
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Mim</title></head><body></body></html>');
console.log('build ok: dist/index.html written');