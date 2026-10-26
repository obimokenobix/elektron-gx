'use strict';
// Prüft im CI, ob die Sicherheits-Schalter (Electron-Fuses) in der gebauten .exe gesetzt sind.
const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
const EXPECT = {
  RunAsNode: false,
  EnableCookieEncryption: true,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true,
  GrantFileProtocolExtraPrivileges: true // die Browser-Oberfläche wird als Datei geladen
};
getCurrentFuseWire(process.argv[2]).then((wire) => {
  let bad = 0;
  for (const [name, want] of Object.entries(EXPECT)) {
    const v = wire[FuseV1Options[name]];
    const on = v === 49 || v === '1';
    console.log(`${on === want ? 'OK  ' : 'FEHLT'} ${name} = ${on ? 'an' : 'aus'}`);
    if (on !== want) bad++;
  }
  process.exit(bad ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
