/* ReviewPilot AI — dashboard app. Uses window.RP (lib/logic.js). */
(function () {
  'use strict';

  var LS = {
    customers: 'rp_customers',
    asks: 'rp_asks',
    reviews: 'rp_reviews',
    settings: 'rp_settings'
  };

  function load(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var state = {
    customers: load(LS.customers, []),
    asks: load(LS.asks, {}),
    reviews: load(LS.reviews, []),
    settings: load(LS.settings, {})
  };
  function persist() {
    save(LS.customers, state.customers);
    save(LS.asks, state.asks);
    save(LS.reviews, state.reviews);
    save(LS.settings, state.settings);
  }

  // ---- Navigation -------------------------------------------------------
  var nav = el('nav');
  nav.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-view]');
    if (!btn) return;
    nav.querySelectorAll('button').forEach(function (b) { b.classList.remove('active'); });
    btn.classList.add('active');
    ['dashboard', 'get', 'reply', 'customers'].forEach(function (v) {
      el('view-' + v).classList.toggle('hidden', v !== btn.dataset.view);
    });
    if (btn.dataset.view === 'dashboard') renderDashboard();
    if (btn.dataset.view === 'customers') renderCustomers();
  });

  // ---- Dashboard ---------------------------------------------------------
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString(); } catch (e) { return ''; }
  }

  function renderDashboard() {
    var stats = RP.computeStats(state);
    var cards = [
      [stats.totalCustomers, 'customers'],
      [stats.askedCount, 'asked for reviews'],
      [stats.askRate + '%', 'ask coverage'],
      [stats.asksLast7Days, 'asks (last 7 days)'],
      [stats.totalReviews, 'reviews logged'],
      [stats.avgRating == null ? '—' : stats.avgRating + ' ★', 'average rating']
    ];
    el('statCards').innerHTML = cards.map(function (c) {
      return '<div class="card stat"><div class="num">' + esc(c[0]) + '</div><div class="lbl">' + esc(c[1]) + '</div></div>';
    }).join('');

    var nagged = Object.keys(state.asks)
      .map(function (k) {
        var c = state.customers.find(function (x) { return x.key === k; });
        return { key: k, name: c ? c.name : k, date: state.asks[k], days: RP.daysSinceAsk(state.asks, k) };
      })
      .filter(function (x) { return x.days < RP.NAG_WINDOW_DAYS; })
      .sort(function (a, b) { return a.days - b.days; });

    el('nagList').innerHTML = nagged.length ? '<table><thead><tr><th>Customer</th><th>Asked</th><th>Wait</th></tr></thead><tbody>' +
      nagged.map(function (x) {
        var wait = Math.ceil(RP.NAG_WINDOW_DAYS - x.days);
        return '<tr><td>' + esc(x.name) + '</td><td>' + esc(fmtDate(x.date)) + '</td>' +
          '<td><span class="badge warn">wait ' + wait + ' day' + (wait === 1 ? '' : 's') + '</span></td></tr>';
      }).join('') + '</tbody></table>'
      : '<p class="sub">Nobody in the nag window. You\'re clear to ask.</p>';

    el('reviewLog').innerHTML = state.reviews.length ? '<table><thead><tr><th>Stars</th><th>Note</th><th>Logged</th></tr></thead><tbody>' +
      state.reviews.slice().reverse().map(function (r) {
        return '<tr><td class="stars">' + '★'.repeat(r.stars) + '</td><td>' + esc(r.text) + '</td><td>' + esc(fmtDate(r.at)) + '</td></tr>';
      }).join('') + '</tbody></table>'
      : '<p class="sub">No reviews logged yet.</p>';
  }

  el('logReviewBtn').addEventListener('click', function () {
    var stars = parseInt(el('logStars').value, 10);
    var text = el('logText').value.trim();
    state.reviews.push({ stars: stars, text: text || '(no note)', at: new Date().toISOString() });
    el('logText').value = '';
    persist(); renderDashboard();
  });

  // ---- Link generator ------------------------------------------------------
  function renderQR(target, text) {
    target.innerHTML = '';
    try {
      var qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      target.innerHTML = qr.createSvgTag({ scalable: true });
    } catch (e) {
      target.innerHTML = '<p class="notice err">Could not render QR code.</p>';
    }
  }

  el('genLinkBtn').addEventListener('click', function () {
    var biz = el('bizName').value.trim();
    var url = el('reviewUrl').value.trim();
    var err = el('genError');
    err.innerHTML = '';
    if (!biz) { err.innerHTML = '<p class="notice err">Please enter your business name.</p>'; return; }
    if (!RP.isValidUrl(url)) { err.innerHTML = '<p class="notice err">Please enter a valid Google review URL (starting with http).</p>'; return; }

    var link = RP.buildAskUrl(window.location.origin, biz, url);
    state.settings.business = biz;
    state.settings.reviewUrl = url;
    persist();

    el('askLink').textContent = link;
    el('genResult').classList.remove('hidden');
    renderQR(el('qrBox'), link);

    el('copyLinkBtn').onclick = function () {
      navigator.clipboard.writeText(link).then(function () {
        el('copyLinkBtn').textContent = 'Copied ✓';
        setTimeout(function () { el('copyLinkBtn').textContent = 'Copy link'; }, 1500);
      });
    };
    el('openAskBtn').onclick = function () { window.open(link, '_blank'); };
    el('dlQrBtn').onclick = function () {
      var svg = el('qrBox').querySelector('svg');
      if (!svg) return;
      var blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'review-qr.svg';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    };
  });

  // Prefill from settings
  if (state.settings.business) el('bizName').value = state.settings.business;
  if (state.settings.reviewUrl) el('reviewUrl').value = state.settings.reviewUrl;

  // ---- Quick ask logger ------------------------------------------------------
  el('quickAskBtn').addEventListener('click', function () {
    var name = el('quickAskName').value.trim();
    var contact = el('quickAskContact').value.trim();
    var msg = el('quickAskMsg');
    msg.innerHTML = '';
    if (!name && !contact) { msg.innerHTML = '<p class="notice err">Enter a name or contact first.</p>'; return; }
    var key = (contact || name).toLowerCase();
    if (RP.isNag(state.asks, key)) {
      msg.innerHTML = '<p class="notice">' + esc(RP.nagMessage(state.asks, key)) + ' Log again anyway?</p>';
    }
    state.asks = RP.recordAsk(state.asks, key);
    // Auto-add to customers if unknown
    if (!state.customers.some(function (c) { return c.key === key; })) {
      state.customers.push({ name: name || contact, email: '', phone: '', key: key });
    }
    persist();
    el('quickAskName').value = ''; el('quickAskContact').value = '';
    msg.innerHTML = '<p class="notice ok">Ask logged for <b>' + esc(name || contact) + '</b>. They\'re protected for 14 days.</p>';
    renderDashboard();
  });

  // ---- Reply drafter ------------------------------------------------------------
  fetch('/api/config').then(function (r) { return r.json(); }).then(function (cfg) {
    el('aiBadge').innerHTML = cfg.openai
      ? '<span class="badge ok">AI-enhanced</span>'
      : '<span class="badge">offline smart templates</span>';
  }).catch(function () {
    el('aiBadge').innerHTML = '<span class="badge">offline smart templates</span>';
  });

  el('draftBtn').addEventListener('click', async function () {
    var err = el('draftError'), out = el('draftResult');
    err.innerHTML = ''; out.innerHTML = '';
    var payload = {
      review: el('repText').value,
      stars: parseInt(el('repStars').value, 10),
      business: el('repBiz').value || state.settings.business || '',
      name: el('repName').value
    };
    if (!payload.review.trim()) { err.innerHTML = '<p class="notice err">Paste the review text first.</p>'; return; }

    var data = null;
    try {
      var resp = await fetch('/api/draft-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (resp.ok) data = await resp.json();
    } catch (e) { /* offline fallback below */ }

    if (!data) {
      // Pure client-side fallback: identical local templates.
      var local = RP.draftReplies(payload);
      data = {
        tones: { professional: local.professional, friendly: local.friendly, witty: local.witty },
        enhanced: false
      };
    }

    out.innerHTML = '<h3>Reply options ' +
      (data.enhanced ? '<span class="badge ok">AI-enhanced</span>' : '<span class="badge">smart templates</span>') + '</h3>' +
      ['professional', 'friendly', 'witty'].map(function (tone, i) {
        return '<div class="tone"><h4>' + tone + '</h4><p id="tone-' + i + '">' + esc(data.tones[tone]) + '</p>' +
          '<button class="btn secondary small" data-copy="tone-' + i + '">Copy</button></div>';
      }).join('');

    out.querySelectorAll('[data-copy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        navigator.clipboard.writeText(el(btn.dataset.copy).textContent).then(function () {
          btn.textContent = 'Copied ✓';
          setTimeout(function () { btn.textContent = 'Copy'; }, 1500);
        });
      });
    });
  });

  // ---- Customers -----------------------------------------------------------------
  el('importBtn').addEventListener('click', function () {
    var msg = el('importMsg');
    msg.innerHTML = '';
    var text = el('csvText').value;
    var file = el('csvFile').files[0];

    function doImport(t) {
      var rows = RP.parseCSV(t);
      if (!rows.length) { msg.innerHTML = '<p class="notice err">No valid rows found. Need a header like <code>name,email,phone</code>.</p>'; return; }
      var added = 0;
      rows.forEach(function (r) {
        if (!state.customers.some(function (c) { return c.key === r.key; })) {
          state.customers.push(r); added++;
        }
      });
      persist(); renderCustomers(); renderDashboard();
      msg.innerHTML = '<p class="notice ok">Imported <b>' + added + '</b> new customer(s) (' + (rows.length - added) + ' duplicate(s) skipped).</p>';
    }

    if (file) {
      var reader = new FileReader();
      reader.onload = function () { doImport(reader.result); };
      reader.readAsText(file);
    } else if (text.trim()) {
      doImport(text);
    } else {
      msg.innerHTML = '<p class="notice err">Upload a CSV file or paste CSV text first.</p>';
    }
  });

  el('exportBtn').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'reviewpilot-data.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  });

  el('clearBtn').addEventListener('click', function () {
    if (!confirm('Clear ALL ReviewPilot data in this browser?')) return;
    state = { customers: [], asks: {}, reviews: [], settings: {} };
    persist(); renderCustomers(); renderDashboard();
  });

  function renderCustomers() {
    el('custCount').textContent = state.customers.length;
    var tb = el('custTable');
    if (!state.customers.length) {
      tb.innerHTML = '<tr><td colspan="5" class="sub">No customers yet — import a CSV above.</td></tr>';
      return;
    }
    tb.innerHTML = state.customers.map(function (c, i) {
      var asked = state.asks[c.key];
      var nag = RP.isNag(state.asks, c.key);
      var status = !asked
        ? '<span class="badge">not asked</span>'
        : nag
          ? '<span class="badge warn">asked ' + Math.floor(RP.daysSinceAsk(state.asks, c.key)) + 'd ago</span>'
          : '<span class="badge ok">asked ' + esc(fmtDate(asked)) + '</span>';
      var action = nag
        ? '<button class="btn ghost small" disabled title="' + esc(RP.nagMessage(state.asks, c.key) || '') + '">Nag-protected</button>'
        : '<button class="btn secondary small" data-ask="' + i + '">Mark asked</button>';
      return '<tr><td>' + esc(c.name) + '</td><td>' + esc(c.email) + '</td><td>' + esc(c.phone) +
        '</td><td>' + status + '</td><td>' + action + '</td></tr>';
    }).join('');

    tb.querySelectorAll('[data-ask]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var c = state.customers[parseInt(btn.dataset.ask, 10)];
        if (RP.isNag(state.asks, c.key)) {
          alert(RP.nagMessage(state.asks, c.key));
          return;
        }
        state.asks = RP.recordAsk(state.asks, c.key);
        persist(); renderCustomers(); renderDashboard();
      });
    });
  }

  // ---- Boot -------------------------------------------------------------------------
  renderDashboard();
})();
