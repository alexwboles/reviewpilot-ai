/* ReviewPilot AI — shared logic (Node + browser).
 * UMD-ish: `require('./lib/logic')` in Node, `window.RP` in the browser.
 * No dependencies. All AI drafting works offline via local templates.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RP = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NAG_WINDOW_DAYS = 14;
  var MS_PER_DAY = 24 * 60 * 60 * 1000;

  function clampStars(s) {
    s = parseInt(s, 10);
    if (isNaN(s)) return 5;
    return Math.max(1, Math.min(5, s));
  }

  function clean(s) {
    return String(s == null ? '' : s).trim();
  }

  // Pull a short, quotable snippet from the review for personalization.
  function snippetOf(review) {
    var t = clean(review).replace(/\s+/g, ' ');
    if (!t) return '';
    // Prefer the first sentence if it's a reasonable length.
    var m = t.match(/^(.{20,140}?[.!?])(\s|$)/);
    var s = m ? m[1] : t.slice(0, 120);
    return s.replace(/[.!?]+$/, '');
  }

  function greet(name) {
    name = clean(name);
    return name ? ' ' + name + ',' : '';
  }

  // ---- Reply drafting -------------------------------------------------
  // Three tones, tuned by star rating. Works with zero API keys.
  function draftReplies(opts) {
    opts = opts || {};
    var review = clean(opts.review);
    var stars = clampStars(opts.stars);
    var business = clean(opts.business) || 'our business';
    var name = clean(opts.name);
    var snip = snippetOf(review);
    var echo = snip ? ' We\'re glad "' + snip + '" stood out to you.' : '';
    var g = greet(name);

    var tones;
    if (stars >= 4) {
      tones = {
        professional:
          'Thank you for your ' + stars + '-star review' + g + '.' + echo +
          ' Your feedback means a great deal to the whole team at ' + business +
          ', and we look forward to serving you again soon.',
        friendly:
          'Wow, thank you so much' + g + '! ' +
          (snip ? 'Reading that "' + snip + '" honestly made our day. ' : '') +
          'Reviews like yours are why we love what we do at ' + business +
          '. Can\'t wait to see you again!',
        witty:
          'Five stars? We\'re blushing' + g + '!' +
          (snip ? ' We\'ll be quoting "' + snip + '" at our next team meeting. ' : ' ') +
          'Thanks for making ' + business + ' look good — come back soon, the coffee\'s on us (figuratively).'
      };
    } else if (stars === 3) {
      tones = {
        professional:
          'Thank you for your honest feedback' + g + '.' +
          (snip ? ' We\'ve noted your comments about "' + snip + '." ' : ' ') +
          'We\'re always working to improve at ' + business +
          ', and we\'d welcome the chance to earn that extra star on your next visit.',
        friendly:
          'Thanks for the honest review' + g + ' — we really do read every word. ' +
          (snip ? 'Your note about "' + snip + '" is super helpful. ' : '') +
          'We\'re on it, and we\'d love another shot to wow you at ' + business + '.',
        witty:
          'Three stars — we\'ll take "solid" as a starting point, not a finish line' + g + '. ' +
          (snip ? 'Point taken on "' + snip + '." ' : '') +
          'The team at ' + business + ' is already plotting how to earn the other two. Challenge accepted.'
      };
    } else {
      // 1-2 stars: service recovery. Empathy first, take it offline.
      tones = {
        professional:
          'We\'re very sorry to hear about your experience' + g + '. ' +
          'This isn\'t the standard we hold ourselves to at ' + business + '. ' +
          'We\'d appreciate the chance to make this right — please reach out to us directly so we can resolve this with you personally.',
        friendly:
          'Oh no, we\'re really sorry' + g + '. ' +
          'That\'s not the experience we want anyone to have at ' + business + '. ' +
          'We\'d love to fix this — could you message or call us directly so we can sort it out together?',
        witty:
          'Well, this one stings a little' + g + ' — and honestly, it should. ' +
          'We dropped the ball, and ' + business + ' is better than this. ' +
          'Give us a chance to make it up to you: reach out directly and we\'ll put it right.'
      };
    }

    return {
      professional: tones.professional,
      friendly: tones.friendly,
      witty: tones.witty,
      meta: { stars: stars, positive: stars >= 4, needsRecovery: stars <= 2 }
    };
  }

  // ---- CSV import ------------------------------------------------------
  // Accepts: name,email,phone header (any order, case-insensitive).
  function parseCSV(text) {
    var lines = String(text == null ? '' : text).split(/\r?\n/);
    var rows = [];
    var headers = null;

    lines.forEach(function (line) {
      if (!line.trim()) return;
      var cells = splitCSVLine(line).map(function (c) { return c.trim(); });
      if (!headers) {
        headers = cells.map(function (h) { return h.toLowerCase(); });
        return;
      }
      var obj = {};
      headers.forEach(function (h, i) {
        if (h === 'name') obj.name = cells[i] || '';
        else if (h === 'email') obj.email = cells[i] || '';
        else if (h === 'phone') obj.phone = cells[i] || '';
      });
      obj.key = (obj.email || obj.phone || obj.name).toLowerCase();
      if (obj.key) rows.push(obj);
    });
    return rows;
  }

  function splitCSVLine(line) {
    var out = [], cur = '', inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }

  // ---- Anti-nag ---------------------------------------------------------
  // asks: { key: ISODateString }. windowDays optional (default 14).
  function normalizeWindow(w) {
    var n = parseInt(w, 10);
    if (isNaN(n) || n < 1) return NAG_WINDOW_DAYS;
    return Math.min(365, n);
  }

  function daysSinceAsk(asks, key) {
    if (!asks || !key) return Infinity;
    var k = String(key).toLowerCase();
    var iso = asks[k];
    if (!iso) return Infinity;
    var then = new Date(iso).getTime();
    if (isNaN(then)) return Infinity;
    return (Date.now() - then) / MS_PER_DAY;
  }

  function isNag(asks, key, windowDays) {
    return daysSinceAsk(asks, key) < normalizeWindow(windowDays);
  }

  function nagMessage(asks, key, windowDays) {
    var win = normalizeWindow(windowDays);
    var d = daysSinceAsk(asks, key);
    if (d >= win) return null;
    var daysLeft = Math.ceil(win - d);
    return 'Already asked ' + Math.floor(d) + ' day(s) ago — wait ' + daysLeft + ' more day(s) to avoid nagging.';
  }

  function recordAsk(asks, key) {
    asks = asks || {};
    asks[String(key).toLowerCase()] = new Date().toISOString();
    return asks;
  }

  // ---- Dashboard stats ---------------------------------------------------
  function computeStats(data) {
    data = data || {};
    var customers = data.customers || [];
    var asks = data.asks || {};
    var reviews = data.reviews || [];

    var askedCount = customers.filter(function (c) { return asks[c.key]; }).length;
    var recentAsks = Object.keys(asks).filter(function (k) {
      return (Date.now() - new Date(asks[k]).getTime()) / MS_PER_DAY <= 7;
    }).length;

    var totalStars = 0, validReviews = 0;
    reviews.forEach(function (r) {
      var s = clampStars(r.stars);
      if (r.stars != null) { totalStars += s; validReviews++; }
    });

    return {
      totalCustomers: customers.length,
      askedCount: askedCount,
      askRate: customers.length ? Math.round((askedCount / customers.length) * 100) : 0,
      asksLast7Days: recentAsks,
      totalReviews: reviews.length,
      avgRating: validReviews ? (totalStars / validReviews).toFixed(1) : null
    };
  }

  // ---- Review-request link ------------------------------------------------
  function buildAskUrl(base, business, reviewUrl) {
    base = String(base || '').replace(/\/$/, '');
    var b = clean(business), u = clean(reviewUrl);
    if (!b || !u) return null;
    return base + '/ask?b=' + encodeURIComponent(b) + '&u=' + encodeURIComponent(u);
  }

  function isValidUrl(s) {
    try {
      var u = new URL(clean(s));
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (e) { return false; }
  }

  // ---- CSV export ------------------------------------------------------
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return (/[",\n]/.test(s)) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function customersToCSV(customers) {
    var lines = ['name,email,phone'];
    (customers || []).forEach(function (c) {
      lines.push([c.name || '', c.email || '', c.phone || ''].map(csvCell).join(','));
    });
    return lines.join('\n');
  }

  // ---- Who to ask next ----------------------------------------------------
  // Up to `limit` customers outside the nag window: never-asked first,
  // then longest since last ask.
  function suggestNextAsk(customers, asks, limit, windowDays) {
    var lim = Math.max(1, parseInt(limit, 10) || 5);
    var list = (customers || []).filter(function (c) { return !isNag(asks, c.key, windowDays); });
    list.sort(function (a, b) { return daysSinceAsk(asks, b.key) - daysSinceAsk(asks, a.key); });
    return list.slice(0, lim);
  }

  // ---- Weekly ask goal ------------------------------------------------------
  function goalProgress(asks, goalPerWeek, now) {
    var goal = Math.max(1, parseInt(goalPerWeek, 10) || 10);
    var t = now ? new Date(now).getTime() : Date.now();
    if (isNaN(t)) t = Date.now();
    var weekAgo = t - 7 * MS_PER_DAY;
    var count = Object.keys(asks || {}).filter(function (k) {
      var at = new Date(asks[k]).getTime();
      return !isNaN(at) && at >= weekAgo && at <= t;
    }).length;
    return {
      goal: goal,
      count: count,
      pct: Math.min(100, Math.round(count / goal * 100)),
      remaining: Math.max(0, goal - count)
    };
  }

  // ---- Rating trend + reply tracking ---------------------------------------
  // ratingTrendByMonth(reviews) -> [{ month, count, avg }] oldest first.
  function ratingTrendByMonth(reviews) {
    var buckets = {};
    (reviews || []).forEach(function (r) {
      if (r.stars == null) return;
      var m = String(r.at || '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(m)) return;
      if (!buckets[m]) buckets[m] = { month: m, total: 0, count: 0 };
      buckets[m].total += clampStars(r.stars);
      buckets[m].count++;
    });
    return Object.keys(buckets).sort().map(function (k) {
      var b = buckets[k];
      return { month: k, count: b.count, avg: Math.round(b.total / b.count * 10) / 10 };
    });
  }

  // responseRate(reviews) -> { total, replied, pct }. r.replied = ISO date or null.
  function responseRate(reviews) {
    var total = (reviews || []).length;
    var replied = (reviews || []).filter(function (r) { return !!r.replied; }).length;
    return { total: total, replied: replied, pct: total ? Math.round(replied / total * 100) : 0 };
  }

  // ---- Review topic insights ----------------------------------------------
  // Scans logged review text for common business topics and reports
  // mention counts + average stars per topic, so the owner can see
  // exactly what customers keep talking about. 100% offline.
  var TOPIC_KEYWORDS = {
    'Service': ['service', 'waiter', 'waitress', 'staff member', 'service was', 'served'],
    'Staff': ['staff', 'team', 'waiter', 'waitress', 'bartender', 'cashier', 'barista', 'stylist', 'mechanic', 'receptionist', 'friendly staff', 'rude'],
    'Food & drink': ['food', 'meal', 'dish', 'pizza', 'burger', 'coffee', 'croissant', 'menu', 'breakfast', 'lunch', 'dinner', 'taco', 'sandwich', 'delicious', 'tasty'],
    'Price': ['price', 'pricing', 'expensive', 'cheap', 'affordable', 'overpriced', 'value', 'cost'],
    'Wait time': ['wait', 'waiting', 'waited', 'slow', 'hour', 'minutes', 'late', 'long line', 'quick service'],
    'Cleanliness': ['clean', 'dirty', 'hygiene', 'filthy', 'spotless', 'tidy', 'messy'],
    'Ambience': ['ambiance', 'ambience', 'atmosphere', 'decor', 'music', 'vibe', 'cozy', 'loud', 'quiet'],
    'Quality': ['quality', 'broken', 'defect', 'workmanship', 'craftsmanship', 'durable', 'fell apart'],
    'Parking & access': ['parking', 'park', 'location', 'access', 'wheelchair', 'ramp', 'elevator']
  };

  // reviewTopics(reviews) -> [{ topic, mentions, avgStars }] sorted by mentions desc.
  function reviewTopics(reviews) {
    var hits = {};
    Object.keys(TOPIC_KEYWORDS).forEach(function (t) { hits[t] = { mentions: 0, stars: 0 }; });
    (reviews || []).forEach(function (r) {
      var text = clean(r.text).toLowerCase();
      if (!text) return;
      var stars = clampStars(r.stars);
      Object.keys(TOPIC_KEYWORDS).forEach(function (t) {
        var found = TOPIC_KEYWORDS[t].some(function (kw) {
          return text.indexOf(kw) !== -1;
        });
        if (found) {
          hits[t].mentions++;
          hits[t].stars += stars;
        }
      });
    });
    var out = Object.keys(hits)
      .filter(function (t) { return hits[t].mentions > 0; })
      .map(function (t) {
        return {
          topic: t,
          mentions: hits[t].mentions,
          avgStars: Math.round(hits[t].stars / hits[t].mentions * 10) / 10
        };
      });
    out.sort(function (a, b) { return b.mentions - a.mentions || a.topic.localeCompare(b.topic); });
    return out;
  }

  // ---- Negative-review recovery workflow -------------------------------------
  // Separate from "mark replied": a 1-2 star review needs follow-up until the
  // customer is actually won back. States: 'open' -> 'contacted' -> 'resolved'.
  var RECOVERY_STATUSES = ['open', 'contacted', 'resolved'];

  function recoveryStatus(r) {
    var s = clean(r && r.recovery);
    return RECOVERY_STATUSES.indexOf(s) !== -1 ? s : 'open';
  }

  // setRecoveryStatus(reviews, index, status) -> { ok, error? }. Index-based,
  // mirrors how the UI addresses rows.
  function setRecoveryStatus(reviews, index, status) {
    if (!Array.isArray(reviews)) return { ok: false, error: 'Invalid review list.' };
    var i = parseInt(index, 10);
    if (isNaN(i) || i < 0 || i >= reviews.length) return { ok: false, error: 'Review not found.' };
    if (RECOVERY_STATUSES.indexOf(status) === -1) return { ok: false, error: 'Invalid recovery status.' };
    reviews[i].recovery = status;
    return { ok: true };
  }

  // recoveryQueue(reviews) -> 1-2 star reviews whose recovery is not resolved,
  // worst ratings first.
  function recoveryQueue(reviews) {
    return (reviews || [])
      .map(function (r, i) { return { r: r, i: i }; })
      .filter(function (x) { return clampStars(x.r.stars) <= 2 && recoveryStatus(x.r) !== 'resolved'; })
      .sort(function (a, b) { return clampStars(a.r.stars) - clampStars(b.r.stars); });
  }

  // ---- Backup restore ----------------------------------------------------------
  // Exported JSON (from the Export backup button) can be re-imported.
  // validateBackup(obj) -> { ok, error? } checks shape before the UI merges it.
  function validateBackup(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { ok: false, error: 'Not a ReviewPilot backup file.' };
    }
    var keys = ['customers', 'asks', 'reviews', 'settings', 'drafts', 'snippets'];
    var hasAny = keys.some(function (k) { return obj[k] !== undefined; });
    if (!hasAny) return { ok: false, error: 'Not a ReviewPilot backup file.' };
    if (obj.customers !== undefined && !Array.isArray(obj.customers)) {
      return { ok: false, error: 'Backup customers list is corrupted.' };
    }
    if (obj.reviews !== undefined && !Array.isArray(obj.reviews)) {
      return { ok: false, error: 'Backup review log is corrupted.' };
    }
    return { ok: true };
  }

  // ---- Ask message templates ------------------------------------------------
  // Ready-made ask texts. {business} and {link} are filled; copy-ready.
  var ASK_TEMPLATES = {
    sms: 'Hi there! Thanks for visiting {business} today. If you had a great experience, would you leave us a quick review? It takes about 30 seconds: {link}',
    email: 'Subject: Thanks for visiting {business}!\n\nHi there,\n\nThanks for choosing {business} — it means a lot to us. If you had a great experience, would you leave us a quick Google review? It takes about 30 seconds and helps our small business more than you know:\n\n{link}\n\nThanks again,\n{business}'
  };

  function fillAskTemplate(template, vars) {
    vars = vars || {};
    return String(template).replace(/\{(business|link)\}/g, function (m, key) {
      var v = vars[key];
      return v === undefined || v === null ? m : String(v);
    });
  }

  // askMessageTemplates(business, link) -> { sms, email } filled and copy-ready.
  function askMessageTemplates(business, link) {
    var vars = {
      business: clean(business) || 'our business',
      link: clean(link) || '{link}'
    };
    return {
      sms: fillAskTemplate(ASK_TEMPLATES.sms, vars),
      email: fillAskTemplate(ASK_TEMPLATES.email, vars)
    };
  }

  // ---- Saved reply snippets ---------------------------------------------------
  // Snippets: [{ name, text, at }]. Names are case-insensitively unique.
  function addSnippet(snippets, name, text) {
    name = clean(name);
    text = clean(text);
    if (!name) return { ok: false, error: 'Snippet name is required.' };
    if (!text) return { ok: false, error: 'Snippet text is required.' };
    var list = (snippets || []).slice();
    var dup = list.some(function (s) { return clean(s.name).toLowerCase() === name.toLowerCase(); });
    if (dup) return { ok: false, error: 'A snippet named "' + name + '" already exists.' };
    list.push({ name: name, text: text.slice(0, 2000), at: new Date().toISOString() });
    return { ok: true, snippets: list };
  }

  function removeSnippet(snippets, name) {
    name = String(name || '').toLowerCase();
    return (snippets || []).filter(function (s) { return clean(s.name).toLowerCase() !== name; });
  }
  function draftLogEntry(payload, tones) {
    payload = payload || {};
    tones = tones || {};
    return {
      at: new Date().toISOString(),
      stars: clampStars(payload.stars),
      name: clean(payload.name),
      business: clean(payload.business),
      review: clean(payload.review).slice(0, 200),
      professional: clean(tones.professional).slice(0, 2000),
      friendly: clean(tones.friendly).slice(0, 2000),
      witty: clean(tones.witty).slice(0, 2000)
    };
  }

  return {
    NAG_WINDOW_DAYS: NAG_WINDOW_DAYS,
    clampStars: clampStars,
    clean: clean,
    draftReplies: draftReplies,
    parseCSV: parseCSV,
    daysSinceAsk: daysSinceAsk,
    isNag: isNag,
    nagMessage: nagMessage,
    normalizeWindow: normalizeWindow,
    recordAsk: recordAsk,
    computeStats: computeStats,
    buildAskUrl: buildAskUrl,
    isValidUrl: isValidUrl,
    customersToCSV: customersToCSV,
    suggestNextAsk: suggestNextAsk,
    goalProgress: goalProgress,
    ratingTrendByMonth: ratingTrendByMonth,
    responseRate: responseRate,
    reviewTopics: reviewTopics,
    TOPIC_KEYWORDS: TOPIC_KEYWORDS,
    RECOVERY_STATUSES: RECOVERY_STATUSES,
    recoveryStatus: recoveryStatus,
    setRecoveryStatus: setRecoveryStatus,
    recoveryQueue: recoveryQueue,
    validateBackup: validateBackup,
    ASK_TEMPLATES: ASK_TEMPLATES,
    fillAskTemplate: fillAskTemplate,
    askMessageTemplates: askMessageTemplates,
    addSnippet: addSnippet,
    removeSnippet: removeSnippet,
    draftLogEntry: draftLogEntry
  };
});
