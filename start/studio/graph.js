'use strict';
/*
 * Elektron Studio – Node-Editor (ähnlich wie Blueprints / Material-Editor in Unreal Engine).
 * Kästchen (Nodes) mit Eingängen und Ausgängen, die man mit Linien verbindet.
 *
 *   const g = new GraphEditor(element, { catalog, onChange, pinColor, canConnect });
 *   g.load({ nodes: [...], links: [...] });
 *
 * Bedienung: Rechtsklick/Leertaste = Node hinzufügen · Ziehen am Hintergrund = verschieben ·
 * Mausrad = zoomen · Entf = Auswahl löschen · Strg+D = duplizieren · Alt+Klick auf Pin = trennen
 */
(function () {
  const SVGNS = 'http://www.w3.org/2000/svg';
  let uid = 1;
  const newId = () => 'n' + Date.now().toString(36) + (uid++).toString(36);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  class GraphEditor {
    constructor(root, opts) {
      this.root = root;
      this.catalog = opts.catalog;           // { typ: { title, category, color, inputs, outputs, params, width, single } }
      this.onChange = opts.onChange || (() => {});
      this.onParam = opts.onParam || null;   // (node, key, value) – für Live-Vorschau ohne Neuaufbau
      this.renderExtra = opts.renderExtra || null; // (node, bodyElement) – eigene Inhalte (Knöpfe, Fehler …)
      this.pinColor = opts.pinColor || (() => '#9aa');
      this.nodes = new Map();  // id -> { data, el, pins: { 'in:name' | 'out:name': el } }
      this.links = [];         // { from: { node, port }, to: { node, port } }
      this.view = { x: 0, y: 0, z: 1 };
      this.selected = new Set();
      this.build();
    }

    // ------------------------------------------------------------ Aufbau
    build() {
      this.root.classList.add('graph');
      this.root.tabIndex = 0;
      this.stage = el('div', 'g-stage');
      this.svg = document.createElementNS(SVGNS, 'svg');
      this.svg.classList.add('g-wires');
      this.layer = el('div', 'g-nodes');
      this.stage.append(this.svg, this.layer);
      this.root.append(this.stage);
      this.hint = el('div', 'g-hint', 'Rechtsklick oder Leertaste: Node hinzufügen · Hintergrund ziehen: verschieben · Mausrad: zoomen · Entf: löschen');
      this.root.append(this.hint);

      this.root.addEventListener('contextmenu', (e) => {
        if (e.target.closest('.g-node')) return;
        e.preventDefault();
        this.openAddMenu(e.clientX, e.clientY);
      });
      this.root.addEventListener('pointerdown', (e) => this.onBgDown(e));
      this.root.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
      this.root.addEventListener('keydown', (e) => this.onKey(e));
      window.addEventListener('resize', () => this.applyView());
      this.applyView();
    }

    // ------------------------------------------------------------ Laden / Speichern
    load(graph) {
      this.layer.replaceChildren();
      this.nodes.clear();
      this.links = [];
      this.selected.clear();
      for (const n of (graph && graph.nodes) || []) if (this.catalog[n.type]) this.addNode(n.type, n.x, n.y, n.params, n.id, true);
      for (const l of (graph && graph.links) || []) {
        if (this.nodes.has(l.from.node) && this.nodes.has(l.to.node)) this.links.push({ from: { ...l.from }, to: { ...l.to } });
      }
      if (graph && graph.view) this.view = { ...graph.view };
      this.applyView();
      this.redrawWires();
    }

    toJSON() {
      return {
        nodes: [...this.nodes.values()].map(n => ({ id: n.data.id, type: n.data.type, x: Math.round(n.data.x), y: Math.round(n.data.y), params: { ...n.data.params } })),
        links: this.links.map(l => ({ from: { ...l.from }, to: { ...l.to } })),
        view: { ...this.view }
      };
    }

    changed(structural = true) { this.onChange(this.toJSON(), structural); }

    // ------------------------------------------------------------ Nodes
    addNode(type, x, y, params, id, silent) {
      const def = this.catalog[type];
      if (!def) return null;
      if (def.single && [...this.nodes.values()].some(n => n.data.type === type)) {
        const ex = [...this.nodes.values()].find(n => n.data.type === type);
        this.select(ex.data.id);
        return ex;
      }
      const data = { id: id || newId(), type, x: x || 0, y: y || 0, params: {} };
      for (const p of def.params || []) data.params[p.key] = params && p.key in params ? params[p.key] : p.default;
      const node = { data, def, el: null, pins: {} };
      this.nodes.set(data.id, node);
      this.renderNode(node);
      if (!silent) { this.select(data.id); this.changed(); }
      return node;
    }

    renderNode(node) {
      const { data, def } = node;
      const box = el('div', 'g-node');
      box.dataset.id = data.id;
      box.style.width = (def.width || 200) + 'px';
      box.style.setProperty('--nc', def.color || '#555');
      const head = el('div', 'g-head');
      const title = el('span', 'g-title', def.title);
      head.append(title);
      if (def.badge) head.append(el('span', 'g-badge', def.badge));
      box.append(head);

      const pins = el('div', 'g-pins');
      const ins = el('div', 'g-ins'), outs = el('div', 'g-outs');
      for (const p of def.inputs || []) ins.append(this.makePin(node, 'in', p));
      for (const p of def.outputs || []) outs.append(this.makePin(node, 'out', p));
      pins.append(ins, outs);
      box.append(pins);

      const body = el('div', 'g-body');
      for (const p of def.params || []) body.append(this.makeParam(node, p));
      box.append(body);
      if (this.renderExtra) this.renderExtra(node, body);
      if (!body.children.length) body.remove();

      head.addEventListener('pointerdown', (e) => this.startNodeDrag(e, node));
      box.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (!e.target.closest('input,textarea,select,button,.g-pin')) this.select(data.id, e.shiftKey);
      });
      box.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.select(data.id);
        this.openNodeMenu(node, e.clientX, e.clientY);
      });
      box.style.transform = `translate(${data.x}px, ${data.y}px)`;
      node.el = box;
      this.layer.append(box);
    }

    makePin(node, dir, p) {
      const row = el('div', 'g-pinrow ' + dir);
      const dot = el('span', 'g-pin');
      dot.dataset.dir = dir;
      dot.dataset.port = p.name;
      dot.dataset.kind = p.type || 'any';
      dot.style.setProperty('--pc', this.pinColor(p.type));
      if (p.type === 'exec') dot.classList.add('exec');
      const label = el('span', 'g-pinlabel', p.label || '');
      if (dir === 'in') row.append(dot, label); else row.append(label, dot);
      node.pins[dir + ':' + p.name] = dot;
      dot.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (e.button !== 0) return;
        if (e.altKey) { this.disconnect(node.data.id, dir, p.name); return; }
        this.startWire(e, node, dir, p);
      });
      return row;
    }

    makeParam(node, p) {
      const wrap = el('label', 'g-param');
      const v = node.data.params[p.key];
      let input;
      const set = (val, structural) => {
        node.data.params[p.key] = val;
        if (this.onParam) this.onParam(node, p.key, val);
        this.changed(!!structural);
      };
      if (p.kind === 'select') {
        input = el('select');
        for (const [val, text] of p.options) { const o = el('option', null, text); o.value = val; input.append(o); }
        input.value = v;
        input.addEventListener('change', () => set(input.value, true));
      } else if (p.kind === 'range') {
        input = el('input');
        input.type = 'range'; input.min = p.min; input.max = p.max; input.step = p.step || 0.01; input.value = v;
        const out = el('output', null, fmt(v));
        input.addEventListener('input', () => { out.textContent = fmt(Number(input.value)); set(Number(input.value), !!p.structural); });
        wrap.append(el('span', 'g-plabel', p.label), input, out);
        wrap.classList.add('range');
        stopDrag(input);
        return wrap;
      } else if (p.kind === 'color') {
        input = el('input'); input.type = 'color'; input.value = v;
        input.addEventListener('input', () => set(input.value, false));
      } else if (p.kind === 'textarea') {
        input = el('textarea'); input.value = v; input.spellcheck = false; input.rows = p.rows || 6;
        let t; input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => set(input.value, true), 400); });
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Tab') { e.preventDefault(); const s = input.selectionStart; input.setRangeText('  ', s, input.selectionEnd, 'end'); }
        });
      } else if (p.kind === 'check') {
        input = el('input'); input.type = 'checkbox'; input.checked = !!v;
        input.addEventListener('change', () => set(input.checked, true));
        wrap.classList.add('check');
        wrap.append(input, el('span', 'g-plabel', p.label));
        return wrap;
      } else if (p.kind === 'number') {
        input = el('input'); input.type = 'number'; input.value = v;
        if (p.min != null) input.min = p.min; if (p.max != null) input.max = p.max; if (p.step) input.step = p.step;
        input.addEventListener('change', () => {
          let n = Number(input.value);
          if (!Number.isFinite(n)) n = p.default;
          if (p.min != null) n = Math.max(p.min, n); if (p.max != null) n = Math.min(p.max, n);
          input.value = n; set(n, true);
        });
      } else {
        input = el('input'); input.type = 'text'; input.value = v == null ? '' : v; input.placeholder = p.placeholder || '';
        input.spellcheck = false;
        input.addEventListener('change', () => set(input.value.trim(), true));
        input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') input.blur(); });
      }
      stopDrag(input);
      if (p.label) wrap.append(el('span', 'g-plabel', p.label));
      wrap.append(input);
      return wrap;
    }

    removeNode(id) {
      const n = this.nodes.get(id);
      if (!n) return;
      n.el.remove();
      this.nodes.delete(id);
      this.links = this.links.filter(l => l.from.node !== id && l.to.node !== id);
      this.selected.delete(id);
    }

    deleteSelected() {
      if (!this.selected.size) return;
      for (const id of [...this.selected]) this.removeNode(id);
      this.redrawWires();
      this.changed();
    }

    duplicateSelected() {
      const ids = [...this.selected];
      if (!ids.length) return;
      this.selected.clear();
      for (const id of ids) {
        const n = this.nodes.get(id);
        if (!n || n.def.single) continue;
        const c = this.addNode(n.data.type, n.data.x + 40, n.data.y + 40, JSON.parse(JSON.stringify(n.data.params)), null, true);
        this.selected.add(c.data.id);
      }
      this.refreshSelection();
      this.changed();
    }

    select(id, add) {
      if (!add) this.selected.clear();
      if (id) this.selected.add(id);
      this.refreshSelection();
    }
    refreshSelection() { for (const n of this.nodes.values()) n.el.classList.toggle('sel', this.selected.has(n.data.id)); }

    // ------------------------------------------------------------ Verbindungen
    connect(from, to) {
      if (from.node === to.node) return false;
      const fn = this.nodes.get(from.node), tn = this.nodes.get(to.node);
      if (!fn || !tn) return false;
      const op = (fn.def.outputs || []).find(p => p.name === from.port);
      const ip = (tn.def.inputs || []).find(p => p.name === to.port);
      if (!op || !ip) return false;
      if (op.type && ip.type && op.type !== ip.type) return false;
      if (this.wouldCycle(from.node, to.node)) return false;
      if (ip.type === 'exec') {
        // Ausführungs-Pins: ein Ausgang führt zu genau einem Ziel, ein Eingang darf mehrere Quellen haben
        this.links = this.links.filter(l => !(l.from.node === from.node && l.from.port === from.port));
      } else {
        // Daten-Pins: ein Eingang hat genau eine Quelle
        this.links = this.links.filter(l => !(l.to.node === to.node && l.to.port === to.port));
      }
      this.links.push({ from: { ...from }, to: { ...to } });
      this.redrawWires();
      this.changed();
      return true;
    }

    wouldCycle(fromNode, toNode) {
      // gibt es schon einen Weg von toNode zurück zu fromNode?
      const seen = new Set();
      const stack = [toNode];
      while (stack.length) {
        const cur = stack.pop();
        if (cur === fromNode) return true;
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const l of this.links) if (l.from.node === cur) stack.push(l.to.node);
      }
      return false;
    }

    disconnect(nodeId, dir, port) {
      const before = this.links.length;
      this.links = this.links.filter(l => dir === 'in' ? !(l.to.node === nodeId && l.to.port === port) : !(l.from.node === nodeId && l.from.port === port));
      if (this.links.length !== before) { this.redrawWires(); this.changed(); }
    }

    pinPos(nodeId, dir, port) {
      const n = this.nodes.get(nodeId);
      const pin = n && n.pins[dir + ':' + port];
      if (!pin) return null;
      const r = pin.getBoundingClientRect();
      const s = this.stage.getBoundingClientRect();
      return { x: (r.left + r.width / 2 - s.left) / this.view.z, y: (r.top + r.height / 2 - s.top) / this.view.z };
    }

    wirePath(a, b) {
      const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
      return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
    }

    redrawWires() {
      this.svg.replaceChildren();
      for (const n of this.nodes.values()) for (const pin of Object.values(n.pins)) pin.classList.remove('linked');
      for (const l of this.links) {
        const a = this.pinPos(l.from.node, 'out', l.from.port);
        const b = this.pinPos(l.to.node, 'in', l.to.port);
        if (!a || !b) continue;
        const fn = this.nodes.get(l.from.node);
        const op = (fn.def.outputs || []).find(p => p.name === l.from.port) || {};
        const path = document.createElementNS(SVGNS, 'path');
        path.setAttribute('d', this.wirePath(a, b));
        path.setAttribute('stroke', this.pinColor(op.type));
        if (op.type === 'exec') path.classList.add('exec');
        path.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          // Klick auf eine Linie trennt sie
          this.links = this.links.filter(x => x !== l);
          this.redrawWires();
          this.changed();
        });
        const t = document.createElementNS(SVGNS, 'title');
        t.textContent = 'Klicken zum Trennen';
        path.append(t);
        this.svg.append(path);
        fn.pins['out:' + l.from.port].classList.add('linked');
        this.nodes.get(l.to.node).pins['in:' + l.to.port].classList.add('linked');
      }
    }

    startWire(e, node, dir, p) {
      const start = this.pinPos(node.data.id, dir, p.name);
      const temp = document.createElementNS(SVGNS, 'path');
      temp.classList.add('temp');
      temp.setAttribute('stroke', this.pinColor(p.type));
      this.svg.append(temp);
      const move = (ev) => {
        const pt = this.toStage(ev.clientX, ev.clientY);
        temp.setAttribute('d', dir === 'out' ? this.wirePath(start, pt) : this.wirePath(pt, start));
      };
      const up = (ev) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        temp.remove();
        const target = document.elementFromPoint(ev.clientX, ev.clientY);
        const pin = target && target.closest && target.closest('.g-pin');
        if (pin && pin.dataset.dir !== dir) {
          const other = pin.closest('.g-node').dataset.id;
          if (dir === 'out') this.connect({ node: node.data.id, port: p.name }, { node: other, port: pin.dataset.port });
          else this.connect({ node: other, port: pin.dataset.port }, { node: node.data.id, port: p.name });
        } else if (!pin) {
          // ins Leere gezogen: passenden Node vorschlagen und gleich verbinden
          this.openAddMenu(ev.clientX, ev.clientY, { node: node.data.id, dir, port: p.name, type: p.type });
        }
      };
      move(e);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }

    // ------------------------------------------------------------ Ziehen, Zoomen
    toStage(cx, cy) {
      const s = this.stage.getBoundingClientRect();
      return { x: (cx - s.left) / this.view.z, y: (cy - s.top) / this.view.z };
    }

    startNodeDrag(e, node) {
      if (e.button !== 0) return;
      e.preventDefault();
      if (!this.selected.has(node.data.id)) this.select(node.data.id, e.shiftKey);
      const start = { x: e.clientX, y: e.clientY };
      const items = [...this.selected].map(id => this.nodes.get(id)).filter(Boolean).map(n => ({ n, x: n.data.x, y: n.data.y }));
      let moved = false;
      const move = (ev) => {
        const dx = (ev.clientX - start.x) / this.view.z, dy = (ev.clientY - start.y) / this.view.z;
        if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
        for (const it of items) {
          it.n.data.x = Math.round((it.x + dx) / 8) * 8;
          it.n.data.y = Math.round((it.y + dy) / 8) * 8;
          it.n.el.style.transform = `translate(${it.n.data.x}px, ${it.n.data.y}px)`;
        }
        this.redrawWires();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (moved) this.changed(false);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }

    onBgDown(e) {
      if (e.target.closest('.g-node') || e.target.closest('.g-menu')) return;
      if (e.target.closest('path')) return;
      this.closeMenu();
      this.root.focus({ preventScroll: true });
      if (e.button === 0 && !e.shiftKey) this.select(null);
      if (e.button !== 0 && e.button !== 1) return;
      const start = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y };
      this.root.classList.add('panning');
      const move = (ev) => {
        this.view.x = start.vx + (ev.clientX - start.x);
        this.view.y = start.vy + (ev.clientY - start.y);
        this.applyView();
      };
      const up = () => {
        this.root.classList.remove('panning');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        this.changed(false);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }

    onWheel(e) {
      if (e.target.closest('textarea, select, .g-menu')) return;
      e.preventDefault();
      const r = this.root.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const z0 = this.view.z;
      const z = Math.min(2, Math.max(0.3, z0 * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      this.view.x = mx - (mx - this.view.x) * (z / z0);
      this.view.y = my - (my - this.view.y) * (z / z0);
      this.view.z = z;
      this.applyView();
    }

    applyView() {
      this.stage.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.z})`;
      this.root.style.backgroundPosition = `${this.view.x}px ${this.view.y}px`;
      this.root.style.backgroundSize = `${24 * this.view.z}px ${24 * this.view.z}px, ${120 * this.view.z}px ${120 * this.view.z}px`;
    }

    // Alles ins Bild holen
    fit() {
      const ns = [...this.nodes.values()];
      if (!ns.length) { this.view = { x: 40, y: 40, z: 1 }; this.applyView(); return; }
      const minX = Math.min(...ns.map(n => n.data.x)), minY = Math.min(...ns.map(n => n.data.y));
      const maxX = Math.max(...ns.map(n => n.data.x + n.el.offsetWidth)), maxY = Math.max(...ns.map(n => n.data.y + n.el.offsetHeight));
      const r = this.root.getBoundingClientRect();
      const z = Math.min(1.2, Math.max(0.3, Math.min((r.width - 80) / (maxX - minX || 1), (r.height - 80) / (maxY - minY || 1))));
      this.view = { z, x: (r.width - (maxX - minX) * z) / 2 - minX * z, y: (r.height - (maxY - minY) * z) / 2 - minY * z };
      this.applyView();
      this.redrawWires();
    }

    onKey(e) {
      if (e.target.closest('input, textarea, select')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.deleteSelected(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); this.duplicateSelected(); }
      else if (e.key === ' ' || e.key === 'Tab') {
        e.preventDefault();
        const r = this.root.getBoundingClientRect();
        this.openAddMenu(this.lastMouse ? this.lastMouse.x : r.left + r.width / 2, this.lastMouse ? this.lastMouse.y : r.top + r.height / 2);
      } else if (e.key === 'Escape') this.closeMenu();
      else if (e.key.toLowerCase() === 'f') this.fit();
    }

    // ------------------------------------------------------------ Menüs
    closeMenu() { if (this.menu) { this.menu.remove(); this.menu = null; } }

    openAddMenu(cx, cy, pending) {
      this.closeMenu();
      const menu = el('div', 'g-menu');
      const search = el('input', 'g-msearch');
      search.placeholder = 'Node suchen …';
      const list = el('div', 'g-mlist');
      menu.append(search, list);
      const pos = this.toStage(cx, cy);
      const entries = Object.entries(this.catalog).filter(([, d]) => !d.hidden).filter(([, d]) => {
        if (!pending) return true;
        const pins = pending.dir === 'out' ? (d.inputs || []) : (d.outputs || []);
        return pins.some(p => !pending.type || !p.type || p.type === pending.type);
      });
      let active = 0;
      const render = () => {
        list.replaceChildren();
        const q = search.value.trim().toLowerCase();
        const groups = {};
        const shown = [];
        for (const [type, d] of entries) {
          if (q && !(d.title.toLowerCase().includes(q) || (d.category || '').toLowerCase().includes(q) || (d.keywords || '').includes(q))) continue;
          (groups[d.category || 'Sonstiges'] = groups[d.category || 'Sonstiges'] || []).push([type, d]);
        }
        for (const [cat, items] of Object.entries(groups)) {
          list.append(el('div', 'g-mcat', cat));
          for (const [type, d] of items) {
            const b = el('button', 'g-mitem');
            b.type = 'button';
            const sw = el('i'); sw.style.background = d.color || '#555';
            b.append(sw, el('span', null, d.title));
            if (d.description) b.title = d.description;
            b.addEventListener('click', () => pick(type));
            shown.push(b);
            list.append(b);
          }
        }
        active = Math.min(active, shown.length - 1);
        shown.forEach((b, i) => b.classList.toggle('on', i === active));
        menu._shown = shown;
      };
      const pick = (type) => {
        const n = this.addNode(type, Math.round(pos.x / 8) * 8, Math.round(pos.y / 8) * 8);
        this.closeMenu();
        if (n && pending) {
          const pins = pending.dir === 'out' ? (n.def.inputs || []) : (n.def.outputs || []);
          const p = pins.find(x => !pending.type || !x.type || x.type === pending.type);
          if (p) {
            if (pending.dir === 'out') this.connect({ node: pending.node, port: pending.port }, { node: n.data.id, port: p.name });
            else this.connect({ node: n.data.id, port: p.name }, { node: pending.node, port: pending.port });
          }
        }
        this.root.focus({ preventScroll: true });
      };
      search.addEventListener('input', () => { active = 0; render(); });
      search.addEventListener('keydown', (e) => {
        e.stopPropagation();
        const shown = menu._shown || [];
        if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(shown.length - 1, active + 1); shown.forEach((b, i) => b.classList.toggle('on', i === active)); shown[active] && shown[active].scrollIntoView({ block: 'nearest' }); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); shown.forEach((b, i) => b.classList.toggle('on', i === active)); shown[active] && shown[active].scrollIntoView({ block: 'nearest' }); }
        else if (e.key === 'Enter') { e.preventDefault(); shown[active] && shown[active].click(); }
        else if (e.key === 'Escape') this.closeMenu();
      });
      render();
      const r = this.root.getBoundingClientRect();
      menu.style.left = Math.min(cx - r.left, r.width - 270) + 'px';
      menu.style.top = Math.min(cy - r.top, r.height - 380) + 'px';
      this.root.append(menu);
      this.menu = menu;
      search.focus();
    }

    openNodeMenu(node, cx, cy) {
      this.closeMenu();
      const menu = el('div', 'g-menu small');
      const items = [
        ['Duplizieren (Strg+D)', () => this.duplicateSelected(), !node.def.single],
        ['Alle Verbindungen trennen', () => { this.links = this.links.filter(l => l.from.node !== node.data.id && l.to.node !== node.data.id); this.redrawWires(); this.changed(); }, true],
        ['Löschen (Entf)', () => this.deleteSelected(), !node.def.undeletable]
      ];
      for (const [text, fn, ok] of items) {
        const b = el('button', 'g-mitem', text);
        b.type = 'button';
        b.disabled = !ok;
        b.addEventListener('click', () => { this.closeMenu(); fn(); });
        menu.append(b);
      }
      const r = this.root.getBoundingClientRect();
      menu.style.left = (cx - r.left) + 'px';
      menu.style.top = (cy - r.top) + 'px';
      this.root.append(menu);
      this.menu = menu;
    }
  }

  function fmt(v) { return Math.abs(v) >= 100 ? String(Math.round(v)) : (Math.round(v * 100) / 100).toString(); }
  function stopDrag(input) { input.addEventListener('pointerdown', (e) => e.stopPropagation()); }

  document.addEventListener('pointermove', (e) => { for (const g of GraphEditor.all) g.lastMouse = { x: e.clientX, y: e.clientY }; });
  GraphEditor.all = [];
  const Orig = GraphEditor;
  window.GraphEditor = function (root, opts) { const g = new Orig(root, opts); Orig.all.push(g); return g; };
})();
