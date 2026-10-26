'use strict';
/*
 * Elektron Studio – Abläufe (wie Blueprints): Auslöser → Bedingungen → Aktionen.
 * Weiße Pins = Ablauf („wenn das passiert, dann …“). Ausgeführt wird alles im Browser selbst,
 * nur mit eingebauten, sicheren Aktionen.
 */
(function () {
  const C = { trig: '#c0283d', cond: '#8a4bc4', act: '#3a5fb0', ctl: '#5c6070' };
  const THEN = [{ name: 'then', label: 'Dann', type: 'exec' }];
  const IN = [{ name: 'in', label: '', type: 'exec' }];
  const YESNO = [{ name: 'yes', label: 'Ja', type: 'exec' }, { name: 'no', label: 'Nein', type: 'exec' }];
  const days = { key: 'days', label: 'Tage', kind: 'select', default: 'all', options: [['all', 'Jeden Tag'], ['work', 'Montag – Freitag'], ['weekend', 'Wochenende']] };

  const CATALOG = {
    // ---------------------------------------------------------- Auslöser
    on_start: { title: 'Wenn der Browser startet', category: 'Auslöser', color: C.trig, badge: 'Start', outputs: THEN, width: 220, params: [] },
    on_page: { title: 'Wenn eine Seite geöffnet wird', category: 'Auslöser', color: C.trig, badge: 'Seite', outputs: THEN, width: 270,
      params: [{ key: 'match', label: 'Adresse enthält', kind: 'text', default: 'twitch.tv', placeholder: 'z. B. youtube.com' }] },
    on_time: { title: 'Zur Uhrzeit', category: 'Auslöser', color: C.trig, badge: 'Zeit', outputs: THEN, width: 210,
      params: [{ key: 'time', label: 'Uhrzeit (HH:MM)', kind: 'text', default: '18:00' }, days] },
    on_interval: { title: 'Alle paar Minuten', category: 'Auslöser', color: C.trig, badge: 'Zeit', outputs: THEN, width: 200,
      params: [{ key: 'min', label: 'Minuten', kind: 'number', default: 30, min: 1, max: 1440 }] },
    on_key: { title: 'Tastenkürzel', category: 'Auslöser', color: C.trig, badge: 'Taste', outputs: THEN, width: 200,
      params: [{ key: 'key', label: 'Strg + Alt + …', kind: 'select', default: '1', options: '123456789'.split('').map(k => [k, 'Strg + Alt + ' + k]) }] },
    on_gaming: { title: 'Wenn Gaming-Modus …', category: 'Auslöser', color: C.trig, badge: 'Gaming', outputs: THEN, width: 210,
      params: [{ key: 'state', label: '', kind: 'select', default: 'on', options: [['on', '… eingeschaltet wird'], ['off', '… ausgeschaltet wird']] }] },
    on_download: { title: 'Wenn ein Download fertig ist', category: 'Auslöser', color: C.trig, badge: 'Download', outputs: THEN, width: 230,
      params: [{ key: 'ext', label: 'Nur Dateien mit (leer = alle)', kind: 'text', default: '', placeholder: 'z. B. .exe oder .zip' }] },

    // ---------------------------------------------------------- Bedingungen
    if_time: { title: 'Wenn Uhrzeit zwischen', category: 'Bedingungen', color: C.cond, inputs: IN, outputs: YESNO, width: 210,
      params: [{ key: 'from', label: 'Von', kind: 'text', default: '08:00' }, { key: 'to', label: 'Bis', kind: 'text', default: '18:00' }] },
    if_day: { title: 'Wenn Tag ist', category: 'Bedingungen', color: C.cond, inputs: IN, outputs: YESNO, width: 200, params: [days] },
    if_gaming: { title: 'Wenn Gaming-Modus an ist', category: 'Bedingungen', color: C.cond, inputs: IN, outputs: YESNO, width: 220, params: [] },
    if_page: { title: 'Wenn aktiver Tab enthält', category: 'Bedingungen', color: C.cond, inputs: IN, outputs: YESNO, width: 220,
      params: [{ key: 'match', label: 'Adresse enthält', kind: 'text', default: 'youtube.com' }] },
    if_chance: { title: 'Zufall', category: 'Bedingungen', color: C.cond, inputs: IN, outputs: YESNO, width: 180,
      params: [{ key: 'pct', label: 'Wahrscheinlichkeit (%)', kind: 'number', default: 50, min: 0, max: 100 }] },

    // ---------------------------------------------------------- Aktionen
    open_tab: { title: 'Tab öffnen', category: 'Aktionen', color: C.act, inputs: IN, outputs: THEN, width: 230,
      params: [{ key: 'url', label: 'Adresse', kind: 'text', default: 'https://www.twitch.tv/' }, { key: 'bg', label: 'Im Hintergrund', kind: 'check', default: false }] },
    gaming: { title: 'Gaming-Modus', category: 'Aktionen', color: C.act, inputs: IN, outputs: THEN, width: 190,
      params: [{ key: 'state', label: '', kind: 'select', default: 'on', options: [['on', 'Einschalten'], ['off', 'Ausschalten'], ['toggle', 'Umschalten']] }] },
    adblock: { title: 'Werbeblocker', category: 'Aktionen', color: C.act, inputs: IN, outputs: THEN, width: 180,
      params: [{ key: 'state', label: '', kind: 'select', default: 'on', options: [['on', 'Einschalten'], ['off', 'Ausschalten']] }] },
    notify: { title: 'Hinweis anzeigen', category: 'Aktionen', color: C.act, inputs: IN, outputs: THEN, width: 220,
      params: [{ key: 'text', label: 'Text', kind: 'text', default: 'Zeit für eine Pause! 🎮' }] },
    mute: { title: 'Ton aller Tabs', category: 'Aktionen', color: C.act, inputs: IN, outputs: THEN, width: 190,
      params: [{ key: 'state', label: '', kind: 'select', default: 'mute', options: [['mute', 'Stumm schalten'], ['unmute', 'Wieder einschalten']] }] },
    screenshot: { title: 'Screenshot machen', category: 'Aktionen', color: C.act, inputs: IN, outputs: THEN, width: 200,
      params: [{ key: 'full', label: 'Ganze Seite', kind: 'check', default: false }] },
    reader: { title: 'Lesemodus öffnen', category: 'Aktionen', color: C.act, inputs: IN, outputs: THEN, width: 180, params: [] },
    close_tab: { title: 'Aktiven Tab schließen', category: 'Aktionen', color: C.act, inputs: IN, outputs: THEN, width: 190, params: [] },
    panel: { title: 'Seitenleiste öffnen', category: 'Aktionen', color: C.act, inputs: IN, outputs: THEN, width: 200,
      params: [{ key: 'which', label: '', kind: 'select', default: 'discord', options: [['discord', 'Discord'], ['twitch', 'Twitch'], ['youtube', 'YouTube'], ['whatsapp', 'WhatsApp'], ['claude', 'Claude'], ['chatgpt', 'ChatGPT'], ['gx', 'GX Control']] }] },
    background: { title: 'Startseiten-Hintergrund', category: 'Aktionen', color: C.act, inputs: IN, outputs: THEN, width: 210,
      params: [{ key: 'bg', label: '', kind: 'select', default: 'galaxie', options: [['neon', 'Neon'], ['schlicht', 'Schlicht'], ['nebel', 'Nebel'], ['galaxie', 'Galaxie'], ['berge', 'Retro'], ['aurora', 'Polarlicht'], ['wellen', 'Wellen'], ['eigenes', 'Eigenes Bild']] }] },
    style: { title: 'Browser-Stil', category: 'Aktionen', color: C.act, inputs: IN, outputs: THEN, width: 180,
      params: [{ key: 'style', label: '', kind: 'select', default: 'gaming', options: [['gaming', 'Gaming'], ['normal', 'Normal']] }] },

    // ---------------------------------------------------------- Steuerung
    wait: { title: 'Warten', category: 'Steuerung', color: C.ctl, inputs: IN, outputs: THEN, width: 170,
      params: [{ key: 'sec', label: 'Sekunden', kind: 'number', default: 5, min: 1, max: 3600 }] },
    once: { title: 'Nur einmal pro Tag', category: 'Steuerung', color: C.ctl, inputs: IN, outputs: THEN, width: 190, params: [] }
  };

  const EXAMPLE = {
    nodes: [
      { id: 't1', type: 'on_page', x: 40, y: 60, params: { match: 'twitch.tv' } },
      { id: 'a1', type: 'gaming', x: 340, y: 60, params: { state: 'on' } },
      { id: 'a2', type: 'notify', x: 600, y: 60, params: { text: 'Twitch offen – Gaming-Modus ist an 🎮' } },
      { id: 't2', type: 'on_time', x: 40, y: 280, params: { time: '22:00', days: 'work' } },
      { id: 'c1', type: 'if_gaming', x: 300, y: 280, params: {} },
      { id: 'a3', type: 'notify', x: 580, y: 260, params: { text: 'Schon 22 Uhr – morgen ist Schule/Arbeit 😉' } }
    ],
    links: [
      { from: { node: 't1', port: 'then' }, to: { node: 'a1', port: 'in' } },
      { from: { node: 'a1', port: 'then' }, to: { node: 'a2', port: 'in' } },
      { from: { node: 't2', port: 'then' }, to: { node: 'c1', port: 'in' } },
      { from: { node: 'c1', port: 'yes' }, to: { node: 'a3', port: 'in' } }
    ]
  };

  window.FlowStudio = { CATALOG, EXAMPLE };
})();
