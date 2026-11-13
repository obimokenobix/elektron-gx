(function(){
  const $=id=>document.getElementById(id);
  const esc=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const KEY='elektron-assistent-v1', VERSION='1.0', LIB='./assistent/web-llm.js';
  const CHECK='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const LOCK='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  const LOOKS=[
    {id:'nacht',name:'Nacht',a:'#0b1020',b:'#5ee6c4'},
    {id:'tag',name:'Tag',a:'#f3f5fb',b:'#0e8f72'},
    {id:'glut',name:'Glut',a:'#1a0f14',b:'#ff8a5c',pro:true},
    {id:'wald',name:'Wald',a:'#0c1711',b:'#b6e35a',pro:true},
    {id:'neon',name:'Neon',a:'#0d0718',b:'#ff4fd8',pro:true}
  ];
  const MODEL='Llama-3.2-3B-Instruct-q4f16_1-MLC';
  const MODES=[{id:'eins',name:'Assistent',ins:'Du bist ein einziger Assistent für alles und erkennst selbst, was gerade gebraucht wird: bei einfachen Fragen eine kurze Antwort; bei schwierigen Fragen Schritt für Schritt wie ein Denker; beim Erklären einfach und mit Beispiel wie ein Lehrer; bei Programmierfragen zuerst der Code, dann kurz die Erklärung; bei „übersetze“ nur die Übersetzung; bei Geschichten, Ideen und Texten kreativ; bei Witzen und Spaß mit Humor; bei Fachfragen genau wie ein Profi. Halte dich so kurz, wie es die Frage erlaubt.'}];
  const REPLY='(Beispiel aus Version 2. Damals gab es noch keine Antworten.)';
  const UP='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  const STOP='<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="3"/></svg>';
  const DOTS='<span class="dots"><i></i><i></i><i></i></span>';
  const SYS=[
    'Du bist der Assistent in einer Chat-Oberfläche. Antworte in der Sprache des Nutzers, klar und ohne Füllsätze.',
    'Formatierung: nur einfacher Text, **fett** und `code`. Keine Überschriften, keine Tabellen.',
    'Ehrlichkeit: Erfinde keine Fakten, Zahlen, Maße, Rekorde, Zitate, Quellen oder Links. Wenn du etwas nicht sicher weißt, sag das offen, nenne was du weißt und was unsicher ist. Rate keine genauen Zahlen.',
    'Du hast hier keine Internetsuche und kennst keine tagesaktuellen Ereignisse oder Preise. Braucht die Frage aktuelle Daten, sag das offen und empfiehl, es nachzusehen.',
    'Wenn der Nutzer dich korrigiert oder widerspricht: Gib nicht automatisch nach und sag nicht einfach "du hast recht". Prüfe die Korrektur sachlich. Stimmt sie, sag genau, was an deiner Angabe falsch war. Bist du gut begründet anderer Meinung, bleib höflich dabei und erkläre warum. Kannst du es nicht entscheiden, sag genau das: dass du es von hier aus nicht prüfen kannst.',
    'Rechne Schritt für Schritt und prüfe das Ergebnis, bevor du es nennst.',
    'Beginne jede Antwort mit einer eigenen ersten Zeile in genau dieser Form: "SICHERHEIT: hoch" oder "SICHERHEIT: mittel" oder "SICHERHEIT: niedrig". Sie sagt, wie sicher du dir bei den Fakten deiner Antwort bist. Danach folgt die Antwort.'
  ].join('\n');
  let tts=null, dict=null, ctrl=null, listening=false, lib=null, engine=null, loaded='', halt=false;
  const gpu=!!navigator.gpu;
  const host=(name,...a)=>{try{return window.elektron?window.elektron.invoke(name,...a).catch(()=>null):Promise.resolve(null);}catch(x){return Promise.resolve(null);}};
  const PRELOAD=location.hash==='#vorladen';
  let jitless=false;

  let S={chats:[],cur:null,seq:1,set:{look:'nacht',size:15,enter:true,motion:false,pro:true,name:'',mode:'eins',seen:'1.0'}};
  let pending=[], busy=false;

  function load(){
    try{const r=JSON.parse(localStorage.getItem(KEY)); if(r&&r.chats){S=Object.assign(S,r); S.set=Object.assign({look:'nacht',size:15,enter:true,motion:false,name:''},r.set||{});}}catch(e){}
    S.set.pro=true;S.set.mode='eins';S.set.seen=VERSION;S.set.model=MODEL;
  }
  function save(){try{localStorage.setItem(KEY,JSON.stringify(S));}catch(e){}}
  const cur=()=>S.chats.find(c=>c.id===S.cur)||null;
  const time=t=>new Date(t).toLocaleTimeString('de-AT',{hour:'2-digit',minute:'2-digit'});
  function toast(m){const d=document.createElement('div');d.className='toast';d.textContent=m;$('toasts').appendChild(d);setTimeout(()=>d.remove(),2200);}
  function fmt(s){return esc(s).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/`([^`]+)`/g,'<code>$1</code>');}

  /* Aussehen anwenden */
  function apply(){
    const st=S.set, look=LOOKS.find(l=>l.id===st.look)||LOOKS[0];
    document.documentElement.dataset.look=(look.pro&&!st.pro)?'nacht':look.id;
    document.documentElement.style.setProperty('--fs',st.size+'px');
    document.body.classList.toggle('is-pro',st.pro);
    $('upsell').style.display=st.pro?'none':'';
    $('updDot').style.display=st.seen===VERSION?'none':'';
    $('hint').textContent=(st.enter?'Enter sendet · Umschalt + Enter für neue Zeile':'Strg + Enter sendet · Enter für neue Zeile')+'';
    $('modes').innerHTML='';
    MODES.forEach(m=>{const b=document.createElement('button');b.className='mode'+(st.mode===m.id?' on':'');b.innerHTML=esc(m.name)+(m.pro&&!st.pro?LOCK:'');
      b.onclick=()=>{if(m.pro&&!st.pro){showPro();return;}st.mode=m.id;save();apply();};$('modes').appendChild(b);});
    accent=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    if(typeof kick==='function')kick();
  }

  /* Seitenleiste */
  function drawHist(){
    const q=$('search').value.trim().toLowerCase(), h=$('hist');h.innerHTML='';
    const hit=c=>!q||c.title.toLowerCase().includes(q)||c.msgs.some(m=>m.text.toLowerCase().includes(q));
    const groups=[['Angeheftet',S.chats.filter(c=>c.pin&&hit(c))],['Verlauf',S.chats.filter(c=>!c.pin&&hit(c))]];
    let n=0;
    groups.forEach(([name,list])=>{
      if(!list.length)return; n+=list.length;
      const l=document.createElement('div');l.className='label';l.textContent=name;h.appendChild(l);
      list.forEach(c=>{
        const r=document.createElement('div');r.className='item'+(c.id===S.cur?' active':'');
        const o=document.createElement('button');o.className='open';o.textContent=c.title;o.title=c.title;
        o.onclick=()=>{S.cur=c.id;save();draw();$('side').classList.remove('open');};
        const mk=(label,svg,fn,on)=>{const b=document.createElement('button');b.className='mini'+(on?' on':'');b.title=label;b.setAttribute('aria-label',label);b.innerHTML=svg;b.onclick=fn;return b;};
        r.append(o,
          mk(c.pin?'Lösen':'Anheften','<svg width="14" height="14" viewBox="0 0 24 24" fill="'+(c.pin?'currentColor':'none')+'" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9 6.6 19.8l1.1-6.1L3.2 9.4l6.1-.8z"/></svg>',()=>{c.pin=!c.pin;save();drawHist();},c.pin),
          mk('Umbenennen','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',()=>rename(c)),
          mk('Löschen','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>',()=>remove(c)));
        h.appendChild(r);
      });
    });
    if(!n){const e=document.createElement('div');e.className='none';e.textContent=q?'Kein Chat passt zu „'+q+'“.':'Noch keine Chats. Schreib unten die erste Nachricht.';h.appendChild(e);}
  }

  /* Gespräch */
  function hello(){
    const hr=new Date().getHours(), gr=hr<11?'Guten Morgen':hr<18?'Hallo':'Guten Abend';
    const nm=S.set.name?', '+esc(S.set.name):'';
    const ideas=[['Erklären','Wie funktioniert ein Elektromotor?','M12 3a6 6 0 0 0-3.5 10.9V17h7v-3.1A6 6 0 0 0 12 3zM9.5 21h5'],
      ['Schreiben','Schreib eine kurze Einladung zum Geburtstag.','M4 20h4L19 9l-4-4L4 16zM13 7l4 4'],
      ['Planen','Plane mir ein Wochenende in Wien.','M5 5h14v15H5zM5 10h14M9 3v4M15 3v4'],
      ['Programmieren','Zeig mir eine Schleife in Python.','M8 8l-4 4 4 4M16 8l4 4-4 4M13 5l-2 14']];
    $('col').innerHTML='<div class="hello"><h1>'+gr+nm+'. <em>Was steht an?</em></h1>'+
      '<p>Der Assistent ist in Elektron eingebaut und rechnet auf deinem PC. Deine Nachrichten verlassen den Computer nicht. Er ist kleiner als die großen KIs im Netz, irrt sich öfter und kann nicht im Internet suchen.</p>'+
      '<div class="cards">'+ideas.map((i,k)=>'<button class="card" data-k="'+k+'"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="'+i[2]+'"/></svg><b>'+i[0]+'</b><small>'+i[1]+'</small></button>').join('')+'</div></div>';
    $('col').querySelectorAll('.card').forEach(b=>b.onclick=()=>{$('input').value=ideas[+b.dataset.k][1];grow();$('input').focus();});
  }
  function draw(){
    const c=cur();
    $('title').textContent=c?c.title:'Neuer Chat';
    if(!c||!c.msgs.length){hello();}
    else{
      const col=$('col');col.innerHTML='';
      c.msgs.forEach(m=>col.appendChild(rowFor(c,m)));
      $('msgs').scrollTop=$('msgs').scrollHeight;
    }
    drawHist();
  }
  function rowFor(c,m){
    const r=document.createElement('div');r.className='row '+m.who+(m.err?' err':'');r.dataset.mid=m.id;
    const av=document.createElement('div');av.className='av';av.textContent=m.who==='bot'?'✦':(S.set.name||'Du').slice(0,2).toUpperCase();
    const st=document.createElement('div');st.className='stack';
    if(m.files&&m.files.length){const f=document.createElement('div');f.className='files';m.files.forEach(n=>{const s=document.createElement('span');s.className='file';s.textContent=n;f.appendChild(s);});st.appendChild(f);}
    const b=document.createElement('div');b.className='bubble';b.innerHTML=m.text?fmt(m.text):(m.live?DOTS:'');st.appendChild(b);
    const meta=document.createElement('div');meta.className='meta';
    const tm=document.createElement('span');tm.textContent=time(m.t);meta.appendChild(tm);
    if(m.conf){const cf=document.createElement('span');cf.className='conf '+m.conf;cf.textContent='Sicherheit: '+m.conf;cf.title='So sicher ist sich der Assistent bei den Fakten dieser Antwort.';meta.appendChild(cf);}
    const act=(label,fn)=>{const x=document.createElement('button');x.textContent=label;x.onclick=fn;meta.appendChild(x);};
    if(!busy){
      act('Kopieren',()=>copy(m.text));
      if(m.who==='user'){
        act('Bearbeiten',()=>{const i=c.msgs.indexOf(m);c.msgs.splice(i,(c.msgs[i+1]&&c.msgs[i+1].who==='bot')?2:1);$('input').value=m.text;grow();save();draw();$('input').focus();});
      }else{
        if(tts&&m.text&&!m.err)act('Vorlesen',()=>{tts.speak(m.text.replace(/[*`]/g,'').slice(0,2000)).catch(()=>toast('Vorlesen ist gerade nicht möglich'));});
        if(c.msgs[c.msgs.length-1]===m&&c.msgs.length>1)act('Neu antworten',()=>{c.msgs.pop();answer(c);});
      }
      act('Löschen',()=>{c.msgs.splice(c.msgs.indexOf(m),1);save();draw();});
    }
    st.appendChild(meta);r.append(av,st);return r;
  }

  /* Antworten */
  function curMode(){const m=MODES.find(x=>x.id===S.set.mode);return (m&&(!m.pro||S.set.pro))?m:MODES[0];}
  function status(){const e=$('state'), ok=gpu&&!jitless&&engine&&loaded===MODEL;e.classList.toggle('ok',!!ok);
    e.textContent=jitless?'Aus bei „Maximale Sicherheit“':!gpu?'Grafikkarte wird nicht unterstützt':ok?'Assistent bereit · läuft auf deinem PC':'Lädt beim ersten Senden';}
  async function ready(m){
    if(engine&&loaded===S.set.model)return;
    const show=t=>{const el=document.querySelector('[data-mid="'+m.id+'"] .bubble');if(el)el.textContent=t;};
    show('Lade die KI-Bibliothek …');
    if(!lib)lib=await import(LIB);
    if(engine){try{await engine.unload();}catch(x){}engine=null;loaded='';}
    engine=await lib.CreateMLCEngine(S.set.model,{
      initProgressCallback:r=>show('Lade das KI-Modell … '+Math.round((r.progress||0)*100)+' %\nBeim ersten Mal wird es heruntergeladen. Das kann einige Minuten dauern.'),
      appConfig:Object.assign({},lib.prebuiltAppConfig,{useIndexedDBCache:true})});
    loaded=S.set.model;status();host('ai.ready',MODEL);
  }
  function split(text){
    const mt=text.match(/^\s*SICHERHEIT:\s*(hoch|mittel|niedrig)[^\n]*\n?/i);
    if(mt)return {conf:mt[1].toLowerCase(),body:text.slice(mt[0].length).replace(/^\s+/,'')};
    const t=text.trim().toUpperCase();
    if(t.length<40&&text.indexOf('\n')<0&&('SICHERHEIT:'.startsWith(t.slice(0,11))))return {conf:null,body:''};
    return {conf:null,body:text};
  }
  function setLive(m,text){
    const p=split(text||'');m.text=p.body;if(p.conf)m.conf=p.conf;
    const el=document.querySelector('[data-mid="'+m.id+'"] .bubble');
    if(el){el.innerHTML=m.text?fmt(m.text):DOTS;$('msgs').scrollTop=$('msgs').scrollHeight;}
  }
  function buildInput(c,upto){
    const out=[];
    c.msgs.slice(0,c.msgs.indexOf(upto)).filter(m=>m.text&&!m.err).slice(-8).forEach(m=>{
      const role=m.who==='user'?'user':'assistant';
      let text=m.text;
      if(m.files&&m.files.length)text+='\n[Angehängte Dateien: '+m.files.join(', ')+'. Der Inhalt ist für dich nicht lesbar, nur die Namen.]';
      if(out.length&&out[out.length-1].role===role)out[out.length-1].content+='\n\n'+text;else out.push({role:role,content:text});
    });
    while(out.length&&out[0].role!=='user')out.shift();
    const mode='\nModell „'+curMode().name+'“: '+curMode().ins;
    const who=S.set.name?'\nDer Nutzer heißt '+S.set.name+'.':'';
    const d=new Date();
    const now='\nHeute ist '+d.toLocaleDateString('de-AT',{weekday:'long',year:'numeric',month:'long',day:'numeric'})+', '+d.toLocaleTimeString('de-AT',{hour:'2-digit',minute:'2-digit'})+' Uhr.';
    out.unshift({role:'system',content:SYS+mode+who+now});
    return out;
  }
  async function answer(c){
    const m={id:S.seq++,who:'bot',text:'',t:Date.now(),live:true};
    c.msgs.push(m);busy=true;halt=false;draw();grow();
    let full='';
    try{
      if(jitless){m.err=true;m.text='Im Modus „Maximale Sicherheit“ kann der Assistent nicht rechnen. Schalte den Modus in GX Control aus und starte Elektron neu.';}
      else if(!gpu){m.err=true;m.text='Der Assistent braucht eine Grafikkarte mit WebGPU. Auf diesem PC ist das nicht verfügbar. Aktualisiere den Grafiktreiber und starte Elektron neu.';}
      else{
        ctrl={abort:function(){halt=true;if(engine&&loaded){try{engine.interruptGenerate();}catch(x){}}}};
        await ready(m);
        if(!halt){
                    const stream=await engine.chat.completions.create({messages:buildInput(c,m),stream:true,temperature:0.5,max_tokens:900});
          for await(const ch of stream){
            const d=ch.choices&&ch.choices[0]&&ch.choices[0].delta&&ch.choices[0].delta.content;
            if(d){full+=d;setLive(m,full.replace(/<think>[\s\S]*?(<\/think>|$)/g,''));}
            if(halt)break;
          }
        }
        if(halt){m.text=(m.text?m.text+'\n\n':'')+'(Antwort gestoppt.)';if(!m.conf)m.err=true;}
        else if(!m.text){m.err=true;m.text='Es kam keine Antwort zurück. Tippe auf „Neu antworten“.';}
      }
    }catch(e){
      m.err=true;m.conf=null;
      const msg=(e&&e.message)||String(e);
      m.text=!engine||loaded!==S.set.model
        ?'Das KI-Modell konnte nicht geladen werden: '+msg+'\n\nBeim ersten Mal braucht es Internet und etwa 2 GB freien Speicher. Tippe auf „Neu antworten“, um es noch einmal zu versuchen.'
        :'Die Antwort ist fehlgeschlagen: '+msg+'\n\nTippe auf „Neu antworten“. Bleibt der Fehler, beginne einen neuen Chat.';
    }finally{m.live=false;busy=false;ctrl=null;save();draw();grow();status();}
  }
  function copy(t){navigator.clipboard.writeText(t).then(()=>toast('Kopiert'),()=>toast('Kopieren wurde vom Browser blockiert'));}

  /* Senden */
  function grow(){const i=$('input');i.style.height='auto';i.style.height=Math.min(i.scrollHeight,200)+'px';
    const n=i.value.length;$('count').textContent=n+' / 4000';$('count').style.color=n>4000?'var(--danger)':'';
    $('send').disabled=!busy&&((!i.value.trim()&&!pending.length)||n>4000);$('send').innerHTML=busy?STOP:UP;$('send').setAttribute('aria-label',busy?'Antwort stoppen':'Senden');slash();}
  function drawPending(){const p=$('pending');p.innerHTML='';pending.forEach((n,k)=>{const s=document.createElement('span');s.className='file';s.textContent=n+' ';const x=document.createElement('button');x.textContent='✕';x.setAttribute('aria-label',n+' entfernen');x.onclick=()=>{pending.splice(k,1);drawPending();grow();};s.appendChild(x);p.appendChild(s);});}
  function send(){
    const i=$('input'), t=i.value.trim();
    if(busy||(!t&&!pending.length)||i.value.length>4000)return;
    if(t.startsWith('/')){const cmd=CMDS.find(c=>c.slash===t.split(' ')[0].toLowerCase());if(cmd){i.value='';grow();cmd.run();return;}}
    let c=cur();
    if(!c){const base=t||pending[0];c={id:S.seq++,title:base.length>34?base.slice(0,34)+'…':base,pin:false,msgs:[]};S.chats.unshift(c);S.cur=c.id;}
    c.msgs.push({id:S.seq++,who:'user',text:t||'(nur Anhang)',t:Date.now(),files:pending.slice()});
    pending=[];drawPending();i.value='';save();answer(c);
  }

  /* Fenster */
  function open(html){$('dialog').innerHTML=html;$('veil').classList.add('show');const f=$('dialog').querySelector('[autofocus],input,button');if(f)f.focus();}
  function close(){$('veil').classList.remove('show');$('input').focus();}
  const X='<button class="icon" data-close aria-label="Schließen"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
  $('veil').addEventListener('click',e=>{if(e.target===$('veil')||e.target.closest('[data-close]'))close();});

  function rename(c){
    open('<h2>Chat umbenennen'+X+'</h2><label class="field"><span>Neuer Name</span><input type="text" id="rn" maxlength="60" value="'+esc(c.title)+'"></label><div class="acts"><button class="btn" data-close>Abbrechen</button><button class="btn primary" id="rnOk">Speichern</button></div>');
    const ok=()=>{const v=$('rn').value.trim();if(v){c.title=v;save();draw();}close();};
    $('rnOk').onclick=ok;$('rn').onkeydown=e=>{if(e.key==='Enter')ok();};$('rn').select();
  }
  function remove(c){
    open('<h2>Chat löschen?'+X+'</h2><p>„'+esc(c.title)+'“ mit '+c.msgs.length+' Nachrichten wird aus diesem Browser entfernt. Das lässt sich nicht rückgängig machen.</p><div class="acts"><button class="btn" data-close>Behalten</button><button class="btn danger" id="rmOk">Löschen</button></div>');
    $('rmOk').onclick=()=>{S.chats=S.chats.filter(x=>x!==c);if(S.cur===c.id)S.cur=null;save();draw();close();toast('Chat gelöscht');};
  }
  function showSet(){
    const st=S.set, msgs=S.chats.reduce((a,c)=>a+c.msgs.filter(m=>m.who==='user').length,0);
    open('<h2>Einstellungen'+X+'</h2>'+
      '<div class="stats"><div class="stat"><b>'+S.chats.length+'</b><span>Chats</span></div><div class="stat"><b>'+msgs+'</b><span>Nachrichten von dir</span></div><div class="stat"><b>3B</b><span>Modell Llama 3.2</span></div></div>'+
      '<label class="field"><span>Dein Name (für die Begrüßung)</span><input type="text" id="nm" maxlength="24" value="'+esc(st.name)+'" placeholder="z. B. Alex"></label>'+
      '<div class="field"><span>Farbwelt</span><div class="looks">'+LOOKS.map(l=>'<button class="look'+(st.look===l.id?' on':'')+'" data-look="'+l.id+'"><i style="background:linear-gradient(135deg,'+l.a+' 55%,'+l.b+' 55%)"></i>'+l.name+(l.pro&&!st.pro?' '+LOCK:'')+'</button>').join('')+'</div></div>'+
      '<div class="field"><span>Schriftgröße</span><div class="seg">'+[[14,'Klein'],[15,'Normal'],[17,'Groß']].map(s=>'<button class="btn'+(st.size===s[0]?' on':'')+'" data-size="'+s[0]+'">'+s[1]+'</button>').join('')+'</div></div>'+
      '<label class="switch"><span>Enter sendet die Nachricht</span><input type="checkbox" id="swEnter"'+(st.enter?' checked':'')+'></label>'+
      '<label class="switch"><span>Modell nach der Installation automatisch laden (ca. 2 GB)</span><input type="checkbox" id="swAuto" checked></label>'+
      '<label class="switch"><span>Bewegter Hintergrund</span><input type="checkbox" id="swMotion"'+(st.motion&&st.pro?' checked':'')+(st.pro?'':' disabled')+'></label>'+
      '<div class="acts"><button class="btn danger" id="wipe">Alle Chats löschen</button><button class="btn primary" data-close>Fertig</button></div>');
    $('nm').oninput=e=>{st.name=e.target.value.trim();save();draw();};
    $('dialog').querySelectorAll('[data-look]').forEach(b=>b.onclick=()=>{const l=LOOKS.find(x=>x.id===b.dataset.look);if(l.pro&&!st.pro){showPro();return;}st.look=l.id;save();apply();showSet();});
    $('dialog').querySelectorAll('[data-size]').forEach(b=>b.onclick=()=>{st.size=+b.dataset.size;save();apply();showSet();});
    $('swEnter').onchange=e=>{st.enter=e.target.checked;save();apply();};
    $('swMotion').onchange=e=>{st.motion=e.target.checked;save();kick();};
    host('ai.info').then(i=>{if(i&&$('swAuto'))$('swAuto').checked=i.auto;});
    $('swAuto').onchange=e=>{host('ai.setAuto',e.target.checked);};
    $('wipe').onclick=()=>{open('<h2>Wirklich alles löschen?'+X+'</h2><p>Alle '+S.chats.length+' Chats werden aus diesem Browser entfernt.</p><div class="acts"><button class="btn" data-close>Abbrechen</button><button class="btn danger" id="wipeOk">Alles löschen</button></div>');
      $('wipeOk').onclick=()=>{S.chats=[];S.cur=null;save();draw();close();toast('Alle Chats gelöscht');};};
  }
  function showPro(){
    const on=S.set.pro;
    const feats=['Drei weitere Farbwelten: Glut, Wald und Neon','Drei weitere Modelle: Kreativ, Witzig und Profi','Bewegter Hintergrund, der die Farbwelt aufnimmt','PRO-Abzeichen neben dem Namen'];
    open('<h2>Pro <span class="pill '+(on?'a':'')+'">'+(on?'Aktiv':'Demo')+'</span>'+X+'</h2>'+
      '<p>Pro ist hier eine Vorschau zum Ausprobieren. Es wird nichts bezahlt und nichts abgebucht.</p>'+
      '<ul class="list">'+feats.map(f=>'<li>'+CHECK+'<span>'+f+'</span></li>').join('')+'</ul>'+
      '<div class="acts"><button class="btn" data-close>Später</button><button class="btn primary" id="proOk">'+(on?'Pro ausschalten':'Pro einschalten')+'</button></div>');
    $('proOk').onclick=()=>{S.set.pro=!on;if(S.set.pro){S.set.motion=true;}else if((MODES.find(x=>x.id===S.set.mode)||{}).pro){S.set.mode='schnell';}save();apply();close();toast(S.set.pro?'Pro ist eingeschaltet':'Pro ist ausgeschaltet');};
  }
  function showUpd(){
    S.set.seen=VERSION;save();apply();
    open('<h2>Updates'+X+'</h2>'+
      '<div class="ver now"><h3>Version 5.0 <span class="pill a">Neu</span></h3><ul><li>Die KI läuft direkt im Browser, in einer einzigen Datei und ohne Zusatzprogramm</li><li>Vier freie Modelle zur Auswahl, von winzig bis sehr groß</li></ul></div>'+
      '<div class="ver"><h3>Version 3.1</h3><ul><li>Acht Modelle: Blitz, Denker, Lehrer, Coder, Übersetzer, dazu Kreativ, Witzig und Profi mit Pro</li><li>Antworten sind insgesamt kürzer</li></ul></div>'+
      '<div class="ver"><h3>Version 3.0</h3><ul><li>Echte Antworten, die beim Schreiben mitlaufen</li><li>Ehrlichkeitsregeln: nicht raten, Unsicherheit offen sagen, bei Widerspruch prüfen statt einfach nachgeben</li><li>Anzeige, wie sicher eine Antwort ist</li><li>Werkzeuge: exaktes Rechnen, Datum und Uhrzeit, Zufallszahlen</li><li>Antwort stoppen und neu antworten lassen</li><li>Vorlesen und Diktieren, wo der Browser es erlaubt</li></ul></div>'+
      '<div class="ver"><h3>Version 2.0</h3><ul><li>Neues Design mit fünf Farbwelten</li><li>Chats bleiben in diesem Browser gespeichert</li><li>Suchen, Anheften, Umbenennen und Löschen von Chats</li><li>Befehlsfenster mit Strg + K und Schrägstrich-Befehle</li><li>Dateien anhängen (es wird nur der Name gezeigt)</li><li>Nachrichten kopieren, bearbeiten und löschen</li><li>Pro-Vorschau, Einstellungen und Tastenkürzel</li></ul></div>'+
      '<div class="ver"><h3>Version 1.0</h3><ul><li>Erste Oberfläche mit Seitenleiste und Eingabefeld</li></ul></div>'+
      '<div class="ver"><h3>Geplant <span class="pill">Offen</span></h3><ul><li>Internetsuche</li><li>Inhalte angehängter Dateien lesen</li></ul></div>'+
      '<div class="acts"><button class="btn primary" data-close>Alles klar</button></div>');
  }
  function showKeys(){
    const k=[['Befehlsfenster öffnen','Strg K'],['Neuer Chat','Alt N'],['Chats durchsuchen','Strg Umschalt F'],['Einstellungen','Strg ,'],['Befehle in der Eingabe','/'],['Fenster schließen','Esc']];
    open('<h2>Tastenkürzel'+X+'</h2><div class="keys">'+k.map(r=>'<span>'+r[0]+'</span><kbd>'+r[1]+'</kbd>').join('')+'</div><div class="acts"><button class="btn primary" data-close>Schließen</button></div>');
  }

  /* Befehle */
  function newChat(){S.cur=null;save();draw();$('side').classList.remove('open');$('input').focus();}
  function copyChat(){const c=cur();if(!c||!c.msgs.length){toast('Dieser Chat ist noch leer');return;}
    copy(c.title+'\n\n'+c.msgs.map(m=>(m.who==='user'?'Du':'Assistent')+' ('+time(m.t)+'): '+m.text).join('\n'));}
  function nextLook(){const ok=LOOKS.filter(l=>!l.pro||S.set.pro);const i=ok.findIndex(l=>l.id===S.set.look);const n=ok[(i+1)%ok.length];S.set.look=n.id;save();apply();toast('Farbwelt: '+n.name);}
  const CMDS=[
    {slash:'/neu',name:'Neuer Chat',hint:'Leeren Chat beginnen',run:newChat},
    {slash:'/leeren',name:'Chat leeren',hint:'Alle Nachrichten dieses Chats entfernen',run:()=>{const c=cur();if(c){c.msgs=[];save();draw();toast('Chat geleert');}}},
    {slash:'/thema',name:'Farbwelt wechseln',hint:'Zur nächsten Farbwelt springen',run:nextLook},
    {slash:'/kopieren',name:'Chat kopieren',hint:'Ganzen Chat als Text in die Zwischenablage',run:copyChat},
    {slash:'/einstellungen',name:'Einstellungen',hint:'Name, Farbwelt, Schrift',run:showSet},
    {slash:'/hilfe',name:'Tastenkürzel',hint:'Alle Kürzel auf einen Blick',run:showKeys}
  ];
  function slash(){
    const v=$('input').value, box=$('slash');
    if(!v.startsWith('/')||/\s/.test(v)){box.classList.remove('show');return;}
    const list=CMDS.filter(c=>c.slash.startsWith(v.toLowerCase()));
    if(!list.length){box.classList.remove('show');return;}
    box.innerHTML='';list.forEach((c,k)=>{const b=document.createElement('button');b.className='opt'+(k===0?' sel':'');b.innerHTML='<b>'+c.slash+'</b><span>'+c.hint+'</span>';b.onclick=()=>{$('input').value='';grow();c.run();};box.appendChild(b);});
    box.classList.add('show');
  }
  function showPal(){
    open('<h2>Befehle'+X+'</h2><input id="pal-in" type="text" placeholder="Befehl suchen" aria-label="Befehl suchen" autofocus><div id="pal-list"></div>');
    let sel=0, list=[];
    const paint=()=>{const q=$('pal-in').value.trim().toLowerCase();list=CMDS.filter(c=>(c.name+c.hint+c.slash).toLowerCase().includes(q));sel=Math.min(sel,Math.max(0,list.length-1));
      const L=$('pal-list');L.innerHTML=list.length?'':'<div class="none">Kein Befehl gefunden.</div>';
      list.forEach((c,k)=>{const b=document.createElement('button');b.className='opt'+(k===sel?' sel':'');b.innerHTML='<b>'+c.name+'</b><span>'+c.hint+'</span>';b.onclick=()=>{close();c.run();};L.appendChild(b);});};
    $('pal-in').oninput=()=>{sel=0;paint();};
    $('pal-in').onkeydown=e=>{if(e.key==='ArrowDown'){sel=Math.min(sel+1,list.length-1);paint();e.preventDefault();}
      else if(e.key==='ArrowUp'){sel=Math.max(sel-1,0);paint();e.preventDefault();}
      else if(e.key==='Enter'&&list[sel]){const c=list[sel];close();c.run();}};
    paint();
  }

  /* Ereignisse */
  $('input').addEventListener('input',grow);
  $('input').addEventListener('keydown',e=>{
    if(e.key!=='Enter')return;
    const want=S.set.enter?!e.shiftKey:(e.ctrlKey||e.metaKey);
    if(want){e.preventDefault();send();}
  });
  $('send').onclick=()=>{if(busy){if(ctrl)ctrl.abort();}else send();};
  $('mic').onclick=()=>{if(!dict)return;
    if(listening){dict.stop().catch(()=>{});return;}
    dict.start().catch(e=>{toast(e&&e.code==='not_granted'?'Mikrofon wurde nicht erlaubt':'Diktieren ist gerade nicht möglich');});};
  $('attach').onclick=()=>$('file').click();
  $('file').onchange=e=>{[...e.target.files].forEach(f=>pending.push(f.name));e.target.value='';drawPending();grow();};
  $('new').onclick=newChat; $('search').oninput=drawHist;
  $('openSet').onclick=showSet; $('openPro').onclick=showPro; $('openUpd').onclick=showUpd; $('openPal').onclick=showPal; $('copyChat').onclick=copyChat;
  $('menu').onclick=()=>$('side').classList.toggle('open');
  $('msgs').addEventListener('click',()=>$('side').classList.remove('open'));
  document.addEventListener('keydown',e=>{
    const m=e.ctrlKey||e.metaKey;
    if(e.key==='Escape'&&$('veil').classList.contains('show')){close();}
    else if(m&&e.key.toLowerCase()==='k'){e.preventDefault();showPal();}
    else if(e.altKey&&e.key.toLowerCase()==='n'){e.preventDefault();newChat();}
    else if(m&&e.shiftKey&&e.key.toLowerCase()==='f'){e.preventDefault();$('side').classList.add('open');$('search').focus();}
    else if(m&&e.key===','){e.preventDefault();showSet();}
  });

  /* Hintergrund (Pro) */
  let accent='#5ee6c4';
  const cv=$('sky'), cx=cv.getContext('2d');
  const blobs=Array.from({length:5},(_,i)=>({x:Math.random(),y:Math.random(),r:.18+Math.random()*.2,dx:(Math.random()-.5)*.00035,dy:(Math.random()-.5)*.00035,p:i}));
  const calm=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function size(){cv.width=innerWidth;cv.height=innerHeight;}
  function paint(){
    cx.clearRect(0,0,cv.width,cv.height);
    const live=S.set.pro&&S.set.motion;
    const n=live?blobs.length:2;
    for(let i=0;i<n;i++){const b=blobs[i];
      if(live&&!calm){b.x+=b.dx;b.y+=b.dy;if(b.x<0||b.x>1)b.dx*=-1;if(b.y<0||b.y>1)b.dy*=-1;}
      const x=b.x*cv.width,y=b.y*cv.height,r=b.r*Math.max(cv.width,cv.height);
      const g=cx.createRadialGradient(x,y,0,x,y,r);
      cx.globalAlpha=live?.22:.12;g.addColorStop(0,accent);g.addColorStop(1,'transparent');
      cx.fillStyle=g;cx.fillRect(0,0,cv.width,cv.height);}
    cx.globalAlpha=1;
    if(live&&!calm)requestAnimationFrame(paint);else looping=false;
  }
  let looping=false;
  function kick(){if(!looping){looping=true;requestAnimationFrame(paint);}}
  addEventListener('resize',()=>{size();kick();});

  load();apply();size();draw();grow();kick();status();
  if('speechSynthesis' in window){tts={speak:function(t){return new Promise((ok,no)=>{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(t);u.lang=document.documentElement.lang||'de-DE';u.onend=ok;u.onerror=no;speechSynthesis.speak(u);});}};draw();}
  host('ai.info').then(i=>{jitless=!!(i&&i.jitless);status();
    if(!PRELOAD)return;
    // Unsichtbarer Start nach der Installation: Modell einmal laden, dann meldet sich die Seite ab
    if(jitless||!gpu){host('ai.failed');return;}
    ready({id:0}).catch(()=>host('ai.failed'));
  });
})();
