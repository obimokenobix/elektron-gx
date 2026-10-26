'use strict';
/* global floatApi */
const $ = (s) => document.getElementById(s);

floatApi.onInfo((info) => {
  document.documentElement.style.setProperty('--accent', info.accent);
  $('title').textContent = info.title || 'Elektron';
  $('fav').src = info.favicon || '../assets/icon.png';
  if (document.activeElement !== $('op')) $('op').value = info.opacity;
  $('pin').classList.toggle('on', info.pinned);
  $('pin').title = info.pinned ? 'Immer im Vordergrund (an)' : 'Immer im Vordergrund (aus)';
});
$('fav').addEventListener('error', () => { $('fav').src = '../assets/icon.png'; });
$('op').addEventListener('input', () => floatApi.cmd('opacity', Number($('op').value)));
$('pin').addEventListener('click', () => floatApi.cmd('pin'));
$('pip').addEventListener('click', () => floatApi.cmd('pip'));
$('dock').addEventListener('click', () => floatApi.cmd('dock'));
$('close').addEventListener('click', () => floatApi.cmd('close'));
