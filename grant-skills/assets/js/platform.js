/* ==========================================================================
   Education Research Skills, CTLT edition.
   platform.js. One plain JavaScript engine, no dependencies, no build step.

   What it does
   ------------
   1. Hydrates every element that carries data-widget from its child
      <script type="application/json"> payload. See assets/js/WIDGETS.md for
      the payload shape of every widget type.
   2. Builds the step list from the sections that carry data-step, keeps the
      current step highlighted, and remembers the last step per module.
   3. Saves everything under localStorage key ctlt-ers:<module-id>. Every read
      and every write is wrapped in try/catch, so the page still works when
      storage is blocked or full.
   4. Exposes window.Skills with state helpers, track, llm and hub.

   Nothing leaves the browser unless window.SkillsTelemetry.send or
   window.SkillsConfig.llmEndpoint is plugged in. Both are unset by default.
   ========================================================================== */

(function (window, document) {
  'use strict';

  var VERSION = '0.1';
  var PREFIX = 'ctlt-ers:';
  var CONFIDENCE = ['Sure', 'Fairly sure', 'Guessing'];

  /* The wager. Confidence is a stake, not a mood. A right answer earns the
     stake, a wrong one costs it, so "sure and wrong" is the expensive mistake.
     expect is the hit rate a stake claims. The calibration report holds the
     learner to it, which is the part that actually teaches. */
  var WAGER = [
    { stake: 3, expect: 0.90 },
    { stake: 2, expect: 0.70 },
    { stake: 1, expect: 0.40 }
  ];

  function wagerOf(index) { return WAGER[index] || WAGER[WAGER.length - 1]; }

  function signed(n) { return (n > 0 ? '+' : '') + n; }

  function percent(n) { return Math.round(n * 100) + '%'; }

  /* ------------------------------------------------------------------------
     1. Small helpers
     ------------------------------------------------------------------------ */

  function qs(sel, root) { return (root || document).querySelector(sel); }

  function qsa(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function el(tag, attrs, kids) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) { return; }
        if (key === 'class') { node.className = value; }
        else if (key === 'text') { node.textContent = value; }
        else if (key.indexOf('on') === 0 && typeof value === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (value === true) { node.setAttribute(key, ''); }
        else { node.setAttribute(key, String(value)); }
      });
    }
    append(node, kids);
    return node;
  }

  function append(parent, kids) {
    if (kids === null || kids === undefined || kids === false) { return parent; }
    if (Array.isArray(kids)) {
      kids.forEach(function (kid) { append(parent, kid); });
      return parent;
    }
    parent.appendChild(typeof kids === 'object' ? kids : document.createTextNode(String(kids)));
    return parent;
  }

  function clear(node) {
    while (node && node.firstChild) { node.removeChild(node.firstChild); }
    return node;
  }

  function parseJSON(text, where) {
    try {
      return JSON.parse(text);
    } catch (err) {
      if (window.console) {
        window.console.error('Skills: could not read the JSON payload for ' + (where || 'a widget') + '.', err);
      }
      return null;
    }
  }

  function payloadOf(root) {
    var kids = root.children;
    for (var i = 0; i < kids.length; i += 1) {
      if (kids[i].tagName === 'SCRIPT' && (kids[i].getAttribute('type') || '') === 'application/json') {
        return parseJSON(kids[i].textContent, root.getAttribute('data-id') || root.getAttribute('data-widget'));
      }
    }
    return null;
  }

  function plural(n, one, many) { return n === 1 ? one : many; }

  function nowStamp() {
    try {
      return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (err) {
      return '';
    }
  }

  function dateStamp(ms) {
    try {
      return new Date(ms).toLocaleString();
    } catch (err) {
      return '';
    }
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      window.clearTimeout(timer);
      timer = window.setTimeout(function () { fn.apply(self, args); }, wait);
    };
  }

  /* ------------------------------------------------------------------------
     2. Storage. Every read and write is guarded.
     ------------------------------------------------------------------------ */

  /* The stylesheet assumes a 72px header. The real one wraps on a narrow
     window and grows, and everything that sticks below it reads
     --ctlt-header-h, so measure the real thing and keep it current. */
  function syncHeaderHeight() {
    var header = qs('.site-header');
    if (!header) { return; }
    var height = Math.round(header.getBoundingClientRect().height);
    if (height > 0) {
      document.documentElement.style.setProperty('--ctlt-header-h', height + 'px');
    }
  }

  /* Tells a sticky element when it is actually pinned, so it can shrink out of
     the way. When the element is not sticky at all, which is what the narrow
     breakpoints do, the computed top is auto and the class never goes on. */
  function watchSticky(node) {
    if (!node) { return; }
    var pending = null;

    function check() {
      var stickTop = parseFloat(window.getComputedStyle(node).top);
      if (isNaN(stickTop)) {
        node.classList.remove('is-stuck');
        return;
      }
      node.classList.toggle('is-stuck', node.getBoundingClientRect().top <= stickTop + 1);
    }

    function schedule() {
      if (pending) { return; }
      pending = window.setTimeout(function () {
        pending = null;
        check();
      }, 80);
    }

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    check();
  }

  function storageAvailable() {
    try {
      var probe = '__ctlt_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return true;
    } catch (err) {
      return false;
    }
  }

  var STORAGE_OK = storageAvailable();

  function readModule(moduleId) {
    try {
      var raw = window.localStorage.getItem(PREFIX + moduleId);
      if (!raw) { return null; }
      var data = JSON.parse(raw);
      return (data && typeof data === 'object') ? data : null;
    } catch (err) {
      return null;
    }
  }

  function writeModule(moduleId, data) {
    try {
      window.localStorage.setItem(PREFIX + moduleId, JSON.stringify(data));
      return true;
    } catch (err) {
      return false;
    }
  }

  function getState(moduleId) {
    return readModule(moduleId) || { module: moduleId, widgets: {}, created: Date.now() };
  }

  function setState(moduleId, data) {
    data.module = moduleId;
    data.updated = Date.now();
    if (!data.created) { data.created = data.updated; }
    return writeModule(moduleId, data);
  }

  function getWidgetState(moduleId, widgetId) {
    var state = getState(moduleId);
    return (state.widgets && state.widgets[widgetId]) || {};
  }

  function setWidgetState(moduleId, widgetId, patch) {
    var state = getState(moduleId);
    if (!state.widgets) { state.widgets = {}; }
    var current = state.widgets[widgetId] || {};
    Object.keys(patch).forEach(function (key) { current[key] = patch[key]; });
    current.ts = Date.now();
    state.widgets[widgetId] = current;
    setState(moduleId, state);
    return current;
  }

  function listModules() {
    var out = [];
    try {
      for (var i = 0; i < window.localStorage.length; i += 1) {
        var key = window.localStorage.key(i);
        if (key && key.indexOf(PREFIX) === 0) {
          var id = key.slice(PREFIX.length);
          var data = readModule(id);
          if (data) { out.push({ id: id, data: data }); }
        }
      }
    } catch (err) { /* storage blocked. Return whatever was collected. */ }
    out.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    return out;
  }

  function clearAll() {
    var keys = [];
    try {
      for (var i = 0; i < window.localStorage.length; i += 1) {
        var key = window.localStorage.key(i);
        if (key && key.indexOf(PREFIX) === 0) { keys.push(key); }
      }
      keys.forEach(function (k) { window.localStorage.removeItem(k); });
      return true;
    } catch (err) {
      return false;
    }
  }

  /* ------------------------------------------------------------------------
     3. Page context, live region, telemetry, LLM stub
     ------------------------------------------------------------------------ */

  var PAGE = { moduleId: null, title: null };

  function readPageContext() {
    var host = qs('[data-module]');
    PAGE.moduleId = host ? host.getAttribute('data-module') : null;
    PAGE.title = (host && host.getAttribute('data-module-title')) || document.title || PAGE.moduleId;
    /* How far this page sits below the site root. The hub leaves it empty,
       a module page sets data-base="../". Links in the proposal map are
       written from the root and get this in front of them. */
    var based = qs('[data-base]');
    PAGE.base = based ? (based.getAttribute('data-base') || '') : '';
    return PAGE;
  }

  var liveNode = null;

  function liveRegion() {
    if (liveNode && document.body.contains(liveNode)) { return liveNode; }
    liveNode = qs('#skills-live');
    if (!liveNode) {
      liveNode = el('div', { id: 'skills-live', class: 'visually-hidden', 'aria-live': 'polite', 'aria-atomic': 'true' });
      document.body.appendChild(liveNode);
    }
    return liveNode;
  }

  function announce(message) {
    var region = liveRegion();
    if (!region) { return; }
    region.textContent = '';
    window.setTimeout(function () { region.textContent = String(message); }, 60);
  }

  var eventLog = [];

  function track(eventName, payload) {
    var event = {
      event: eventName,
      module: PAGE.moduleId,
      widget: (payload && payload.widget) || null,
      ts: Date.now()
    };
    if (payload) {
      Object.keys(payload).forEach(function (key) {
        if (key !== 'widget') { event[key] = payload[key]; }
      });
    }
    eventLog.push(event);
    try {
      if (window.SkillsTelemetry && typeof window.SkillsTelemetry.send === 'function') {
        window.SkillsTelemetry.send(event);
      }
    } catch (err) { /* a broken sender must never break the page */ }
    return event;
  }

  /* Skills.llm.score returns null when no endpoint is configured, which is the
     default in this prototype. When an endpoint is set it returns a Promise
     for { score, comment }. Callers must handle both. */
  function llmScore(request) {
    var config = window.SkillsConfig || {};
    if (!config.llmEndpoint) { return null; }
    try {
      return window.fetch(config.llmEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      }).then(function (response) {
        if (!response.ok) { throw new Error('Scoring endpoint returned ' + response.status); }
        return response.json();
      }).then(function (data) {
        return { score: data.score, comment: data.comment };
      })['catch'](function (err) {
        if (window.console) { window.console.warn('Skills: scoring failed.', err); }
        return null;
      });
    } catch (err) {
      return null;
    }
  }

  /* ------------------------------------------------------------------------
     4. Copy and download
     ------------------------------------------------------------------------ */

  function fallbackCopy(text) {
    try {
      var area = el('textarea', { class: 'visually-hidden' });
      area.value = text;
      document.body.appendChild(area);
      area.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch (err) {
      return false;
    }
  }

  function copyText(text) {
    try {
      if (window.navigator && window.navigator.clipboard && window.navigator.clipboard.writeText) {
        return window.navigator.clipboard.writeText(text).then(function () {
          return true;
        })['catch'](function () {
          return fallbackCopy(text);
        });
      }
    } catch (err) { /* fall through */ }
    return Promise.resolve(fallbackCopy(text));
  }

  function downloadText(filename, text) {
    try {
      var blob = new window.Blob([text], { type: 'text/plain;charset=utf-8' });
      var url = window.URL.createObjectURL(blob);
      var link = el('a', { href: url, download: filename, class: 'visually-hidden' });
      document.body.appendChild(link);
      link.click();
      window.setTimeout(function () {
        if (link.parentNode) { link.parentNode.removeChild(link); }
        window.URL.revokeObjectURL(url);
      }, 0);
      return true;
    } catch (err) {
      return false;
    }
  }

  /* ------------------------------------------------------------------------
     5. Export lines
     Every widget writes an _export array of [label, value] pairs into its own
     saved state. The hub and the Your study buttons walk those pairs, so they
     never need to know what a widget is.
     ------------------------------------------------------------------------ */

  function moduleExportLines(moduleId) {
    var state = readModule(moduleId);
    var lines = [];
    if (!state || !state.widgets) { return lines; }
    Object.keys(state.widgets).forEach(function (widgetId) {
      var widget = state.widgets[widgetId];
      if (!widget || !Array.isArray(widget._export)) { return; }
      widget._export.forEach(function (pair) {
        if (pair && pair.length) { lines.push([pair[0], pair[1]]); }
      });
    });
    return lines;
  }

  function linesToText(lines) {
    return lines.map(function (pair) {
      var value = (pair[1] === null || pair[1] === undefined || pair[1] === '') ? '(not filled in)' : String(pair[1]);
      return pair[0] + '\n' + value + '\n';
    }).join('\n');
  }

  function moduleTitleOf(moduleId, state) {
    if (state && state.title) { return state.title; }
    if (PAGE.moduleId === moduleId && PAGE.title) { return PAGE.title; }
    return 'Module ' + moduleId.replace('-', '.');
  }

  function exportEverything() {
    var parts = [];
    parts.push('Education Research Skills. Your saved work.');
    parts.push('Centre for Teaching, Learning and Technology, National University of Singapore.');
    parts.push('Exported ' + dateStamp(Date.now()));
    parts.push('');
    var modules = listModules();
    if (!modules.length) {
      parts.push('Nothing saved yet on this device.');
      return parts.join('\n');
    }
    modules.forEach(function (entry) {
      var title = moduleTitleOf(entry.id, entry.data);
      parts.push(title);
      parts.push(new Array(title.length + 1).join('-'));
      var lines = moduleExportLines(entry.id);
      if (!lines.length) {
        parts.push('Opened, nothing saved yet.');
      } else {
        parts.push(linesToText(lines).replace(/\n+$/, ''));
      }
      parts.push('');
    });
    return parts.join('\n');
  }

  function moduleProgress(moduleId) {
    var state = readModule(moduleId);
    if (!state || !state.widgets || !Object.keys(state.widgets).length) { return 'not-started'; }
    var done = false;
    Object.keys(state.widgets).forEach(function (widgetId) {
      var widget = state.widgets[widgetId];
      if (widget && widget.kind === 'postcheck' && widget.submitted) { done = true; }
      if (widget && widget.kind === 'diagnose' && widget.committed) { done = true; }
    });
    return done ? 'done' : 'in-progress';
  }

  /* ------------------------------------------------------------------------
     6. Widget registry
     ------------------------------------------------------------------------ */

  var registry = {};

  function register(type, builder) { registry[type] = builder; }

  function makeContext(root, moduleId, widgetId, kind) {
    return {
      root: root,
      module: moduleId,
      id: widgetId,
      get: function () { return getWidgetState(moduleId, widgetId); },
      save: function (patch) {
        var full = {};
        Object.keys(patch).forEach(function (key) { full[key] = patch[key]; });
        full.kind = kind;
        return setWidgetState(moduleId, widgetId, full);
      },
      track: function (name, payload) {
        var data = payload || {};
        data.widget = widgetId;
        return track(name, data);
      },
      announce: announce
    };
  }

  function hydrate(root) {
    var type = root.getAttribute('data-widget');
    var widgetId = root.getAttribute('data-id') || type;
    var builder = registry[type];
    if (!builder) {
      if (window.console) { window.console.warn('Skills: no widget named ' + type + '.'); }
      return;
    }
    var data = payloadOf(root) || {};
    var context = makeContext(root, PAGE.moduleId || 'page', widgetId, type);
    try {
      builder(root, data, context);
      root.setAttribute('data-widget-ready', 'true');
    } catch (err) {
      if (window.console) { window.console.error('Skills: widget ' + widgetId + ' failed.', err); }
      root.appendChild(el('p', { class: 'fb', text: 'This activity could not be loaded. The rest of the page still works.' }));
    }
  }

  /* ------------------------------------------------------------------------
     6b. Motion

     Six primitives and one switch. Everything that moves goes through here,
     so there is one list to read and one place to fix when it misbehaves.

     The switch is live: a learner who turns reduced motion on mid-session
     gets a still page without reloading. The CSS block in section 20 of the
     stylesheet does the same for transitions and keyframes, but !important
     cannot stop a requestAnimationFrame loop, so every tween asks first.

     Two rules learned the hard way:

     - rAF does not run in a background tab, in a hidden preview pane, or in
       a headless capture. Every tween therefore carries a wall-clock guard
       that jumps it to its end state. A half-finished reveal is not a slow
       reveal; it is the wrong thing on screen, permanently.
     - Never animate border-width, or anything else that reflows a control.
       FLIP moves things with transform and nothing else.
     ------------------------------------------------------------------------ */

  var REDUCE = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  function motionOK() { return !(REDUCE && REDUCE.matches); }

  function stamp() {
    return (window.performance && window.performance.now)
      ? window.performance.now()
      : Date.now();
  }

  /* Matches the feel of --e-out in the stylesheet: leaves fast, settles slow. */
  function easeOut(t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); }

  function tween(duration, step, done) {
    var ms = Math.max(1, duration || 0);
    if (!motionOK()) {
      step(1);
      if (done) { done(); }
      return function () {};
    }
    var started = stamp();
    var frame = null;
    var guard = null;
    var over = false;

    function finish() {
      if (over) { return; }
      over = true;
      if (frame) { window.cancelAnimationFrame(frame); frame = null; }
      if (guard) { window.clearTimeout(guard); guard = null; }
      step(1);
      if (done) { done(); }
    }

    function tick() {
      frame = null;
      if (over) { return; }
      var t = (stamp() - started) / ms;
      if (t >= 1) { finish(); return; }
      step(easeOut(t));
      frame = window.requestAnimationFrame(tick);
    }

    /* setTimeout is throttled in a background tab, but it does still fire.
       requestAnimationFrame does not fire at all. That asymmetry is the
       entire reason this guard exists. */
    guard = window.setTimeout(finish, ms + 150);
    frame = window.requestAnimationFrame(tick);
    return finish;
  }

  /* Measure, mutate, invert, play.

     `collect` returns the elements to watch, keyed by a stable id, and is
     called twice. It is a function rather than a list because most widgets
     here redraw by throwing the old DOM away: matching by id survives that,
     matching by node identity would not. */
  function flip(collect, mutate, options) {
    var opts = options || {};
    if (!motionOK()) { mutate(); return; }

    var before = {};
    var pre = collect();
    Object.keys(pre).forEach(function (key) {
      before[key] = pre[key].getBoundingClientRect();
    });

    mutate();

    var moved = [];
    var post = collect();
    Object.keys(post).forEach(function (key) {
      var was = before[key];
      if (!was) { return; }
      var node = post[key];
      var box = node.getBoundingClientRect();
      var dx = was.left - box.left;
      var dy = was.top - box.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) { return; }
      moved.push({ node: node, dx: dx, dy: dy });
    });
    if (!moved.length) { return; }

    moved.forEach(function (m) {
      m.node.style.transform = 'translate(' + m.dx + 'px, ' + m.dy + 'px)';
      m.node.classList.add('is-flipping');
    });

    tween(opts.duration || 320, function (t) {
      var k = 1 - t;
      moved.forEach(function (m) {
        m.node.style.transform = 'translate(' + (m.dx * k) + 'px, ' + (m.dy * k) + 'px)';
      });
    }, function () {
      moved.forEach(function (m) {
        m.node.style.transform = '';
        m.node.classList.remove('is-flipping');
      });
      if (opts.done) { opts.done(); }
    });
  }

  /* Grow a block that has just been inserted from nothing to its own height.

     Used only where the expansion is the point and the block pushes the rest
     of the page down: the worked example's reveal. Everywhere else a CSS
     keyframe does the arrival without touching layout, which is cheaper and
     cannot jank. Height is measured before anything is changed, so the node
     must already be in the document when this is called. */
  function revealBlock(node, options) {
    var opts = options || {};
    if (!motionOK() || !node || !node.getBoundingClientRect) { return; }
    var box = node.getBoundingClientRect();
    if (!box.height) { return; }
    var styles = window.getComputedStyle(node);
    var height = box.height;
    var padTop = parseFloat(styles.paddingTop) || 0;
    var padBottom = parseFloat(styles.paddingBottom) || 0;
    var marginTop = parseFloat(styles.marginTop) || 0;

    node.style.overflow = 'hidden';
    tween(opts.duration || 340, function (t) {
      /* Box sizing is border-box everywhere here, so height alone would floor
         at the padding. The padding has to shrink with it to reach zero. */
      node.style.height = (height * t) + 'px';
      node.style.paddingTop = (padTop * t) + 'px';
      node.style.paddingBottom = (padBottom * t) + 'px';
      node.style.marginTop = (marginTop * t) + 'px';
      node.style.opacity = String(Math.min(1, t * 1.8));
    }, function () {
      node.style.overflow = '';
      node.style.height = '';
      node.style.paddingTop = '';
      node.style.paddingBottom = '';
      node.style.marginTop = '';
      node.style.opacity = '';
      if (opts.done) { opts.done(); }
    });
  }

  /* Tick a number up. Only for numbers the learner is meant to watch change:
     a tally after a placement, a word count crossing a limit. Never on a
     number that was already sitting there when the page loaded. */
  function countTo(node, from, to, options) {
    var opts = options || {};
    var format = opts.format || function (v) { return String(Math.round(v)); };
    if (!node) { return; }
    if (from === to || !motionOK()) { node.textContent = format(to); return; }
    tween(opts.duration || 420, function (t) {
      node.textContent = format(from + (to - from) * t);
    });
  }

  /* Grow a bar to a percentage. The width transition in the stylesheet covers
     a bar that changes; this is for the first paint, where the bar is built
     already full and so has nothing to transition from. */
  function growBar(node, percent, options) {
    var opts = options || {};
    var target = Math.max(0, Math.min(100, percent));
    if (!node) { return; }
    if (!motionOK()) { node.style.width = target + '%'; return; }
    node.style.width = '0%';
    tween(opts.duration || 620, function (t) {
      node.style.width = (target * t) + '%';
    });
  }

  /* Restart a one-shot CSS animation on an element that may already carry the
     class. Reading a layout property is what actually flushes the removal;
     without it the browser coalesces both changes and nothing replays. */
  function replayAnimation(node, className) {
    if (!node || !motionOK()) { return; }
    node.classList.remove(className);
    void node.offsetWidth;
    node.classList.add(className);
  }

  /* ------------------------------------------------------------------------
     7. Shared pieces
     ------------------------------------------------------------------------ */

  function statusNote(text) {
    return el('span', { class: 'status-note', role: 'status', text: text || '' });
  }

  /* `enter` marks a block as having just arrived, so the stylesheet wipes its
     bar in from the top. Restored state must never pass it: a page that
     replays on load every answer the learner gave last week is exactly the
     decoration this system does not do. */
  function feedbackBlock(kind, verdict, body, enter) {
    var classes = 'fb' + (kind === 'correct' ? ' fb-correct' : (kind === 'wrong' ? ' fb-wrong' : ' fb-quiet'));
    if (enter && motionOK()) { classes += ' fb-enter'; }
    var block = el('div', { class: classes });
    var paragraph = el('p', {});
    if (verdict) {
      paragraph.appendChild(el('span', { class: 'fb-verdict', text: verdict }));
      paragraph.appendChild(document.createTextNode(' '));
    }
    if (body) { append(paragraph, body); }
    block.appendChild(paragraph);
    return block;
  }

  function paragraphs(text, className) {
    if (!text) { return []; }
    return String(text).split(/\n{2,}/).map(function (chunk) {
      return el('p', { class: className || null, text: chunk });
    });
  }

  function readItemBank() {
    var node = document.getElementById('items');
    if (!node) { return []; }
    var data = parseJSON(node.textContent, 'the page item bank');
    if (!data) { return []; }
    if (Array.isArray(data)) { return data; }
    return Array.isArray(data.items) ? data.items : [];
  }

  function correctOptionOf(item) {
    var found = null;
    (item.options || []).forEach(function (option) {
      if (option.correct && !found) { found = option; }
    });
    return found;
  }

  /* ------------------------------------------------------------------------
     8. precheck and postcheck
     ------------------------------------------------------------------------ */

  function buildQuiz(root, data, context, mode) {
    var items = readItemBank();
    if (!items.length) {
      root.appendChild(el('p', { class: 'fb', text: 'The question bank for this page is missing.' }));
      return;
    }
    var confidenceLabels = data.confidenceLabels || CONFIDENCE;
    var wager = data.wager !== false;
    var saved = context.get();
    var answers = (saved && saved.answers) || {};
    var confidence = (saved && saved.confidence) || {};
    var submitted = !!(saved && saved.submitted);

    if (data.intro) { append(root, paragraphs(data.intro)); }

    if (wager) {
      var rules = el('div', { class: 'panel panel-alt stake-rules' });
      rules.appendChild(el('p', { class: 'panel-title', text: data.wagerTitle || 'How the stakes work' }));
      rules.appendChild(el('p', {
        text: data.wagerIntro || 'Each item is a bet. Say what you would stake on your answer. ' +
          'You win the stake when you are right and lose it when you are wrong, so being sure and wrong ' +
          'costs more than admitting you are guessing.'
      }));
      var rulesList = el('ul', { class: 'stake-key' });
      confidenceLabels.forEach(function (label, index) {
        var bet = wagerOf(index);
        rulesList.appendChild(el('li', {}, [
          el('span', { class: 'stake-key-label', text: label }),
          el('span', { class: 'stake-key-odds', text: signed(bet.stake) + ' if right, ' + signed(-bet.stake) + ' if wrong' })
        ]));
      });
      rules.appendChild(rulesList);
      rules.appendChild(el('p', {
        class: 'small',
        text: 'The points are not a grade and nobody sees them. What they buy you is the calibration line at the end: whether your confidence matches how right you actually are.'
      }));
      root.appendChild(rules);
    }

    var itemNodes = [];
    items.forEach(function (item, index) {
      var itemId = item.id || ('item-' + (index + 1));
      var stemId = context.id + '-stem-' + itemId;
      var confId = context.id + '-conf-' + itemId;
      var wrap = el('div', { class: 'quiz-item' });

      wrap.appendChild(el('p', { class: 'quiz-num', text: 'Item ' + (index + 1) + ' of ' + items.length }));
      wrap.appendChild(el('p', { class: 'quiz-stem', id: stemId, text: item.stem }));

      var options = el('div', { class: 'choice-list', role: 'radiogroup', 'aria-labelledby': stemId });
      (item.options || []).forEach(function (option, oIndex) {
        var optionId = option.id || String.fromCharCode(97 + oIndex);
        var input = el('input', {
          type: 'radio',
          name: context.id + '-a-' + itemId,
          value: optionId,
          id: context.id + '-a-' + itemId + '-' + optionId
        });
        if (answers[itemId] === optionId) { input.checked = true; }
        input.addEventListener('change', function () {
          answers[itemId] = optionId;
          context.save({ answers: answers, confidence: confidence, submitted: submitted });
        });
        options.appendChild(el('label', { class: 'choice', 'for': input.id }, [input, el('span', { text: option.text })]));
      });
      wrap.appendChild(options);

      var conf = el('div', { class: 'confidence' });
      conf.appendChild(el('p', {
        class: 'confidence-label',
        id: confId,
        text: wager ? 'What do you stake on that answer?' : 'How sure are you?'
      }));
      var confRow = el('div', {
        class: wager ? 'choice-row stake-row' : 'choice-row',
        role: 'radiogroup',
        'aria-labelledby': confId
      });
      confidenceLabels.forEach(function (label, cIndex) {
        var bet = wagerOf(cIndex);
        var input = el('input', {
          type: 'radio',
          name: context.id + '-c-' + itemId,
          value: label,
          id: context.id + '-c-' + itemId + '-' + label.replace(/\s+/g, '-')
        });
        if (confidence[itemId] === label) { input.checked = true; }
        input.addEventListener('change', function () {
          confidence[itemId] = label;
          context.save({ answers: answers, confidence: confidence, submitted: submitted });
        });
        var face = [el('span', { text: label })];
        if (wager) {
          face.push(el('span', {
            class: 'stake-odds',
            text: signed(bet.stake) + ' / ' + signed(-bet.stake),
            'aria-label': 'stake ' + bet.stake + ', win ' + bet.stake + ' or lose ' + bet.stake
          }));
        }
        confRow.appendChild(el('label', { class: 'choice', 'for': input.id }, [input, el('span', { class: 'choice-face' }, face)]));
      });
      conf.appendChild(confRow);
      wrap.appendChild(conf);

      var slot = el('div', { class: 'fb-slot' });
      wrap.appendChild(slot);
      itemNodes.push({ item: item, itemId: itemId, wrap: wrap, slot: slot });
      root.appendChild(wrap);
    });

    var note = statusNote('');
    var resultSlot = el('div', { class: 'result-slot' });
    var button = el('button', {
      type: 'button',
      class: 'btn',
      text: data.submitLabel || (mode === 'precheck' ? 'Save my answers' : 'Show my result')
    });
    root.appendChild(el('div', { class: 'btn-row' }, [button, note]));
    root.appendChild(resultSlot);

    function idOf(item, index) { return item.id || ('item-' + (index + 1)); }

    function isRight(item, chosen) {
      var right = false;
      (item.options || []).forEach(function (option, oIndex) {
        var optionId = option.id || String.fromCharCode(97 + oIndex);
        if (optionId === chosen && option.correct) { right = true; }
      });
      return right;
    }

    function scoreOf(answerMap) {
      var score = 0;
      items.forEach(function (item, index) {
        if (isRight(item, answerMap[idOf(item, index)])) { score += 1; }
      });
      return score;
    }

    /* The wager. Every item pays or costs its stake, so the total can go
       negative. maxPoints is what a learner who was right and sure every
       time would have taken. */
    function pointsOf(answerMap, confMap) {
      var total = 0;
      items.forEach(function (item, index) {
        var itemId = idOf(item, index);
        var at = confidenceLabels.indexOf(confMap[itemId]);
        if (at === -1) { return; }
        var bet = wagerOf(at).stake;
        total += isRight(item, answerMap[itemId]) ? bet : -bet;
      });
      return total;
    }

    function maxPoints() { return items.length * wagerOf(0).stake; }

    /* One row per stake level: how often it was used, how often it paid off,
       and the hit rate that stake was claiming. */
    function bandsOf(answerMap, confMap) {
      return confidenceLabels.map(function (label, index) {
        var bet = wagerOf(index);
        var used = 0;
        var right = 0;
        items.forEach(function (item, i) {
          var itemId = idOf(item, i);
          if (confMap[itemId] !== label) { return; }
          used += 1;
          if (isRight(item, answerMap[itemId])) { right += 1; }
        });
        return {
          label: label,
          stake: bet.stake,
          expect: bet.expect,
          used: used,
          right: right,
          rate: used ? right / used : null
        };
      });
    }

    /* One number for the whole page: how far the learner's hit rate sat from
       what their stakes claimed, weighted by how often each stake was used.
       Negative means confidence ran ahead of accuracy. */
    function calibrationGap(bands) {
      var used = 0;
      var gap = 0;
      bands.forEach(function (band) {
        if (!band.used) { return; }
        used += band.used;
        gap += band.used * (band.rate - band.expect);
      });
      return used ? gap / used : null;
    }

    function calibrationVerdict(gap) {
      if (gap === null) { return 'You did not stake anything, so there is nothing to calibrate.'; }
      if (gap <= -0.15) {
        return 'Your confidence ran ahead of your accuracy. That is the expensive direction: it is what makes a reviewer’s objection feel like an ambush.';
      }
      if (gap >= 0.15) {
        return 'You knew more than you were willing to stake. You can back yourself harder here.';
      }
      return 'Your confidence matched your accuracy. That is the harder half of knowing something, and you have it here.';
    }

    function exportLines(score) {
      var lines = [];
      var label = mode === 'precheck' ? 'Where you stand (pre-check) score' : 'Check again (post-check) score';
      lines.push([label, score + ' of ' + items.length]);
      return lines;
    }

    function showPostFeedback(answerMap, live) {
      itemNodes.forEach(function (node, index) {
        clear(node.slot);
        var chosen = answerMap[node.itemId];
        var chosenOption = null;
        (node.item.options || []).forEach(function (option, oIndex) {
          var optionId = option.id || String.fromCharCode(97 + oIndex);
          if (optionId === chosen) { chosenOption = option; }
        });
        if (!chosenOption) { return; }
        var right = !!chosenOption.correct;
        var block = feedbackBlock(right ? 'correct' : 'wrong', right ? 'Correct.' : 'Not quite.', chosenOption.feedback || '', live);
        if (!right) {
          var answer = correctOptionOf(node.item);
          if (answer) {
            block.appendChild(el('p', { class: 'small', text: 'The right answer: ' + answer.text }));
          }
        }
        node.slot.appendChild(block);
      });
    }

    function report(post) {
      clear(resultSlot);
      var pre = getWidgetState(context.module, data.preId || 'precheck');
      var preScore = (pre && pre.submitted) ? pre.score : null;
      var total = items.length;
      var result = el('div', { class: 'result' });
      result.appendChild(el('h3', { text: 'Your result' }));

      var list = el('dl', {});
      if (preScore === null) {
        list.appendChild(el('dt', { text: 'Before' }));
        list.appendChild(el('dd', { text: 'No pre-check saved on this device' }));
      } else {
        list.appendChild(el('dt', { text: 'Before' }));
        list.appendChild(el('dd', { text: preScore + ' of ' + total }));
      }
      list.appendChild(el('dt', { text: 'After' }));
      list.appendChild(el('dd', { text: post + ' of ' + total }));

      var gain = null;
      if (preScore !== null && preScore < total) {
        gain = (post - preScore) / (total - preScore);
        list.appendChild(el('dt', { text: 'Normalised gain' }));
        list.appendChild(el('dd', { text: gain.toFixed(2) }));
      }
      result.appendChild(list);

      if (gain !== null) {
        result.appendChild(el('p', {
          class: 'small',
          text: 'Normalised gain is the share of what you had left to gain that you did gain. It is (after minus before) divided by (' + total + ' minus before).'
        }));
      } else if (preScore === total) {
        result.appendChild(el('p', { class: 'small', text: 'You had all ' + total + ' right before, so there is no gain to compute.' }));
      }

      var bands = bandsOf(answers, confidence);
      var sure = bands[0] || { used: 0, right: 0 };
      var sureCount = sure.used;
      var sureRight = sure.right;
      var points = pointsOf(answers, confidence);
      var prePoints = (pre && pre.submitted && typeof pre.points === 'number') ? pre.points : null;
      var gap = calibrationGap(bands);

      if (wager) {
        var pointsRow = el('dl', { class: 'result-points' });
        if (prePoints !== null) {
          pointsRow.appendChild(el('dt', { text: 'Points staked before' }));
          pointsRow.appendChild(el('dd', { text: signed(prePoints) + ' of a possible ' + maxPoints() }));
        }
        pointsRow.appendChild(el('dt', { text: 'Points staked after' }));
        pointsRow.appendChild(el('dd', { text: signed(points) + ' of a possible ' + maxPoints() }));
        if (prePoints !== null) {
          var swing = points - prePoints;
          pointsRow.appendChild(el('dt', { text: 'Swing' }));
          pointsRow.appendChild(el('dd', {
            text: swing === 0 ? 'No change' : signed(swing) + ' ' + plural(Math.abs(swing), 'point', 'points')
          }));
        }
        result.appendChild(pointsRow);
      }

      /* Calibration. This is the part worth reading, so it gets a heading of
         its own rather than a sentence tucked under the score. */
      result.appendChild(el('h4', { class: 'result-sub', text: 'Your calibration' }));

      if (wager) {
        var wrapTable = el('div', { class: 'table-wrap' });
        var table = el('table', { class: 'calib-table' });
        table.appendChild(el('caption', { text: 'What each stake claimed, and what it delivered' }));
        var head = el('thead', {});
        head.appendChild(el('tr', {}, [
          el('th', { scope: 'col', text: 'Stake' }),
          el('th', { scope: 'col', text: 'Used' }),
          el('th', { scope: 'col', text: 'Right' }),
          el('th', { scope: 'col', text: 'Your rate' }),
          el('th', { scope: 'col', text: 'That stake claims' })
        ]));
        table.appendChild(head);
        var body = el('tbody', {});
        bands.forEach(function (band) {
          body.appendChild(el('tr', {}, [
            el('th', { scope: 'row', text: band.label + ' (' + signed(band.stake) + ')' }),
            el('td', { text: String(band.used) }),
            el('td', { text: band.used ? String(band.right) : '—' }),
            el('td', { text: band.rate === null ? '—' : percent(band.rate) }),
            el('td', { class: 'calib-expect', text: percent(band.expect) })
          ]));
        });
        table.appendChild(body);
        wrapTable.appendChild(table);
        result.appendChild(wrapTable);
      }

      if (sureCount === 0) {
        result.appendChild(el('p', { text: 'You did not stake ' + confidenceLabels[0] + ' on anything.' }));
      } else {
        result.appendChild(el('p', {
          text: 'You were ' + confidenceLabels[0].toLowerCase() + ' on ' + sureCount + ' ' +
            plural(sureCount, 'item', 'items') + ' and right on ' + sureRight + ' of them.'
        }));
      }
      result.appendChild(el('p', { class: 'calib-verdict', text: calibrationVerdict(gap) }));
      if (wager && items.length < 6) {
        result.appendChild(el('p', {
          class: 'small',
          text: 'On ' + items.length + ' items that is a rough read, not a judgement on how well calibrated you are generally. ' +
            'It is worth watching across modules rather than trusting on one.'
        }));
      }
      resultSlot.appendChild(result);

      var lines = exportLines(post);
      if (preScore !== null) { lines.unshift(['Score before this module', preScore + ' of ' + total]); }
      if (gain !== null) { lines.push(['Normalised gain', gain.toFixed(2)]); }
      if (wager) {
        if (prePoints !== null) { lines.push(['Points staked before', signed(prePoints) + ' of ' + maxPoints()]); }
        lines.push(['Points staked after', signed(points) + ' of ' + maxPoints()]);
      }
      lines.push(['Confidence', confidenceLabels[0] + ' on ' + sureCount + ' of ' + total + ', right on ' + sureRight + ' of those']);
      lines.push(['Calibration', calibrationVerdict(gap)]);
      return {
        lines: lines, gain: gain, preScore: preScore,
        sureCount: sureCount, sureRight: sureRight,
        points: points, prePoints: prePoints, gap: gap
      };
    }

    function missingFirst() {
      for (var i = 0; i < itemNodes.length; i += 1) {
        var id = itemNodes[i].itemId;
        if (!answers[id] || !confidence[id]) { return itemNodes[i]; }
      }
      return null;
    }

    button.addEventListener('click', function () {
      var missing = missingFirst();
      if (missing) {
        var nag = wager
          ? 'Answer every item and set a stake on each one.'
          : 'Answer every item and say how sure you are for each one.';
        note.textContent = nag;
        announce(nag);
        var firstInput = qs('input', missing.wrap);
        if (firstInput) { firstInput.focus(); }
        return;
      }
      var score = scoreOf(answers);
      submitted = true;
      if (mode === 'precheck') {
        context.save({
          answers: answers,
          confidence: confidence,
          score: score,
          points: pointsOf(answers, confidence),
          submitted: true,
          _export: exportLines(score)
        });
        clear(resultSlot);
        resultSlot.appendChild(feedbackBlock('quiet', 'Saved.',
          data.savedNote || 'You will see the answers, and your score, after step 7. That is the point of doing this now.', true));
        note.textContent = 'Saved at ' + nowStamp() + '. You can change an answer and save again.';
        announce('Pre-check saved. The answers come after step 7.');
        context.track('precheck_submit', { score: score, total: items.length });
      } else {
        showPostFeedback(answers, true);
        var summary = report(score);
        context.save({
          answers: answers,
          confidence: confidence,
          score: score,
          points: summary.points,
          prePoints: summary.prePoints,
          calibrationGap: summary.gap,
          preScore: summary.preScore,
          gain: summary.gain,
          submitted: true,
          _export: summary.lines
        });
        note.textContent = 'Saved at ' + nowStamp() + '.';
        announce('Post-check scored. You got ' + score + ' of ' + items.length + '.');
        context.track('postcheck_submit', { score: score, total: items.length, gain: summary.gain });
      }
    });

    /* Restore a page that was already submitted. */
    if (saved && saved.submitted) {
      if (mode === 'precheck') {
        resultSlot.appendChild(feedbackBlock('quiet', 'Saved.',
          data.savedNote || 'You will see the answers, and your score, after step 7. That is the point of doing this now.'));
        note.textContent = 'Saved earlier. You can change an answer and save again.';
      } else {
        showPostFeedback(answers);
        report(scoreOf(answers));
        note.textContent = 'Saved earlier.';
      }
    }
  }

  register('precheck', function (root, data, context) { buildQuiz(root, data, context, 'precheck'); });
  register('postcheck', function (root, data, context) { buildQuiz(root, data, context, 'postcheck'); });

  /* ------------------------------------------------------------------------
     9. reveal-steps
     ------------------------------------------------------------------------ */

  register('reveal-steps', function (root, data, context) {
    var saved = context.get();
    var predictions = (saved && saved.predictions) || {};
    var revealed = (saved && saved.revealed) || {};
    var steps = data.steps || [];

    if (data['case']) {
      var casePanel = el('div', { class: 'panel panel-alt' });
      if (data['case'].title) { casePanel.appendChild(el('p', { class: 'panel-title', text: data['case'].title })); }
      append(casePanel, paragraphs(data['case'].text));
      root.appendChild(casePanel);
    }
    if (data.intro) { append(root, paragraphs(data.intro)); }

    var save = debounce(function () {
      context.save({ predictions: predictions, revealed: revealed, _export: exportLines() });
    }, 500);

    function exportLines() {
      return steps.map(function (step, index) {
        var stepId = step.id || ('s' + (index + 1));
        return ['Worked example, prompt ' + (index + 1) + '. ' + step.prompt, predictions[stepId] || ''];
      });
    }

    steps.forEach(function (step, index) {
      var stepId = step.id || ('s' + (index + 1));
      var block = el('div', { class: 'reveal-step' });
      var inputId = context.id + '-' + stepId;

      block.appendChild(el('p', { class: 'reveal-prompt', text: 'Prompt ' + (index + 1) + '. ' + step.prompt }));
      block.appendChild(el('label', { class: 'field-label', 'for': inputId, text: data.predictLabel || 'Your prediction' }));
      var input = el('input', { type: 'text', id: inputId, placeholder: step.placeholder || '' });
      input.value = predictions[stepId] || '';
      input.addEventListener('input', function () {
        predictions[stepId] = input.value;
        save();
      });
      block.appendChild(input);

      var slot = el('div', {});
      var button = el('button', { type: 'button', class: 'btn btn-secondary btn-small', text: data.revealLabel || 'Reveal' });
      block.appendChild(el('div', { class: 'btn-row' }, [button]));
      block.appendChild(slot);

      function show(fromClick) {
        clear(slot);
        var answer = el('div', { class: 'reveal-answer' });
        answer.appendChild(el('span', { class: 'reveal-answer-label', text: 'Reveal' }));
        append(answer, paragraphs(step.reveal));
        if (step.note) {
          var note = el('div', { class: 'reveal-note' });
          note.appendChild(el('span', { class: 'reveal-note-label', text: 'Why this is conceptual' }));
          append(note, paragraphs(step.note));
          if (step.noteLabel) { note.firstChild.textContent = step.noteLabel; }
          answer.appendChild(note);
        }
        slot.appendChild(answer);
        /* The one place a height animation earns its cost: this is the payoff
           of the step and it pushes the rest of the page down, so growing it
           open tells the learner where the new text came from. */
        if (fromClick) {
          answer.classList.add('is-entering');
          revealBlock(answer);
        }
        button.textContent = data.revealedLabel || 'Revealed';
        button.setAttribute('aria-disabled', 'true');
        button.disabled = true;
        if (fromClick) {
          announce('Revealed. ' + step.reveal);
          context.track('reveal', { step: stepId });
          revealed[stepId] = true;
          context.save({ predictions: predictions, revealed: revealed, _export: exportLines() });
        }
      }

      button.addEventListener('click', function () { show(true); });
      if (revealed[stepId]) { show(false); }

      root.appendChild(block);
    });
  });

  /* ------------------------------------------------------------------------
     10. cardsort
     ------------------------------------------------------------------------ */

  register('cardsort', function (root, data, context) {
    var bins = data.bins || [];
    var cards = data.cards || [];
    var saved = context.get();
    var placements = (saved && saved.placements) || {};
    var selectedId = null;
    var cardNodes = {};

    var binById = {};
    bins.forEach(function (bin) { binById[bin.id] = bin; });

    if (data.instructions) { append(root, paragraphs(data.instructions)); }

    /* Sticky bar: status, counts and the drop targets for the optional drag. */
    var bar = el('div', { class: 'sort-bar' });
    var status = el('p', { class: 'sort-bar-status', role: 'status', text: 'No card chosen yet.' });
    bar.appendChild(status);
    var binRow = el('div', { class: 'sort-bins' });
    var binCountNodes = {};
    bins.forEach(function (bin, index) {
      var count = el('span', { class: 'bin-count', text: '0 placed' });
      binCountNodes[bin.id] = count;
      var target = el('div', {
        class: 'bin-btn',
        'data-bin': bin.id
      }, [el('span', { class: 'bin-key', text: String(index + 1) }), bin.label, count]);
      target.addEventListener('dragover', function (event) {
        event.preventDefault();
        target.classList.add('is-dropover');
      });
      target.addEventListener('dragleave', function () { target.classList.remove('is-dropover'); });
      target.addEventListener('drop', function (event) {
        event.preventDefault();
        target.classList.remove('is-dropover');
        var cardId = '';
        try { cardId = event.dataTransfer.getData('text/plain'); } catch (err) { cardId = selectedId || ''; }
        if (cardId) { place(cardId, bin.id); }
      });
      binRow.appendChild(target);
    });
    bar.appendChild(binRow);
    bar.appendChild(el('p', {
      class: 'small sort-hint',
      text: data.hint || 'Choose a card, then press 1, 2, 3 or 4, or use the four buttons under the card. Your score counts the cards you place right the first time.'
    }));
    root.appendChild(bar);

    var list = el('ol', { class: 'sort-cards' });
    root.appendChild(list);

    var summarySlot = el('div', {});
    var resetButton = el('button', { type: 'button', class: 'btn btn-secondary btn-small', text: 'Start the sort again' });
    root.appendChild(el('div', { class: 'btn-row' }, [resetButton]));
    root.appendChild(summarySlot);

    function scoreNow() {
      var right = 0;
      var placed = 0;
      cards.forEach(function (card) {
        var record = placements[card.id];
        if (!record || !record.done) { return; }
        placed += 1;
        if (record.correct) { right += 1; }
      });
      return { right: right, placed: placed, total: cards.length };
    }

    function exportLines() {
      var s = scoreNow();
      return [['Card sort', s.right + ' of ' + s.total + ' placed right the first time']];
    }

    var lastCounts = {};

    function updateCounts(live) {
      var counts = {};
      bins.forEach(function (bin) { counts[bin.id] = 0; });
      cards.forEach(function (card) {
        var record = placements[card.id];
        if (record && record.done && counts[record.bin] !== undefined) { counts[record.bin] += 1; }
      });
      bins.forEach(function (bin) {
        var node = binCountNodes[bin.id];
        var to = counts[bin.id];
        var from = lastCounts[bin.id] === undefined ? to : lastCounts[bin.id];
        var render = function (v) { return Math.round(v) + ' placed'; };
        /* The tally only ticks when it moved because of something the learner
           just did. On load it is simply the number it already was. */
        if (live && from !== to) {
          countTo(node, from, to, { format: render, duration: 360 });
        } else {
          node.textContent = render(to);
        }
        lastCounts[bin.id] = to;
      });
    }

    function setSelected(cardId) {
      selectedId = cardId;
      cards.forEach(function (card) {
        var node = cardNodes[card.id];
        if (!node) { return; }
        var on = card.id === cardId;
        node.li.classList.toggle('is-selected', on);
        node.select.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      if (cardId) {
        var index = 0;
        cards.forEach(function (card, i) { if (card.id === cardId) { index = i + 1; } });
        status.textContent = 'Card ' + index + ' chosen. Press 1, 2, 3 or 4, or use the buttons under the card.';
      } else {
        status.textContent = 'No card chosen yet.';
      }
    }

    function renderCardState(card, live) {
      var node = cardNodes[card.id];
      var record = placements[card.id];
      clear(node.slot);
      node.li.classList.remove('is-correct', 'is-wrong');
      if (!record) {
        node.state.textContent = 'Not placed yet.';
        node.binButtons.forEach(function (button) { button.disabled = false; });
        return;
      }
      var bin = binById[record.bin];
      var binLabel = bin ? bin.label : record.bin;
      if (record.done) {
        node.li.classList.add('is-correct');
        node.state.textContent = 'Placed in ' + binLabel + '. ' + (record.correct ? 'Counted as correct.' : 'Right, but after ' + record.attempts + ' tries, so it does not count.');
        node.binButtons.forEach(function (button) { button.disabled = true; });
      } else {
        node.li.classList.add('is-wrong');
        node.state.textContent = 'Last try: ' + binLabel + '. Not right yet. Try again.';
        node.binButtons.forEach(function (button) { button.disabled = false; });
      }
      var right = record.done;
      var verdict = right ? 'Correct.' : 'Not quite.';
      var body = right
        ? ((bin && bin.correctFeedback) || card.correctFeedback || 'That is the right bin.')
        : ((card.feedback && card.feedback[record.bin]) || 'That is not the right bin. Look again at what the card does.');
      var block = feedbackBlock(right ? 'correct' : 'wrong', verdict, body, live);
      /* Mark which card this happened to. The block below says what happened;
         in a list of twelve, this says where. */
      if (live) {
        node.li.classList.remove('is-just-right', 'is-just-wrong');
        replayAnimation(node.li, right ? 'is-just-right' : 'is-just-wrong');
      }
      if (right && !record.correct) {
        block.appendChild(el('p', { class: 'small', text: 'It took ' + record.attempts + ' tries, so this one is not counted in the score.' }));
      }
      if (right && record.correct && record.attempts === 2) {
        block.appendChild(el('p', { class: 'small', text: 'This card is one where the second thought is the right one, so it still counts.' }));
      }
      node.slot.appendChild(block);
    }

    var announceSummary = false;

    function maybeSummary() {
      var s = scoreNow();
      var allDone = cards.every(function (card) {
        var record = placements[card.id];
        return record && record.done;
      });
      clear(summarySlot);
      if (!allDone) { return; }
      var box = el('div', { class: 'sort-summary' });
      box.appendChild(el('h3', { text: 'How the sort went' }));
      box.appendChild(el('p', { text: 'You placed ' + s.right + ' of ' + s.total + ' right the first time.' }));
      if (data.summary) {
        box.appendChild(el('h4', { text: data.summaryTitle || 'The hard cases' }));
        append(box, paragraphs(data.summary));
      }
      summarySlot.appendChild(box);
      if (!announceSummary) { return; }
      announceSummary = false;
      announce('Sort finished. You placed ' + s.right + ' of ' + s.total + ' right the first time.');
      context.track('sort_done', { right: s.right, total: s.total });
    }

    function place(cardId, binId) {
      var card = null;
      cards.forEach(function (candidate) { if (candidate.id === cardId) { card = candidate; } });
      if (!card) { return; }
      var record = placements[cardId] || { attempts: 0, done: false };
      if (record.done) { return; }
      record.attempts += 1;
      record.bin = binId;
      var right = binId === card.answer;
      record.done = right;
      if (right) {
        record.correct = record.attempts === 1 || (card.correctOnSecondAttempt === true && record.attempts === 2);
      } else {
        record.correct = false;
      }
      placements[cardId] = record;
      context.save({ placements: placements, _export: exportLines() });
      context.track('sort_place', { card: cardId, bin: binId, attempt: record.attempts, right: right });
      renderCardState(card, true);
      updateCounts(true);
      announceSummary = true;
      maybeSummary();
      announceSummary = false;
      var binLabel = binById[binId] ? binById[binId].label : binId;
      announce((right ? 'Correct. ' : 'Not quite. ') + 'Card placed in ' + binLabel + '.');
      if (right) { setSelected(null); }
      var node = cardNodes[cardId];
      if (node && node.select) { node.select.focus(); }
    }

    cards.forEach(function (card, index) {
      var li = el('li', { class: 'sort-card' });
      var select = el('button', {
        type: 'button',
        class: 'sort-card-select',
        'aria-pressed': 'false',
        draggable: 'true'
      });
      select.appendChild(el('span', { class: 'sort-card-num', text: 'Card ' + (index + 1) + ' of ' + cards.length }));
      select.appendChild(el('span', { class: 'sort-card-text', text: card.text }));
      if (card.source) { select.appendChild(el('span', { class: 'sort-card-source', text: card.source })); }
      var state = el('span', { class: 'sort-card-state', text: 'Not placed yet.' });
      select.appendChild(state);
      select.addEventListener('click', function () {
        setSelected(selectedId === card.id ? null : card.id);
      });
      select.addEventListener('dragstart', function (event) {
        try { event.dataTransfer.setData('text/plain', card.id); } catch (err) { /* older browsers */ }
        setSelected(card.id);
      });
      li.appendChild(select);

      var body = el('div', { class: 'sort-card-body' });
      var binButtons = [];
      var buttonRow = el('div', { class: 'sort-card-bins' });
      bins.forEach(function (bin, binIndex) {
        var button = el('button', {
          type: 'button',
          class: 'bin-btn',
          'aria-label': 'Place card ' + (index + 1) + ' in ' + bin.label +
            '. Keyboard shortcut ' + (binIndex + 1) + '.'
        }, [
          el('span', { class: 'bin-key', text: String(binIndex + 1) }),
          document.createTextNode(bin.label)
        ]);
        button.addEventListener('click', function () { place(card.id, bin.id); });
        binButtons.push(button);
        buttonRow.appendChild(button);
      });
      body.appendChild(buttonRow);
      var slot = el('div', {});
      body.appendChild(slot);
      li.appendChild(body);
      list.appendChild(li);

      cardNodes[card.id] = { li: li, select: select, state: state, slot: slot, binButtons: binButtons };
    });

    /* Number keys place the chosen card. */
    root.addEventListener('keydown', function (event) {
      if (!selectedId) { return; }
      if (event.altKey || event.ctrlKey || event.metaKey) { return; }
      var index = parseInt(event.key, 10);
      if (!index || index < 1 || index > bins.length) { return; }
      var target = event.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) { return; }
      event.preventDefault();
      place(selectedId, bins[index - 1].id);
    });

    resetButton.addEventListener('click', function () {
      placements = {};
      context.save({ placements: placements, _export: exportLines() });
      cards.forEach(function (card) { renderCardState(card); });
      updateCounts();
      clear(summarySlot);
      setSelected(null);
      announce('The sort has been reset. All twelve cards are back.');
    });

    cards.forEach(function (card) { renderCardState(card); });
    updateCounts();
    maybeSummary();
  });

  /* ------------------------------------------------------------------------
     11. diagnose

     The reverse of the card sort. Nothing here is sorted into a right bin;
     the learner is handed something broken and has to find what is wrong with
     it, on a budget. There are always more questions worth asking than there
     are probes to spend, so choosing the question is the assessed act.
     ------------------------------------------------------------------------ */

  register('diagnose', function (root, data, context) {
    var probes = data.probes || [];
    if (!probes.length) {
      root.appendChild(el('p', { class: 'fb', text: 'This clinic has no probes to spend.' }));
      return;
    }

    var budget = typeof data.moves === 'number' ? data.moves : 4;
    var flaws = probes.filter(function (probe) { return !!probe.flaw; });
    var saved = context.get();
    var used = Array.isArray(saved && saved.used) ? saved.used.slice() : [];
    var answer = (saved && saved.answer) || '';
    var committed = !!(saved && saved.committed);
    var ticks = (saved && saved.ticks) || {};

    function probeById(id) {
      var found = null;
      probes.forEach(function (probe) { if (probe.id === id) { found = probe; } });
      return found;
    }

    function usedProbes() {
      return used.map(probeById).filter(Boolean);
    }

    function foundFlaws() {
      return usedProbes().filter(function (probe) { return !!probe.flaw; });
    }

    function missedFlaws() {
      return flaws.filter(function (probe) { return used.indexOf(probe.id) === -1; });
    }

    function movesLeft() { return Math.max(0, budget - used.length); }

    function huntOver() { return movesLeft() === 0 || missedFlaws().length === 0; }

    function label() { return data.exportLabel || 'The clinic'; }

    function exportLines() {
      var spent = usedProbes().map(function (probe) { return probe.label; }).join('; ');
      var lines = [];
      lines.push([label() + ': probes spent', used.length + ' of ' + budget + (spent ? ' (' + spent + ')' : '')]);
      lines.push([label() + ': problems found', foundFlaws().length + ' of ' + flaws.length]);
      if (committed && answer) {
        lines.push([(data.commit && data.commit.question) || 'My verdict', answer]);
      }
      return lines;
    }

    function persist() {
      context.save({
        used: used,
        answer: answer,
        committed: committed,
        ticks: ticks,
        found: foundFlaws().length,
        total: flaws.length,
        _export: exportLines()
      });
    }

    if (data.intro) { append(root, paragraphs(data.intro)); }

    /* The case under review. */
    var caseBox = el('div', { class: 'panel clinic-case' });
    if (data.caseLabel) { caseBox.appendChild(el('p', { class: 'panel-title', text: data.caseLabel })); }
    if (data.caseTitle) { caseBox.appendChild(el('p', { class: 'clinic-case-title', text: data.caseTitle })); }
    append(caseBox, paragraphs(data.caseText));
    if (data.caseNote) { caseBox.appendChild(el('p', { class: 'small muted', text: data.caseNote })); }
    root.appendChild(caseBox);

    /* The budget. One cell per probe, filled as it is spent. Flat and
       hairline, and never colour alone: the count is written out beside it. */
    var meter = el('div', { class: 'clinic-meter' });
    var meterCount = el('p', { class: 'clinic-meter-count', role: 'status' });
    var meterCells = el('div', { class: 'clinic-meter-cells', 'aria-hidden': 'true' });
    meter.appendChild(meterCount);
    meter.appendChild(meterCells);
    root.appendChild(meter);
    watchSticky(meter);

    var probeHost = el('div', { class: 'clinic-probes' });
    if (data.probeTitle) { probeHost.appendChild(el('h3', { class: 'clinic-sub', text: data.probeTitle })); }
    if (data.probeHint) { probeHost.appendChild(el('p', { class: 'note-line', text: data.probeHint })); }
    var probeList = el('div', { class: 'clinic-probe-list' });
    probeHost.appendChild(probeList);
    root.appendChild(probeHost);

    var commitSlot = el('div', { class: 'clinic-commit-slot' });
    root.appendChild(commitSlot);

    var buttons = {};
    var slots = {};

    function renderMeter(live) {
      var left = movesLeft();
      meterCount.textContent = left === 0
        ? 'No probes left. You spent all ' + budget + '.'
        : left + ' of ' + budget + ' ' + plural(left, 'probe', 'probes') + ' left.';
      clear(meterCells);
      for (var i = 0; i < budget; i += 1) {
        var spent = i < used.length;
        var cell = el('span', { class: spent ? 'clinic-cell is-spent' : 'clinic-cell' });
        /* Only the cell just spent fills across. The ones spent earlier were
           already full before this click and must not replay. The budget
           draining is the tension of this exercise, so it is worth showing. */
        if (live && spent && i === used.length - 1) { cell.className += ' is-just-spent'; }
        meterCells.appendChild(cell);
      }
    }

    function renderProbe(probe, live) {
      var spent = used.indexOf(probe.id) !== -1;
      var button = buttons[probe.id];
      var slot = slots[probe.id];
      button.disabled = spent || huntOver();
      button.setAttribute('aria-pressed', spent ? 'true' : 'false');
      clear(slot);
      if (!spent) { return; }
      var block = feedbackBlock(
        probe.flaw ? 'wrong' : 'quiet',
        probe.flaw ? (probe.severity ? probe.severity + '.' : 'Problem.') : 'Nothing wrong here.',
        probe.result || '',
        live && probe.id === used[used.length - 1]
      );
      if (probe.note) { block.appendChild(el('p', { class: 'small', text: probe.note })); }
      slot.appendChild(block);
    }

    probes.forEach(function (probe) {
      var row = el('div', { class: 'clinic-probe' });
      var button = el('button', { type: 'button', class: 'probe-btn', text: probe.label });
      var slot = el('div', { class: 'fb-slot' });
      buttons[probe.id] = button;
      slots[probe.id] = slot;
      button.addEventListener('click', function () {
        if (used.indexOf(probe.id) !== -1 || huntOver()) { return; }
        used.push(probe.id);
        persist();
        renderAll(true);
        var left = movesLeft();
        announce((probe.flaw ? 'That found a problem. ' : 'Nothing wrong there. ') +
          left + ' ' + plural(left, 'probe', 'probes') + ' left.');
        context.track('diagnose_probe', { probe: probe.id, flaw: !!probe.flaw, left: left });
      });
      row.appendChild(button);
      row.appendChild(slot);
      probeList.appendChild(row);
    });

    /* The verdict. Only once the probes are done, and in the learner's own
       words: they commit to a judgement before they are shown ours. */
    function renderCommit() {
      clear(commitSlot);
      if (!huntOver()) { return; }
      var commit = data.commit || {};
      var box = el('div', { class: 'clinic-commit' });
      box.appendChild(el('h3', { class: 'clinic-sub', text: commit.title || 'Your verdict' }));
      if (commit.intro) { append(box, paragraphs(commit.intro)); }

      var fieldId = context.id + '-verdict';
      box.appendChild(el('label', {
        class: 'field-label',
        'for': fieldId,
        text: commit.question || 'In one sentence, what would you send back to the author?'
      }));
      var input = el('textarea', {
        id: fieldId,
        rows: commit.rows || 3,
        placeholder: commit.placeholder || 'One sentence is enough.'
      });
      input.value = answer;
      var note = statusNote('');
      var send = el('button', { type: 'button', class: 'btn', text: commit.submitLabel || 'Send my verdict' });
      var result = el('div', { class: 'result-slot' });

      var autosave = debounce(function () { persist(); }, 600);
      input.addEventListener('input', function () {
        answer = input.value;
        autosave();
      });

      function showResult() {
        clear(result);
        var found = foundFlaws();
        var missed = missedFlaws();
        var panel = el('div', { class: 'result' });
        panel.appendChild(el('h4', { text: 'What was actually wrong with it' }));
        panel.appendChild(el('p', {
          class: 'clinic-score',
          text: 'You found ' + found.length + ' of the ' + flaws.length + ' real problems, and spent ' +
            used.length + ' of ' + budget + ' ' + plural(budget, 'probe', 'probes') + ' doing it.'
        }));

        if (missed.length) {
          panel.appendChild(el('p', { text: 'These were in the paper too, and you did not ask about them:' }));
          var list = el('ul', { class: 'clinic-missed' });
          missed.forEach(function (probe) {
            list.appendChild(el('li', {}, [
              el('span', { class: 'clinic-missed-label', text: probe.label }),
              el('span', { text: probe.result || '' })
            ]));
          });
          panel.appendChild(list);
        } else {
          panel.appendChild(el('p', { text: 'You asked about every one of them. That is the whole set.' }));
        }

        if (commit.reference) {
          panel.appendChild(el('h4', { text: commit.referenceTitle || 'What a reviewer would write' }));
          append(panel, paragraphs(commit.reference, 'reference-text'));
        }

        if (Array.isArray(commit.rubric) && commit.rubric.length) {
          panel.appendChild(el('p', { class: 'field-label', text: commit.rubricLabel || 'Does your sentence do these?' }));
          commit.rubric.forEach(function (line, index) {
            var tickId = context.id + '-tick-' + index;
            var tick = el('input', { type: 'checkbox', id: tickId });
            tick.checked = !!ticks[index];
            tick.addEventListener('change', function () {
              ticks[index] = tick.checked;
              persist();
            });
            panel.appendChild(el('label', { class: 'choice', 'for': tickId }, [tick, el('span', { text: line })]));
          });
        }

        if (data.summary) { append(panel, paragraphs(data.summary, 'clinic-summary')); }
        result.appendChild(panel);
      }

      send.addEventListener('click', function () {
        if (!input.value.trim()) {
          note.textContent = 'Write your one sentence first. Committing to it is the point.';
          announce(note.textContent);
          input.focus();
          return;
        }
        answer = input.value;
        committed = true;
        persist();
        showResult();
        note.textContent = 'Saved at ' + nowStamp() + '.';
        announce('Verdict saved. The reviewer letter is below.');
        context.track('diagnose_commit', { found: foundFlaws().length, total: flaws.length, probes: used.length });
      });

      box.appendChild(input);
      box.appendChild(el('div', { class: 'btn-row' }, [send, note]));
      box.appendChild(result);
      commitSlot.appendChild(box);

      if (committed) {
        showResult();
        note.textContent = 'Saved earlier. You can rewrite it and send again.';
      }

      var restart = el('button', {
        type: 'button',
        class: 'btn btn-secondary',
        text: data.restartLabel || 'Start the clinic again'
      });
      restart.addEventListener('click', function () {
        used = [];
        committed = false;
        ticks = {};
        persist();
        renderAll();
        announce('The clinic has been reset. All ' + budget + ' probes are back.');
      });
      commitSlot.appendChild(el('div', { class: 'btn-row' }, [restart]));
    }

    function renderAll(live) {
      renderMeter(live);
      probes.forEach(function (probe) { renderProbe(probe, live); });
      renderCommit();
    }

    renderAll();
  });

  /* ------------------------------------------------------------------------
     12. your-study
     ------------------------------------------------------------------------ */

  register('your-study', function (root, data, context) {
    var fields = data.fields || [];
    var saved = context.get();
    var values = (saved && saved.values) || {};

    if (data.intro) { append(root, paragraphs(data.intro)); }

    function valueOf(field) { return values[field.id]; }

    function textFor(field) {
      var value = values[field.id];
      if (field.type === 'checkbox') { return value ? 'Yes' : 'No'; }
      if (field.type === 'checkgroup') { return (value || []).join(', '); }
      if (field.type === 'grid') {
        var rows = gridRows(field);
        if (!rows.length) { return ''; }
        return rows.map(function (row) {
          var cells = (value && value[row.id]) || {};
          return row.label + '\n' + (field.columns || []).map(function (column) {
            return '  ' + column.label + ': ' + (cells[column.id] || '');
          }).join('\n');
        }).join('\n');
      }
      return value || '';
    }

    function exportLines() {
      return fields.map(function (field) { return [field.label, textFor(field)]; });
    }

    /* The same text, keyed by field id. The proposal view on the hub pulls
       single sections out of this rather than guessing from export labels. */
    function exportFields() {
      var out = {};
      fields.forEach(function (field) { out[field.id] = textFor(field); });
      return out;
    }

    function gridRows(field) {
      if (field.rowsFrom) {
        var chosen = values[field.rowsFrom] || [];
        return chosen.map(function (label) { return { id: label, label: label }; });
      }
      return (field.rows || []).map(function (row) {
        return typeof row === 'string' ? { id: row, label: row } : row;
      });
    }

    var gridHosts = [];

    var save = debounce(function () {
      context.save({ values: values, _fields: exportFields(), _export: exportLines() });
      note.textContent = 'Saved at ' + nowStamp() + '.';
    }, 600);

    var note = statusNote(saved && saved.ts ? 'Last saved ' + dateStamp(saved.ts) + '.' : 'Nothing saved yet.');

    fields.forEach(function (field) {
      var wrap = el('div', { class: 'field' });
      var fieldId = context.id + '-' + field.id;

      if (field.type === 'checkbox') {
        var box = el('input', { type: 'checkbox', id: fieldId });
        box.checked = !!values[field.id];
        box.addEventListener('change', function () {
          values[field.id] = box.checked;
          save();
        });
        wrap.appendChild(el('label', { class: 'study-check', 'for': fieldId }, [box, el('span', { text: field.label })]));
        if (field.hint) { wrap.appendChild(el('p', { class: 'field-hint', text: field.hint })); }
        root.appendChild(wrap);
        return;
      }

      if (field.type === 'checkgroup') {
        var group = el('fieldset', {});
        group.appendChild(el('legend', { class: 'field-label', text: field.label }));
        if (field.hint) { group.appendChild(el('p', { class: 'field-hint', text: field.hint })); }
        if (!Array.isArray(values[field.id])) { values[field.id] = []; }
        (field.options || []).forEach(function (option, oIndex) {
          var optionId = fieldId + '-' + oIndex;
          var box = el('input', { type: 'checkbox', id: optionId, value: option });
          box.checked = values[field.id].indexOf(option) !== -1;
          box.addEventListener('change', function () {
            var list = values[field.id] || [];
            var at = list.indexOf(option);
            if (box.checked && at === -1) { list.push(option); }
            if (!box.checked && at !== -1) { list.splice(at, 1); }
            values[field.id] = list;
            gridHosts.forEach(function (host) { if (host.field.rowsFrom === field.id) { host.render(); } });
            save();
          });
          group.appendChild(el('label', { class: 'choice', 'for': optionId }, [box, el('span', { text: option })]));
        });
        wrap.appendChild(group);
        root.appendChild(wrap);
        return;
      }

      if (field.type === 'grid') {
        var gridWrap = el('div', {});
        gridWrap.appendChild(el('p', { class: 'field-label', text: field.label }));
        if (field.hint) { gridWrap.appendChild(el('p', { class: 'field-hint', text: field.hint })); }
        var host = el('div', {});
        gridWrap.appendChild(host);
        wrap.appendChild(gridWrap);
        root.appendChild(wrap);

        var renderer = {
          field: field,
          render: function () {
            clear(host);
            var rows = gridRows(field);
            if (!rows.length) {
              host.appendChild(el('p', { class: 'field-hint', text: field.emptyText || 'Choose above and the boxes appear here.' }));
              return;
            }
            if (!values[field.id] || typeof values[field.id] !== 'object') { values[field.id] = {}; }
            rows.forEach(function (row) {
              var block = el('div', { class: 'panel' });
              block.appendChild(el('p', { class: 'panel-title', text: row.label }));
              if (!values[field.id][row.id]) { values[field.id][row.id] = {}; }
              (field.columns || []).forEach(function (column) {
                var cellId = fieldId + '-' + String(row.id).replace(/\W+/g, '-') + '-' + column.id;
                block.appendChild(el('label', { class: 'field-label', 'for': cellId, text: column.label }));
                var input = el('textarea', { id: cellId, rows: column.rows || 2, placeholder: column.starter || '' });
                input.value = values[field.id][row.id][column.id] || '';
                input.addEventListener('input', function () {
                  values[field.id][row.id][column.id] = input.value;
                  save();
                });
                block.appendChild(input);
              });
              host.appendChild(block);
            });
          }
        };
        gridHosts.push(renderer);
        renderer.render();
        return;
      }

      /* text and textarea */
      wrap.appendChild(el('label', { class: 'field-label', 'for': fieldId, text: field.label }));
      var starters = field.starters || (field.starter ? [field.starter] : []);
      if (starters.length === 1) {
        wrap.appendChild(el('p', { class: 'field-hint', text: 'Sentence starter: ' + starters[0] }));
      } else if (starters.length > 1) {
        var hint = el('div', { class: 'field-hint' });
        hint.appendChild(el('span', { text: 'Sentence starters:' }));
        hint.appendChild(el('ul', {}, starters.map(function (starter) { return el('li', { text: starter }); })));
        wrap.appendChild(hint);
      }
      if (field.hint) { wrap.appendChild(el('p', { class: 'field-hint', text: field.hint })); }
      var control = field.type === 'text'
        ? el('input', { type: 'text', id: fieldId, placeholder: field.placeholder || starters[0] || '' })
        : el('textarea', { id: fieldId, rows: field.rows || 4, placeholder: field.placeholder || starters[0] || '' });
      control.value = valueOf(field) || '';
      control.addEventListener('input', function () {
        values[field.id] = control.value;
        save();
      });
      wrap.appendChild(control);
      root.appendChild(wrap);
    });

    var saveButton = el('button', { type: 'button', class: 'btn', text: 'Save' });
    var copyButton = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Copy as text' });
    var downloadButton = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Download as .txt' });
    root.appendChild(el('div', { class: 'btn-row no-print' }, [saveButton, copyButton, downloadButton, note]));

    function asText() {
      var header = (data.exportTitle || moduleTitleOf(context.module, null)) + '\nSaved ' + dateStamp(Date.now()) + '\n\n';
      return header + linesToText(exportLines());
    }

    saveButton.addEventListener('click', function () {
      context.save({ values: values, _fields: exportFields(), _export: exportLines() });
      note.textContent = 'Saved at ' + nowStamp() + '.';
      announce('Your study notes are saved on this device.');
      context.track('study_save', {});
    });

    copyButton.addEventListener('click', function () {
      Promise.resolve(copyText(asText())).then(function (ok) {
        note.textContent = ok ? 'Copied to the clipboard.' : 'The browser blocked the copy. Use Download as .txt instead.';
        announce(note.textContent);
      });
    });

    downloadButton.addEventListener('click', function () {
      var name = data.filename || ('your-study-' + context.module + '.txt');
      var ok = downloadText(name, asText());
      note.textContent = ok ? 'Downloaded as ' + name + '.' : 'The browser blocked the download. Use Copy as text instead.';
      announce(note.textContent);
    });

    if (STORAGE_OK === false) {
      root.appendChild(feedbackBlock('quiet', 'Note.',
        'This browser is not letting the page save to your device. Copy or download your text before you leave the page.'));
    }
  });

  /* ------------------------------------------------------------------------
     13. muddiest and rating
     ------------------------------------------------------------------------ */

  register('muddiest', function (root, data, context) {
    var saved = context.get();
    var fieldId = context.id + '-input';
    if (data.intro) { append(root, paragraphs(data.intro)); }
    root.appendChild(el('label', { class: 'field-label', 'for': fieldId, text: data.prompt || 'What is still unclear?' }));
    var input = el('input', { type: 'text', id: fieldId, placeholder: data.placeholder || 'One line is enough.' });
    input.value = (saved && saved.text) || '';
    root.appendChild(input);
    var note = statusNote(saved && saved.submitted ? 'Saved earlier.' : '');
    var button = el('button', { type: 'button', class: 'btn', text: data.submitLabel || 'Save this' });
    root.appendChild(el('div', { class: 'btn-row' }, [button, note]));

    button.addEventListener('click', function () {
      var text = input.value.trim();
      if (!text) {
        note.textContent = 'Write one line first.';
        input.focus();
        return;
      }
      context.save({ text: text, submitted: true, _export: [[data.prompt || 'Muddiest point', text]] });
      note.textContent = 'Saved at ' + nowStamp() + '.';
      announce('Your muddiest point is saved on this device.');
      context.track('muddiest_submit', {});
    });
  });

  register('rating', function (root, data, context) {
    var min = data.min || 1;
    var max = data.max || 5;
    var saved = context.get();
    var value = (saved && saved.value) || null;
    var labelId = context.id + '-label';

    if (data.intro) { append(root, paragraphs(data.intro)); }
    root.appendChild(el('p', { class: 'field-label', id: labelId, text: data.prompt || 'How useful was this?' }));

    var row = el('div', { class: 'rating-row', role: 'group', 'aria-labelledby': labelId });
    var buttons = [];
    for (var n = min; n <= max; n += 1) {
      (function (score) {
        var button = el('button', {
          type: 'button',
          class: 'rating-btn',
          'aria-pressed': value === score ? 'true' : 'false',
          'aria-label': score + ' out of ' + max,
          text: String(score)
        });
        button.addEventListener('click', function () {
          value = score;
          buttons.forEach(function (other) {
            other.setAttribute('aria-pressed', other === button ? 'true' : 'false');
          });
          context.save({ value: score, _export: [[data.prompt || 'Module rating', score + ' of ' + max]] });
          note.textContent = 'Saved. You chose ' + score + ' of ' + max + '.';
          announce('Rating saved. ' + score + ' of ' + max + '.');
          context.track('rating_submit', { value: score });
        });
        buttons.push(button);
        row.appendChild(button);
      }(n));
    }
    root.appendChild(row);
    root.appendChild(el('div', { class: 'rating-ends' }, [
      el('span', { text: data.lowLabel || 'Not useful' }),
      el('span', { text: data.highLabel || 'Very useful' })
    ]));
    var note = statusNote(value ? 'Saved earlier. You chose ' + value + ' of ' + max + '.' : '');
    root.appendChild(el('div', { class: 'btn-row' }, [note]));
  });

  /* ------------------------------------------------------------------------
     14. readings
     ------------------------------------------------------------------------ */

  register('readings', function (root, data, context) {
    if (data.intro) { append(root, paragraphs(data.intro)); }
    var list = el('ul', { class: 'readings' });
    (data.items || []).forEach(function (item) {
      var entry = el('li', {});
      entry.appendChild(el('p', { class: 'reading-cite', text: item.citation }));
      if (item.readThisIf) { entry.appendChild(el('p', { class: 'reading-if', text: item.readThisIf })); }
      if (item.doi || item.url) {
        var href = item.url || ('https://doi.org/' + item.doi);
        var text = item.doi ? ('DOI ' + item.doi) : href;
        entry.appendChild(el('p', { class: 'reading-doi' }, [
          el('a', { href: href, rel: 'noopener', text: text })
        ]));
      }
      if (item.note) { entry.appendChild(el('p', { class: 'small muted', text: item.note })); }
      list.appendChild(entry);
    });
    root.appendChild(list);
    if (context) { /* readings save nothing */ }
  });

  /* ------------------------------------------------------------------------
     15. predict-table (used by module 3.2)
     ------------------------------------------------------------------------ */

  register('predict-table', function (root, data, context) {
    var columns = data.columns || [];
    var rows = data.rows || [];
    var saved = context.get();
    var guesses = (saved && saved.guesses) || {};
    var revealed = (saved && saved.revealed) || {};
    var ratings = (saved && saved.ratings) || {};
    var rateOptions = data.selfRate || ['Matched', 'Partly', 'Missed'];
    var hidden = columns.filter(function (column) { return !column.shown; });
    var shown = columns.filter(function (column) { return column.shown; });

    if (data.intro) { append(root, paragraphs(data.intro)); }

    var finalSlot = el('div', {});

    function exportLines() {
      var lines = [];
      rows.forEach(function (row) {
        hidden.forEach(function (column) {
          var key = row.id + ':' + column.id;
          lines.push([row.label + '. ' + column.label + ' (your guess)', guesses[key] || '']);
        });
        if (ratings[row.id]) { lines.push([row.label + '. How close you were', ratings[row.id]]); }
      });
      return lines;
    }

    var save = debounce(function () {
      context.save({ guesses: guesses, revealed: revealed, ratings: ratings, _export: exportLines() });
    }, 500);

    function showFinalTable() {
      clear(finalSlot);
      var allDone = rows.every(function (row) { return revealed[row.id]; });
      if (!allDone) { return; }
      var wrap = el('div', { class: 'table-wrap' });
      var table = el('table', {});
      if (data.finalTableTitle) { table.appendChild(el('caption', { text: data.finalTableTitle })); }
      var head = el('tr', {});
      head.appendChild(el('th', { scope: 'col', text: data.rowLabel || 'Row' }));
      columns.forEach(function (column) { head.appendChild(el('th', { scope: 'col', text: column.label })); });
      table.appendChild(el('thead', {}, [head]));
      var body = el('tbody', {});
      rows.forEach(function (row) {
        var tr = el('tr', {});
        tr.appendChild(el('th', { scope: 'row', text: row.label }));
        columns.forEach(function (column) {
          tr.appendChild(el('td', { text: (row.cells && row.cells[column.id]) || '' }));
        });
        body.appendChild(tr);
      });
      table.appendChild(body);
      wrap.appendChild(table);
      finalSlot.appendChild(wrap);
    }

    rows.forEach(function (row, index) {
      var block = el('div', { class: 'predict-row' });
      block.appendChild(el('h3', { text: row.label }));
      shown.forEach(function (column) {
        var shownBox = el('div', { class: 'predict-shown' });
        shownBox.appendChild(el('span', { class: 'predict-col-label', text: column.label }));
        shownBox.appendChild(el('p', { text: (row.cells && row.cells[column.id]) || '' }));
        block.appendChild(shownBox);
      });

      hidden.forEach(function (column) {
        var key = row.id + ':' + column.id;
        var inputId = context.id + '-' + row.id + '-' + column.id;
        block.appendChild(el('label', { class: 'field-label', 'for': inputId, text: column.label + '. Your guess.' }));
        var input = el('input', { type: 'text', id: inputId, placeholder: column.placeholder || 'One line.' });
        input.value = guesses[key] || '';
        input.addEventListener('input', function () {
          guesses[key] = input.value;
          save();
        });
        block.appendChild(input);
      });

      var slot = el('div', {});
      var button = el('button', { type: 'button', class: 'btn btn-secondary btn-small', text: data.revealLabel || 'Reveal this row' });
      block.appendChild(el('div', { class: 'btn-row' }, [button]));
      block.appendChild(slot);

      function show(fromClick) {
        clear(slot);
        hidden.forEach(function (column) {
          var cell = el('div', { class: 'predict-cell' });
          cell.appendChild(el('span', { class: 'predict-col-label', text: column.label }));
          cell.appendChild(el('p', { text: (row.cells && row.cells[column.id]) || '' }));
          slot.appendChild(cell);
        });
        var rateRow = el('div', { class: 'selfrate-row' });
        rateRow.appendChild(el('span', { class: 'selfrate-label', text: data.rateLabel || 'How close were you?' }));
        var rateButtons = [];
        rateOptions.forEach(function (option) {
          var rateButton = el('button', {
            type: 'button',
            class: 'rating-btn btn-small',
            'aria-pressed': ratings[row.id] === option ? 'true' : 'false',
            text: option
          });
          rateButton.addEventListener('click', function () {
            ratings[row.id] = option;
            rateButtons.forEach(function (other) {
              other.setAttribute('aria-pressed', other === rateButton ? 'true' : 'false');
            });
            context.save({ guesses: guesses, revealed: revealed, ratings: ratings, _export: exportLines() });
            announce('Saved. You rated this row ' + option + '.');
          });
          rateButtons.push(rateButton);
          rateRow.appendChild(rateButton);
        });
        slot.appendChild(rateRow);
        button.textContent = data.revealedLabel || 'Revealed';
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
        if (fromClick) {
          revealed[row.id] = true;
          context.save({ guesses: guesses, revealed: revealed, ratings: ratings, _export: exportLines() });
          context.track('predict_reveal', { row: row.id });
          announce('Row ' + (index + 1) + ' revealed.');
        }
        showFinalTable();
      }

      button.addEventListener('click', function () { show(true); });
      if (revealed[row.id]) { show(false); }
      root.appendChild(block);
    });

    root.appendChild(finalSlot);
    showFinalTable();
  });

  /* ------------------------------------------------------------------------
     16. compare (used by module 3.2)
     ------------------------------------------------------------------------ */

  register('compare', function (root, data, context) {
    var saved = context.get();
    var answers = (saved && saved.answers) || {};
    var ratings = (saved && saved.ratings) || {};
    var shownMap = (saved && saved.shown) || {};
    var rateOptions = data.selfRate || ['Yes', 'Partly', 'No'];

    if (data.intro) { append(root, paragraphs(data.intro)); }

    (data.items || []).forEach(function (item) {
      var block = el('div', { class: 'compare-item' });
      block.appendChild(el('h3', { text: item.label }));
      append(block, paragraphs(item.text));
      if (item.note) { block.appendChild(el('p', { class: 'compare-flag', text: item.note })); }
      root.appendChild(block);
    });

    function exportLines() {
      var lines = [];
      (data.prompts || []).forEach(function (prompt) {
        lines.push([prompt.question, answers[prompt.id] || '']);
        if (ratings[prompt.id]) { lines.push([prompt.question + ' (your self-rating)', ratings[prompt.id]]); }
      });
      return lines;
    }

    var save = debounce(function () {
      context.save({ answers: answers, ratings: ratings, shown: shownMap, _export: exportLines() });
    }, 500);

    (data.prompts || []).forEach(function (prompt) {
      var block = el('div', { class: 'field' });
      var fieldId = context.id + '-' + prompt.id;
      block.appendChild(el('label', { class: 'field-label', 'for': fieldId, text: prompt.question }));
      var input = el('textarea', { id: fieldId, rows: prompt.rows || 3, placeholder: prompt.placeholder || 'One sentence.' });
      input.value = answers[prompt.id] || '';
      input.addEventListener('input', function () {
        answers[prompt.id] = input.value;
        save();
      });
      block.appendChild(input);

      var slot = el('div', {});
      var note = statusNote('');
      var button = el('button', { type: 'button', class: 'btn', text: data.submitLabel || 'Submit this sentence' });
      block.appendChild(el('div', { class: 'btn-row' }, [button, note]));
      block.appendChild(slot);

      function showReference() {
        clear(slot);
        shownMap[prompt.id] = true;
        var box = el('div', { class: 'fb fb-quiet' });
        box.appendChild(el('p', {}, [el('span', { class: 'fb-verdict', text: 'Model answer.' }), prompt.reference || '']));
        if (prompt.rubric && prompt.rubric.length) {
          box.appendChild(el('p', { class: 'field-label', text: data.rubricLabel || 'Rate your own sentence against these two points.' }));
          var rateRow = el('div', { class: 'selfrate-row' });
          prompt.rubric.forEach(function (point, pIndex) {
            var pointId = fieldId + '-r' + pIndex;
            var box2 = el('input', { type: 'checkbox', id: pointId });
            var key = prompt.id + ':' + pIndex;
            box2.checked = !!ratings[key];
            box2.addEventListener('change', function () {
              ratings[key] = box2.checked;
              context.save({ answers: answers, ratings: ratings, _export: exportLines() });
            });
            rateRow.appendChild(el('label', { class: 'choice', 'for': pointId }, [box2, el('span', { text: point })]));
          });
          box.appendChild(rateRow);
        }
        var rateButtons = [];
        var overall = el('div', { class: 'selfrate-row' });
        overall.appendChild(el('span', { class: 'selfrate-label', text: data.rateLabel || 'Did your sentence do the job?' }));
        rateOptions.forEach(function (option) {
          var rateButton = el('button', {
            type: 'button',
            class: 'rating-btn btn-small',
            'aria-pressed': ratings[prompt.id] === option ? 'true' : 'false',
            text: option
          });
          rateButton.addEventListener('click', function () {
            ratings[prompt.id] = option;
            rateButtons.forEach(function (other) {
              other.setAttribute('aria-pressed', other === rateButton ? 'true' : 'false');
            });
            context.save({ answers: answers, ratings: ratings, _export: exportLines() });
            announce('Saved. You rated your sentence ' + option + '.');
          });
          rateButtons.push(rateButton);
          overall.appendChild(rateButton);
        });
        box.appendChild(overall);
        slot.appendChild(box);
      }

      button.addEventListener('click', function () {
        var text = (answers[prompt.id] || '').trim();
        if (!text) {
          note.textContent = 'Write one sentence first.';
          input.focus();
          return;
        }
        context.save({ answers: answers, ratings: ratings, _export: exportLines() });
        context.track('compare_submit', { prompt: prompt.id });
        note.textContent = 'Saved at ' + nowStamp() + '.';
        var pending = llmScore({
          question: prompt.question,
          answer: text,
          reference: prompt.reference || '',
          rubric: prompt.rubric || []
        });
        if (!pending) {
          showReference();
          announce('Saved. The model answer is now shown.');
          return;
        }
        note.textContent = 'Scoring your sentence.';
        pending.then(function (result) {
          if (!result) {
            showReference();
            note.textContent = 'Scoring was not available, so the model answer is shown instead.';
            return;
          }
          clear(slot);
          var box = el('div', { class: 'fb fb-quiet' });
          box.appendChild(el('p', {}, [el('span', { class: 'fb-verdict', text: 'Score ' + result.score + '.' }), result.comment || '']));
          slot.appendChild(box);
          note.textContent = 'Scored at ' + nowStamp() + '.';
          announce('Your sentence was scored ' + result.score + '.');
        });
      });

      if (shownMap[prompt.id]) { showReference(); }
      root.appendChild(block);
    });
  });

  /* ------------------------------------------------------------------------
     16b. The visual widgets.

     Everything above this point is made of text: cards of text sorted into
     bins of text, text you diagnose, text you reveal. That is a lot of
     clicking and nothing to look at, which is why the course read as dry.

     These eight are the other half. A figure you can look at, a video you
     choose to load, an artefact you mark up, a sentence that rewrites itself
     as you drag, pieces you put in order, a decision with consequences, a
     poll with no right answer, and a hundred dots that make statistical power
     something you feel instead of calculate.
     ------------------------------------------------------------------------ */

  /* --- figure ------------------------------------------------------------
     A diagram, animated or not. Animation is the payload, never decoration,
     so the still is a first-class citizen: anyone who has asked their system
     to stop moving things gets the final frame, which carries the whole idea.
     GIFs ignore prefers-reduced-motion on their own, so <picture> does it. */
  register('figure', function (root, data, context) {
    if (data.intro) { append(root, paragraphs(data.intro)); }
    var base = PAGE.base || '';
    var fig = el('figure', { class: 'fig' + (data.wide ? ' fig-wide' : '') });

    var img = el('img', {
      src: base + data.src,
      alt: data.alt || '',
      width: data.width || 1280,
      height: data.height || 800,
      loading: 'lazy',
      decoding: 'async'
    });

    if (data.still) {
      var picture = el('picture', {});
      picture.appendChild(el('source', {
        srcset: base + data.still,
        media: '(prefers-reduced-motion: reduce)'
      }));
      picture.appendChild(img);
      fig.appendChild(picture);
    } else {
      fig.appendChild(img);
    }

    if (data.caption) { fig.appendChild(el('figcaption', { text: data.caption })); }
    root.appendChild(fig);
    context.track('figure_view', { src: data.src });
  });

  /* --- video -------------------------------------------------------------
     Click to load. Nothing reaches Google until the learner asks for it, and
     the real embed is the nocookie host. A plain iframe would pull most of a
     megabyte of player code per video before anyone pressed anything. */
  register('video', function (root, data, context) {
    if (data.intro) { append(root, paragraphs(data.intro)); }
    var id = data.id;
    if (!id) {
      root.appendChild(el('p', { class: 'fb', text: 'This video is missing its id.' }));
      return;
    }
    var base = PAGE.base || '';
    var wrap = el('div', { class: 'video' });
    var frame = el('div', { class: 'video-frame' });

    var poster = data.poster
      ? el('img', { class: 'video-poster', src: base + data.poster, alt: '', loading: 'lazy', decoding: 'async' })
      : null;
    if (poster) { frame.appendChild(poster); }

    var play = el('button', {
      type: 'button',
      class: 'video-play',
      'aria-label': 'Play the video: ' + (data.title || 'video')
    }, [el('span', { class: 'video-play-text', text: 'Play' })]);

    play.addEventListener('click', function () {
      var iframe = el('iframe', {
        src: 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&modestbranding=1',
        title: data.title || 'Video',
        allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
        allowfullscreen: true,
        frameborder: '0'
      });
      clear(frame).appendChild(iframe);
      context.save({ played: true });
      context.track('video_play', { id: id });
      announce('Video loading.');
    });

    frame.appendChild(play);
    wrap.appendChild(frame);

    var meta = el('p', { class: 'video-meta' });
    if (data.title) { meta.appendChild(el('span', { class: 'video-title', text: data.title })); }
    var bits = [];
    if (data.channel) { bits.push(data.channel); }
    if (data.length) { bits.push(data.length); }
    if (bits.length) { meta.appendChild(el('span', { class: 'video-sub', text: bits.join(' · ') })); }
    wrap.appendChild(meta);

    wrap.appendChild(el('p', {
      class: 'video-note',
      text: 'Hosted on YouTube. Nothing is sent to Google until you press play.'
    }));

    root.appendChild(wrap);
  });

  /* --- annotate ----------------------------------------------------------
     A real artefact, and you click what looks wrong. The skill being trained
     is noticing, and noticing can only be trained on something to notice in.
     Wrong clicks cost nothing: they go grey and say so. */
  register('annotate', function (root, data, context) {
    var passages = data.passages || [];
    var total = passages.filter(function (p) { return !!p.issue; }).length;
    var saved = context.get() || {};
    var picked = saved.picked || {};

    if (data.intro) { append(root, paragraphs(data.intro)); }

    var sheet = el('div', { class: 'annot' });
    if (data.title) { sheet.appendChild(el('p', { class: 'annot-title', text: data.title })); }
    if (data.subtitle) { sheet.appendChild(el('p', { class: 'annot-sub', text: data.subtitle })); }

    var note = statusNote('');
    var nodes = [];
    /* Built before the passages loop, because restoring saved marks calls
       refresh(), and refresh() touches this button. Declared later with var,
       it is hoisted as undefined and a returning learner gets a TypeError. */
    var reveal = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Show the ones I missed' });

    function found() {
      var n = 0;
      passages.forEach(function (p, i) { if (p.issue && picked[i]) { n += 1; } });
      return n;
    }

    function refresh() {
      var n = found();
      note.textContent = n === 0
        ? 'Nothing marked yet. Click any passage that looks like a problem.'
        : 'You have found ' + n + ' of ' + total + '.';
      reveal.disabled = false;
    }

    passages.forEach(function (p, i) {
      var line = el('button', {
        type: 'button',
        class: 'annot-p',
        'aria-pressed': picked[i] ? 'true' : 'false'
      }, [el('span', { class: 'annot-text', text: p.text })]);

      var slot = el('div', { class: 'annot-slot' });
      var block = el('div', { class: 'annot-line' }, [line, slot]);

      function mark(fromClick) {
        picked[i] = true;
        line.setAttribute('aria-pressed', 'true');
        block.className = 'annot-line ' + (p.issue ? 'is-issue' : 'is-clean');
        clear(slot);
        slot.appendChild(el('p', {
          class: p.issue ? 'annot-note is-issue' : 'annot-note',
          text: p.issue || p.ok || 'Not a problem here.'
        }));
        if (fromClick) {
          context.save({ picked: picked, found: found(), total: total });
          context.track('annotate_mark', { index: i, issue: !!p.issue });
        }
        refresh();
      }

      line.addEventListener('click', function () {
        if (picked[i]) { return; }
        mark(true);
      });

      if (picked[i]) { mark(false); }
      nodes.push({ mark: mark, index: i });
      sheet.appendChild(block);
    });

    root.appendChild(sheet);

    reveal.addEventListener('click', function () {
      nodes.forEach(function (n) { if (!picked[n.index]) { n.mark(true); } });
      reveal.disabled = true;
      announce('All problems shown. You found ' + found() + ' of ' + total + '.');
      context.track('annotate_reveal', { found: found(), total: total });
    });

    root.appendChild(el('div', { class: 'btn-row' }, [reveal, note]));
    if (data.closing) { append(root, paragraphs(data.closing, 'small muted')); }
    refresh();
  });

  /* --- tune --------------------------------------------------------------
     Sliders that rewrite a sentence as you move them, and a panel that says
     what each setting just cost you. There is no right answer here; the
     teaching is that every choice buys one thing and sells another. */
  register('tune', function (root, data, context) {
    var sliders = data.sliders || [];
    var saved = context.get() || {};
    var picks = saved.picks || {};

    sliders.forEach(function (s) {
      if (picks[s.id] === undefined) { picks[s.id] = s.start === undefined ? 0 : s.start; }
    });

    if (data.intro) { append(root, paragraphs(data.intro)); }

    var out = el('p', { class: 'tune-sentence', role: 'status' });
    var costs = el('ul', { class: 'tune-costs' });

    function stepOf(s) { return (s.steps || [])[picks[s.id]] || {}; }

    function render() {
      var text = data.template || '';
      sliders.forEach(function (s) {
        text = text.split('{' + s.id + '}').join(stepOf(s).text || '');
      });
      out.textContent = text;

      clear(costs);
      sliders.forEach(function (s) {
        var step = stepOf(s);
        (step.costs || []).forEach(function (c) {
          costs.appendChild(el('li', { class: 'tune-cost', text: c }));
        });
      });
      if (!costs.children.length) {
        costs.appendChild(el('li', { class: 'tune-cost is-quiet', text: 'Nothing has changed yet. Move a slider.' }));
      }
    }

    var box = el('div', { class: 'tune' });
    sliders.forEach(function (s) {
      var rowId = context.id + '-' + s.id;
      var row = el('div', { class: 'tune-row' });
      var head = el('div', { class: 'tune-head' });
      head.appendChild(el('label', { class: 'tune-label', for: rowId, text: s.label }));
      var value = el('span', { class: 'tune-value', text: (stepOf(s).label || '') });
      head.appendChild(value);
      row.appendChild(head);

      var input = el('input', {
        type: 'range',
        id: rowId,
        class: 'tune-range',
        min: '0',
        max: String((s.steps || []).length - 1),
        step: '1',
        value: String(picks[s.id])
      });
      input.addEventListener('input', function () {
        picks[s.id] = Number(input.value);
        value.textContent = stepOf(s).label || '';
        render();
      });
      input.addEventListener('change', function () {
        context.save({ picks: picks, _export: [[data.exportLabel || 'Scoped question', out.textContent]] });
        context.track('tune_change', { slider: s.id, step: picks[s.id] });
      });
      row.appendChild(input);

      var ticks = el('div', { class: 'tune-ticks', 'aria-hidden': 'true' });
      (s.steps || []).forEach(function (step) {
        ticks.appendChild(el('span', { text: step.label || '' }));
      });
      row.appendChild(ticks);
      box.appendChild(row);
    });

    root.appendChild(box);
    root.appendChild(el('div', { class: 'tune-out' }, [
      el('p', { class: 'field-label', text: data.outLabel || 'Your question, as it now stands' }),
      out
    ]));
    root.appendChild(el('div', { class: 'tune-costs-wrap' }, [
      el('p', { class: 'field-label', text: data.costsLabel || 'What that just cost you' }),
      costs
    ]));

    render();
  });

  /* --- parsons -----------------------------------------------------------
     The pieces of a study, shuffled. You cannot invent a wrong piece, so all
     the load lands on whether they fit each other, which is the actual skill.
     Reordering is by button, not by drag: drag is a mobile and screen-reader
     problem and buys nothing here. */
  register('parsons', function (root, data, context) {
    var pieces = (data.pieces || []).slice();
    var correct = data.correct || pieces.map(function (p) { return p.id; });
    var saved = context.get() || {};
    var order = saved.order && saved.order.length === pieces.length ? saved.order.slice() : null;

    if (!order) {
      order = pieces.map(function (p) { return p.id; });
      /* A fixed shuffle, so two learners see the same starting muddle and can
         compare notes, and a reload does not reshuffle under you. */
      order.sort(function (a, b) {
        return String(a).localeCompare(String(b));
      });
      if (order.join('|') === correct.join('|')) { order.reverse(); }
    }

    if (data.intro) { append(root, paragraphs(data.intro)); }

    var byId = {};
    pieces.forEach(function (p) { byId[p.id] = p; });

    var list = el('ol', { class: 'parsons' });
    var note = statusNote('');
    var checked = false;

    function move(index, delta) {
      var next = index + delta;
      if (next < 0 || next >= order.length) { return; }
      var tmp = order[index];
      order[index] = order[next];
      order[next] = tmp;
      checked = false;

      /* FLIP. draw() throws the whole list away and rebuilds it, so the two
         layouts are matched by piece id rather than by node identity. The
         swap animation is not decoration here: it is the only thing that
         says which two pieces exchanged places. */
      flip(function () {
        var map = {};
        qsa('.parsons-item', list).forEach(function (node) {
          var id = node.getAttribute('data-piece');
          if (id) { map[id] = node; }
        });
        return map;
      }, draw);

      /* draw() rebuilt the button that was just pressed, so focus is on a
         node that no longer exists. Put it back on the replacement, or a
         keyboard user is dumped at the top of the page after one press. */
      var rows = qsa('.parsons-item', list);
      var landed = rows[next];
      if (landed) {
        var buttons = qsa('button', landed);
        var wanted = delta < 0 ? buttons[0] : buttons[1];
        if (!wanted || wanted.disabled) { wanted = delta < 0 ? buttons[1] : buttons[0]; }
        if (wanted && !wanted.disabled) { wanted.focus(); }
      }

      context.save({ order: order });
      context.track('parsons_move', { from: index, to: next });
      announce(byId[order[next]].label + ' moved to position ' + (next + 1) + '.');
    }

    function draw() {
      clear(list);
      order.forEach(function (id, i) {
        var piece = byId[id];
        if (!piece) { return; }
        var right = checked && correct[i] === id;
        var wrong = checked && correct[i] !== id;
        var item = el('li', {
          class: 'parsons-item' + (right ? ' is-right' : '') + (wrong ? ' is-wrong' : ''),
          'data-piece': id
        });

        var body = el('div', { class: 'parsons-body' });
        body.appendChild(el('p', { class: 'parsons-label', text: piece.label }));
        if (piece.text) { body.appendChild(el('p', { class: 'parsons-text', text: piece.text })); }
        if (wrong && piece.why) { body.appendChild(el('p', { class: 'parsons-why', text: piece.why })); }
        item.appendChild(body);

        var controls = el('div', { class: 'parsons-controls' });
        var up = el('button', { type: 'button', class: 'btn btn-secondary btn-small', 'aria-label': 'Move ' + piece.label + ' earlier', text: 'Up' });
        var down = el('button', { type: 'button', class: 'btn btn-secondary btn-small', 'aria-label': 'Move ' + piece.label + ' later', text: 'Down' });
        up.disabled = i === 0;
        down.disabled = i === order.length - 1;
        up.addEventListener('click', function () { move(i, -1); });
        down.addEventListener('click', function () { move(i, 1); });
        controls.appendChild(up);
        controls.appendChild(down);
        item.appendChild(controls);

        list.appendChild(item);
      });
    }

    root.appendChild(list);

    var check = el('button', { type: 'button', class: 'btn', text: data.checkLabel || 'Check the order' });
    check.addEventListener('click', function () {
      checked = true;
      var hits = 0;
      order.forEach(function (id, i) { if (correct[i] === id) { hits += 1; } });
      draw();
      var all = hits === order.length;
      note.textContent = all
        ? (data.doneNote || 'That is the order. Every piece follows from the one above it.')
        : hits + ' of ' + order.length + ' are in the right place.';
      context.save({ order: order, checked: true, hits: hits, _export: [[data.exportLabel || 'Study order', order.join(', then ')]] });
      context.track('parsons_check', { hits: hits, total: order.length });
      announce(note.textContent);
    });

    root.appendChild(el('div', { class: 'btn-row' }, [check, note]));
    draw();
  });

  /* --- branch ------------------------------------------------------------
     A dilemma with no clean answer, played from inside it. No score, no
     feedback between choices, because the point is that you commit before you
     can see what it costs. The replay at the end names what each choice
     protected and what it traded away, and then offers the path not taken. */
  register('branch', function (root, data, context) {
    var nodes = data.nodes || {};
    var saved = context.get() || {};
    var path = saved.path || [];

    if (data.intro) { append(root, paragraphs(data.intro)); }

    var stage = el('div', { class: 'branch' });
    root.appendChild(stage);

    function nodeAt(step) {
      if (!step) { return data.start ? nodes[data.start] : null; }
      return nodes[step];
    }

    function currentId() {
      if (!path.length) { return data.start; }
      var last = path[path.length - 1];
      var node = nodes[last.node];
      var option = (node.options || [])[last.choice];
      return option ? option.next : null;
    }

    /* Which way the learner moved. Same language as screen mode: forward is
       a decision taken, backward is starting the scenario again. */
    var sceneDir = 'fwd';

    function drawScene(animate) {
      var id = currentId();
      var node = id ? nodes[id] : null;
      clear(stage);

      if (!node) { drawReplay(animate); return; }

      var scene = el('div', { class: 'branch-scene' });
      if (animate && motionOK()) {
        scene.classList.add(sceneDir === 'back' ? 'scene-in-back' : 'scene-in-fwd');
      }
      scene.appendChild(el('p', { class: 'branch-step', text: 'Decision ' + (path.length + 1) }));
      append(scene, paragraphs(node.text, 'branch-text'));

      var options = el('div', { class: 'branch-options' });
      (node.options || []).forEach(function (option, i) {
        var button = el('button', { type: 'button', class: 'branch-option', text: option.label });
        button.addEventListener('click', function () {
          path.push({ node: id, choice: i });
          context.save({ path: path });
          context.track('branch_choice', { node: id, choice: i });
          sceneDir = 'fwd';
          drawScene(true);
        });
        options.appendChild(button);
      });
      scene.appendChild(options);
      stage.appendChild(scene);
    }

    function drawReplay(animate) {
      var replay = el('div', { class: 'branch-replay' });
      if (animate && motionOK()) {
        replay.classList.add(sceneDir === 'back' ? 'scene-in-back' : 'scene-in-fwd');
      }
      replay.appendChild(el('h3', { class: 'branch-replay-title', text: data.replayTitle || 'The path you took' }));

      var lines = [];
      path.forEach(function (stepRow) {
        var node = nodes[stepRow.node];
        var option = (node.options || [])[stepRow.choice];
        if (!option) { return; }
        var item = el('div', { class: 'branch-trace' });
        item.appendChild(el('p', { class: 'branch-trace-choice', text: option.label }));
        var grid = el('div', { class: 'branch-trace-grid' });
        if (option.protects) {
          grid.appendChild(el('div', { class: 'branch-trace-cell' }, [
            el('p', { class: 'branch-trace-key', text: 'You protected' }),
            el('p', { class: 'branch-trace-val', text: option.protects })
          ]));
        }
        if (option.trades) {
          grid.appendChild(el('div', { class: 'branch-trace-cell is-cost' }, [
            el('p', { class: 'branch-trace-key', text: 'You traded away' }),
            el('p', { class: 'branch-trace-val', text: option.trades })
          ]));
        }
        item.appendChild(grid);
        replay.appendChild(item);
        lines.push(option.label);
      });

      if (data.closing) { append(replay, paragraphs(data.closing, 'branch-closing')); }

      var row = el('div', { class: 'btn-row' });
      var other = el('button', { type: 'button', class: 'btn btn-secondary', text: data.otherLabel || 'See the path you did not take' });
      other.addEventListener('click', function () {
        other.disabled = true;
        var alt = el('div', { class: 'branch-alt' });
        alt.appendChild(el('h4', { text: 'The other ways it could have gone' }));
        path.forEach(function (stepRow) {
          var node = nodes[stepRow.node];
          (node.options || []).forEach(function (option, i) {
            if (i === stepRow.choice) { return; }
            var block = el('div', { class: 'branch-alt-row' });
            block.appendChild(el('p', { class: 'branch-alt-choice', text: option.label }));
            if (option.trades) { block.appendChild(el('p', { class: 'branch-alt-note', text: 'Would have cost you: ' + option.trades })); }
            alt.appendChild(block);
          });
        });
        replay.appendChild(alt);
        context.track('branch_alt', {});
      });
      var again = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Start again' });
      again.addEventListener('click', function () {
        path = [];
        context.save({ path: path });
        sceneDir = 'back';
        drawScene(true);
      });
      row.appendChild(other);
      row.appendChild(again);
      replay.appendChild(row);

      context.save({ path: path, _export: [[data.exportLabel || 'Decisions taken', lines.join(', then ')]] });
      stage.appendChild(replay);
    }

    drawScene();
  });

  /* --- poll --------------------------------------------------------------
     For the questions that have no answer. You commit, then you see where
     colleagues landed. The distribution is the content: finding out that a
     third of your colleagues disagree with you is the teaching. */
  register('poll', function (root, data, context) {
    var options = data.options || [];
    var saved = context.get() || {};
    var chosen = saved.choice === undefined ? null : saved.choice;

    if (data.intro) { append(root, paragraphs(data.intro)); }
    root.appendChild(el('p', { class: 'field-label', text: data.prompt || '' }));

    var box = el('div', { class: 'poll' });
    var results = el('div', { class: 'poll-results', hidden: true });

    function showResults(live) {
      clear(results);
      results.hidden = false;
      var pending = [];
      options.forEach(function (option, i) {
        var share = option.share || 0;
        var row = el('div', { class: 'poll-row' + (i === chosen ? ' is-mine' : '') });
        var head = el('div', { class: 'poll-row-head' });
        head.appendChild(el('span', { class: 'poll-row-label', text: option.label }));
        var shareNode = el('span', { class: 'poll-row-share', text: (live ? 0 : share) + '%' });
        head.appendChild(shareNode);
        row.appendChild(head);
        var bar = el('div', { class: 'poll-bar', 'aria-hidden': 'true' });
        var fill = el('span', { class: 'poll-bar-fill', style: 'width:' + (live ? 0 : share) + '%' });
        bar.appendChild(fill);
        row.appendChild(bar);
        if (i === chosen) { row.appendChild(el('p', { class: 'poll-mine', text: 'This was your answer.' })); }
        results.appendChild(row);
        if (live) { pending.push({ fill: fill, node: shareNode, share: share, index: i }); }
      });

      /* The distribution is the content of this widget: finding out that a
         third of your colleagues disagree with you is the teaching. Growing
         the bars makes the learner read them one at a time instead of taking
         in a finished chart at a glance. Staggered, but briefly. */
      if (live && motionOK()) {
        pending.forEach(function (row) {
          window.setTimeout(function () {
            growBar(row.fill, row.share, { duration: 520 });
            countTo(row.node, 0, row.share, {
              duration: 520,
              format: function (v) { return Math.round(v) + '%'; }
            });
          }, row.index * 80);
        });
      }
      if (data.source) { results.appendChild(el('p', { class: 'small muted', text: data.source })); }
      if (data.closing) { append(results, paragraphs(data.closing, 'poll-closing')); }
    }

    options.forEach(function (option, i) {
      var button = el('button', {
        type: 'button',
        class: 'poll-option' + (chosen === i ? ' is-chosen' : ''),
        'aria-pressed': chosen === i ? 'true' : 'false',
        text: option.label
      });
      button.addEventListener('click', function () {
        chosen = i;
        qsa('.poll-option', box).forEach(function (other, j) {
          other.className = 'poll-option' + (j === i ? ' is-chosen' : '');
          other.setAttribute('aria-pressed', j === i ? 'true' : 'false');
        });
        context.save({ choice: i, _export: [[data.prompt || 'Poll', option.label]] });
        context.track('poll_answer', { choice: i });
        showResults(true);
        announce('Answer recorded. Showing how others answered.');
      });
      box.appendChild(button);
    });

    root.appendChild(box);
    root.appendChild(results);
    if (chosen !== null) { showResults(); }
  });

  /* --- dots --------------------------------------------------------------
     A hundred dots, each one a hypothetical repeat of your study. Drag the
     class size and watch how many of them would have found the effect. This
     replaces a power calculation with a feeling, which is the only form in
     which most people will act on it.

     The maths is the normal approximation to power for a two-sample t-test at
     alpha .05, two-tailed. It is an approximation and the widget says so. */
  function normalCdf(z) {
    /* Abramowitz and Stegun 7.1.26, applied to erf. */
    var sign = z < 0 ? -1 : 1;
    var x = Math.abs(z) / Math.sqrt(2);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return 0.5 * (1 + sign * y);
  }

  function powerOf(n, d) {
    if (n < 4) { return 0; }
    var ncp = d * Math.sqrt(n / 2);
    return Math.max(0, Math.min(1, normalCdf(ncp - 1.959964) + normalCdf(-ncp - 1.959964)));
  }

  register('dots', function (root, data, context) {
    var saved = context.get() || {};
    var n = saved.n || data.startN || 40;
    var d = saved.d === undefined ? (data.startD || 0.3) : saved.d;

    if (data.intro) { append(root, paragraphs(data.intro)); }

    var grid = el('div', { class: 'dots-grid', 'aria-hidden': 'true' });
    var cells = [];
    for (var i = 0; i < 100; i += 1) {
      var cell = el('span', { class: 'dot' });
      cells.push(cell);
      grid.appendChild(cell);
    }

    var readout = el('p', { class: 'dots-readout', role: 'status' });

    /* Which repeats find the effect is not the first k of them. Filling a
       prefix draws a bar, and a bar says "82%", which the readout already
       says in words. Scattering the hits says the other half of it: which
       studies succeed is luck, and yours is one draw from this grid. */
    var order = [];
    for (var seat = 0; seat < 100; seat += 1) { order.push(seat); }

    function reshuffle() {
      for (var k = order.length - 1; k > 0; k -= 1) {
        var j = Math.floor(Math.random() * (k + 1));
        var swapped = order[k];
        order[k] = order[j];
        order[j] = swapped;
      }
    }

    reshuffle();

    function render(stagger) {
      var p = powerOf(n, d);
      var hits = Math.round(p * 100);
      var hit = {};
      for (var k = 0; k < hits; k += 1) { hit[order[k]] = true; }
      cells.forEach(function (cell, j) {
        /* A stagger only on an explicit re-run, where it reads as a hundred
           results arriving. During a drag it would smear into mush, so the
           delays are cleared again every time the sliders move. */
        cell.style.transitionDelay = (stagger && motionOK()) ? (Math.round(Math.random() * 300) + 'ms') : '';
        cell.className = hit[j] ? 'dot is-hit' : 'dot';
      });
      readout.textContent = 'With ' + n + ' students per group and a true effect of d = ' + d.toFixed(2)
        + ', you would detect it in about ' + hits + ' of 100 attempts.';
      verdict.textContent = hits >= 80
        ? 'This study can find what you are looking for.'
        : (hits >= 50
          ? 'A coin toss. Half the time you would conclude there was nothing there.'
          : 'Most of the time this study would miss a real effect and you would call it a null result.');
      verdict.className = 'dots-verdict ' + (hits >= 80 ? 'is-ok' : (hits >= 50 ? 'is-mid' : 'is-bad'));
    }

    var verdict = el('p', { class: 'dots-verdict' });

    function slider(id, label, min, max, stepSize, value, format, onInput) {
      var wrapId = context.id + '-' + id;
      var row = el('div', { class: 'tune-row' });
      var head = el('div', { class: 'tune-head' });
      head.appendChild(el('label', { class: 'tune-label', for: wrapId, text: label }));
      var out = el('span', { class: 'tune-value', text: format(value) });
      head.appendChild(out);
      row.appendChild(head);
      var input = el('input', {
        type: 'range', id: wrapId, class: 'tune-range',
        min: String(min), max: String(max), step: String(stepSize), value: String(value)
      });
      input.addEventListener('input', function () {
        var v = Number(input.value);
        out.textContent = format(v);
        onInput(v);
        render();
      });
      input.addEventListener('change', function () {
        context.save({ n: n, d: d });
        context.track('dots_change', { n: n, d: d });
      });
      row.appendChild(input);
      return row;
    }

    var box = el('div', { class: 'tune dots-controls' });
    box.appendChild(slider('n', data.nLabel || 'Students per group', 10, 400, 5, n,
      function (v) { return String(v); }, function (v) { n = v; }));
    box.appendChild(slider('d', data.dLabel || 'The true effect, if there is one', 0.1, 1.0, 0.05, d,
      function (v) { return 'd = ' + Number(v).toFixed(2); }, function (v) { d = v; }));

    root.appendChild(box);
    root.appendChild(el('div', { class: 'dots' }, [grid, readout, verdict]));

    var again = el('button', {
      type: 'button',
      class: 'btn btn-secondary btn-small',
      text: data.againLabel || 'Run the hundred studies again'
    });
    again.addEventListener('click', function () {
      reshuffle();
      render(true);
      context.track('dots_rerun', { n: n, d: d });
      announce('Re-run. The same number of studies find the effect. Different ones.');
    });
    root.appendChild(el('div', { class: 'btn-row' }, [again]));

    root.appendChild(el('p', {
      class: 'small muted',
      text: data.note || 'Normal approximation for a two-sample comparison at the .05 level. Close enough to decide with, not to quote in a paper.'
    }));

    render();
  });

  /* ------------------------------------------------------------------------
     16b. The module index

     One place that knows every module: its title, the line the map shows, and
     whether it exists. A module with no href has not been written yet, so
     nothing anywhere links to it. Adding the href is the only change needed
     to switch a module on across the whole site.
     ------------------------------------------------------------------------ */

  var MODULE_INDEX = {
    '1-1': { title: 'What counts as education research', href: 'modules/1-1-what-counts.html',
      blurb: 'Where good teaching practice ends and a study a panel will fund begins.' },
    '1-2': { title: 'Turning a hunch into a question', href: 'modules/1-2-question.html',
      blurb: 'From a sense that students struggle to a question you can answer in one semester.' },
    '2-1': { title: 'Searching for education work',
      blurb: 'Where education research hides, and why a PubMed habit will not find it.' },
    '2-2': { title: 'Reading an education paper',
      blurb: 'What to look for first when the methods are not the ones you know.' },
    '2-3': { title: 'Synthesis, not summary', href: 'modules/2-3-synthesis.html',
      blurb: 'Why listing fourteen studies is not a literature review, and what a panel wants instead.' },
    '3-1': { title: 'Three terms people confuse', href: 'modules/3-1-three-terms.html',
      blurb: 'Theory, theoretical framework, conceptual framework. Which one the reviewer is asking for.' },
    '3-2': { title: 'What a lens shows and what it hides', href: 'modules/3-2-lens.html',
      blurb: 'Every framework lights one part of the field and leaves the rest dark. Say which part, on purpose.' },
    '3-3': { title: 'Choosing a lens you can test',
      blurb: 'Matching the framework to the data you can actually get hold of.' },
    '3-4': { title: 'Writing the framework section', href: 'modules/3-4-framework-section.html',
      blurb: 'The call rejects any proposal without both a literature review and a framework.' },
    '4-1': { title: 'Designs that fit a classroom', href: 'modules/4-1-designs.html',
      blurb: 'What you can do when randomising students is not on the table.' },
    '4-2': { title: 'Measuring learning, not satisfaction', href: 'modules/4-2-measuring.html',
      blurb: 'The call says outcomes must go beyond student perceptions. This is how you do that.' },
    '4-3': { title: 'The validity clinic', href: 'modules/4-3-validity-clinic.html',
      blurb: 'Bring your own design. Find the threat that will sink it, and the fix you can make.' },
    '5-1': { title: 'Ethics review for education studies at NUS', href: 'modules/5-1-ethics.html',
      blurb: 'Education research goes to LACE, not NUS-IRB. There is no retrospective review.' },
    '5-2': { title: 'Consent when you are also the teacher', href: 'modules/5-2-consent.html',
      blurb: 'You hold power over these students and you are asking them for something.' },
    '6-1': { title: 'Quantitative basics for classroom data',
      blurb: 'What you can honestly claim from forty students, and what you cannot.' },
    '6-2': { title: 'Qualitative analysis you can defend',
      blurb: 'Thematic analysis that survives a reviewer who does it for a living.' },
    '7-1': { title: 'Writing for AJSoTL and beyond',
      blurb: 'The abstract is written last and read first. Where the work goes after the grant.' },
    '7-2': { title: 'Teaching enhancement grants and learning communities',
      blurb: 'The scheme, the cycle, and what the panel is actually reading for.' },
    '7-3': { title: 'Costing and scheduling a classroom study',
      blurb: 'The schedule and the budget. Budget is explicitly not a quality criterion.' }
  };

  function moduleInfo(id) {
    return (id && MODULE_INDEX[id]) ? MODULE_INDEX[id] : null;
  }

  /* Set the first time the hub dashboard is drawn, so a redraw never replays
     the count. */
  var hubCounted = false;

  /* ------------------------------------------------------------------------
     17. The proposal. The spine of the whole course.

     The learner is writing one real document: an NUS Teaching Enhancement
     Grant application, Learning Improvement Projects stream. Every module
     writes one box of it. The hub renders it as the form itself, not as a
     menu of modules.

     Section numbers, labels and word limits are taken from the FY2025
     application form. The four criteria and their weights are taken from the
     published assessment rubric in the same call.

     One deliberate design decision. Significance carries 40% of the marks but
     the form gives it no box of its own; it is spread across Scope & Aims,
     one bullet inside the Rationale, and Sharing. So every box says which
     criteria it feeds, and a box feeding Significance says so in a heavier
     chip. Otherwise a lecturer under-writes the single highest-scoring
     criterion, which is the commonest way a good project loses to a worse
     one.
     ------------------------------------------------------------------------ */

  var RUBRIC = [
    { id: 'problem', label: 'Research Problem', weight: 20,
      detail: 'The learning problem, situated in its setting, and a clearly articulated research question.' },
    { id: 'lit', label: 'Literature Review', weight: 20,
      detail: 'A review of the literature on this problem, connected to theory where appropriate.' },
    { id: 'method', label: 'Method', weight: 20,
      detail: 'A well-thought-out approach, and evidence that measures real change in skills, attitudes or behaviour.' },
    { id: 'significance', label: 'Significance', weight: 40,
      detail: 'How the project will change teaching practice or student learning. Worth more than the other three, and the form never asks for it directly.' }
  ];

  var PROPOSAL_MAP = {
    scheme: 'NUS Teaching Enhancement Grant',
    stream: 'Learning Improvement Projects',
    formNote: 'Sections, word limits and criteria follow the FY2025 call. Check the current call before you submit.',
    totalWords: 1400,
    rubric: RUBRIC,
    sections: [
      {
        id: 'title', no: '2a', label: 'Project Title', kind: 'line',
        module: '1-2', widget: 'your-study', field: 'title',
        source: 'Module 1.2', href: 'modules/1-2-question.html',
        hint: 'One line. The module you are studying, the change you are making, and what you expect it to move.'
      },
      {
        id: 'abstract', no: '2d', label: 'Abstract', limit: 100,
        module: '7-1', widget: 'your-study', field: 'abstract',
        source: 'Module 7.1', href: 'modules/7-1-writing.html',
        hint: 'Written last, read first. The panel reads this before anything else.'
      },
      {
        id: 'rationale', no: '3a', label: 'Project Rationale', limit: 400,
        scores: ['problem', 'lit', 'significance'],
        hint: 'Four separate demands in one box. The call rejects any proposal that lacks either a literature review or a theoretical framework, so both must be visible here.',
        parts: [
          { id: 'rat-problem', label: 'The problem, positioned in higher education research',
            module: '1-1', widget: 'your-study', field: 'problem',
            source: 'Module 1.1', href: 'modules/1-1-what-counts.html', scores: ['problem'] },
          { id: 'rat-question', label: 'The research question',
            module: '1-2', widget: 'your-study', field: 'question',
            source: 'Module 1.2', href: 'modules/1-2-question.html', scores: ['problem'] },
          { id: 'rat-outcomes', label: 'The educational outcomes you anticipate',
            module: '1-2', widget: 'your-study', field: 'outcomes',
            source: 'Module 1.2', href: 'modules/1-2-question.html', scores: ['significance'] },
          { id: 'rat-lit', label: 'What the literature already shows, and the gap',
            module: '2-3', widget: 'your-study', field: 'gap',
            source: 'Module 2.3', href: 'modules/2-3-synthesis.html', scores: ['lit'] },
          { id: 'rat-framework', label: 'The framework you are working in',
            module: '3-4', widget: 'your-study', field: 'framework',
            source: 'Module 3.4', href: 'modules/3-4-framework-section.html', scores: ['lit'] }
        ]
      },
      {
        id: 'scope', no: '3b', label: 'Project Scope and Aims', limit: 200,
        scores: ['problem', 'significance'],
        hint: 'The call also wants the module code, the current class size and how it is delivered. Concrete numbers, not description.',
        parts: [
          { id: 'scope-aims', label: 'What the project sets out to do',
            module: '1-2', widget: 'your-study', field: 'aims',
            source: 'Module 1.2', href: 'modules/1-2-question.html', scores: ['significance'] },
          { id: 'scope-context', label: 'Module code, class size, how it is taught now',
            module: '1-2', widget: 'your-study', field: 'context',
            source: 'Module 1.2', href: 'modules/1-2-question.html', scores: ['problem'] }
        ]
      },
      {
        id: 'approach', no: '3c', label: 'Approach and Implementation', limit: 200,
        scores: ['method', 'significance'],
        module: '4-1', widget: 'your-study', field: 'design',
        source: 'Module 4.1', href: 'modules/4-1-designs.html',
        hint: 'What you will actually do, week by week, in a real class you cannot randomise.'
      },
      {
        id: 'evaluation', no: '3d', label: 'Evaluation Plan and Method', limit: 300,
        scores: ['method'],
        hint: 'The call is explicit: outcomes must go beyond surveying student perceptions or satisfaction. Satisfaction is at most indirect evidence.',
        parts: [
          { id: 'ev-measures', label: 'What you will measure, and why it is learning and not satisfaction',
            module: '4-2', widget: 'your-study', field: 'measures',
            source: 'Module 4.2', href: 'modules/4-2-measuring.html', scores: ['method'] },
          { id: 'ev-threat', label: 'The biggest threat to the claim, and the fix',
            module: '4-3', widget: 'your-study', field: 'threat',
            source: 'Module 4.3', href: 'modules/4-3-validity-clinic.html', scores: ['method'] },
          { id: 'ev-analysis', label: 'How you will analyse it',
            module: '6-1', widget: 'your-study', field: 'analysis',
            source: 'Module 6.1', href: 'modules/6-1-quantitative.html', scores: ['method'] }
        ]
      },
      {
        id: 'sharing', no: '3e', label: 'Sharing', limit: 100,
        scores: ['significance'],
        module: '7-2', widget: 'your-study', field: 'sharing',
        source: 'Module 7.2', href: 'modules/7-2-grants.html',
        hint: 'Part of the 40% for Significance. Where the finding goes, and who changes what because of it.'
      },
      {
        id: 'links', no: '3f', label: 'Links to other projects or grants', limit: 100,
        module: '7-2', widget: 'your-study', field: 'links',
        source: 'Module 7.2', href: 'modules/7-2-grants.html',
        hint: 'Administrative. Say plainly if there are none.'
      },
      {
        id: 'schedule', no: '5', label: 'Project Implementation Schedule', kind: 'table',
        module: '7-3', widget: 'your-study', field: 'schedule',
        source: 'Module 7.3', href: 'modules/7-3-costing.html',
        hint: 'A table of activity and month. It has to survive a semester that will not go to plan.'
      },
      {
        id: 'budget', no: '6', label: 'Budget Plan', kind: 'table',
        module: '7-3', widget: 'your-study', field: 'budget',
        source: 'Module 7.3', href: 'modules/7-3-costing.html',
        hint: 'The call says plainly that budget is not a criterion for judging quality. Get it right, do not agonise.'
      }
    ],
    /* Ethics is not part of this form. It happens after the award, and it goes
       to LACE, CTLT's own committee, not to NUS-IRB. It is a second document
       and the hub shows it as one. */
    second: {
      id: 'lace',
      title: 'Your ethics application',
      body: 'LACE, the Learning and Analytics Committee on Ethics, reviews education research at NUS. It is a departmental committee run by CTLT and ALSET, and you submit through the DREAM app, not iRIMS-IRB.',
      warning: 'There is no retrospective review. Collect data before approval and the study cannot be published.',
      sections: [
        { id: 'lace-category', label: 'Your exemption category', module: '5-1', widget: 'your-study', field: 'category',
          source: 'Module 5.1', href: 'modules/5-1-ethics.html',
          hint: 'Category 1A covers normal educational practice with no grade analysis. Touch grades and you are in 1B, which requires prospective consent from every student.' },
        { id: 'lace-consent', label: 'How you will take consent while you are also the teacher', module: '5-2', widget: 'your-study', field: 'consent',
          source: 'Module 5.2', href: 'modules/5-2-consent.html',
          hint: 'You hold power over these students. The consent process has to work anyway.' }
      ]
    }
  };

  function readProposalMap() {
    var node = document.getElementById('proposal-map');
    if (!node) { return PROPOSAL_MAP; }
    var data = parseJSON(node.textContent, 'the proposal map');
    if (!data) { return PROPOSAL_MAP; }
    if (Array.isArray(data)) { return { sections: data }; }
    return Array.isArray(data.sections) ? data : PROPOSAL_MAP;
  }

  function countWords(text) {
    var trimmed = String(text || '').trim();
    if (!trimmed) { return 0; }
    return trimmed.split(/\s+/).length;
  }

  /* Pull one section's text out of saved state. A section names the module and
     the widget that writes it, then either a field id (your-study keeps a
     _fields map) or the export label to match on (works for any widget). */
  function proposalValue(section) {
    if (!section || !section.module) { return ''; }
    var state = readModule(section.module);
    if (!state || !state.widgets) { return ''; }
    var widget = state.widgets[section.widget || 'your-study'];
    if (!widget) { return ''; }
    if (section.field) {
      var fields = widget._fields || {};
      return String(fields[section.field] === undefined ? '' : fields[section.field]).trim();
    }
    if (section.exportLabel && Array.isArray(widget._export)) {
      var hit = '';
      widget._export.forEach(function (pair) {
        if (pair && pair[0] === section.exportLabel && !hit) { hit = pair[1]; }
      });
      return String(hit === undefined || hit === null ? '' : hit).trim();
    }
    return '';
  }

  /* A section is either one box or a box made of several parts. Either way it
     resolves to text, a word count, and whether anything has been written. */
  function resolveSection(section) {
    var parts = (section.parts || []).map(function (part) {
      var text = proposalValue(part);
      return { part: part, text: text, words: countWords(text), filled: text !== '' };
    });
    var own = section.parts ? '' : proposalValue(section);
    var words = section.parts
      ? parts.reduce(function (sum, row) { return sum + row.words; }, 0)
      : countWords(own);
    var filledParts = parts.filter(function (row) { return row.filled; }).length;
    return {
      section: section,
      parts: parts,
      text: own,
      words: words,
      filled: section.parts ? filledParts > 0 : own !== '',
      complete: section.parts ? filledParts === parts.length : own !== '',
      over: !!section.limit && words > section.limit
    };
  }

  function proposalRows(map) {
    return (map.sections || []).map(resolveSection);
  }

  function draftMeter(filled, total, compact) {
    var meter = el('div', { class: compact ? 'draft-meter is-compact' : 'draft-meter' });
    meter.appendChild(el('p', {
      class: 'draft-meter-count',
      role: 'status',
      text: filled + ' of ' + total + ' ' + plural(total, 'section', 'sections') + ' drafted.'
    }));
    var cells = el('div', { class: 'draft-meter-cells', 'aria-hidden': 'true' });
    for (var i = 0; i < total; i += 1) {
      cells.appendChild(el('span', { class: i < filled ? 'draft-cell is-filled' : 'draft-cell' }));
    }
    meter.appendChild(cells);
    return meter;
  }

  /* The word counter against a cap. Under is quiet, over is orange. Orange is
     the callout colour in this system, and going over the cap is exactly the
     kind of thing it is reserved for. */
  function wordCount(words, limit) {
    if (!limit) {
      return el('span', { class: 'wc', text: words + ' ' + plural(words, 'word', 'words') });
    }
    var over = words > limit;
    var node = el('span', { class: over ? 'wc is-over' : (words ? 'wc is-set' : 'wc'), title: 'Limit ' + limit + ' words' });
    node.appendChild(el('span', { class: 'wc-n', text: String(words) }));
    node.appendChild(el('span', { class: 'wc-sep', text: ' / ' }));
    node.appendChild(el('span', { class: 'wc-max', text: String(limit) }));
    if (over) {
      node.appendChild(el('span', { class: 'wc-flag', text: ' over by ' + (words - limit) }));
    }
    return node;
  }

  function weightChips(ids, rubric) {
    if (!ids || !ids.length) { return null; }
    var wrap = el('p', { class: 'draft-weights' });
    wrap.appendChild(el('span', { class: 'draft-weights-label', text: 'Scored on' }));
    ids.forEach(function (id) {
      var hit = null;
      rubric.forEach(function (row) { if (row.id === id) { hit = row; } });
      if (!hit) { return; }
      var chip = el('span', { class: hit.weight >= 40 ? 'chip chip-major' : 'chip', title: hit.detail });
      chip.appendChild(el('span', { text: hit.label }));
      chip.appendChild(el('span', { class: 'chip-w', text: hit.weight + '%' }));
      wrap.appendChild(chip);
    });
    return wrap;
  }

  /* A target is only a link when the module behind it exists. The index is the
     authority: an href in the map for an unwritten module would be a 404. */
  function moduleIsLive(target) {
    if (!target || !target.module) { return false; }
    var info = moduleInfo(target.module);
    return info ? !!info.href : !!target.href;
  }

  function joinList(items) {
    if (items.length <= 1) { return items[0] || ''; }
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  function lowerFirst(text) {
    var t = String(text || '');
    return t.charAt(0).toLowerCase() + t.slice(1);
  }

  /* One module, as it appears in the margin beside the box it writes. The
     blurb shows on a module's first appearance only: 1.2 writes three boxes,
     and repeating its description three times is noise, not information. */
  function moduleChip(target, base, writes, seen) {
    var id = target.module;
    var info = moduleInfo(id) || {};
    var live = !!info.href;
    var first = !seen[id];
    seen[id] = true;

    var chip = el(live ? 'a' : 'div', {
      class: 'draft-chip' + (live ? ' is-ready' : ' is-planned'),
      href: live ? base + info.href : null
    });
    chip.appendChild(el('p', { class: 'draft-chip-num', text: target.source || ('Module ' + String(id).replace('-', '.')) }));
    chip.appendChild(el('p', { class: 'draft-chip-title', text: info.title || '' }));
    if (first && info.blurb) { chip.appendChild(el('p', { class: 'draft-chip-blurb', text: info.blurb })); }
    if (writes && writes.length) {
      chip.appendChild(el('p', {
        class: 'draft-chip-writes',
        text: 'Writes ' + joinList(writes.map(lowerFirst))
      }));
    }
    var foot = el('p', { class: 'draft-chip-foot' });
    foot.appendChild(el('span', {
      class: live ? 'tag tag-ready' : 'tag tag-planned',
      text: live ? 'Ready' : 'Not built yet'
    }));
    chip.appendChild(foot);
    return chip;
  }

  /* The margin beside one box. Sides alternate down the page, so a connector
     line never has to cross another one. */
  function gutterFor(row, base, side, seen) {
    var section = row.section;
    var targets = section.parts || [section];

    /* One chip per module, not one per part. Module 1.2 writes two of the
       Rationale's five parts; two identical cards side by side would say
       nothing the one card cannot say in a line. */
    var order = [];
    var byModule = {};
    targets.forEach(function (target) {
      if (!target.module) { return; }
      if (!byModule[target.module]) {
        byModule[target.module] = { target: target, writes: [] };
        order.push(target.module);
      }
      if (section.parts && target.label) { byModule[target.module].writes.push(target.label); }
    });
    if (!order.length) { return null; }

    var aside = el('aside', {
      class: 'draft-gutter draft-gutter-' + side,
      'aria-label': 'Modules that write ' + section.label
    });
    order.forEach(function (id) {
      aside.appendChild(moduleChip(byModule[id].target, base, byModule[id].writes, seen));
    });
    return aside;
  }

  /* The document with its margins. Each box and the modules that write it are
     placed on the same explicit grid row, so they stay level whatever their
     heights. Below the wide breakpoint the whole thing is one column and the
     margins fall in underneath their box. */
  function buildMap(rowList, map, base, headNode, seen, extraClass) {
    var node = el('div', { class: 'draft-map' + (extraClass ? ' ' + extraClass : '') });
    var paper = el('div', { class: 'draft-paper', 'aria-hidden': 'true' });
    paper.style.gridRow = '1 / ' + (rowList.length + 2);
    node.appendChild(paper);

    headNode.style.gridRow = '1';
    node.appendChild(headNode);

    rowList.forEach(function (row, i) {
      var lineNo = String(i + 2);
      var block = drawnSection(row, map, base);
      block.style.gridRow = lineNo;
      node.appendChild(block);
      var aside = gutterFor(row, base, (i % 2 === 0) ? 'l' : 'r', seen);
      if (aside) { aside.style.gridRow = lineNo; node.appendChild(aside); }
    });
    return node;
  }

  /* Some modules write no box of their own. They are the craft the boxes lean
     on, so they get a band underneath rather than a margin. */
  function craftBand(base, seen) {
    var ids = Object.keys(MODULE_INDEX).filter(function (id) { return !seen[id]; });
    if (!ids.length) { return null; }
    var band = el('section', { class: 'draft-band' });
    band.appendChild(el('h3', { class: 'draft-band-title', text: 'Behind the boxes' }));
    band.appendChild(el('p', {
      class: 'draft-band-note',
      text: 'These write no box of their own. They build the craft the boxes above depend on.'
    }));
    var grid = el('div', { class: 'draft-band-grid' });
    ids.forEach(function (id) {
      grid.appendChild(moduleChip({ module: id }, base, null, {}));
    });
    band.appendChild(grid);
    return band;
  }

  function drawnSection(row, map, base) {
    var section = row.section;
    var rubric = map.rubric || RUBRIC;
    /* Demo-readiness: a box is walkable when at least one of the modules that
       writes it is built. None built, and it is only a placeholder. */
    var targets = section.parts || [section];
    var live = targets.filter(moduleIsLive).length;

    var block = el('section', {
      class: 'draft-section' + (row.filled ? ' is-filled' : '') + (row.over ? ' is-over' : '')
        + (live ? ' is-ready' : ' is-unbuilt'),
      id: 'section-' + section.id
    });

    var head = el('header', { class: 'draft-section-head' });
    var line = el('div', { class: 'draft-section-line' });
    if (section.no) { line.appendChild(el('span', { class: 'draft-no', text: section.no })); }
    line.appendChild(el('h3', { class: 'draft-section-title', text: section.label }));
    head.appendChild(line);
    if (section.limit || section.kind === 'table') {
      head.appendChild(section.kind === 'table'
        ? el('span', { class: 'wc wc-table', text: 'table' })
        : wordCount(row.words, section.limit));
    }
    block.appendChild(head);

    var chips = weightChips(section.scores, rubric);
    if (chips) { block.appendChild(chips); }
    if (section.hint) { block.appendChild(el('p', { class: 'draft-hint', text: section.hint })); }

    var body = el('div', { class: 'draft-body' });

    if (section.parts) {
      section.parts.forEach(function (part, i) {
        var pr = row.parts[i];
        var pb = el('div', { class: pr.filled ? 'draft-part is-filled' : 'draft-part' });
        pb.appendChild(el('h4', { class: 'draft-part-title', text: part.label }));
        if (pr.filled) {
          append(pb, paragraphs(pr.text, 'draft-text'));
          var foot = el('p', { class: 'draft-source' });
          foot.appendChild(el('span', { text: 'From ' + (part.source || 'your work') + ' · ' }));
          foot.appendChild(el('span', { text: pr.words + ' ' + plural(pr.words, 'word', 'words') }));
          pb.appendChild(foot);
        } else {
          pb.appendChild(el('p', { class: 'draft-empty', text: 'Not written yet.' }));
        }
        body.appendChild(pb);
      });
    } else if (row.filled) {
      append(body, paragraphs(row.text, 'draft-text'));
      body.appendChild(el('p', { class: 'draft-source', text: 'From ' + (section.source || 'your work') }));
    } else {
      var empty = el('div', { class: 'draft-blank' });
      var lines = section.kind === 'line' ? 1 : (section.kind === 'table' ? 3 : 4);
      for (var i = 0; i < lines; i += 1) {
        empty.appendChild(el('span', { class: 'draft-rule', 'aria-hidden': 'true' }));
      }
      body.appendChild(empty);
    }

    block.appendChild(body);
    return block;
  }

  function secondDocument(map, base, seen) {
    var second = map.second;
    if (!second) { return null; }
    var rows = (second.sections || []).map(resolveSection);
    var filled = rows.filter(function (r) { return r.filled; }).length;

    var head = el('header', { class: 'draft-doc-head' });
    head.appendChild(el('p', { class: 'draft-doc-kind', text: 'Second document' }));
    head.appendChild(el('h2', { class: 'draft-doc-title', text: second.title }));
    head.appendChild(el('p', { class: 'draft-doc-body', text: second.body }));
    if (second.warning) {
      var callout = el('div', { class: 'callout' });
      callout.appendChild(el('span', { class: 'callout-label', text: 'Before any data' }));
      callout.appendChild(el('p', { text: second.warning }));
      head.appendChild(callout);
    }
    head.appendChild(draftMeter(filled, rows.length, true));

    var node = buildMap(rows, map, base, head, seen, 'draft-map-second');
    node.id = 'doc-' + second.id;
    return node;
  }

  function renderProposal(host, map, options) {
    var opts = options || {};
    var rows = proposalRows(map);
    var total = rows.length;
    var filled = rows.filter(function (row) { return row.filled; }).length;
    var words = rows.reduce(function (sum, row) { return sum + row.words; }, 0);
    var base = map.base === undefined ? (PAGE.base || '') : map.base;

    clear(host);

    /* On a module page this is one strip, not the whole form.

       It has to count the ethics document too. Modules 5.1 and 5.2 write only
       into that second document, so counting the TEG form alone would tell a
       learner who had just filled the ethics box that they had drafted
       nothing. */
    if (opts.compact) {
      var secondRows = (map.second && map.second.sections)
        ? map.second.sections.map(resolveSection) : [];
      var allTotal = total + secondRows.length;
      var allFilled = filled + secondRows.filter(function (row) { return row.filled; }).length;

      host.appendChild(draftMeter(allFilled, allTotal, true));
      var line = el('p', { class: 'draft-compact-line' });
      if (allFilled === 0) {
        line.appendChild(el('span', { text: 'Nothing drafted yet. What you write in this module becomes part of it. ' }));
      } else if (filled === 0 && allFilled > 0) {
        line.appendChild(el('span', {
          text: 'Your ethics application has been started. The grant form has no ethics section, so this module fills the second document rather than the form. '
        }));
      } else {
        line.appendChild(el('span', {
          text: words + ' of about ' + (map.totalWords || 1400) + ' words of the form written. '
        }));
      }
      if (opts.hubHref) {
        line.appendChild(el('a', { href: opts.hubHref, text: map.compactLinkText || 'See the whole proposal' }));
      }
      host.appendChild(line);
      return;
    }

    var head = el('header', { class: 'draft-doc-head' });
    head.appendChild(el('p', { class: 'draft-doc-kind', text: 'Application form' }));
    head.appendChild(el('h2', { class: 'draft-doc-title', text: map.scheme || 'Your proposal' }));
    if (map.stream) { head.appendChild(el('p', { class: 'draft-doc-stream', text: map.stream })); }

    var stats = el('div', { class: 'draft-stats' });
    var s1 = el('div', { class: 'draft-stat' });
    var s1n = el('span', { class: 'draft-stat-n', text: String(filled) + ' / ' + total });
    s1.appendChild(s1n);
    s1.appendChild(el('span', { class: 'draft-stat-l', text: 'sections started' }));
    stats.appendChild(s1);
    var s2 = el('div', { class: 'draft-stat' });
    var s2n = el('span', { class: 'draft-stat-n', text: String(words) });
    s2.appendChild(s2n);
    s2.appendChild(el('span', { class: 'draft-stat-l', text: 'of about ' + (map.totalWords || 1400) + ' words' }));
    stats.appendChild(s2);
    head.appendChild(stats);

    var pct = Math.min(100, Math.round((words / (map.totalWords || 1400)) * 100));
    var bar = el('div', { class: 'draft-bar', 'aria-hidden': 'true' });
    var barFill = el('span', { class: 'draft-bar-fill', style: 'width:' + pct + '%' });
    bar.appendChild(barFill);
    head.appendChild(bar);

    /* The only thing on the site that moves without a click immediately
       before it, and it is fenced twice. It runs once per page load, and only
       when there is something to count: on a first visit, with an empty form,
       nothing moves at all. What climbs is the learner's own accumulated
       work, which is the one number this page exists to show. The final
       values are already in the DOM, so a tween that never runs costs
       nothing. */
    if (!hubCounted && words > 0) {
      hubCounted = true;
      countTo(s1n, 0, filled, {
        duration: 620,
        format: function (v) { return Math.round(v) + ' / ' + total; }
      });
      countTo(s2n, 0, words, { duration: 620 });
      growBar(barFill, pct);
    }

    if (map.formNote) { head.appendChild(el('p', { class: 'draft-doc-note', text: map.formNote })); }

    /* Say in words what the filled number badges mean, so the reader knows
       which boxes they can walk end to end today. */
    var liveRows = rows.filter(function (row) {
      return (row.section.parts || [row.section]).filter(moduleIsLive).length > 0;
    }).length;
    if (liveRows < total) {
      head.appendChild(el('p', {
        class: 'draft-doc-note',
        text: 'A filled section number means the module that writes that box is built and open: ' +
          liveRows + ' of ' + total + '. The rest name the module still to be written.'
      }));
    }

    if (map.intro) { append(head, paragraphs(map.intro, 'draft-intro')); }

    /* One shared record of which modules have already been shown, so a module
       that writes several boxes carries its description exactly once. */
    var seen = {};
    host.appendChild(buildMap(rows, map, base, head, seen));

    var second = secondDocument(map, base, seen);
    if (second) { host.appendChild(second); }

    var band = craftBand(base, seen);
    if (band) { host.appendChild(band); }

    if (map.note) { host.appendChild(el('p', { class: 'small muted', text: map.note })); }
  }

  /* On a module page: a short strip that says how much of the proposal now
     exists. Same map, same numbers, one line instead of the whole document. */
  register('proposal', function (root, data, context) {
    var map = readProposalMap();
    if (!map) {
      root.appendChild(el('p', { class: 'fb', text: 'This page has no proposal map, so the draft cannot be shown.' }));
      return;
    }
    if (data.intro) { append(root, paragraphs(data.intro)); }
    var host = el('div', {});
    root.appendChild(host);
    renderProposal(host, map, {
      compact: data.compact !== false,
      hubHref: data.hubHref || '../index.html#proposal'
    });
    context.track('proposal_view', { compact: data.compact !== false });
  });
  /* ------------------------------------------------------------------------
     18. The step list
     ------------------------------------------------------------------------ */

  /* Screen mode. One step fills the view, you advance deliberately, and the
     URL hash keeps your place so a refresh or a bookmark lands where you were.

     The alternative, and the default before this, is one long scroll with a
     side rail. Some people want that; the "Read as one page" toggle gives it
     back, and the choice is remembered. Gating without an escape hatch is how
     you make people leave.

     Motion here is the one place it earns its keep: the slide direction tells
     you which way you moved. prefers-reduced-motion turns it off entirely. */

  var MOTION_OK = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function initSteps() {
    var host = qs('[data-steplist]');
    var sections = qsa('[data-step]');
    if (!host || !sections.length) { return; }

    var body = document.body;
    var wantsScreens = body.getAttribute('data-steps') === 'screens';
    var stored = null;
    try { stored = window.localStorage.getItem(PREFIX + 'view'); } catch (err) { stored = null; }
    var screenMode = wantsScreens && stored !== 'page';

    var numbers = sections.map(function (s) { return s.getAttribute('data-step'); });
    var titleOf = {};
    sections.forEach(function (section) {
      var n = section.getAttribute('data-step');
      titleOf[n] = section.getAttribute('data-step-title')
        || ((qs('h2', section) || {}).textContent || '').trim()
        || ('Step ' + n);
      if (!section.id) { section.id = 'step-' + n; }
    });

    var current = null;
    var seen = {};
    var firstPass = true;
    var setCurrent = null;   /* assigned only in page mode */

    var remember = debounce(function (number) {
      if (!PAGE.moduleId) { return; }
      var state = getState(PAGE.moduleId);
      state.lastStep = number;
      state.title = PAGE.title;
      setState(PAGE.moduleId, state);
    }, 400);

    function markSeen(number, fromClick) {
      if (firstPass) { firstPass = false; } else { remember(number); }
      if (!seen[number]) {
        seen[number] = true;
        track('step_view', { step: number, click: !!fromClick, mode: screenMode ? 'screen' : 'page' });
      }
    }

    /* ---------------------------------------------------------------- rail */

    var nav = el('nav', { class: screenMode ? 'step-rail is-screens' : 'step-rail', 'aria-label': 'Steps in this module' });
    nav.appendChild(el('h2', { text: 'Steps' }));
    var list = el('ol', {});
    var links = {};

    sections.forEach(function (section) {
      var n = section.getAttribute('data-step');
      var link = el('a', { href: '#step-' + n }, [
        el('span', { class: 'step-num', text: n + '.' }),
        el('span', { text: titleOf[n] })
      ]);
      link.addEventListener('click', function (event) {
        if (screenMode) {
          event.preventDefault();
          go(n, true);
        } else {
          setCurrent(n, true);
        }
      });
      links[n] = link;
      list.appendChild(el('li', {}, [link]));
    });
    nav.appendChild(list);

    var resume = el('p', { class: 'rail-resume' });
    nav.appendChild(resume);

    var toggle = null;
    if (wantsScreens) {
      toggle = el('button', {
        type: 'button',
        class: 'btn btn-secondary rail-toggle',
        text: screenMode ? 'Read as one page' : 'Back to one step at a time'
      });
      toggle.addEventListener('click', function () {
        try { window.localStorage.setItem(PREFIX + 'view', screenMode ? 'page' : 'screens'); } catch (err) { /* private mode */ }
        track('view_mode', { to: screenMode ? 'page' : 'screens' });
        window.location.reload();
      });
      nav.appendChild(toggle);
    }

    clear(host).appendChild(nav);

    function highlight(number) {
      Object.keys(links).forEach(function (key) {
        if (key === number) { links[key].setAttribute('aria-current', 'true'); }
        else { links[key].removeAttribute('aria-current'); }
      });
    }

    /* ------------------------------------------------------- page (scroll) */

    if (!screenMode) {
      setCurrent = function (number, fromClick) {
        if (current === number) { return; }
        current = number;
        highlight(number);
        markSeen(number, fromClick);
      };

      var onScroll = function () {
        var offset = 140;
        var best = sections[0];
        sections.forEach(function (section) {
          if (section.getBoundingClientRect().top <= offset) { best = section; }
        });
        if (best) { setCurrent(best.getAttribute('data-step'), false); }
      };

      var pending = null;
      var schedule = function () {
        if (pending) { return; }
        pending = window.setTimeout(function () { pending = null; onScroll(); }, 100);
      };
      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', schedule);
      document.addEventListener('visibilitychange', schedule);
      onScroll();

      var saved = PAGE.moduleId ? readModule(PAGE.moduleId) : null;
      if (saved && saved.lastStep && saved.lastStep !== '1' && links[saved.lastStep]) {
        resume.appendChild(el('span', { text: 'You were last on step ' + saved.lastStep + '. ' }));
        resume.appendChild(el('a', { href: '#step-' + saved.lastStep, text: 'Go back to ' + titleOf[saved.lastStep] }));
      } else if (resume.parentNode) {
        resume.parentNode.removeChild(resume);
      }
      return;
    }

    /* ------------------------------------------------------------- screens */

    if (resume.parentNode) { resume.parentNode.removeChild(resume); }
    body.classList.add('is-screens');

    /* A progress strip above the step, and prev/next below it. Both are built
       once and moved nowhere; only their labels change. */
    var strip = el('div', { class: 'screen-strip' });
    var stripFill = el('span', { class: 'screen-strip-fill' });
    var stripTrack = el('div', { class: 'screen-strip-track', 'aria-hidden': 'true' }, [stripFill]);
    var stripLabel = el('p', { class: 'screen-strip-label', role: 'status' });
    strip.appendChild(stripLabel);
    strip.appendChild(stripTrack);

    var pager = el('nav', { class: 'screen-pager', 'aria-label': 'Move between steps' });
    var prev = el('button', { type: 'button', class: 'btn btn-secondary screen-prev' }, [
      el('span', { class: 'screen-dir', 'aria-hidden': 'true', text: 'Back' }),
      el('span', { class: 'screen-label' })
    ]);
    var next = el('button', { type: 'button', class: 'btn screen-next' }, [
      el('span', { class: 'screen-dir', 'aria-hidden': 'true', text: 'Next' }),
      el('span', { class: 'screen-label' })
    ]);
    pager.appendChild(prev);
    pager.appendChild(next);

    var main = sections[0].parentNode;
    main.insertBefore(strip, sections[0]);
    main.appendChild(pager);

    sections.forEach(function (section) { section.hidden = true; });

    function indexOf(number) {
      for (var i = 0; i < numbers.length; i += 1) {
        if (numbers[i] === number) { return i; }
      }
      return -1;
    }

    function paint(number, direction) {
      var i = indexOf(number);
      if (i < 0) { return; }
      sections.forEach(function (section, j) { section.hidden = j !== i; });

      var node = sections[i];
      if (MOTION_OK && direction) {
        node.classList.remove('step-in-back', 'step-in-fwd');
        /* Force a reflow so the class change restarts the animation rather
           than being coalesced away. */
        void node.offsetWidth;
        node.classList.add(direction < 0 ? 'step-in-back' : 'step-in-fwd');
      }

      highlight(number);
      stripLabel.textContent = 'Step ' + number + ' of ' + numbers.length + '. ' + titleOf[number];
      stripFill.style.width = Math.round(((i + 1) / numbers.length) * 100) + '%';

      prev.disabled = i === 0;
      next.disabled = i === numbers.length - 1;
      qs('.screen-label', prev).textContent = i === 0 ? '' : titleOf[numbers[i - 1]];
      qs('.screen-label', next).textContent = i === numbers.length - 1 ? 'You are at the end' : titleOf[numbers[i + 1]];
      qs('.screen-dir', next).textContent = i === numbers.length - 1 ? 'Done' : 'Next';
    }

    function go(number, fromClick, skipScroll) {
      if (indexOf(number) < 0) { return; }
      var direction = current === null ? 0 : (indexOf(number) - indexOf(current));
      if (current === number) { return; }
      current = number;
      paint(number, direction);
      markSeen(number, fromClick);
      if (window.location.hash !== '#step-' + number) {
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, '', '#step-' + number);
        } else {
          window.location.hash = 'step-' + number;
        }
      }
      if (!skipScroll) {
        var top = strip.getBoundingClientRect().top + window.pageYOffset - 90;
        window.scrollTo({ top: top < 0 ? 0 : top, behavior: MOTION_OK ? 'smooth' : 'auto' });
      }
      announce('Step ' + number + '. ' + titleOf[number]);
    }

    prev.addEventListener('click', function () {
      var i = indexOf(current);
      if (i > 0) { go(numbers[i - 1], true); }
    });
    next.addEventListener('click', function () {
      var i = indexOf(current);
      if (i < numbers.length - 1) { go(numbers[i + 1], true); }
    });

    window.addEventListener('hashchange', function () {
      var m = /^#step-(.+)$/.exec(window.location.hash);
      if (m && m[1] !== current) { go(m[1], false); }
    });

    /* Arrow keys, but never while someone is typing in a box. */
    document.addEventListener('keydown', function (event) {
      if (event.metaKey || event.ctrlKey || event.altKey) { return; }
      var tag = (event.target && event.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || event.target.isContentEditable) { return; }
      var i = indexOf(current);
      if (event.key === 'ArrowRight' && i < numbers.length - 1) { go(numbers[i + 1], true); }
      else if (event.key === 'ArrowLeft' && i > 0) { go(numbers[i - 1], true); }
    });

    /* Where to open. An explicit hash wins, then the step they left off on,
       then the beginning. */
    var startAt = numbers[0];
    var fromHash = /^#step-(.+)$/.exec(window.location.hash);
    if (fromHash && indexOf(fromHash[1]) >= 0) {
      startAt = fromHash[1];
    } else {
      var savedState = PAGE.moduleId ? readModule(PAGE.moduleId) : null;
      if (savedState && savedState.lastStep && indexOf(savedState.lastStep) >= 0 && savedState.lastStep !== numbers[0]) {
        startAt = savedState.lastStep;
        window.setTimeout(function () {
          announce('Picked up where you left off, at step ' + startAt + '.');
        }, 400);
      }
    }
    current = null;
    go(startAt, false, true);
  }

  /* ------------------------------------------------------------------------
     19. The hub page
     ------------------------------------------------------------------------ */

  var PROGRESS_LABEL = {
    'not-started': 'Not started',
    'in-progress': 'In progress',
    'done': 'Done'
  };

  var PROGRESS_CLASS = {
    'not-started': 'tag tag-planned',
    'in-progress': 'tag tag-progress',
    'done': 'tag tag-done'
  };

  function initHub() {
    var hub = qs('[data-hub]');
    if (!hub) { return; }

    qsa('[data-hub-progress]').forEach(function (node) {
      var moduleId = node.getAttribute('data-hub-progress');
      var progress = moduleProgress(moduleId);
      node.className = PROGRESS_CLASS[progress];
      node.textContent = PROGRESS_LABEL[progress];
    });

    var studyHost = qs('[data-hub-study]');
    if (studyHost) { renderHubStudy(studyHost); }

    qsa('[data-hub-action]').forEach(function (button) {
      var action = button.getAttribute('data-hub-action');
      button.addEventListener('click', function () {
        if (action === 'download') {
          var ok = downloadText('education-research-skills-my-work.txt', exportEverything());
          announce(ok ? 'Your work has been downloaded as a text file.' : 'The browser blocked the download.');
          setHubNote(ok ? 'Downloaded as education-research-skills-my-work.txt' : 'The browser blocked the download.');
        } else if (action === 'clear') {
          var yes = window.confirm('This deletes everything you have saved for this course on this device. It cannot be undone. Delete it?');
          if (!yes) {
            setHubNote('Nothing was deleted.');
            return;
          }
          clearAll();
          if (studyHost) { renderHubStudy(studyHost); }
          qsa('[data-hub-progress]').forEach(function (node) {
            node.className = PROGRESS_CLASS['not-started'];
            node.textContent = PROGRESS_LABEL['not-started'];
          });
          setHubNote('Everything saved for this course on this device has been deleted.');
          announce('Everything saved for this course on this device has been deleted.');
        }
      });
    });
  }

  function setHubNote(text) {
    var note = qs('[data-hub-note]');
    if (note) { note.textContent = text; }
  }

  function renderHubStudy(host) {
    clear(host);

    var map = readProposalMap();
    if (map) {
      renderProposal(host, map, { compact: false });
      return;
    }

    var modules = listModules();
    var any = false;
    var list = el('ul', { class: 'hub-study-list' });
    modules.forEach(function (entry) {
      var lines = moduleExportLines(entry.id);
      if (!lines.length) { return; }
      any = true;
      var item = el('li', {});
      item.appendChild(el('h4', { text: moduleTitleOf(entry.id, entry.data) }));
      var dl = el('dl', {});
      lines.forEach(function (pair) {
        dl.appendChild(el('dt', { text: pair[0] }));
        dl.appendChild(el('dd', { text: (pair[1] === '' || pair[1] === null || pair[1] === undefined) ? 'Not filled in yet.' : String(pair[1]) }));
      });
      item.appendChild(dl);
      list.appendChild(item);
    });
    if (!any) {
      host.appendChild(el('p', {
        text: STORAGE_OK
          ? 'Nothing saved yet. Anything you write in a module shows up here.'
          : 'This browser is not letting the page save to your device, so nothing can be shown here.'
      }));
      return;
    }
    host.appendChild(list);
  }

  /* ------------------------------------------------------------------------
     20. Public API
     ------------------------------------------------------------------------ */

  var Skills = {
    version: VERSION,
    prefix: PREFIX,
    storageAvailable: function () { return STORAGE_OK; },
    log: eventLog,
    state: {
      get: function (moduleId) { return getState(moduleId || PAGE.moduleId); },
      set: function (moduleId, data) { return setState(moduleId || PAGE.moduleId, data); },
      getWidget: function (moduleId, widgetId) { return getWidgetState(moduleId || PAGE.moduleId, widgetId); },
      setWidget: function (moduleId, widgetId, patch) { return setWidgetState(moduleId || PAGE.moduleId, widgetId, patch); },
      progress: moduleProgress,
      clear: function (moduleId) {
        try {
          window.localStorage.removeItem(PREFIX + (moduleId || PAGE.moduleId));
          return true;
        } catch (err) { return false; }
      }
    },
    track: track,
    llm: { score: llmScore },
    hub: {
      list: function () {
        return listModules().map(function (entry) {
          return {
            id: entry.id,
            title: moduleTitleOf(entry.id, entry.data),
            updated: entry.data.updated || null,
            lastStep: entry.data.lastStep || null,
            progress: moduleProgress(entry.id),
            lines: moduleExportLines(entry.id)
          };
        });
      },
      exportText: exportEverything,
      download: function (filename) {
        return downloadText(filename || 'education-research-skills-my-work.txt', exportEverything());
      },
      clear: function (skipConfirm) {
        if (!skipConfirm) {
          var yes = window.confirm('This deletes everything you have saved for this course on this device. It cannot be undone. Delete it?');
          if (!yes) { return false; }
        }
        return clearAll();
      }
    },
    announce: announce,
    register: register,
    hydrate: hydrate,
    /* The motion primitives, so a figure script loaded beside this one gets
       the same easing, the same reduced-motion switch and the same rAF
       guard rather than growing a second set that drifts. */
    motion: {
      ok: motionOK,
      ease: easeOut,
      tween: tween,
      flip: flip,
      reveal: revealBlock,
      countTo: countTo,
      growBar: growBar,
      replay: replayAnimation
    },
    copyText: copyText,
    downloadText: downloadText
  };

  window.Skills = Skills;

  /* ------------------------------------------------------------------------
     21. Start
     ------------------------------------------------------------------------ */

  function start() {
    readPageContext();
    syncHeaderHeight();
    liveRegion();
    qsa('[data-widget]').forEach(hydrate);
    initSteps();
    initHub();
    if (PAGE.moduleId) {
      var state = getState(PAGE.moduleId);
      state.title = PAGE.title;
      setState(PAGE.moduleId, state);
      track('module_open', {});
    }

    window.addEventListener('resize', debounce(syncHeaderHeight, 150));
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(syncHeaderHeight);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}(window, document));
