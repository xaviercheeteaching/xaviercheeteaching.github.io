/* ==========================================================================
   Education Research Skills, CTLT edition.
   Drawn figures. Loaded after platform.js, which it registers into.

   What a figure is allowed to be here:

   1. It moves only where something in the content genuinely varies, and the
      learner holds the knob. A figure that plays at you is a GIF with extra
      steps, and nothing here autoplays.
   2. The drawing is aria-hidden. The sentence under it is the real content
      and has to stand on its own, because that is what a screen reader, a
      printout and a learner with reduced motion all get.
   3. Colour lives in the stylesheet, section 19f. This file only picks class
      names, so a figure cannot invent a navy of its own. Flat and hairline,
      like everything else: no shadows, no gradients, no icons.
   4. Controls are native inputs. A range is a range, so keyboard operation
      and the platform's own slider look both come free.
   5. Nothing here is required to understand the module. Every figure is an
      aid to prose that already says the thing.

   This file registers two widget types:

     scrub   an explanation you step through, replacing an animated GIF
     dial    something that varies, with the learner holding the parameter
   ========================================================================== */

(function (window, document) {
  'use strict';

  var Skills = window.Skills;
  if (!Skills || typeof Skills.register !== 'function') {
    if (window.console) { window.console.warn('figures.js loaded before platform.js.'); }
    return;
  }

  var M = Skills.motion || {};

  function motionOK() { return M.ok ? M.ok() : true; }

  var SVGNS = 'http://www.w3.org/2000/svg';

  /* ------------------------------------------------------------------------
     1. Small DOM and SVG helpers

     platform.js keeps its own el() inside its closure, so this file carries a
     minimal pair rather than reaching for internals that were never exported.
     ------------------------------------------------------------------------ */

  function h(tag, attrs, kids) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var value = attrs[key];
      if (value === null || value === undefined || value === false) { return; }
      if (key === 'text') { node.textContent = String(value); return; }
      if (key === 'class') { node.className = String(value); return; }
      if (value === true) { node.setAttribute(key, ''); return; }
      node.setAttribute(key, String(value));
    });
    (kids || []).forEach(function (kid) { if (kid) { node.appendChild(kid); } });
    return node;
  }

  function mk(tag, attrs) {
    var node = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var value = attrs[key];
      if (value === null || value === undefined) { return; }
      node.setAttribute(key, String(value));
    });
    return node;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* A pen bound to one <svg>. Every figure draws through this and nothing
     else, so there is one place to look when a figure comes out wrong. */
  function pen(stage) {
    var api = {
      step: 0,
      prev: 0,

      clear: function () {
        while (stage.firstChild) { stage.removeChild(stage.firstChild); }
        return api;
      },

      add: function (node) { stage.appendChild(node); return node; },

      /* A class suffix marking an element as new in this step, so only what
         is genuinely new fades in. Redrawing the whole frame and fading all
         of it would be a slideshow, not an explanation. Forward only:
         stepping back is a correction and should be instant. */
      fresh: function (n) {
        return (n === api.step && api.step > api.prev && motionOK()) ? ' f-in' : '';
      },

      box: function (x, y, w, height, cls, r) {
        return api.add(mk('rect', {
          x: x, y: y, width: Math.max(0, w), height: Math.max(0, height),
          rx: r === undefined ? 8 : r, 'class': cls || 'f-panel'
        }));
      },

      line: function (x1, y1, x2, y2, cls) {
        return api.add(mk('line', { x1: x1, y1: y1, x2: x2, y2: y2, 'class': cls || 'f-rule' }));
      },

      path: function (d, cls) {
        return api.add(mk('path', { d: d, 'class': cls || 'f-rule' }));
      },

      dot: function (cx, cy, r, cls) {
        return api.add(mk('circle', { cx: cx, cy: cy, r: r, 'class': cls || 'f-dot' }));
      },

      text: function (x, y, str, cls, anchor) {
        var node = mk('text', { x: x, y: y, 'class': cls || null, 'text-anchor': anchor || 'start' });
        node.textContent = String(str);
        return api.add(node);
      },

      /* A short label centred in a box. SVG does not wrap text, so anything
         longer than a few words is a sentence and belongs in the line under
         the drawing, where it can actually be read. */
      mid: function (x, w, y, lines, cls) {
        [].concat(lines).forEach(function (line, i) {
          api.text(x + w / 2, y + i * 15, line, cls, 'middle');
        });
      }
    };
    return api;
  }

  /* ------------------------------------------------------------------------
     2. The register, and the shared frame
     ------------------------------------------------------------------------ */

  var FIGURES = {};
  function figure(name, spec) { FIGURES[name] = spec; }

  function missing(root, name) {
    root.appendChild(h('p', {
      'class': 'fb fb-quiet',
      text: 'This figure (' + (name || 'unnamed') + ') is not in the figure set. The rest of the page still works.'
    }));
  }

  function sayInto(node, said) {
    while (node.firstChild) { node.removeChild(node.firstChild); }
    if (!said) { return; }
    if (typeof said === 'string') { node.appendChild(document.createTextNode(said)); return; }
    if (said.lead) {
      node.appendChild(h('strong', { text: said.lead }));
      node.appendChild(document.createTextNode(' '));
    }
    if (said.rest) { node.appendChild(document.createTextNode(said.rest)); }
  }

  function flatten(said) {
    if (!said) { return ''; }
    return typeof said === 'string' ? said : ((said.lead || '') + ' ' + (said.rest || ''));
  }

  function frame(root, spec, data) {
    var box = h('figure', { 'class': 'figbox' });
    var stage = mk('svg', {
      'class': 'figstage',
      viewBox: (spec.view || [0, 0, 640, 320]).join(' '),
      'aria-hidden': 'true',
      focusable: 'false',
      role: 'presentation'
    });
    box.appendChild(stage);
    var say = h('p', { 'class': 'figsay', role: 'status' });
    box.appendChild(say);
    var controls = h('div', { 'class': 'figctl' });
    box.appendChild(controls);
    var note = data.caption || spec.note;
    if (note) { box.appendChild(h('figcaption', { 'class': 'fignote', text: note })); }
    root.appendChild(box);
    return { box: box, stage: stage, say: say, controls: controls, g: pen(stage) };
  }

  /* ------------------------------------------------------------------------
     3. `scrub`: an explanation you step through

     This is what replaces an animated GIF. The learner sets the pace, can go
     back, and can stop on the frame that confused them. Play exists because
     the first time through you want to be shown; the scrubber exists because
     every time after that you want to look. Neither runs on its own.
     ------------------------------------------------------------------------ */

  Skills.register('scrub', function (root, data, context) {
    var spec = FIGURES[data.figure];
    if (!spec || !spec.steps) { missing(root, data.figure); return; }

    if (data.intro) { root.appendChild(h('p', { text: data.intro })); }

    var steps = spec.steps;
    var last = steps.length - 1;
    var parts = frame(root, spec, data);
    var g = parts.g;
    var current = 0;
    var playToken = 0;
    var playTimer = null;
    var playLabel = data.playLabel || 'Play it through';

    var play = h('button', { type: 'button', 'class': 'btn btn-secondary btn-small', text: playLabel });
    var range = h('input', {
      type: 'range', 'class': 'tune-range',
      min: '0', max: String(last), step: '1', value: '0',
      'aria-label': data.stepLabel || 'Step through the figure'
    });
    var count = h('span', { 'class': 'figstep-n' });
    parts.controls.appendChild(h('div', { 'class': 'figsteps' }, [play, range, count]));

    function paint(next) {
      var to = clamp(Math.round(next), 0, last);
      g.prev = current;
      g.step = to;
      current = to;
      g.clear();
      spec.draw(g, to);
      sayInto(parts.say, steps[to]);
      count.textContent = 'Step ' + (to + 1) + ' of ' + steps.length;
      if (range.value !== String(to)) { range.value = String(to); }
    }

    function stopPlay() {
      playToken += 1;
      if (playTimer) { window.clearTimeout(playTimer); playTimer = null; }
      play.disabled = false;
      play.textContent = playLabel;
    }

    /* Discrete steps with a dwell, not a glide. An explanation is read one
       claim at a time, and a continuous tween would leave the drawing sitting
       in states that are not any of the things being said. */
    function runPlay() {
      stopPlay();
      var mine = playToken;
      var i = current >= last ? 0 : current;
      paint(i);
      if (!motionOK()) { paint(last); return; }
      play.disabled = true;
      play.textContent = 'Playing';
      (function next() {
        if (mine !== playToken) { return; }
        if (i >= last) { stopPlay(); return; }
        playTimer = window.setTimeout(function () {
          if (mine !== playToken) { return; }
          i += 1;
          paint(i);
          next();
        }, spec.dwell || 1700);
      }());
    }

    play.addEventListener('click', function () {
      if (play.disabled) { return; }
      runPlay();
      context.track('figure_play', { figure: data.figure });
    });

    /* Touching the scrubber takes the figure back off autopilot. */
    range.addEventListener('input', function () {
      stopPlay();
      paint(Number(range.value));
    });
    range.addEventListener('change', function () {
      context.track('figure_step', { figure: data.figure, step: current });
    });

    paint(0);
    context.track('figure_view', { figure: data.figure });
  });

  /* ------------------------------------------------------------------------
     4. `dial`: something that varies, with the learner holding it

     The rule that separates this from decoration: the drawing must be able to
     tell the learner something they did not already believe. If every setting
     says the same thing, the figure is a picture, and it should be drawn once
     and left still.
     ------------------------------------------------------------------------ */

  Skills.register('dial', function (root, data, context) {
    var spec = FIGURES[data.figure];
    if (!spec || !spec.draw) { missing(root, data.figure); return; }

    if (data.intro) { root.appendChild(h('p', { text: data.intro })); }

    var saved = context.get() || {};
    var values = {};
    var parts = frame(root, spec, data);
    var g = parts.g;

    function render() {
      g.clear();
      spec.draw(g, values);
      sayInto(parts.say, spec.say ? spec.say(values) : '');
    }

    (spec.controls || []).forEach(function (control) {
      var startValue = saved[control.id] === undefined ? control.start : saved[control.id];

      if (control.type === 'choice') {
        values[control.id] = startValue === undefined ? control.options[0].id : startValue;
        var row = h('div', { 'class': 'figchoice', role: 'group', 'aria-label': control.label });
        var buttons = [];
        control.options.forEach(function (option) {
          var button = h('button', {
            type: 'button',
            text: option.label,
            'aria-pressed': option.id === values[control.id] ? 'true' : 'false'
          });
          button.addEventListener('click', function () {
            values[control.id] = option.id;
            buttons.forEach(function (other, i) {
              other.setAttribute('aria-pressed', control.options[i].id === option.id ? 'true' : 'false');
            });
            render();
            context.save(values);
            context.track('figure_choice', { figure: data.figure, choice: option.id });
            Skills.announce(option.label + '. ' + flatten(spec.say ? spec.say(values) : ''));
          });
          buttons.push(button);
          row.appendChild(button);
        });
        parts.controls.appendChild(row);
        return;
      }

      values[control.id] = startValue === undefined ? control.min : Number(startValue);
      var id = context.id + '-' + control.id;
      var out = h('span', { 'class': 'tune-value' });
      var head = h('div', { 'class': 'tune-head' }, [
        h('label', { 'class': 'tune-label', 'for': id, text: control.label }),
        out
      ]);
      var input = h('input', {
        type: 'range', id: id, 'class': 'tune-range',
        min: String(control.min), max: String(control.max),
        step: String(control.step || 1), value: String(values[control.id])
      });
      function show() {
        out.textContent = control.format ? control.format(values[control.id]) : String(values[control.id]);
      }
      input.addEventListener('input', function () {
        values[control.id] = Number(input.value);
        show();
        render();
      });
      input.addEventListener('change', function () {
        context.save(values);
        context.track('figure_dial', { figure: data.figure, id: control.id, value: values[control.id] });
      });
      show();
      parts.controls.appendChild(h('div', { 'class': 'tune-row' }, [head, input]));
    });

    render();
    context.track('figure_view', { figure: data.figure });
  });

  /* ========================================================================
     5. The figures

     The first four replace the animated GIFs in module 3.1. A GIF cannot be
     paused, stepped or asked a question, it needs a second still image for
     anyone who has asked their system to stop moving things, and each of
     these weighed several hundred kilobytes.
     ======================================================================== */

  /* --- 3.1, first GIF: a theory does not bend to fit the room ------------ */

  figure('theory-travels', {
    view: [0, 0, 640, 300],
    steps: [
      'Cognitive load theory is a claim about people, not about a subject. Working memory is narrow, and instruction that ignores that will cost more than it teaches.',
      'Take it into a chemistry lecture. It predicts that a worked example will beat an unguided problem for a novice.',
      'Take it into a surgical skills lab. The same claim, and here it predicts that breaking a procedure into part-tasks will help.',
      'Take it into a programming studio. Still the same claim, now predicting that guidance should fade as the student gets stronger.',
      'Three settings, three different predictions, one theory. It did not change to fit any of them. That is what makes it a theory rather than a description of your own classroom.'
    ],
    draw: function (g, i) {
      var spots = [
        { x: 20, name: 'Chemistry lecture', note: 'Worked examples' },
        { x: 230, name: 'Surgical skills lab', note: 'Part-task practice' },
        { x: 440, name: 'Programming studio', note: 'Fading guidance' }
      ];

      spots.forEach(function (spot, k) {
        var on = k < i;
        var cx = spot.x + 90;
        g.path('M320 96 C 320 160, ' + cx + ' 155, ' + cx + ' 208',
          on ? 'f-link-on' + g.fresh(k + 1) : 'f-dash');
        g.box(spot.x, 208, 180, 66, on ? 'f-panel-on' : 'f-panel-flat', 10);
        g.mid(spot.x, 180, 234, spot.name, 'f-b' + (on ? ' f-navy' : ' f-mute'));
        g.mid(spot.x, 180, 254, on ? spot.note : 'not yet', 'f-sm f-mute');
      });

      g.box(200, 34, 240, 62, 'f-panel-on', 10);
      g.mid(200, 240, 60, 'Cognitive load theory', 'f-b f-navy');
      g.mid(200, 240, 80, 'Working memory is narrow', 'f-sm f-mute');

      if (i >= 4) { g.mid(200, 240, 22, 'UNCHANGED IN ALL THREE', 'f-caps f-accent' + g.fresh(4)); }
    }
  });

  /* --- 3.1, second GIF: one theory, imported whole ---------------------- */

  figure('theoretical-framework', {
    view: [0, 0, 640, 300],
    steps: [
      'Start with the theory sitting outside your study. It is a general claim, and at this point it is doing nothing for you.',
      'Import it. You are not citing it in passing; you are saying this study is built on it.',
      'Its constructs stop being reading and become the things you measure. Intrinsic, extraneous and germane load each need an indicator.',
      'And its prediction becomes yours. Cut extraneous load and transfer should improve. You are now on the hook for that.',
      'One theory, imported whole, framing the design and carrying a prediction you can be wrong about. That is a theoretical framework.'
    ],
    draw: function (g, i) {
      var chips = ['Intrinsic load', 'Extraneous load', 'Germane load'];
      var measures = ['Task complexity rating', 'Split-attention count', 'Self-explanation score'];

      if (i >= 4) { g.mid(0, 640, 20, 'THEORETICAL FRAMEWORK', 'f-caps f-navy' + g.fresh(4)); }

      g.box(20, 34, 200, 196, 'f-panel-on', 10);
      g.mid(20, 200, 56, 'Cognitive load theory', 'f-b f-navy');
      chips.forEach(function (chip, k) {
        var y = 82 + k * 44;
        g.box(34, y, 172, 32, 'f-panel', 6);
        g.mid(34, 172, y + 20, chip, 'f-sm');
      });

      g.box(400, 34, 220, 196, i >= 1 ? 'f-panel-on' : 'f-panel-flat', 10);
      g.mid(400, 220, 56, 'Your study', 'f-b' + (i >= 1 ? ' f-navy' : ' f-mute'));

      if (i >= 1) {
        g.path('M228 128 L 392 128', 'f-link-on' + g.fresh(1));
        g.path('M384 122 L 394 128 L 384 134 Z', 'f-bar' + g.fresh(1));
        g.mid(228, 164, 116, 'IMPORTED', 'f-caps f-mute' + g.fresh(1));
      }

      measures.forEach(function (measure, k) {
        var y = 82 + k * 44;
        var set = i >= 2;
        g.box(414, y, 192, 32, set ? 'f-panel' : 'f-panel-flat', 6);
        g.mid(414, 192, y + 20, set ? measure : 'not decided yet',
          'f-sm' + (set ? g.fresh(2) : ' f-mute'));
      });

      if (i >= 3) {
        g.box(20, 246, 600, 38, 'f-panel-warm' + g.fresh(3), 8);
        g.mid(20, 600, 270, 'Its prediction, now yours: cut extraneous load and transfer improves',
          'f-b f-accent' + g.fresh(3));
      }
    }
  });

  /* --- 3.1, third GIF: a conceptual framework is assembled -------------- */

  figure('conceptual-framework', {
    view: [0, 0, 640, 300],
    steps: [
      'You already have three things, and not one of them is a framework yet.',
      'The theory says what should happen to anyone, anywhere.',
      'The empirical literature says what has actually happened, in settings near enough to yours to matter.',
      'And you know this programme: who these students are, what the timetable allows, what has already been tried here.',
      'Assembled into one argument for why this study, in this programme, now, they become a conceptual framework. A literature review describes what is there. This argues for something.'
    ],
    draw: function (g, i) {
      var sources = [
        { y: 24, name: 'Theory', note: 'what should happen' },
        { y: 112, name: 'Empirical literature', note: 'what happened elsewhere' },
        { y: 200, name: 'This programme', note: 'what you already know' }
      ];

      if (i >= 4) { g.mid(0, 640, 292, 'CONCEPTUAL FRAMEWORK', 'f-caps f-navy' + g.fresh(4)); }

      sources.forEach(function (source, k) {
        var on = i >= k + 1;
        g.box(20, source.y, 210, 66, on ? 'f-panel-on' : 'f-panel-flat', 10);
        g.mid(20, 210, source.y + 28, source.name, 'f-b' + (on ? ' f-navy' : ' f-mute'));
        g.mid(20, 210, source.y + 48, source.note, 'f-sm f-mute');
        var from = source.y + 33;
        g.path('M238 ' + from + ' C 320 ' + from + ', 320 146, 396 146',
          on ? 'f-link-on' + g.fresh(k + 1) : 'f-dash');
      });

      var built = i >= 4;
      g.box(404, 100, 216, 92, built ? 'f-panel-ink' : 'f-panel-flat', 10);
      g.mid(404, 216, 138, ['Why this study,', 'in this programme, now'],
        'f-b' + (built ? ' f-white' : ' f-mute'));
    }
  });

  /* --- 3.1, fourth GIF: sort by what the thing does --------------------- */

  figure('ask-what-it-does', {
    view: [0, 0, 640, 300],
    dwell: 1900,
    steps: [
      'You have something in front of you: a paper, a diagram, a set of constructs, a page of your own notes. The name on it is not evidence of anything.',
      'Does it explain something in general, beyond any one setting? Then it is a theory, whoever wrote it and whatever they called it.',
      'Is one theory doing the work of framing this study, supplying its constructs and its prediction? That is a theoretical framework.',
      'Are several sources assembled into an argument for why this study, here, makes sense? That is a conceptual framework.',
      'None of the three? Then it is background reading. That is a respectable thing to be. Cite it, and stop calling it a framework.'
    ],
    draw: function (g, i) {
      var rows = [
        { q: 'Explains in general, beyond one setting?', a: 'Theory' },
        { q: 'One theory framing this study?', a: 'Theoretical framework' },
        { q: 'Several sources, made into an argument?', a: 'Conceptual framework' },
        { q: 'None of those?', a: 'Background reading' }
      ];

      g.box(180, 12, 280, 34, 'f-panel-on', 8);
      g.mid(180, 280, 33, 'The thing in front of you', 'f-b f-navy');

      var lit = i - 1;
      g.path('M320 46 L 320 58 L 24 58 L 24 ' + (78 + 3 * 54 + 22), 'f-dash');
      if (lit >= 0) { g.path('M320 46 L 320 58 L 24 58 L 24 ' + (78 + lit * 54 + 22), 'f-link-on'); }

      rows.forEach(function (row, k) {
        var y = 78 + k * 54;
        var on = k === lit;
        g.box(40, y, 330, 44, on ? 'f-panel-on' : 'f-panel-flat', 8);
        g.mid(40, 330, y + 27, row.q, 'f-sm' + (on ? ' f-navy f-b' : ' f-mute'));
        if (on) {
          g.path('M374 ' + (y + 22) + ' L 394 ' + (y + 22), 'f-link-on' + g.fresh(k + 1));
          g.path('M388 ' + (y + 17) + ' L 397 ' + (y + 22) + ' L 388 ' + (y + 27) + ' Z',
            'f-bar' + g.fresh(k + 1));
        }
        g.box(402, y, 218, 44, on ? (k === 3 ? 'f-panel-warm' : 'f-panel-ink') : 'f-panel-flat', 8);
        g.mid(402, 218, y + 27, row.a,
          'f-b' + (on ? (k === 3 ? ' f-accent' : ' f-white') : ' f-mute'));
      });
    }
  });

  /* --- 4.3: the confounder ---------------------------------------------- */

  figure('confounder', {
    view: [0, 0, 640, 336],
    note: 'Illustrative numbers. The problem is not illustrative.',
    controls: [
      { id: 'share', type: 'range',
        label: 'How much of the gap was there before you taught anything',
        min: 0, max: 100, step: 5, start: 0,
        format: function (v) { return v + '%'; } }
    ],
    say: function (v) {
      if (v.share === 0) {
        return { lead: 'This is what you are hoping for.',
          rest: 'Every point of the difference is the thing you did. It is also the reading you cannot demonstrate by reporting two means, because the drawing above is identical at every setting of this slider.' };
      }
      if (v.share <= 30) {
        return { lead: 'Most of it is still yours.',
          rest: 'A reviewer will not take that on trust. The question is not whether your students did better. It is how you know the two groups were comparable before you started.' };
      }
      if (v.share <= 70) {
        return { lead: 'Now most of the difference was already there.',
          rest: 'Nothing about your data has changed. Same two means, same p value, same chart. What has changed is what the result is allowed to mean.' };
      }
      return { lead: 'Almost none of this is your teaching.',
        rest: 'And your result is unchanged. That is what a confounder does. It does not make the numbers wrong, it makes the sentence you wrote underneath them wrong.' };
    },
    draw: function (g, v) {
      var base = 250;
      var shared = 84;
      var gap = 72;
      var confound = gap * (v.share / 100);
      var mine = gap - confound;

      g.line(40, base, 610, base, 'f-axis');

      g.box(110, base - shared, 110, shared, 'f-bar-bg', 4);
      g.mid(110, 110, base + 22, 'The other section', 'f-sm f-mute');
      g.mid(110, 110, base + 38, 'mean 58', 'f-sm f-mute');

      /* Your section. The total height never changes: that is the point. */
      g.box(360, base - shared, 110, shared, 'f-bar-bg', 4);
      if (confound > 0.5) { g.box(360, base - shared - confound, 110, confound, 'f-bar-2', 4); }
      if (mine > 0.5) { g.box(360, base - shared - gap, 110, mine, 'f-bar', 4); }
      g.mid(360, 110, base + 22, 'Your section', 'f-sm f-navy');
      g.mid(360, 110, base + 38, 'mean 70', 'f-sm f-navy');

      g.line(110, base - shared, 610, base - shared, 'f-dash');

      g.line(492, base - shared, 492, base - shared - gap, 'f-axis');
      g.line(488, base - shared, 496, base - shared, 'f-axis');
      g.line(488, base - shared - gap, 496, base - shared - gap, 'f-axis');
      g.text(504, base - shared - gap / 2 - 3, 'The 12 point gap', 'f-sm f-b');
      g.text(504, base - shared - gap / 2 + 13, 'you are reporting', 'f-sm f-mute');

      /* Named, not just coloured. Colour never carries meaning alone here. */
      g.box(40, 34, 12, 12, 'f-bar', 3);
      g.text(60, 45, 'What you taught: ' + (12 * (1 - v.share / 100)).toFixed(1) + ' points', 'f-sm');
      g.box(40, 56, 12, 12, 'f-bar-2', 3);
      g.text(60, 67, 'Already there before term: ' + (12 * (v.share / 100)).toFixed(1) + ' points', 'f-sm');
      /* Below the chart, not beside it. At a high setting the navy segment
         reaches y = 94 and these two lines used to run straight through it. */
      g.text(40, 312, 'The students who picked your section may have been keener to begin with.', 'f-sm f-mute');
      g.text(40, 328, 'You did not measure that, so you cannot subtract it.', 'f-sm f-mute');
    }
  });

  /* --- 4.2: liking it and learning it are two measurements -------------- */

  /* Twenty-four fixed pairs. Fixed and not random, so two colleagues
     comparing notes see the same cloud and a reload does not reshuffle it
     under the learner. Same reasoning as the fixed shuffle in `parsons`. */
  var CLOUD = [
    [-1.62, 0.44], [0.31, -1.11], [1.24, 0.87], [-0.48, -0.29], [0.92, 1.43], [-1.05, 1.02],
    [0.06, -0.63], [1.71, -0.18], [-0.83, -1.36], [0.57, 0.21], [-0.21, 1.19], [1.03, -0.94],
    [-1.34, -0.07], [0.44, 1.61], [0.79, -1.48], [-0.66, 0.68], [1.46, 0.33], [-1.89, -0.52],
    [0.18, 0.95], [-0.37, -1.72], [1.12, -0.41], [-1.18, 0.13], [0.68, -0.86], [-0.05, 0.57]
  ];

  figure('outcome', {
    view: [0, 0, 640, 300],
    note: 'Illustrative points, not data. Set it where you believe the truth is, then read what that would mean for your proposal.',
    controls: [
      { id: 'r', type: 'range',
        label: 'How closely enjoyment and learning move together',
        min: -80, max: 90, step: 10, start: 0,
        format: function (v) { return 'r = ' + (v / 100).toFixed(2); } }
    ],
    say: function (v) {
      var r = v.r / 100;
      if (r >= 0.6) {
        return { lead: 'If it looked like this, the feedback form would be a learning measure.',
          rest: 'You could run the usual end-of-module survey and report it as evidence that they learned more. The whole of module 4.2 would be unnecessary.' };
      }
      if (r >= 0.25) {
        return { lead: 'A lean, and not much of one.',
          rest: 'Knowing a class rated the module highly would shift your guess about their learning a little. It would not settle it, and it is not an outcome a panel will accept on its own.' };
      }
      if (r > -0.15) {
        return { lead: 'Two separate measurements.',
          rest: 'Knowing how much a class enjoyed a module tells you close to nothing about how much they learned. This is why the call asks for outcomes that go beyond student perceptions, and why satisfaction data cannot stand in for them.' };
      }
      return { lead: 'The uncomfortable one.',
        rest: 'If effortful teaching feels worse while working better, a good rating is evidence against you. Worth deciding what you think before you promise the panel a satisfaction outcome.' };
    },
    draw: function (g, v) {
      var r = v.r / 100;
      var k = Math.sqrt(Math.max(0, 1 - r * r));
      var x0 = 96, x1 = 604, y0 = 34, y1 = 236;
      var mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      var sx = (x1 - x0) / 5.2, sy = (y1 - y0) / 5.2;

      g.line(x0, y1, x1, y1, 'f-axis');
      g.line(x0, y0, x0, y1, 'f-axis');
      g.text(x1, y1 + 22, 'Rated the module higher', 'f-sm f-mute', 'end');
      g.text(x0 - 8, y0 + 4, 'Learned', 'f-sm f-mute', 'end');
      g.text(x0 - 8, y0 + 19, 'more', 'f-sm f-mute', 'end');

      g.line(x0, my, x1, my, 'f-dash');
      g.line(mx, y0, mx, y1, 'f-dash');

      /* The line first, so the classes sit on top of it. */
      g.line(mx - 2.4 * sx, my - r * 2.4 * sy, mx + 2.4 * sx, my + r * 2.4 * sy,
        Math.abs(r) < 0.15 ? 'f-dash' : 'f-link-on');

      CLOUD.forEach(function (point) {
        var b = r * point[0] + k * point[1];
        g.dot(clamp(mx + point[0] * sx, x0 + 5, x1 - 5),
          clamp(my - b * sy, y0 + 5, y1 - 5), 4.5, 'f-dot');
      });

      g.text(x0, 274, 'Each dot is one class. Left to right is what they said. Up and down is what they learned.',
        'f-sm f-mute');
    }
  });

  /* --- 3.2: what a lens shows, and what it leaves dark ------------------ */

  var FIELD = [
    'Students skip the pre-reading',
    'The worked example runs to 40 lines',
    'Two students explain it to the rest',
    'Nobody asks a question in class',
    'Attendance falls away after week six',
    'The lab manual has no diagrams',
    'A student says it finally clicked',
    'Marks cluster just above the pass line',
    'Seniors coach juniors in the corridor',
    'Most groups pick the easier project'
  ];

  var LENSES = [
    { id: 'load', label: 'Cognitive load', shows: [1, 5, 7],
      says: 'It shows you the materials and what they cost to process: a 40 line example, a manual with no diagrams, marks piling up at the pass line. It has nothing to say about why the seniors coach the juniors in the corridor.' },
    { id: 'sdt', label: 'Self-determination', shows: [0, 4, 9],
      says: 'It shows you choice and its absence: skipped reading, attendance falling away, groups taking the safer project. The 40 line worked example becomes invisible, and that was the thing you could actually have fixed this semester.' },
    { id: 'cop', label: 'Communities of practice', shows: [2, 3, 8],
      says: 'It shows you who is allowed to take part and how: peer explanation, the silence in class, the corridor coaching that no timetable records. It cannot see the marks distribution at all.' },
    { id: 'thresh', label: 'Threshold concepts', shows: [6, 7, 9],
      says: 'It shows you where this subject is hard in its own particular way: the moment it clicked, the pile-up at the pass line, the avoidance of the harder project. It is silent on the reading nobody did.' }
  ];

  function lensOf(id) {
    var found = LENSES[0];
    LENSES.forEach(function (lens) { if (lens.id === id) { found = lens; } });
    return found;
  }

  figure('lens', {
    view: [0, 0, 640, 300],
    note: 'The dimmed items have not gone anywhere. They are the part of the field this lens does not light.',
    controls: [
      { id: 'lens', type: 'choice', label: 'Which lens',
        options: LENSES.map(function (lens) { return { id: lens.id, label: lens.label }; }) }
    ],
    say: function (v) {
      var lens = lensOf(v.lens);
      return { lead: lens.label + '.', rest: lens.says };
    },
    draw: function (g, v) {
      var lens = lensOf(v.lens);

      g.text(20, 16, 'ONE TUTORIAL GROUP, ONE SEMESTER. TEN THINGS YOU NOTICED.', 'f-caps f-mute');

      FIELD.forEach(function (item, k) {
        var x = 20 + (k % 2) * 310;
        var y = 30 + Math.floor(k / 2) * 52;
        var on = lens.shows.indexOf(k) !== -1;
        g.box(x, y, 290, 42, on ? 'f-panel-on' : 'f-panel-flat f-dim', 8);
        g.mid(x, 290, y + 26, item, 'f-sm' + (on ? ' f-navy f-b' : ' f-mute f-dim'));
      });
    }
  });

}(window, document));
