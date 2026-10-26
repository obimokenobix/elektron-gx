'use strict';
/*
 * Elektron Studio – Shader & Bilder.
 * Jeder Node wird zu einer GLSL-Funktion  vec4 n_ID(vec2 uv)  – verbundene Nodes rufen sich
 * gegenseitig auf. Daraus entsteht ein einziger Fragment-Shader, der live mit WebGL 2 läuft.
 */
(function () {
  const C = { src: '#2f7d4f', fx: '#3a5fb0', mix: '#8a4bc4', code: '#b5702a', out: '#c0283d' };
  const IMG = (name = 'in', label = 'Bild') => ({ name, label, type: 'img' });
  const OUT = [{ name: 'out', label: 'Bild', type: 'img' }];
  const r = (key, label, min, max, def, step) => ({ key, label, kind: 'range', min, max, default: def, step: step || 0.01 });

  const CATALOG = {
    // ---------------------------------------------------------- Quellen
    image_url: {
      title: 'Bild aus dem Internet', category: 'Quellen', color: C.src, outputs: OUT, width: 240, keywords: 'url web foto',
      params: [
        { key: 'url', label: 'Bild-Adresse (https://…)', kind: 'text', default: '', placeholder: 'https://… .jpg / .png / .webp' },
        { key: 'fit', label: 'Einpassen', kind: 'select', default: 'cover', options: [['cover', 'Ausfüllen'], ['contain', 'Ganz zeigen'], ['stretch', 'Strecken']] }
      ], description: 'Lädt ein Bild aus dem Internet'
    },
    image_file: {
      title: 'Bild vom PC', category: 'Quellen', color: C.src, outputs: OUT, width: 220, keywords: 'datei foto upload',
      params: [{ key: 'fit', label: 'Einpassen', kind: 'select', default: 'cover', options: [['cover', 'Ausfüllen'], ['contain', 'Ganz zeigen'], ['stretch', 'Strecken']] }]
    },
    color: { title: 'Farbe', category: 'Quellen', color: C.src, outputs: OUT, width: 170,
      params: [{ key: 'c', label: 'Farbe', kind: 'color', default: '#ff2b4e' }, r('a', 'Deckkraft', 0, 1, 1)] },
    gradient: { title: 'Verlauf', category: 'Quellen', color: C.src, outputs: OUT, width: 200,
      params: [{ key: 'c1', label: 'Farbe 1', kind: 'color', default: '#12002b' }, { key: 'c2', label: 'Farbe 2', kind: 'color', default: '#ff2b4e' },
        { key: 'mode', label: 'Art', kind: 'select', default: 'linear', options: [['linear', 'Linear'], ['radial', 'Kreis']] }, r('angle', 'Winkel', 0, 360, 90, 1)] },
    noise: { title: 'Rauschen / Wolken', category: 'Quellen', color: C.src, outputs: OUT, width: 200, keywords: 'noise fbm',
      params: [r('scale', 'Größe', 0.5, 20, 4), r('speed', 'Bewegung', 0, 2, 0.2), r('detail', 'Details', 1, 6, 4, 1),
        { key: 'c1', label: 'Dunkel', kind: 'color', default: '#000000' }, { key: 'c2', label: 'Hell', kind: 'color', default: '#ffffff' }] },
    pattern: { title: 'Muster', category: 'Quellen', color: C.src, outputs: OUT, width: 200,
      params: [{ key: 'kind', label: 'Muster', kind: 'select', default: 'grid', options: [['grid', 'Gitter'], ['checker', 'Schachbrett'], ['stripes', 'Streifen'], ['dots', 'Punkte'], ['hex', 'Waben']] },
        r('scale', 'Größe', 2, 60, 12), r('width', 'Linienbreite', 0.01, 0.5, 0.06), { key: 'c1', label: 'Farbe', kind: 'color', default: '#ff2b4e' }, { key: 'c2', label: 'Hintergrund', kind: 'color', default: '#0b0b0f' }] },
    plasma: { title: 'Plasma (bunt, animiert)', category: 'Quellen', color: C.src, outputs: OUT, width: 200,
      params: [r('speed', 'Tempo', 0, 3, 1), r('scale', 'Größe', 1, 20, 6)] },

    // ---------------------------------------------------------- Effekte
    adjust: { title: 'Helligkeit & Kontrast', category: 'Effekte', color: C.fx, inputs: [IMG()], outputs: OUT, width: 210,
      params: [r('b', 'Helligkeit', -1, 1, 0), r('c', 'Kontrast', 0, 3, 1), r('s', 'Sättigung', 0, 3, 1), r('g', 'Gamma', 0.2, 3, 1)] },
    hue: { title: 'Farbton drehen', category: 'Effekte', color: C.fx, inputs: [IMG()], outputs: OUT, width: 200,
      params: [r('deg', 'Drehung (°)', 0, 360, 0, 1), r('speed', 'Animiert', 0, 2, 0)] },
    tint: { title: 'Einfärben', category: 'Effekte', color: C.fx, inputs: [IMG()], outputs: OUT, width: 190,
      params: [{ key: 'c', label: 'Farbe', kind: 'color', default: '#ff2b4e' }, r('amt', 'Stärke', 0, 1, 0.5)] },
    gray: { title: 'Schwarz-Weiß', category: 'Effekte', color: C.fx, inputs: [IMG()], outputs: OUT, width: 170, params: [] },
    invert: { title: 'Invertieren', category: 'Effekte', color: C.fx, inputs: [IMG()], outputs: OUT, width: 170, params: [] },
    blur: { title: 'Unschärfe', category: 'Effekte', color: C.fx, inputs: [IMG()], outputs: OUT, width: 190, params: [r('rad', 'Stärke', 0, 0.05, 0.01, 0.001)] },
    pixel: { title: 'Pixel', category: 'Effekte', color: C.fx, inputs: [IMG()], outputs: OUT, width: 170, params: [r('size', 'Pixelgröße', 2, 80, 16, 1)] },
    rgbsplit: { title: 'RGB-Versatz (Glitch)', category: 'Effekte', color: C.fx, inputs: [IMG()], outputs: OUT, width: 200,
      params: [r('amt', 'Versatz', 0, 0.05, 0.008, 0.001), r('glitch', 'Störung', 0, 1, 0.3)] },
    wave: { title: 'Wellen', category: 'Effekte', color: C.fx, inputs: [IMG()], outputs: OUT, width: 190,
      params: [r('amp', 'Stärke', 0, 0.1, 0.02, 0.001), r('freq', 'Dichte', 1, 60, 12), r('speed', 'Tempo', 0, 5, 1)] },
    vignette: { title: 'Vignette', category: 'Effekte', color: C.fx, inputs: [IMG()], outputs: OUT, width: 180, params: [r('amt', 'Stärke', 0, 2, 0.8), r('soft', 'Weichheit', 0.1, 1, 0.5)] },
    posterize: { title: 'Comic / Poster', category: 'Effekte', color: C.fx, inputs: [IMG()], outputs: OUT, width: 180, params: [r('levels', 'Stufen', 2, 12, 4, 1)] },
    edges: { title: 'Neon-Kanten', category: 'Effekte', color: C.fx, inputs: [IMG()], outputs: OUT, width: 190,
      params: [r('amt', 'Stärke', 0, 10, 3), { key: 'c', label: 'Farbe', kind: 'color', default: '#00e5ff' }, r('keep', 'Bild behalten', 0, 1, 0.2)] },
    scanlines: { title: 'Retro-Bildschirm', category: 'Effekte', color: C.fx, inputs: [IMG()], outputs: OUT, width: 190, params: [r('lines', 'Zeilen', 50, 800, 300, 1), r('amt', 'Stärke', 0, 1, 0.35)] },
    transform: { title: 'Verschieben / Zoomen / Drehen', category: 'Effekte', color: C.fx, inputs: [IMG()], outputs: OUT, width: 220,
      params: [r('x', 'X', -1, 1, 0), r('y', 'Y', -1, 1, 0), r('zoom', 'Zoom', 0.1, 8, 1), r('rot', 'Drehen (°)', -180, 180, 0, 1), r('spin', 'Dreht sich', -2, 2, 0),
        { key: 'tile', label: 'Wiederholen (Kacheln)', kind: 'check', default: false }] },
    kaleido: { title: 'Kaleidoskop', category: 'Effekte', color: C.fx, inputs: [IMG()], outputs: OUT, width: 180, params: [r('seg', 'Teile', 2, 16, 6, 1), r('spin', 'Dreht sich', -1, 1, 0.1)] },

    // ---------------------------------------------------------- Mischen
    mix: { title: 'Mischen', category: 'Mischen', color: C.mix, inputs: [IMG('a', 'A (unten)'), IMG('b', 'B (oben)')], outputs: OUT, width: 210,
      params: [{ key: 'mode', label: 'Modus', kind: 'select', default: 'normal', options: [['normal', 'Normal'], ['add', 'Addieren (Leuchten)'], ['multiply', 'Multiplizieren'], ['screen', 'Negativ multiplizieren'], ['overlay', 'Überlagern'], ['difference', 'Differenz']] },
        r('amt', 'Stärke', 0, 1, 1)] },
    mask: { title: 'Maske', category: 'Mischen', color: C.mix, inputs: [IMG('a', 'Bild'), IMG('m', 'Maske (hell = sichtbar)')], outputs: OUT, width: 220,
      params: [{ key: 'inv', label: 'Umkehren', kind: 'check', default: false }] },

    // ---------------------------------------------------------- Code
    glsl: { title: 'Eigener Shader (GLSL)', category: 'Code', color: C.code, inputs: [IMG('a', 'a'), IMG('b', 'b')], outputs: OUT, width: 340, keywords: 'code glsl shader',
      params: [{ key: 'code', label: 'vec4 effekt(vec2 uv, vec4 a, vec4 b, float time)', kind: 'textarea', rows: 9,
        default: '// a und b sind die Farben der Eingänge an dieser Stelle.\n// sampleA(uv) / sampleB(uv) lesen woanders.\nvec2 p = uv - 0.5;\nfloat r = length(p);\nfloat ring = sin(r * 40.0 - time * 3.0) * 0.5 + 0.5;\nvec3 neon = mix(vec3(1.0, 0.17, 0.3), vec3(0.0, 0.9, 1.0), ring);\nreturn vec4(mix(a.rgb, neon, 0.35 * ring), 1.0);' }] },

    // ---------------------------------------------------------- Ausgabe
    output: { title: 'Ausgabe', category: 'Ausgabe', color: C.out, inputs: [IMG()], outputs: [], width: 210, single: true, undeletable: true,
      params: [{ key: 'size', label: 'Größe beim Speichern', kind: 'select', default: '1920x1080', options: [['1280x720', '1280 × 720'], ['1920x1080', '1920 × 1080 (Full HD)'], ['2560x1440', '2560 × 1440'], ['3840x2160', '3840 × 2160 (4K)'], ['1080x1080', '1080 × 1080 (quadratisch)'], ['1080x1920', '1080 × 1920 (Handy)']] }] }
  };

  // ---------------------------------------------------------------- GLSL-Bausteine
  const hex = (h) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h || '') || [0, '000000'];
    const n = parseInt(m[1], 16);
    return `vec3(${f(((n >> 16) & 255) / 255)}, ${f(((n >> 8) & 255) / 255)}, ${f((n & 255) / 255)})`;
  };
  const f = (v) => { const n = Number(v); return Number.isFinite(n) ? (Number.isInteger(n) ? n.toFixed(1) : String(n)) : '0.0'; };

  const HEADER = `#version 300 es
precision highp float;
uniform float u_time;
uniform vec2 u_res;
uniform sampler2D u_t0, u_t1, u_t2, u_t3, u_t4, u_t5, u_t6, u_t7;
uniform vec2 u_s0, u_s1, u_s2, u_s3, u_s4, u_s5, u_s6, u_s7;
out vec4 outColor;
const float PI = 3.14159265;
vec4 nz(vec2 uv) { return vec4(0.0); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 hueShift(vec3 c, float a) { const vec3 k = vec3(0.57735); float ca = cos(a); return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca); }
vec2 fitUV(vec2 uv, vec2 tex, int mode) {
  float ra = u_res.x / u_res.y, ta = tex.x / max(tex.y, 1.0);
  if (mode == 2 || tex.x < 1.0) return uv;
  vec2 c = uv - 0.5;
  if (mode == 0) { if (ra > ta) c.y *= ta / ra; else c.x *= ra / ta; }
  else { if (ra > ta) c.x *= ra / ta; else c.y *= ta / ra; }
  return c + 0.5;
}
vec4 tex(sampler2D t, vec2 s, vec2 uv, int mode) {
  vec2 p = fitUV(uv, s, mode);
  if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) return vec4(0.0);
  return texture(t, p);
}
`;

  // Ein Node → Funktionsrumpf. inp(name) liefert den Funktionsnamen des verbundenen Eingangs (oder "nz").
  function body(node, inp, texIndex) {
    const p = node.params;
    const A = inp('in');
    switch (node.type) {
      case 'image_url':
      case 'image_file': {
        if (texIndex < 0) return 'return vec4(0.0);';
        const mode = p.fit === 'contain' ? 1 : p.fit === 'stretch' ? 2 : 0;
        return `return tex(u_t${texIndex}, u_s${texIndex}, uv, ${mode});`;
      }
      case 'color': return `return vec4(${hex(p.c)}, ${f(p.a)});`;
      case 'gradient': return p.mode === 'radial'
        ? `float t = clamp(length((uv - 0.5) * vec2(u_res.x / u_res.y, 1.0)) * 1.4, 0.0, 1.0); return vec4(mix(${hex(p.c1)}, ${hex(p.c2)}, t), 1.0);`
        : `float a = radians(${f(p.angle)}); vec2 d = vec2(cos(a), sin(a)); float t = clamp(dot(uv - 0.5, d) + 0.5, 0.0, 1.0); return vec4(mix(${hex(p.c1)}, ${hex(p.c2)}, t), 1.0);`;
      case 'noise': return `vec2 q = uv * vec2(u_res.x / u_res.y, 1.0) * ${f(p.scale)} + vec2(u_time * ${f(p.speed)}, u_time * ${f(p.speed * 0.7)});
  float v = 0.0, amp = 0.5;
  for (int i = 0; i < ${Math.round(p.detail)}; i++) { v += amp * vnoise(q); q *= 2.03; amp *= 0.5; }
  return vec4(mix(${hex(p.c1)}, ${hex(p.c2)}, clamp(v * 1.15, 0.0, 1.0)), 1.0);`;
      case 'pattern': {
        const k = { grid: `vec2 g = abs(fract(q) - 0.5); float m = step(0.5 - ${f(p.width)}, max(g.x, g.y));`,
          checker: `vec2 g = floor(q); float m = mod(g.x + g.y, 2.0);`,
          stripes: `float m = step(1.0 - ${f(Math.min(0.95, p.width * 4))}, fract(q.x + q.y));`,
          dots: `float m = 1.0 - smoothstep(${f(p.width * 3)}, ${f(p.width * 3 + 0.02)}, length(fract(q) - 0.5));`,
          hex: `vec2 r2 = vec2(1.0, 1.732); vec2 h = r2 * 0.5; vec2 a1 = mod(q, r2) - h; vec2 b1 = mod(q - h, r2) - h; vec2 g = dot(a1, a1) < dot(b1, b1) ? a1 : b1; vec2 ag = abs(g); float d = max(dot(ag, normalize(vec2(1.0, 1.732))), ag.x); float m = step(0.5 - ${f(p.width)}, d);` }[p.kind] || 'float m = 0.0;';
        return `vec2 q = uv * vec2(u_res.x / u_res.y, 1.0) * ${f(p.scale)}; ${k} return vec4(mix(${hex(p.c2)}, ${hex(p.c1)}, m), 1.0);`;
      }
      case 'plasma': return `vec2 q = uv * ${f(p.scale)}; float t = u_time * ${f(p.speed)};
  float v = sin(q.x + t) + sin(q.y + t * 1.3) + sin(q.x + q.y + t * 0.7) + sin(length(q - ${f(p.scale / 2)}) * 1.5 - t);
  return vec4(0.5 + 0.5 * cos(v + vec3(0.0, 2.1, 4.2)), 1.0);`;

      case 'adjust': return `vec4 c = ${A}(uv); vec3 x = c.rgb + ${f(p.b)}; x = (x - 0.5) * ${f(p.c)} + 0.5; x = mix(vec3(luma(x)), x, ${f(p.s)}); x = pow(max(x, 0.0), vec3(1.0 / ${f(p.g)})); return vec4(clamp(x, 0.0, 1.0), c.a);`;
      case 'hue': return `vec4 c = ${A}(uv); return vec4(clamp(hueShift(c.rgb, radians(${f(p.deg)}) + u_time * ${f(p.speed)}), 0.0, 1.0), c.a);`;
      case 'tint': return `vec4 c = ${A}(uv); return vec4(mix(c.rgb, luma(c.rgb) * ${hex(p.c)} * 1.6, ${f(p.amt)}), c.a);`;
      case 'gray': return `vec4 c = ${A}(uv); return vec4(vec3(luma(c.rgb)), c.a);`;
      case 'invert': return `vec4 c = ${A}(uv); return vec4(1.0 - c.rgb, c.a);`;
      case 'blur': return `vec4 s = vec4(0.0); float w = 0.0; vec2 k = vec2(${f(p.rad)}) * vec2(u_res.y / u_res.x, 1.0);
  for (int i = -3; i <= 3; i++) for (int j = -3; j <= 3; j++) { float g = exp(-float(i * i + j * j) / 8.0); s += ${A}(uv + vec2(i, j) * k / 3.0) * g; w += g; }
  return s / w;`;
      case 'pixel': return `vec2 n = u_res / ${f(p.size)}; return ${A}((floor(uv * n) + 0.5) / n);`;
      case 'rgbsplit': return `float g = step(1.0 - ${f(p.glitch * 0.3)}, hash(vec2(floor(uv.y * 40.0), floor(u_time * 12.0))));
  float o = ${f(p.amt)} * (1.0 + g * 6.0) * (0.6 + 0.4 * sin(u_time * 3.0));
  vec4 c = ${A}(uv + vec2(g * 0.02, 0.0));
  return vec4(${A}(uv + vec2(o, 0.0)).r, c.g, ${A}(uv - vec2(o, 0.0)).b, c.a);`;
      case 'wave': return `return ${A}(uv + vec2(sin(uv.y * ${f(p.freq)} + u_time * ${f(p.speed)}), cos(uv.x * ${f(p.freq)} + u_time * ${f(p.speed)})) * ${f(p.amp)});`;
      case 'vignette': return `vec4 c = ${A}(uv); float d = length((uv - 0.5) * vec2(u_res.x / u_res.y, 1.0)); return vec4(c.rgb * (1.0 - smoothstep(${f(0.8 - p.soft * 0.6)}, ${f(1.1 - p.soft * 0.2)}, d) * ${f(Math.min(p.amt, 1))}) * (1.0 - max(0.0, ${f(p.amt - 1)}) * d), c.a);`;
      case 'posterize': return `vec4 c = ${A}(uv); return vec4(floor(c.rgb * ${f(p.levels)} + 0.5) / ${f(p.levels)}, c.a);`;
      case 'edges': return `vec2 e = 1.0 / u_res;
  float tl = luma(${A}(uv + vec2(-e.x, e.y)).rgb), t = luma(${A}(uv + vec2(0, e.y)).rgb), tr = luma(${A}(uv + e).rgb);
  float l = luma(${A}(uv - vec2(e.x, 0)).rgb), r = luma(${A}(uv + vec2(e.x, 0)).rgb);
  float bl = luma(${A}(uv - e).rgb), b = luma(${A}(uv - vec2(0, e.y)).rgb), br = luma(${A}(uv + vec2(e.x, -e.y)).rgb);
  float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br, gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
  float m = clamp(length(vec2(gx, gy)) * ${f(p.amt)}, 0.0, 1.0); vec4 c = ${A}(uv);
  return vec4(c.rgb * ${f(p.keep)} + ${hex(p.c)} * m, max(c.a, m));`;
      case 'scanlines': return `vec4 c = ${A}(uv); float s = 0.5 + 0.5 * sin(uv.y * ${f(p.lines)} * PI); return vec4(c.rgb * (1.0 - ${f(p.amt)} * s), c.a);`;
      case 'transform': return `vec2 q = uv - 0.5; q.x *= u_res.x / u_res.y; float a = radians(${f(p.rot)}) + u_time * ${f(p.spin)};
  q = mat2(cos(a), -sin(a), sin(a), cos(a)) * q / ${f(p.zoom)}; q.x /= u_res.x / u_res.y; q += 0.5 - vec2(${f(p.x)}, ${f(p.y)}) * 0.5;
  ${p.tile ? 'q = fract(q);' : ''} return ${A}(q);`;
      case 'kaleido': return `vec2 q = uv - 0.5; q.x *= u_res.x / u_res.y; float a = atan(q.y, q.x) + u_time * ${f(p.spin)}; float r = length(q);
  float s = 2.0 * PI / ${f(p.seg)}; a = mod(a, s); a = abs(a - s / 2.0);
  q = r * vec2(cos(a), sin(a)); q.x /= u_res.x / u_res.y; return ${A}(q + 0.5);`;

      case 'mix': {
        const B = inp('b'), Aa = inp('a');
        const m = { normal: 'b.rgb', add: 'a.rgb + b.rgb', multiply: 'a.rgb * b.rgb', screen: '1.0 - (1.0 - a.rgb) * (1.0 - b.rgb)',
          overlay: 'mix(2.0 * a.rgb * b.rgb, 1.0 - 2.0 * (1.0 - a.rgb) * (1.0 - b.rgb), step(0.5, a.rgb))', difference: 'abs(a.rgb - b.rgb)' }[p.mode] || 'b.rgb';
        return `vec4 a = ${Aa}(uv), b = ${B}(uv); vec3 c = clamp(${m}, 0.0, 1.0); float k = b.a * ${f(p.amt)}; return vec4(mix(a.rgb, c, k), max(a.a, k));`;
      }
      case 'mask': { const Aa = inp('a'), M = inp('m');
        return `vec4 c = ${Aa}(uv); float m = luma(${M}(uv).rgb) * ${M}(uv).a; ${p.inv ? 'm = 1.0 - m;' : ''} return vec4(c.rgb, c.a * m);`; }
      case 'glsl': {
        const fa = inp('a'), fb = inp('b');
        const code = String(p.code || 'return a;').replace(/\bsampleA\s*\(/g, fa + '(').replace(/\bsampleB\s*\(/g, fb + '(');
        return `vec4 a = ${fa}(uv); vec4 b = ${fb}(uv); float time = u_time;\n{\n${code}\n}\nreturn a;`;
      }
      case 'output': return `return ${A}(uv);`;
    }
    return 'return vec4(1.0, 0.0, 1.0, 1.0);';
  }

  /** Baut aus dem Graphen den Shader. Gibt { source, textures: [nodeId], usesTime, lineMap } zurück. */
  function compile(graph) {
    const nodes = new Map(graph.nodes.map(n => [n.id, n]));
    const out = graph.nodes.find(n => n.type === 'output');
    if (!out) return { error: 'Es fehlt der Node „Ausgabe“.' };
    const incoming = (id, port) => { const l = graph.links.find(x => x.to.node === id && x.to.port === port); return l ? l.from.node : null; };
    const order = [];
    const seen = new Set();
    const visit = (id, depth) => {
      if (seen.has(id) || depth > 64) return;
      seen.add(id);
      const n = nodes.get(id);
      if (!n) return;
      for (const l of graph.links) if (l.to.node === id) visit(l.from.node, depth + 1);
      order.push(n);
    };
    visit(out.id, 0);
    const textures = [];
    let src = HEADER;
    const lineMap = [];
    let usesTime = false;
    for (const n of order) {
      let ti = -1;
      if (n.type === 'image_url' || n.type === 'image_file') { if (textures.length < 8) { ti = textures.length; textures.push(n.id); } }
      const inp = (port) => { const from = incoming(n.id, port); return from && nodes.has(from) ? 'n_' + safe(from) : 'nz'; };
      const b = body(n, inp, ti);
      if (/u_time|time/.test(b)) usesTime = true;
      const start = src.split('\n').length;
      src += `vec4 n_${safe(n.id)}(vec2 uv) {\n${b}\n}\n`;
      lineMap.push({ id: n.id, from: start, to: src.split('\n').length });
    }
    src += `void main() { vec2 uv = gl_FragCoord.xy / u_res; vec4 c = n_${safe(out.id)}(uv); outColor = vec4(c.rgb * c.a, c.a); }\n`;
    return { source: src, textures, usesTime, lineMap };
  }
  const safe = (id) => String(id).replace(/[^a-zA-Z0-9_]/g, '_');

  // ---------------------------------------------------------------- WebGL-Vorschau
  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, alpha: true });
      this.textures = new Map(); // nodeId -> { tex, w, h }
      this.prog = null;
      this.start = performance.now();
      this.time = 0;
      if (!this.gl) return;
      const gl = this.gl;
      this.vs = this.shader(gl.VERTEX_SHADER, '#version 300 es\nin vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }');
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    }
    shader(type, src) {
      const gl = this.gl;
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(log); }
      return s;
    }
    use(compiled) {
      const gl = this.gl;
      if (!gl) throw new Error('WebGL 2 ist auf diesem PC nicht verfügbar.');
      const fs = this.shader(gl.FRAGMENT_SHADER, compiled.source);
      const prog = gl.createProgram();
      gl.attachShader(prog, this.vs); gl.attachShader(prog, fs);
      gl.bindAttribLocation(prog, 0, 'p');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      if (this.prog) gl.deleteProgram(this.prog);
      this.prog = prog;
      this.compiled = compiled;
      this.loc = { time: gl.getUniformLocation(prog, 'u_time'), res: gl.getUniformLocation(prog, 'u_res') };
    }
    setImage(nodeId, img) {
      const gl = this.gl;
      if (!gl) return;
      let t = this.textures.get(nodeId);
      if (!t) { t = { tex: gl.createTexture() }; this.textures.set(nodeId, t); }
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      t.w = img.naturalWidth || img.width; t.h = img.naturalHeight || img.height;
    }
    dropImage(nodeId) { const t = this.textures.get(nodeId); if (t && this.gl) this.gl.deleteTexture(t.tex); this.textures.delete(nodeId); }
    draw(w, h, time) {
      const gl = this.gl;
      if (!gl || !this.prog) return;
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.prog);
      gl.uniform1f(this.loc.time, time != null ? time : (performance.now() - this.start) / 1000);
      gl.uniform2f(this.loc.res, w, h);
      (this.compiled.textures || []).forEach((id, i) => {
        const t = this.textures.get(id);
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, t ? t.tex : null);
        gl.uniform1i(gl.getUniformLocation(this.prog, 'u_t' + i), i);
        gl.uniform2f(gl.getUniformLocation(this.prog, 'u_s' + i), t ? t.w : 0, t ? t.h : 0);
      });
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  // Fehlermeldung des Grafiktreibers dem richtigen Node zuordnen
  function errorNode(compiled, log) {
    const m = /ERROR:\s*\d+:(\d+)/.exec(log || '');
    if (!m || !compiled.lineMap) return null;
    const line = Number(m[1]);
    const hit = compiled.lineMap.find(x => line >= x.from && line < x.to);
    return hit ? hit.id : null;
  }

  const EXAMPLE = {
    nodes: [
      { id: 'src', type: 'noise', x: 40, y: 60, params: { scale: 3, speed: 0.15, detail: 5, c1: '#05010f', c2: '#7a1fff' } },
      { id: 'pat', type: 'pattern', x: 40, y: 380, params: { kind: 'grid', scale: 14, width: 0.03, c1: '#ff2b4e', c2: '#000000' } },
      { id: 'mx', type: 'mix', x: 340, y: 200, params: { mode: 'add', amt: 0.6 } },
      { id: 'glow', type: 'vignette', x: 620, y: 200, params: { amt: 1, soft: 0.6 } },
      { id: 'out', type: 'output', x: 880, y: 200, params: { size: '1920x1080' } }
    ],
    links: [
      { from: { node: 'src', port: 'out' }, to: { node: 'mx', port: 'a' } },
      { from: { node: 'pat', port: 'out' }, to: { node: 'mx', port: 'b' } },
      { from: { node: 'mx', port: 'out' }, to: { node: 'glow', port: 'in' } },
      { from: { node: 'glow', port: 'out' }, to: { node: 'out', port: 'in' } }
    ]
  };

  window.ShaderStudio = { CATALOG, compile, Renderer, errorNode, EXAMPLE };
})();
