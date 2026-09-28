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
  // asks: { key: ISODateString }
  function daysSinceAsk(asks, key) {
    if (!asks || !key) return Infinity;
    var k = String(key).toLowerCase();
    var iso = asks[k];
    if (!iso) return Infinity;
    var then = new Date(iso).getTime();
    if (isNaN(then)) return Infinity;
    return (Date.now() - then) / MS_PER_DAY;
  }

  function isNag(asks, key) {
    return daysSinceAsk(asks, key) < NAG_WINDOW_DAYS;
  }

  function nagMessage(asks, key) {
    var d = daysSinceAsk(asks, key);
    if (d >= NAG_WINDOW_DAYS) return null;
    var daysLeft = Math.ceil(NAG_WINDOW_DAYS - d);
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

  return {
    NAG_WINDOW_DAYS: NAG_WINDOW_DAYS,
    clampStars: clampStars,
    clean: clean,
    draftReplies: draftReplies,
    parseCSV: parseCSV,
    daysSinceAsk: daysSinceAsk,
    isNag: isNag,
    nagMessage: nagMessage,
    recordAsk: recordAsk,
    computeStats: computeStats,
    buildAskUrl: buildAskUrl,
    isValidUrl: isValidUrl
  };
});
