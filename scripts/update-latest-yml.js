'use strict';
// Nach dem Signieren ändert sich der Installer – Prüfsumme und Größe in latest.yml neu berechnen,
// sonst lehnt das Update-System die Datei ab. Die Blockmap (für Teil-Downloads) wird entfernt,
// Updates laden dann einfach die ganze Datei.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dist = process.argv[2] || 'dist';
const ymlPath = path.join(dist, 'latest.yml');
let yml = fs.readFileSync(ymlPath, 'utf8');
const exe = /^path:\s*(.+)$/m.exec(yml)[1].trim();
const buf = fs.readFileSync(path.join(dist, exe));
const sha512 = crypto.createHash('sha512').update(buf).digest('base64');
yml = yml.replace(/sha512:\s*\S+/g, `sha512: ${sha512}`)
  .replace(/size:\s*\d+/g, `size: ${buf.length}`)
  .replace(/^\s*blockMapSize:.*\n/gm, '');
fs.writeFileSync(ymlPath, yml);
for (const f of fs.readdirSync(dist)) if (f.endsWith('.blockmap')) fs.unlinkSync(path.join(dist, f));
console.log(`latest.yml aktualisiert: ${exe}, ${buf.length} Bytes`);
