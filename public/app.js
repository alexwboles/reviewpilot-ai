/* ReviewPilot AI — dashboard app. Uses window.RP (lib/logic.js). */
(function () {
  'use strict';

  var LS = {
    customers: 'rp_customers',
    asks: 'rp_asks',
    reviews: 'rp_reviews',
    settings: 'rp_settings',
    drafts: 'rp_drafts',
    snippets: 'rp_snippets'
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
    settings: load(LS.settings, {}),
    drafts: load(LS.drafts, []),
    snippets: load(LS.snippets, [])
  };
  function persist() {
    save(LS.customers, state.customers);
    save(LS.asks, state.asks);
    save(LS.reviews, state.reviews);
    save(LS.settings, state.settings);
    save(LS.drafts, state.drafts);
    save(LS.snippets, state.snippets);
  }

  // Settings with safe defaults.
  function nagWindow() {
    var n = parseInt(state.settings.nagDays, 10);
    return (isNaN(n) || n < 1) ? 14 : Math.min(365, n);
  }
  function weeklyGoal() {
    var n = parseInt(state.settings.weeklyGoal, 10);
    return (isNaN(n) || n < 1) ? 10 : n;
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

    var win = nagWindow();
    el('nagBadge').textContent = win + '-day rule';
    el('nagSub').textContent = 'Customers asked in the last ' + win + ' days — hold off asking them again.';
    var nagged = Object.keys(state.asks)
      .map(function (k) {
        var c = state.customers.find(function (x) { return x.key === k; });
        return { key: k, name: c ? c.name : k, date: state.asks[k], days: RP.daysSinceAsk(state.asks, k) };
      })
      .filter(function (x) { return x.days < win; })
      .sort(function (a, b) { return a.days - b.days; });

    el('nagList').innerHTML = nagged.length ? '<table><thead><tr><th>Customer</th><th>Asked</th><th>Wait</th></tr></thead><tbody>' +
      nagged.map(function (x) {
        var wait = Math.ceil(win - x.days);
        return '<tr><td>' + esc(x.name) + '</td><td>' + esc(fmtDate(x.date)) + '</td>' +
          '<td><span class="badge warn">wait ' + wait + ' day' + (wait === 1 ? '' : 's') + '</span></td></tr>';
      }).join('') + '</tbody></table>'
      : '<p class="sub">Nobody in the nag window. You\'re clear to ask.</p>';

    el('reviewLog').innerHTML = state.reviews.length ? '<table><thead><tr><th>Stars</th><th>Note</th><th>Logged</th><th>Replied</th></tr></thead><tbody>' +
      state.reviews.map(function (r, i) { return { r: r, i: i }; }).reverse().map(function (x) {
        var r = x.r;
        var rep = r.replied
          ? '<span class="badge ok">replied</span>'
          : '<button class="btn secondary small" data-replied="' + x.i + '">Mark replied</button>';
        return '<tr><td class="stars">' + '★'.repeat(r.stars) + '</td><td>' + esc(r.text) +
          '</td><td>' + esc(fmtDate(r.at)) + '</td><td>' + rep + '</td></tr>';
      }).join('') + '</tbody></table>'
      : '<p class="sub">No reviews logged yet.</p>';
    el('reviewLog').querySelectorAll('[data-replied]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var r = state.reviews[parseInt(btn.dataset.replied, 10)];
        if (!r) return;
        r.replied = new Date().toISOString();
        persist(); renderDashboard();
      });
    });

    // Rating trend + response rate
    var trend = RP.ratingTrendByMonth(state.reviews);
    el('trendTable').innerHTML = trend.length ? '<table><thead><tr><th>Month</th><th>Reviews</th><th>Avg rating</th></tr></thead><tbody>' +
      trend.map(function (t) {
        return '<tr><td>' + esc(t.month) + '</td><td>' + t.count + '</td><td class="stars">' + t.avg.toFixed(1) + ' ★</td></tr>';
      }).join('') + '</tbody></table>'
      : '<p class="sub">Log some reviews to see your rating trend.</p>';
    var rr = RP.responseRate(state.reviews);
    el('responseBadge').textContent = rr.pct + '% responded';
    el('responseLine').textContent = 'You have replied to ' + rr.replied + ' of ' + rr.total +
      ' logged review' + (rr.total === 1 ? '' : 's') + ' (' + rr.pct + '% response rate).';

    renderAskNext();
    renderGoal();
    renderTopics();
    renderRecovery();
  }

  // ---- What customers mention --------------------------------------------------
  function renderTopics() {
    var box = el('topicInsights');
    if (!box) return;
    var topics = RP.reviewTopics(state.reviews);
    if (!topics.length) {
      box.innerHTML = '<p class="sub">Log reviews with a short note to see topic insights.</p>';
      return;
    }
    var maxM = Math.max.apply(null, topics.map(function (t) { return t.mentions; }));
    box.innerHTML = topics.map(function (t) {
      var w = Math.round(t.mentions / maxM * 100);
      var mood = t.avgStars >= 4 ? 'ok' : (t.avgStars >= 3 ? '' : 'warn');
      return '<div class="topic-row"><div class="topic-name">' + esc(t.topic) + '</div>' +
        '<div class="goalbar grow"><div class="goalfill" style="width:' + w + '%"></div></div>' +
        '<div class="topic-meta">' + t.mentions + ' mention' + (t.mentions === 1 ? '' : 's') +
        ' · <span class="badge ' + mood + '">' + t.avgStars.toFixed(1) + ' ★</span></div></div>';
    }).join('');
  }

  // ---- Recovery queue ------------------------------------------------------------
  function renderRecovery() {
    var box = el('recoveryQueue');
    if (!box) return;
    var queue = RP.recoveryQueue(state.reviews);
    var open = queue.filter(function (x) { return RP.recoveryStatus(x.r) === 'open'; }).length;
    el('recoveryBadge').textContent = queue.length ? open + ' open' : 'clear';
    if (!queue.length) {
      box.innerHTML = '<p class="sub">No unresolved low reviews. Keep it that way.</p>';
      return;
    }
    var next = { open: 'contacted', contacted: 'resolved', resolved: 'open' };
    box.innerHTML = '<table><thead><tr><th>Stars</th><th>Note</th><th>Logged</th><th>Status</th><th></th></tr></thead><tbody>' +
      queue.map(function (x) {
        var r = x.r;
        var st = RP.recoveryStatus(r);
        var badge = st === 'open' ? 'warn' : 'ok';
        return '<tr><td class="stars">' + '★'.repeat(r.stars) + '</td><td>' + esc(r.text) +
          '</td><td>' + esc(fmtDate(r.at)) + '</td>' +
          '<td><span class="badge ' + badge + '">' + esc(st) + '</span></td>' +
          '<td><button class="btn secondary small" data-recover="' + x.i + '">Mark ' + next[st] + '</button></td></tr>';
      }).join('') + '</tbody></table>';
    box.querySelectorAll('[data-recover]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var i = parseInt(btn.dataset.recover, 10);
        var cur = RP.recoveryStatus(state.reviews[i]);
        var res = RP.setRecoveryStatus(state.reviews, i, next[cur]);
        if (!res.ok) return;
        persist(); renderDashboard();
      });
    });
  }

  // ---- Who to ask next ------------------------------------------------------
  function renderAskNext() {
    var box = el('askNext');
    if (!box) return;
    if (!state.customers.length) { box.innerHTML = '<p class="sub">Import customers to get suggestions.</p>'; return; }
    var picks = RP.suggestNextAsk(state.customers, state.asks, 5, nagWindow());
    if (!picks.length) { box.innerHTML = '<p class="sub">Everyone is inside the nag window — you\'re fully covered.</p>'; return; }
    box.innerHTML = '<table><thead><tr><th>Customer</th><th>Contact</th><th>Last asked</th><th></th></tr></thead><tbody>' +
      picks.map(function (c, i) {
        var asked = state.asks[c.key];
        return '<tr><td>' + esc(c.name) + '</td><td>' + esc(c.email || c.phone || '—') + '</td><td>' +
          esc(asked ? fmtDate(asked) : 'never') + '</td>' +
          '<td><button class="btn secondary small" data-asknext="' + i + '">Mark asked</button></td></tr>';
      }).join('') + '</tbody></table>';
    box.querySelectorAll('[data-asknext]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var c = picks[parseInt(btn.dataset.asknext, 10)];
        state.asks = RP.recordAsk(state.asks, c.key);
        persist(); renderDashboard(); renderCustomers();
      });
    });
  }

  // ---- Weekly ask goal ---------------------------------------------------------
  function renderGoal() {
    var g = RP.goalProgress(state.asks, weeklyGoal());
    el('goalFill').style.width = g.pct + '%';
    el('goalBadge').textContent = g.pct + '%';
    el('goalText').textContent = g.count + ' of ' + g.goal + ' asks this week' +
      (g.remaining ? ' — ' + g.remaining + ' to go.' : ' — goal hit. Nice work.');
  }

  el('logReviewBtn').addEventListener('click', function () {
    var stars = parseInt(el('logStars').value, 10);
    var text = el('logText').value.trim();
    state.reviews.push({ stars: stars, text: text || '(no note)', at: new Date().toISOString(), replied: null });
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
    renderAskTemplates();

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

  // ---- Ask message templates -------------------------------------------------
  // Copy-ready SMS + email ask texts, filled from the generated link.
  function currentAskLink() {
    if (!state.settings.business || !state.settings.reviewUrl) return '';
    return RP.buildAskUrl(window.location.origin, state.settings.business, state.settings.reviewUrl) || '';
  }
  function renderAskTemplates() {
    var t = RP.askMessageTemplates(state.settings.business, currentAskLink());
    el('tplSms').textContent = t.sms;
    el('tplEmail').textContent = t.email;
    el('copyTplSms').onclick = function () {
      navigator.clipboard.writeText(t.sms).then(function () {
        el('copyTplSms').textContent = 'Copied ✓';
        setTimeout(function () { el('copyTplSms').textContent = 'Copy SMS'; }, 1500);
      });
    };
    el('copyTplEmail').onclick = function () {
      navigator.clipboard.writeText(t.email).then(function () {
        el('copyTplEmail').textContent = 'Copied ✓';
        setTimeout(function () { el('copyTplEmail').textContent = 'Copy email'; }, 1500);
      });
    };
  }
  renderAskTemplates();

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
    var win = nagWindow();
    if (RP.isNag(state.asks, key, win)) {
      msg.innerHTML = '<p class="notice">' + esc(RP.nagMessage(state.asks, key, win)) + ' Log again anyway?</p>';
    }
    state.asks = RP.recordAsk(state.asks, key);
    // Auto-add to customers if unknown
    if (!state.customers.some(function (c) { return c.key === key; })) {
      state.customers.push({ name: name || contact, email: '', phone: '', key: key });
    }
    persist();
    el('quickAskName').value = ''; el('quickAskContact').value = '';
    msg.innerHTML = '<p class="notice ok">Ask logged for <b>' + esc(name || contact) + '</b>. They\'re protected for ' + win + ' days.</p>';
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

    // Log the draft so it can be re-copied later without re-drafting.
    state.drafts.unshift(RP.draftLogEntry(payload, data.tones));
    state.drafts = state.drafts.slice(0, 20);
    persist();
    renderDraftLog();
  });

  // ---- Recent drafts -------------------------------------------------------------
  function renderDraftLog() {
    var box = el('draftLog');
    if (!box) return;
    if (!state.drafts.length) {
      box.innerHTML = '<p class="sub">No drafts yet — draft a reply above and it lands here.</p>';
      return;
    }
    box.innerHTML = state.drafts.map(function (d, i) {
      return '<div class="draft-entry"><div class="draft-meta"><span class="stars">' + '★'.repeat(d.stars) + '</span> ' +
        '<strong>' + esc(d.name || 'Customer') + '</strong> <span class="sub">' + esc(fmtDate(d.at)) + '</span></div>' +
        '<p class="sub draft-review">“' + esc(d.review || '(no review text)') + '”</p>' +
        '<div class="row">' + ['professional', 'friendly', 'witty'].map(function (t) {
          return '<button class="btn secondary small" data-dcopy="' + i + '-' + t + '">Copy ' + t + '</button>';
        }).join('') + '</div></div>';
    }).join('');
    box.querySelectorAll('[data-dcopy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var parts = btn.dataset.dcopy.split('-');
        var d = state.drafts[parseInt(parts[0], 10)];
        if (!d) return;
        navigator.clipboard.writeText(d[parts[1]] || '').then(function () {
          btn.textContent = 'Copied ✓';
          setTimeout(function () { btn.textContent = 'Copy ' + parts[1]; }, 1500);
        });
      });
    });
  }

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
    downloadBlob('reviewpilot-data.json', JSON.stringify(state, null, 2), 'application/json');
  });

  el('exportCsvBtn').addEventListener('click', function () {
    if (!state.customers.length) {
      el('importMsg').innerHTML = '<p class="notice err">No customers to export yet.</p>';
      return;
    }
    downloadBlob('reviewpilot-customers.csv', RP.customersToCSV(state.customers), 'text/csv;charset=utf-8');
    el('importMsg').innerHTML = '<p class="notice ok">Exported <b>' + state.customers.length + '</b> customer(s) to CSV.</p>';
  });

  // ---- Backup restore -------------------------------------------------------------
  // Re-imports a JSON file written by "Export JSON". Validates shape first,
  // then merges on top of existing data without clobbering it.
  el('restoreBtn').addEventListener('click', function () { el('restoreFile').click(); });
  el('restoreFile').addEventListener('change', function () {
    var msg = el('importMsg');
    var file = el('restoreFile').files[0];
    el('restoreFile').value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var obj;
      try { obj = JSON.parse(reader.result); }
      catch (e) { msg.innerHTML = '<p class="notice err">That file is not valid JSON.</p>'; return; }
      var v = RP.validateBackup(obj);
      if (!v.ok) { msg.innerHTML = '<p class="notice err">' + esc(v.error) + '</p>'; return; }
      if (!confirm('Restore this backup? Existing customers and reviews are kept — backup items merge in.')) return;
      var counts = { customers: 0, reviews: 0 };
      (obj.customers || []).forEach(function (r) {
        var c = { name: String(r.name || ''), email: String(r.email || ''), phone: String(r.phone || '') };
        c.key = (c.email || c.phone || c.name).toLowerCase();
        if (c.key && !state.customers.some(function (x) { return x.key === c.key; })) {
          state.customers.push(c); counts.customers++;
        }
      });
      (obj.reviews || []).forEach(function (r) {
        state.reviews.push({ stars: r.stars, text: r.text || '', at: r.at || new Date().toISOString(), replied: r.replied || null, recovery: r.recovery || 'open' });
        counts.reviews++;
      });
      ['asks', 'settings', 'drafts', 'snippets'].forEach(function (k) {
        if (obj[k] && typeof obj[k] === 'object') state[k] = obj[k];
      });
      persist(); renderCustomers(); renderDashboard(); renderDraftLog();
      msg.innerHTML = '<p class="notice ok">Restored <b>' + counts.customers + '</b> customer(s) and <b>' +
        counts.reviews + '</b> review(s) from backup.</p>';
    };
    reader.readAsText(file);
  });

  el('clearBtn').addEventListener('click', function () {
    if (!confirm('Clear ALL ReviewPilot data in this browser?')) return;
    // Bug fix: snippets was missing from the reset, leaving stale snippet
    // records in localStorage after a "clear all".
    state = { customers: [], asks: {}, reviews: [], settings: {}, drafts: [], snippets: [] };
    persist(); renderCustomers(); renderDashboard(); renderDraftLog();
  });

  function renderCustomers() {
    el('custCount').textContent = state.customers.length;
    var tb = el('custTable');
    if (!state.customers.length) {
      tb.innerHTML = '<tr><td colspan="5" class="sub">No customers yet — import a CSV above.</td></tr>';
      return;
    }
    var win = nagWindow();
    tb.innerHTML = state.customers.map(function (c, i) {
      var asked = state.asks[c.key];
      var nag = RP.isNag(state.asks, c.key, win);
      var status = !asked
        ? '<span class="badge">not asked</span>'
        : nag
          ? '<span class="badge warn">asked ' + Math.floor(RP.daysSinceAsk(state.asks, c.key)) + 'd ago</span>'
          : '<span class="badge ok">asked ' + esc(fmtDate(asked)) + '</span>';
      var action = nag
        ? '<button class="btn ghost small" disabled title="' + esc(RP.nagMessage(state.asks, c.key, win) || '') + '">Nag-protected</button>'
        : '<button class="btn secondary small" data-ask="' + i + '">Mark asked</button>';
      return '<tr><td>' + esc(c.name) + '</td><td>' + esc(c.email) + '</td><td>' + esc(c.phone) +
        '</td><td>' + status + '</td><td>' + action + '</td></tr>';
    }).join('');

    tb.querySelectorAll('[data-ask]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var c = state.customers[parseInt(btn.dataset.ask, 10)];
        if (RP.isNag(state.asks, c.key, nagWindow())) {
          alert(RP.nagMessage(state.asks, c.key, nagWindow()));
          return;
        }
        state.asks = RP.recordAsk(state.asks, c.key);
        persist(); renderCustomers(); renderDashboard();
      });
    });
  }

  function downloadBlob(filename, text, type) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  // ---- Saved reply snippets -------------------------------------------------------
  function renderSnippets() {
    var box = el('snipList');
    if (!box) return;
    if (!state.snippets.length) {
      box.innerHTML = '<p class="sub">No snippets yet — save your first one above.</p>';
      return;
    }
    box.innerHTML = state.snippets.map(function (s, i) {
      return '<div class="draft-entry"><div class="draft-meta"><strong>' + esc(s.name) +
        '</strong> <span class="sub">' + esc(fmtDate(s.at)) + '</span></div>' +
        '<p class="sub">' + esc(s.text) + '</p>' +
        '<div class="row"><button class="btn secondary small" data-snipcopy="' + i + '">Copy</button>' +
        '<button class="btn ghost small" data-snipdel="' + i + '">Delete</button></div></div>';
    }).join('');
    box.querySelectorAll('[data-snipcopy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var s = state.snippets[parseInt(btn.dataset.snipcopy, 10)];
        if (!s) return;
        navigator.clipboard.writeText(s.text).then(function () {
          btn.textContent = 'Copied ✓';
          setTimeout(function () { btn.textContent = 'Copy'; }, 1500);
        });
      });
    });
    box.querySelectorAll('[data-snipdel]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var s = state.snippets[parseInt(btn.dataset.snipdel, 10)];
        if (!s) return;
        if (!confirm('Delete snippet "' + s.name + '"?')) return;
        state.snippets = RP.removeSnippet(state.snippets, s.name);
        persist(); renderSnippets();
      });
    });
  }

  el('addSnipBtn').addEventListener('click', function () {
    var msg = el('snipMsg');
    var res = RP.addSnippet(state.snippets, el('snipName').value, el('snipText').value);
    if (!res.ok) { msg.textContent = res.error; return; }
    state.snippets = res.snippets;
    el('snipName').value = ''; el('snipText').value = ''; msg.textContent = '';
    persist(); renderSnippets();
  });

  // ---- Boot -------------------------------------------------------------------------
  el('nagDays').value = nagWindow();
  el('nagDays').addEventListener('change', function () {
    var n = parseInt(el('nagDays').value, 10);
    state.settings.nagDays = (isNaN(n) || n < 1) ? 14 : Math.min(365, n);
    el('nagDays').value = state.settings.nagDays;
    persist(); renderDashboard();
  });
  el('weeklyGoal').value = weeklyGoal();
  el('weeklyGoal').addEventListener('change', function () {
    var n = parseInt(el('weeklyGoal').value, 10);
    state.settings.weeklyGoal = (isNaN(n) || n < 1) ? 10 : n;
    el('weeklyGoal').value = state.settings.weeklyGoal;
    persist(); renderDashboard();
  });
  renderDashboard();
  renderDraftLog();
  renderSnippets();
})();
