/* ============================================================================
 * CERTIFICATION STATION — station.js
 * Classic script. No modules, no imports, no network. file:// safe.
 * Exposes exactly one global: window.Station
 * All persisted keys are prefixed "cs:".
 * ========================================================================= */
(function (global) {
  'use strict';

  var PREFIX = 'cs:';
  var K_XP       = PREFIX + 'xp';
  var K_MUTED    = PREFIX + 'muted';
  var K_PROGRESS = PREFIX + 'progress';
  var K_SCORES   = PREFIX + 'scores';
  var K_STREAK   = PREFIX + 'streak';      // {last:'YYYY-MM-DD', days:N}
  var K_THEME    = PREFIX + 'theme';
  var K_TIER     = PREFIX + 'tier';        // 100|200|300|400|500 (content depth)
  var K_TIERBELOW= PREFIX + 'tierBelow';   // '1' = also show tiers below

  /* ------------------------------------------------------------ storage -- */
  /** In-memory fallback used when localStorage throws (private mode, file:// lockdown). */
  var memory = new Map();
  var lsOk = (function () {
    try {
      var probe = PREFIX + '__probe';
      global.localStorage.setItem(probe, '1');
      global.localStorage.removeItem(probe);
      return true;
    } catch (e) { return false; }
  }());

  /**
   * Read a raw string from storage.
   * @param {string} key fully-qualified key (already prefixed)
   * @param {string|null} [fallback]
   * @returns {string|null}
   */
  function safeGet(key, fallback) {
    var fb = (fallback === undefined) ? null : fallback;
    if (lsOk) {
      try {
        var v = global.localStorage.getItem(key);
        return (v === null) ? fb : v;
      } catch (e) { /* fall through */ }
    }
    return memory.has(key) ? memory.get(key) : fb;
  }

  /**
   * Write a raw string to storage (mirrored into memory so reads never lie).
   * @param {string} key
   * @param {string} value
   * @returns {boolean} true if it reached localStorage
   */
  function safeSet(key, value) {
    var str = String(value);
    memory.set(key, str);
    if (lsOk) {
      try { global.localStorage.setItem(key, str); return true; }
      catch (e) { return false; }
    }
    return false;
  }

  /** Remove a key from both stores. */
  function safeRemove(key) {
    memory.delete(key);
    if (lsOk) { try { global.localStorage.removeItem(key); } catch (e) {} }
  }

  /** JSON-decode a stored value, returning `def` on any problem. */
  function getJSON(key, def) {
    var raw = safeGet(key, null);
    if (raw === null) return def;
    try {
      var parsed = JSON.parse(raw);
      return (parsed === null || parsed === undefined) ? def : parsed;
    } catch (e) { return def; }
  }

  /** JSON-encode and store. */
  function setJSON(key, obj) { return safeSet(key, JSON.stringify(obj)); }

  /** @returns {string[]} every cs:-prefixed key currently known. */
  function allKeys() {
    var keys = [];
    if (lsOk) {
      try {
        for (var i = 0; i < global.localStorage.length; i++) {
          var k = global.localStorage.key(i);
          if (k && k.indexOf(PREFIX) === 0) keys.push(k);
        }
      } catch (e) {}
    }
    memory.forEach(function (_v, k) { if (keys.indexOf(k) === -1) keys.push(k); });
    return keys;
  }

  /* ------------------------------------------------------------- helpers -- */
  function clamp(n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n); }
  function toInt(v, def) { var n = parseInt(v, 10); return isNaN(n) ? def : n; }

  /** Local (not UTC) ISO date string, YYYY-MM-DD. */
  function isoDate(d) {
    var dt = d || new Date();
    var m = dt.getMonth() + 1, day = dt.getDate();
    return dt.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  /** Whole calendar days between two YYYY-MM-DD strings (b - a). */
  function daysBetween(aStr, bStr) {
    var a = aStr.split('-'), b = bStr.split('-');
    var ad = Date.UTC(+a[0], +a[1] - 1, +a[2]);
    var bd = Date.UTC(+b[0], +b[1] - 1, +b[2]);
    return Math.round((bd - ad) / 86400000);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  }

  var prefersReducedMotion = (function () {
    try { return global.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }());

  /* ----------------------------------------------------------------- xp -- */
  /** Level curve: floor(sqrt(xp/100)) + 1. Level N starts at 100*(N-1)^2 XP. */
  function levelFromXp(xp) { return Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1; }
  /** XP required to reach a given level. */
  function xpForLevel(lv) { var n = Math.max(1, lv) - 1; return 100 * n * n; }

  var xp = {
    /** @returns {number} lifetime XP */
    total: function () { return toInt(safeGet(K_XP, '0'), 0); },

    /**
     * Award XP, show a floating "+n" and toast, fire level-up celebration.
     * @param {number} n amount (may be negative, floors at 0)
     * @param {string} [reason] short label shown in the toast
     * @returns {number} new total
     */
    add: function (n, reason) {
      var amount = Math.round(Number(n) || 0);
      var before = xp.total();
      var after = Math.max(0, before + amount);
      safeSet(K_XP, after);

      var lvBefore = levelFromXp(before), lvAfter = levelFromXp(after);
      if (amount !== 0) floatXp(amount, reason);
      Station.hud.refresh();

      if (lvAfter > lvBefore) {
        Station.sfx.levelup();
        Station.confetti();
        Station.toast('LEVEL ' + lvAfter + ' — nice.', 'good');
      }
      return after;
    },

    /** Hard-set XP (used by imports / resets). */
    set: function (n) { safeSet(K_XP, Math.max(0, Math.round(Number(n) || 0))); Station.hud.refresh(); },

    /** @returns {{level:number,xp:number,into:number,need:number,pct:number}} */
    breakdown: function () {
      var t = xp.total(), lv = levelFromXp(t);
      var base = xpForLevel(lv), next = xpForLevel(lv + 1);
      var into = t - base, need = next - base;
      return { level: lv, xp: t, into: into, need: need, pct: need ? clamp(into / need * 100, 0, 100) : 0 };
    }
  };

  /** Floating "+25 XP" marker near the top-right, purely decorative. */
  function floatXp(amount, reason) {
    if (!document.body) return;
    var node = el('div', 'cs-xpfloat', (amount > 0 ? '+' : '') + amount + ' XP');
    if (amount < 0) node.style.color = 'var(--mk-red)';
    node.style.right = (14 + Math.random() * 40) + 'px';
    node.style.top = 'calc(var(--hud-h, 54px) + 12px)';
    document.body.appendChild(node);
    global.setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 1300);
    if (reason) Station.toast(reason, amount >= 0 ? 'good' : 'bad');
  }

  /* ------------------------------------------------------------ progress -- */
  var progress = {
    /** @returns {Object.<string, number>} id -> completion timestamp */
    all: function () { return getJSON(K_PROGRESS, {}); },

    /** Mark a module id complete (idempotent). Awards 50 XP the first time. */
    complete: function (id) {
      if (!id) return false;
      var map = progress.all();
      if (map[id]) return false;
      map[id] = Date.now();
      setJSON(K_PROGRESS, map);
      streak.touch();
      xp.add(50, 'Module complete: ' + id);
      return true;
    },

    /** @returns {boolean} */
    isDone: function (id) { return !!progress.all()[id]; },

    /** Un-mark a module (no XP is clawed back). */
    clear: function (id) {
      var map = progress.all();
      if (!map[id]) return false;
      delete map[id];
      setJSON(K_PROGRESS, map);
      return true;
    },

    /** @returns {number} count of completed ids */
    count: function () { return Object.keys(progress.all()).length; }
  };

  /* -------------------------------------------------------------- scores -- */
  var score = {
    /** @returns {Object.<string, number>} */
    all: function () { return getJSON(K_SCORES, {}); },

    /**
     * Persist a game score if it beats the stored best.
     * @returns {boolean} true if it was a new personal best
     */
    save: function (gameId, value) {
      if (!gameId) return false;
      var v = Number(value) || 0;
      var map = score.all();
      var best = Number(map[gameId]) || 0;
      streak.touch();
      if (v > best) {
        map[gameId] = v;
        setJSON(K_SCORES, map);
        return true;
      }
      return false;
    },

    /** @returns {number} 0 when never played */
    best: function (gameId) { return Number(score.all()[gameId]) || 0; }
  };

  /* -------------------------------------------------------------- streak -- */
  var streak = {
    /**
     * Record activity today. Consecutive calendar day => +1. Gap => reset to 1.
     * @returns {number} current streak in days
     */
    touch: function () {
      var today = isoDate();
      var s = getJSON(K_STREAK, null);
      if (!s || !s.last) { s = { last: today, days: 1 }; }
      else if (s.last === today) { /* already counted */ }
      else {
        var gap = daysBetween(s.last, today);
        s = { last: today, days: (gap === 1) ? (toInt(s.days, 1) + 1) : 1 };
      }
      setJSON(K_STREAK, s);
      Station.hud.refresh();
      return s.days;
    },

    /** @returns {number} streak length, 0 if broken/never started */
    days: function () {
      var s = getJSON(K_STREAK, null);
      if (!s || !s.last) return 0;
      var gap = daysBetween(s.last, isoDate());
      if (gap > 1) return 0;      // broken but not yet rewritten
      return toInt(s.days, 0);
    },

    /** @returns {string|null} last-active ISO date */
    last: function () { var s = getJSON(K_STREAK, null); return s ? s.last : null; }
  };

  /* ----------------------------------------------------------------- sfx -- */
  var audioCtx = null;

  /** Lazily create the AudioContext. Only ever called from inside a sound call,
   *  which in this app only happens after a user gesture. */
  function ctx() {
    if (Station.isMuted()) return null;
    if (!audioCtx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      try { audioCtx = new AC(); } catch (e) { return null; }
    }
    if (audioCtx.state === 'suspended') { try { audioCtx.resume(); } catch (e) {} }
    return audioCtx;
  }

  /**
   * One oscillator blip.
   * @param {number} freq Hz
   * @param {number} start seconds from now
   * @param {number} dur seconds
   * @param {OscillatorType} [type]
   * @param {number} [gain]
   */
  function blip(freq, start, dur, type, gain) {
    var c = ctx();
    if (!c) return;
    var t0 = c.currentTime + start;
    var osc = c.createOscillator();
    var amp = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    var peak = (gain === undefined ? 0.16 : gain);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(amp); amp.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  var sfx = {
    /** Rising two-tone. */
    correct: function () { blip(660, 0, 0.11, 'sine', 0.16); blip(990, 0.09, 0.16, 'sine', 0.14); },
    /** Low sawtooth buzz. */
    wrong: function () { blip(150, 0, 0.20, 'sawtooth', 0.12); blip(110, 0.06, 0.22, 'square', 0.08); },
    /** Four-note major arpeggio. */
    levelup: function () {
      [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
        blip(f, i * 0.085, 0.22, 'triangle', 0.15);
      });
    },
    /** Short percussive click. */
    tick: function () { blip(1400, 0, 0.035, 'square', 0.05); }
  };

  /* ------------------------------------------------------------ confetti -- */
  /** Full-screen canvas burst, ~120 particles, gravity + rotation, self-removing. */
  function confetti(opts) {
    if (prefersReducedMotion || !document.body) return;
    var o = opts || {};
    var count = o.count || 120;
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1300;';
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var W = global.innerWidth, H = global.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    document.body.appendChild(canvas);
    var g = canvas.getContext('2d');
    if (!g) { document.body.removeChild(canvas); return; }
    g.scale(dpr, dpr);

    var colors = ['#E5484D', '#1F6FEB', '#1A9E5F', '#F2820A', '#8A5CF6', '#0E9AA7', '#DB2777'];
    var parts = [];
    var originX = (o.x === undefined) ? W / 2 : o.x;
    var originY = (o.y === undefined) ? H * 0.36 : o.y;

    for (var i = 0; i < count; i++) {
      var ang = (Math.PI * 2) * (i / count) + Math.random() * 0.5;
      var speed = 4 + Math.random() * 9;
      parts.push({
        x: originX + (Math.random() - 0.5) * 60,
        y: originY + (Math.random() - 0.5) * 30,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed - 5,
        w: 5 + Math.random() * 7,
        h: 8 + Math.random() * 8,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.32,
        color: colors[(Math.random() * colors.length) | 0],
        life: 1
      });
    }

    var start = null;
    function frame(ts) {
      if (start === null) start = ts;
      var elapsed = ts - start;
      g.clearRect(0, 0, W, H);
      var alive = 0;
      for (var j = 0; j < parts.length; j++) {
        var p = parts[j];
        p.vy += 0.30;            // gravity
        p.vx *= 0.992;           // drag
        p.x += p.vx; p.y += p.vy;
        p.rot += p.vr;
        p.life = Math.max(0, 1 - elapsed / 2600);
        if (p.y < H + 40 && p.life > 0) alive++;
        g.save();
        g.globalAlpha = p.life;
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.fillStyle = p.color;
        g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        g.restore();
      }
      if (alive > 0 && elapsed < 3200) {
        global.requestAnimationFrame(frame);
      } else if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
    }
    global.requestAnimationFrame(frame);
  }

  /* --------------------------------------------------------------- toast -- */
  function toastHost() {
    var host = document.getElementById('cs-toast-host');
    if (!host) {
      host = el('div');
      host.id = 'cs-toast-host';
      document.body.appendChild(host);
    }
    return host;
  }

  /**
   * Bottom-center transient message.
   * @param {string} msg
   * @param {'good'|'bad'|'info'} [kind]
   * @param {number} [ms] lifetime, default 2200
   */
  function toast(msg, kind, ms) {
    if (!document.body) return;
    var node = el('div', 'cs-toast cs-toast--' + (kind || 'info'), msg);
    toastHost().appendChild(node);
    var life = ms || 2200;
    global.setTimeout(function () {
      node.classList.add('is-out');
      global.setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 320);
    }, life);
  }

  /* ----------------------------------------------------------- randomness -- */
  /** Fisher-Yates. Returns a NEW array; input untouched. */
  function shuffle(arr, rnd) {
    var a = (arr || []).slice();
    var r = rnd || Math.random;
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /** Random element (undefined for empty arrays). */
  function pick(arr, rnd) {
    if (!arr || !arr.length) return undefined;
    var r = rnd || Math.random;
    return arr[Math.floor(r() * arr.length)];
  }

  /**
   * mulberry32 seeded PRNG factory.
   * @param {number|string} seed
   * @returns {function(): number} values in [0,1)
   */
  function rng(seed) {
    var s;
    if (typeof seed === 'string') {
      s = 2166136261 >>> 0;
      for (var i = 0; i < seed.length; i++) {
        s ^= seed.charCodeAt(i);
        s = Math.imul(s, 16777619) >>> 0;
      }
    } else {
      s = (Number(seed) || 0) >>> 0;
    }
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 1..366 day of year — used for "today's pick" determinism. */
  function dayOfYear(d) {
    var dt = d || new Date();
    var startOfYear = new Date(dt.getFullYear(), 0, 0);
    return Math.floor((dt - startOfYear) / 86400000);
  }

  /* --------------------------------------------------------------- theme -- */
  var theme = {
    /** @returns {'light'|'dark'|'auto'} */
    get: function () { return safeGet(K_THEME, 'auto') || 'auto'; },

    /** Apply and persist. 'auto' removes the attribute so the OS decides. */
    set: function (mode) {
      var m = (mode === 'light' || mode === 'dark') ? mode : 'auto';
      safeSet(K_THEME, m);
      if (m === 'auto') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', m);
      return m;
    },

    /** Cycle light -> dark -> light (auto resolves to its opposite first). */
    toggle: function () {
      var cur = theme.get();
      if (cur === 'auto') {
        var dark = false;
        try { dark = global.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) {}
        cur = dark ? 'dark' : 'light';
      }
      return theme.set(cur === 'dark' ? 'light' : 'dark');
    },

    /** Re-apply the stored theme (called automatically as early as possible). */
    apply: function () {
      var m = theme.get();
      if (m === 'light' || m === 'dark') document.documentElement.setAttribute('data-theme', m);
      else document.documentElement.removeAttribute('data-theme');
      return m;
    }
  };
  theme.apply(); // runs at parse time (defer) — before first paint of body content

  /* ---------------------------------------------------------------- tier -- */
  /* Microsoft's own 100-500 convention. Every piece of content in the project
   * is tagged with exactly one tier. This is a CONTENT DEPTH selector and has
   * nothing whatsoever to do with Station.level(), which is the learner's XP
   * level. Default is 400 because every card written before the tier system
   * existed is expert-grade and must stay visible out of the box. */
  var TIERS = [100, 200, 300, 400, 500];
  var TIER_DEFAULT = 400;

  var TIER_LABEL = {
    100: 'Foundation',
    200: 'Practitioner',
    300: 'Professional',
    400: 'Expert',
    500: 'Architect'
  };

  var TIER_BLURB = {
    100: 'New to Azure/GitHub entirely. Vocabulary, what a service IS, and the mental model behind it.',
    200: 'You can click around the portal. The happy path, the settings that matter, the command you would really type.',
    300: 'You ship to production. Real limits and cost, what breaks under load, and when NOT to use this service.',
    400: 'Exam-grade discrimination. Lookalike traps, wrong defaults, scope and inheritance edge cases.',
    500: 'Design-review altitude. Cross-service consequences, SLA and cost math, why the platform behaves this way.'
  };

  /** @returns {number|null} n coerced to a known tier, or null if it is not one. */
  function normTier(v) {
    var n = parseInt(v, 10);
    return (TIERS.indexOf(n) === -1) ? null : n;
  }

  /** Untagged / unknown content counts as 400. @returns {number} */
  function tierOf(v) {
    var n = normTier(v);
    return (n === null) ? TIER_DEFAULT : n;
  }

  /** Live picker instances, so every one stays in sync with every other. */
  var tierPickers = [];

  /** Broadcast a tier change and repaint every mounted control. */
  function tierEmit() {
    var detail = { tier: tier.get(), below: tier.below() };

    for (var i = tierPickers.length - 1; i >= 0; i--) {
      var p = tierPickers[i];
      // drop pickers whose node has been torn out of the document
      if (p.root && p.root.parentNode) { p.sync(); }
      else { tierPickers.splice(i, 1); }
    }
    tierHudSync();

    try {
      document.dispatchEvent(new CustomEvent('station:tier', { detail: detail }));
    } catch (e) {}
    return detail;
  }

  /** Repaint the compact HUD indicator, if a HUD is mounted. */
  function tierHudSync() {
    if (typeof document === 'undefined') return;
    var btn = document.getElementById('cs-hud-tier');
    if (!btn) return;
    var t = tier.get(), lower = tier.below();
    btn.textContent = (lower ? '≤' : '') + t;
    btn.style.setProperty('--tier-color', 'var(--t' + t + ')');
    btn.setAttribute('data-t', String(t));
    btn.title = 'Tier ' + t + ' — ' + TIER_LABEL[t] +
                (lower ? ' (and everything below)' : '') + '. Click to change.';
    btn.setAttribute('aria-label', 'Skill tier: ' + t + ' ' + TIER_LABEL[t]);
  }

  var tier = {
    /** @returns {number} the selected tier, 100|200|300|400|500 */
    get: function () {
      var n = normTier(safeGet(K_TIER, ''));
      return (n === null) ? TIER_DEFAULT : n;
    },

    /**
     * Select a tier. Persists, re-applies the html attributes, fires
     * 'station:tier' on document.
     * @param {number|string} n
     * @returns {number} the tier now in force
     */
    set: function (n) {
      var t = normTier(n);
      if (t === null) return tier.get();
      safeSet(K_TIER, t);
      tier.apply();
      tierEmit();
      return t;
    },

    /** @returns {boolean} whether tiers BELOW the selected one also show */
    below: function () { return safeGet(K_TIERBELOW, '0') === '1'; },

    /**
     * Toggle "also show everything below the selected tier".
     * @param {boolean} on
     * @returns {boolean}
     */
    setBelow: function (on) {
      var v = !!on;
      safeSet(K_TIERBELOW, v ? '1' : '0');
      tier.apply();
      tierEmit();
      return v;
    },

    /** @returns {string} 'Foundation'|'Practitioner'|'Professional'|'Expert'|'Architect' */
    label: function (n) { return TIER_LABEL[tierOf(n)]; },

    /** @returns {string} the one-line audience description for tier n */
    blurb: function (n) { return TIER_BLURB[tierOf(n)]; },

    /** @returns {number[]} [100,200,300,400,500] — a fresh copy each call */
    all: function () { return TIERS.slice(); },

    /** Normalise any value to a real tier (untagged => 400). @returns {number} */
    of: function (v) { return tierOf(v); },

    /**
     * Does content at tier `t` show under the current selection?
     * @param {number|string|null|undefined} t
     * @returns {boolean}
     */
    matches: function (t) {
      var v = tierOf(t), sel = tier.get();
      return tier.below() ? (v <= sel) : (v === sel);
    },

    /**
     * Write data-tier-active / data-tier-below onto <html>. The CSS does the
     * rest. Cheap, idempotent, safe to call as often as you like.
     * @returns {number} the active tier
     */
    apply: function () {
      var t = tier.get();
      if (typeof document !== 'undefined' && document.documentElement) {
        var de = document.documentElement;
        de.setAttribute('data-tier-active', String(t));
        de.setAttribute('data-tier-below', tier.below() ? '1' : '0');
      }
      return t;
    },

    /**
     * Keep only the items visible at the current selection.
     * Items with no tier property are treated as tier 400.
     * @param {Object[]} list
     * @param {string} [key='tier']
     * @returns {Object[]} a NEW array
     */
    filter: function (list, key) {
      var k = key || 'tier';
      var out = [];
      (list || []).forEach(function (it) {
        var v = (it && it[k] !== undefined && it[k] !== null) ? it[k] : TIER_DEFAULT;
        if (tier.matches(v)) out.push(it);
      });
      return out;
    },

    /**
     * How many items sit at each tier — for badges and "content is thin here".
     * @param {Object[]} list
     * @param {string} [key='tier']
     * @returns {{100:number,200:number,300:number,400:number,500:number}}
     */
    counts: function (list, key) {
      var k = key || 'tier';
      var out = { 100: 0, 200: 0, 300: 0, 400: 0, 500: 0 };
      (list || []).forEach(function (it) {
        var v = (it && it[k] !== undefined && it[k] !== null) ? it[k] : TIER_DEFAULT;
        out[tierOf(v)]++;
      });
      return out;
    },

    /**
     * Render the tier control into an element.
     * Five buttons behaving as one radiogroup (arrow keys move AND select,
     * roving tabindex, role="radio" + aria-checked), a "show lower tiers too"
     * checkbox, and a description line that follows the active tier.
     *
     * @param {HTMLElement|string} target element or CSS selector
     * @param {{compact?:boolean, heading?:string, label?:string,
     *          belowLabel?:string, silent?:boolean}} [opts]
     * @returns {HTMLElement|null} the .tier-picker root
     */
    mountPicker: function (target, opts) {
      if (typeof document === 'undefined') return null;
      var host = (typeof target === 'string') ? document.querySelector(target) : target;
      if (!host) return null;
      var o = opts || {};

      host.innerHTML = '';

      var root = el('div', 'tier-picker' + (o.compact ? ' tier-picker--compact' : ''));

      if (o.heading) {
        root.appendChild(el('div', 'tier-picker__heading', o.heading));
      }

      var group = el('div', 'tier-picker__group');
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-label', o.label || 'Skill tier');

      var btns = [];

      // NOTE: the buttons deliberately use data-t, NOT data-tier — a data-tier
      // attribute here would make the CSS hide four of the five buttons.
      TIERS.forEach(function (t) {
        var b = el('button', 'tier-picker__btn');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('data-t', String(t));
        b.setAttribute('aria-checked', 'false');
        // the visible name is display:none in the compact/phone layouts, so the
        // accessible name has to be stated outright
        b.setAttribute('aria-label', t + ' ' + TIER_LABEL[t]);
        b.tabIndex = -1;
        b.appendChild(el('b', 'tier-picker__num', t));
        b.appendChild(el('span', 'tier-picker__name', TIER_LABEL[t]));
        b.title = t + ' ' + TIER_LABEL[t] + ' — ' + TIER_BLURB[t];
        b.addEventListener('click', function () { choose(t, false); });
        b.addEventListener('keydown', onKey);
        group.appendChild(b);
        btns.push(b);
      });
      root.appendChild(group);

      var belowRow = el('label', 'tier-picker__below');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'tier-picker__cb';
      cb.addEventListener('change', function () {
        Station.tier.setBelow(cb.checked);
        Station.sfx.tick();
      });
      belowRow.appendChild(cb);
      belowRow.appendChild(el('span', null, o.belowLabel || 'Show lower tiers too'));
      root.appendChild(belowRow);

      var desc = el('p', 'tier-picker__desc');
      root.appendChild(desc);

      function choose(t, viaKey) {
        Station.tier.set(t);
        Station.sfx.tick();
        if (viaKey) {
          var i = TIERS.indexOf(t);
          if (btns[i]) btns[i].focus();
        }
      }

      function onKey(ev) {
        var cur = TIERS.indexOf(Station.tier.get());
        if (cur < 0) cur = TIERS.indexOf(TIER_DEFAULT);
        var next = -1;
        switch (ev.key) {
          case 'ArrowRight': case 'ArrowDown': next = (cur + 1) % TIERS.length; break;
          case 'ArrowLeft':  case 'ArrowUp':   next = (cur - 1 + TIERS.length) % TIERS.length; break;
          case 'Home':  next = 0; break;
          case 'End':   next = TIERS.length - 1; break;
          case ' ': case 'Enter':
            next = TIERS.indexOf(parseInt(ev.currentTarget.getAttribute('data-t'), 10));
            break;
          default: return;
        }
        ev.preventDefault();
        if (next >= 0) choose(TIERS[next], true);
      }

      function sync() {
        var t = Station.tier.get();
        var lower = Station.tier.below();
        root.style.setProperty('--tier-color', 'var(--t' + t + ')');
        root.setAttribute('data-t', String(t));
        for (var i = 0; i < TIERS.length; i++) {
          var on = (TIERS[i] === t);
          btns[i].setAttribute('aria-checked', on ? 'true' : 'false');
          btns[i].classList.toggle('is-active', on);
          btns[i].tabIndex = on ? 0 : -1;
        }
        cb.checked = lower;
        desc.textContent = t + ' ' + TIER_LABEL[t] + ' — ' + TIER_BLURB[t] +
          (lower ? ' Everything below ' + t + ' is showing too.' : '');
      }

      host.appendChild(root);
      tierPickers.push({ root: root, sync: sync });
      sync();
      return root;
    }
  };

  tier.apply(); // parse time, before the body paints — no flash of wrong tier

  /* ----------------------------------------------------------------- hud -- */
  var CERT_VARS = { az104: '--az104', az305: '--az305', az400: '--az400', ghas: '--ghas' };

  /**
   * Guess how many directory levels deep the current page sits under the
   * project root. Pages live at /, /tracks/, /whiteboards/, /games/, /drills/.
   * @returns {string} relative href to index.html
   */
  function guessBackHref() {
    var path = global.location.pathname || '';
    // strip trailing filename
    var parts = path.split('/').filter(function (s) { return s.length > 0; });
    if (parts.length === 0) return 'index.html';
    var lastPart = parts[parts.length - 1];
    var isFile = lastPart.indexOf('.') !== -1;
    var dirs = isFile ? parts.slice(0, -1) : parts;
    var known = ['tracks', 'whiteboards', 'games', 'drills', 'labs', 'data'];
    var tail = dirs.length ? dirs[dirs.length - 1].toLowerCase() : '';
    // Only these known folders are one level deep inside the project.
    if (known.indexOf(tail) !== -1) return '../index.html';
    return 'index.html';
  }

  var hudEl = null;

  var hud = {
    /**
     * Build and inject the fixed top bar. Safe to call once per page.
     * @param {{title?:string, cert?:('az104'|'az305'|'az400'|'ghas'|null), back?:string}} [opts]
     * @returns {HTMLElement}
     */
    mount: function (opts) {
      var o = opts || {};
      onReady(function () { hud._build(o); });
      return hudEl;
    },

    _build: function (o) {
      if (hudEl && hudEl.parentNode) return hudEl;
      var accent = (o.cert && CERT_VARS[o.cert]) ? 'var(' + CERT_VARS[o.cert] + ')' : 'var(--mk-blue)';

      hudEl = el('header', 'hud');
      hudEl.setAttribute('role', 'banner');
      hudEl.style.setProperty('--hud-accent', accent);

      var stripe = el('div', 'hud__stripe');
      hudEl.appendChild(stripe);

      var backHref = o.back || guessBackHref();
      var back = el('a', 'hud__back');
      back.href = backHref;
      back.title = 'Back to the hub';
      back.innerHTML = '<span aria-hidden="true">←</span><span>Hub</span>';
      hudEl.appendChild(back);

      var title = el('div', 'hud__title', o.title || document.title || 'Certification Station');
      hudEl.appendChild(title);

      var stats = el('div', 'hud__stats');

      var lvl = el('span', 'hud__level');
      lvl.id = 'cs-hud-level';
      stats.appendChild(lvl);

      var xpwrap = el('div', 'hud__xpwrap');
      var xplabel = el('span', 'hud__xplabel');
      xplabel.id = 'cs-hud-xplabel';
      var bar = el('div', 'hud__xpbar');
      var fill = el('div', 'hud__xpfill');
      fill.id = 'cs-hud-xpfill';
      bar.appendChild(fill);
      xpwrap.appendChild(xplabel);
      xpwrap.appendChild(bar);
      stats.appendChild(xpwrap);

      var flame = el('span', 'hud__streak');
      flame.id = 'cs-hud-streak';
      flame.title = 'Day streak';
      stats.appendChild(flame);

      stats.appendChild(hud._tierControl());

      var mute = el('button', 'hud__mute');
      mute.id = 'cs-hud-mute';
      mute.type = 'button';
      mute.setAttribute('aria-label', 'Toggle sound');
      mute.addEventListener('click', function () {
        var m = Station.toggleMute();
        Station.toast(m ? 'Sound off' : 'Sound on', 'info', 1200);
        if (!m) Station.sfx.tick();
      });
      stats.appendChild(mute);

      hudEl.appendChild(stats);
      document.body.insertBefore(hudEl, document.body.firstChild);
      document.body.classList.add('has-hud');

      hud.refresh();
      return hudEl;
    },

    /**
     * The compact tier indicator + its popover picker. Every page gets one.
     * @returns {HTMLElement} the wrapper to drop into .hud__stats
     */
    _tierControl: function () {
      var wrap = el('div', 'hud-tier-wrap');

      var btn = el('button', 'hud-tier');
      btn.id = 'cs-hud-tier';
      btn.type = 'button';
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-controls', 'cs-hud-tier-pop');

      var pop = el('div', 'hud-tier-pop');
      pop.id = 'cs-hud-tier-pop';
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', 'Choose skill tier');
      pop.hidden = true;

      function open() {
        pop.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        var first = pop.querySelector('.tier-picker__btn.is-active') ||
                    pop.querySelector('.tier-picker__btn');
        if (first) first.focus();
        document.addEventListener('pointerdown', onOutside, true);
        document.addEventListener('keydown', onEsc, true);
      }
      function close(refocus) {
        pop.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', onOutside, true);
        document.removeEventListener('keydown', onEsc, true);
        if (refocus) btn.focus();
      }
      function onOutside(ev) { if (!wrap.contains(ev.target)) close(false); }
      function onEsc(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); close(true); } }

      btn.addEventListener('click', function () {
        if (pop.hidden) { open(); } else { close(true); }
      });

      wrap.appendChild(btn);
      wrap.appendChild(pop);

      // mountPicker needs the node in hand, not in the document, which is fine
      tier.mountPicker(pop, { compact: true, heading: 'Skill tier', label: 'Skill tier' });
      return wrap;
    },

    /** Repaint XP/level/streak/mute state. No-op when no HUD is mounted. */
    refresh: function () {
      if (typeof document === 'undefined') return;
      var b = xp.breakdown();

      var lvl = document.getElementById('cs-hud-level');
      if (lvl) lvl.textContent = 'LV ' + b.level;

      var fill = document.getElementById('cs-hud-xpfill');
      if (fill) fill.style.width = b.pct.toFixed(1) + '%';

      var lab = document.getElementById('cs-hud-xplabel');
      if (lab) lab.textContent = b.xp + ' XP · ' + b.into + '/' + b.need + ' to LV ' + (b.level + 1);

      var st = document.getElementById('cs-hud-streak');
      if (st) {
        var d = streak.days();
        st.textContent = '🔥 ' + d;
        st.style.opacity = d > 0 ? '1' : '.4';
        st.title = d > 0 ? (d + '-day streak') : 'No streak yet — do something today';
      }

      tierHudSync();

      var mute = document.getElementById('cs-hud-mute');
      if (mute) {
        var muted = Station.isMuted();
        mute.textContent = muted ? '🔇' : '🔊';
        mute.setAttribute('aria-pressed', muted ? 'true' : 'false');
      }

      // let pages react (hub stat strip, etc.)
      try {
        document.dispatchEvent(new CustomEvent('station:update', { detail: b }));
      } catch (e) {}
    },

    /** @returns {HTMLElement|null} */
    node: function () { return hudEl; }
  };

  /* ---------------------------------------------------------------- misc -- */
  /** @returns {boolean} */
  function isMuted() { return safeGet(K_MUTED, '0') === '1'; }

  /** @returns {boolean} the new muted state */
  function toggleMute() {
    var next = !isMuted();
    safeSet(K_MUTED, next ? '1' : '0');
    hud.refresh();
    return next;
  }

  /** Wipe every cs: key after confirming with the learner. */
  function reset() {
    var ok = true;
    try {
      ok = global.confirm('Erase ALL Certification Station progress — XP, levels, streak, scores, completions? This cannot be undone.');
    } catch (e) { ok = false; }
    if (!ok) return false;
    allKeys().forEach(safeRemove);
    memory.clear();
    tier.apply();
    tierEmit();
    hud.refresh();
    toast('Progress wiped. Fresh whiteboard.', 'info', 3000);
    return true;
  }

  /** Everything, as one object — handy for a manual backup via console. */
  function exportAll() {
    var out = {};
    allKeys().forEach(function (k) { out[k] = safeGet(k, null); });
    return out;
  }

  /* -------------------------------------------------------------- public -- */
  var Station = {
    version: '1.1.0',
    PREFIX: PREFIX,

    // storage
    safeGet: safeGet,
    safeSet: safeSet,
    safeRemove: safeRemove,
    getJSON: getJSON,
    setJSON: setJSON,
    keys: allKeys,
    exportAll: exportAll,
    storageOk: lsOk,

    // progression
    xp: xp,
    /** @returns {number} current level */
    level: function () { return levelFromXp(xp.total()); },
    levelFromXp: levelFromXp,
    xpForLevel: xpForLevel,
    progress: progress,
    score: score,
    streak: streak,

    // ui
    mountHud: function (opts) { return hud.mount(opts); },
    hud: hud,
    toast: toast,
    confetti: confetti,
    sfx: sfx,
    isMuted: isMuted,
    toggleMute: toggleMute,
    theme: theme,

    /** Content-depth tiers (100-500). NOT the learner's XP level. */
    tier: tier,
    TIERS: TIERS,

    // util
    shuffle: shuffle,
    pick: pick,
    rng: rng,
    dayOfYear: dayOfYear,
    isoDate: isoDate,
    clamp: clamp,
    onReady: onReady,
    reset: reset
  };

  global.Station = Station;
  global.STATION_DATA = global.STATION_DATA || {};

  // Keep the HUD honest if another tab changes things.
  try {
    global.addEventListener('storage', function (e) {
      if (!e || !e.key || e.key.indexOf(PREFIX) !== 0) return;
      if (e.key === K_TIER || e.key === K_TIERBELOW) { tier.apply(); tierEmit(); }
      hud.refresh();
    });
  } catch (e) {}

  // A first real interaction on any page counts as activity for the streak.
  onReady(function () {
    theme.apply();
    tier.apply();
    var armed = false;
    function arm() {
      if (armed) return;
      armed = true;
      streak.touch();
    }
    document.addEventListener('pointerdown', arm, { once: true });
    document.addEventListener('keydown', arm, { once: true });
  });

}(window));
