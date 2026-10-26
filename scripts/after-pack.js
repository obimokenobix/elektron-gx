'use strict';
/*
 * Wird von electron-builder nach dem Packen aufgerufen.
 * Schreibt Firma, Beschreibung, Version und das Elektron-Icon in die Windows-.exe
 * (ohne Wine – reines JavaScript über "resedit").
 */
const path = require('path');
const fs = require('fs');

const INFO = {
  CompanyName: 'Elektron',
  FileDescription: 'Elektron',
  ProductName: 'Elektron',
  InternalName: 'Elektron',
  OriginalFilename: 'Elektron.exe',
  LegalCopyright: '© 2026 Elektron'
};

async function setExeInfo(exePath, version, iconPath) {
  const ResEdit = await import('resedit');
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  // Versionsinformationen (Details im Eigenschaften-Dialog)
  const v = String(version).split('.').map(Number).concat([0, 0, 0, 0]).slice(0, 4);
  const infos = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const vi = infos.length ? infos[0] : ResEdit.Resource.VersionInfo.createEmpty();
  const langs = vi.getAllLanguagesForStringValues();
  const targets = langs.length ? langs : [{ lang: 1033, codepage: 1200 }];
  for (const l of targets) {
    vi.setStringValues(l, { ...INFO, FileVersion: v.join('.'), ProductVersion: v.join('.') });
  }
  vi.setFileVersion(v[0], v[1], v[2], v[3], targets[0].lang);
  vi.setProductVersion(v[0], v[1], v[2], v[3], targets[0].lang);
  vi.outputToResourceEntries(res.entries);

  // Programm-Icon ersetzen
  if (iconPath && fs.existsSync(iconPath)) {
    const ico = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath));
    const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
    const id = groups.length ? groups[0].id : 1;
    const lang = groups.length ? groups[0].lang : 1033;
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      res.entries, id, lang, ico.icons.map(i => i.data)
    );
  }

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const icon = path.join(context.packager.projectDir, 'assets', 'icon.ico');
  await setExeInfo(exe, context.packager.appInfo.version, icon);
  console.log(`  • Elektron: Firma "${INFO.CompanyName}" und Icon in ${path.basename(exe)} eingetragen`);
};

module.exports.setExeInfo = setExeInfo;
