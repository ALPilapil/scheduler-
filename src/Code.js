// EEG session scheduler. See SPEC.md. Personal info (HOME_ADDRESS, MEETING_SPOT) lives in Script Properties, never in this repo.
const CONFIG = {
  DAY_START_H: 9,
  DAY_END_H: 21,
  MIN_NOTICE_H: 12,
  MAX_DAYS: 14,
  STEP_MIN: 30,
  BUFFER_MIN: 15,
  FIRST_PERSON_MIN: 90,
  EXTRA_PERSON_MIN: 60,
  MODES: ['transit', 'bicycling'], // faster of these is used
};
const NON_PLACE = /https?:\/\/|zoom|meet\.google|google meet|teams|webex|\btbd\b|\bvirtual\b|\bonline\b|\bphone\b/i;
const HOUR = 3600000, MIN = 60000;

function doGet() {
  const t = HtmlService.createTemplateFromFile('Index');
  t.meetingSpot = spot_();
  t.firstMin = CONFIG.FIRST_PERSON_MIN;
  t.extraMin = CONFIG.EXTRA_PERSON_MIN;
  return t.evaluate()
    .setTitle('Book an EEG session')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(file) {
  return HtmlService.createHtmlOutputFromFile(file).getContent();
}

// Run once from the editor to grant permissions and sanity-check config.
function authorize() {
  Logger.log(home_());
  Logger.log(geocode_(spot_()));
  Logger.log(JSON.stringify(getDays(1)));
}

// ---------- public (called from the page) ----------

function getDays(people) {
  const durMin = durationMin_(people);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const events = fetchEvents_(today, addDays_(today, CONFIG.MAX_DAYS + 1));
  const days = [];
  for (let i = 0; i <= CONFIG.MAX_DAYS; i++) {
    const d = addDays_(today, i);
    const b = bounds_(d);
    // Calendar-only check (no Maps calls): is there any gap long enough?
    const open = computeSlots_(Object.assign(b, { durMin, events, sessionLoc: '', travel: () => 0 })).length > 0;
    days.push({ day: fmt_(d, 'yyyy-MM-dd'), label: fmt_(d, 'EEE MMM d'), open });
  }
  return days;
}

function getSlots(day, mode, address, people) {
  const ctx = context_(day, mode, address, people);
  return {
    address: ctx.sessionLoc,
    slots: computeSlots_(ctx).map(ms => ({ ms, label: fmt_(new Date(ms), 'h:mm a') })),
  };
}

function book(f) {
  f = f || {};
  const name = clean_(f.name, 100);
  const email = clean_(f.email, 200);
  if (!name) throw new Error('Name is required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A valid email is required.');
  const phone = clean_(f.phone, 40);
  const notes = clean_(f.notes, 2000);
  const elig = (Array.isArray(f.eligibility) ? f.eligibility : []).slice(0, 20).map(s => clean_(s, 300));
  const mustConfirm = [...include('content').matchAll(/<li required>([\s\S]*?)<\/li>/g)].map(m => m[1].trim());
  if (mustConfirm.some(r => !elig.includes(r))) throw new Error('Please check the required boxes.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // Recompute under the lock so two people can't take the same slot.
    const ctx = context_(f.day, f.mode, f.address, f.people);
    const start = Number(f.start);
    if (computeSlots_(ctx).indexOf(start) < 0) {
      throw new Error('That time is no longer available. Please pick another.');
    }
    const end = start + ctx.durMin * MIN;
    const location = f.mode === 'me' ? spot_() : ctx.sessionLoc;
    const people = durationPeople_(f.people);
    const description = [
      'EEG data collection session',
      'People: ' + people + ' (' + ctx.durMin + ' min)',
      f.mode === 'me' ? 'Meet at: ' + spot_() + ' (session is in my apartment nearby)' : 'At participant\'s address',
      'Name: ' + name,
      'Email: ' + email,
      phone && 'Phone: ' + phone,
      notes && 'Notes: ' + notes,
      elig.length ? 'Confirmed:\n- ' + elig.join('\n- ') : '',
      '',
      'Need to cancel or reschedule? Just reply to this invite.',
    ].filter(Boolean).join('\n');

    Calendar.Events.insert({
      summary: 'EEG session: ' + name + (people > 1 ? ' +' + (people - 1) : ''),
      location,
      description,
      start: { dateTime: new Date(start).toISOString() },
      end: { dateTime: new Date(end).toISOString() },
      attendees: [{ email, displayName: name }],
    }, 'primary', { sendUpdates: 'all' });

    return { when: fmt_(new Date(start), 'EEEE, MMMM d, h:mm a') + ' – ' + fmt_(new Date(end), 'h:mm a'), location };
  } finally {
    lock.releaseLock();
  }
}

// ---------- core logic (pure; tested by test.js) ----------

// o: { dayStart, dayEnd, earliest, latest, durMin, events:[{start,end,loc}], sessionLoc, travel(from,to,timeMs,isArrive)->minutes }
function computeSlots_(o) {
  const dur = o.durMin * MIN, step = CONFIG.STEP_MIN * MIN, buf = CONFIG.BUFFER_MIN * MIN;
  const memo = {};
  const leg = (ev, isArrive) => {
    const k = (isArrive ? 'n' : 'p') + o.events.indexOf(ev);
    if (!(k in memo)) {
      memo[k] = isArrive
        ? o.travel(o.sessionLoc, ev.loc, ev.start, true)
        : o.travel(ev.loc, o.sessionLoc, Math.max(ev.end, Date.now()), false);
    }
    return memo[k];
  };
  const gap = m => (m === 0 ? 0 : m * MIN + buf); // no travel, no buffer
  const out = [];
  for (let s = o.dayStart; s + dur <= o.dayEnd; s += step) {
    if (s < o.earliest || s > o.latest) continue;
    const e = s + dur;
    if (o.events.some(ev => ev.start < e && ev.end > s)) continue;
    let prev = null, next = null;
    o.events.forEach(ev => {
      if (ev.end <= s && (!prev || ev.end > prev.end)) prev = ev;
      if (ev.start >= e && (!next || ev.start < next.start)) next = ev;
    });
    if (prev && prev.end + gap(leg(prev, false)) > s) continue;
    if (next && e + gap(leg(next, true)) > next.start) continue;
    out.push(s);
  }
  return out;
}

// Assign each event a location: empty -> home; not a real place (Zoom, TBD...) -> previous location.
function resolveLocations_(events, home, placeOf) {
  let loc = home;
  events.forEach(ev => {
    const text = (ev.location || '').trim();
    ev.loc = !text ? home : placeOf(text) || loc;
    loc = ev.loc;
  });
  return events;
}

// ---------- Google services ----------

function context_(day, mode, address, people) {
  if (mode !== 'me' && mode !== 'them') throw new Error('Pick where to meet.');
  const sessionLoc = geocode_(mode === 'me' ? spot_() : clean_(address, 300));
  if (!sessionLoc) throw new Error('Couldn\'t find that address. Try adding the city and ZIP.');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day));
  if (!m) throw new Error('Pick a day.');
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  const events = resolveLocations_(fetchEvents_(d, addDays_(d, 1)), geocode_(home_()) || home_(), placeOf_);
  return Object.assign(bounds_(d), { durMin: durationMin_(people), events, sessionLoc, travel: travelMin_ });
}

function fetchEvents_(from, to) {
  const res = Calendar.Events.list('primary', {
    timeMin: from.toISOString(), timeMax: to.toISOString(),
    singleEvents: true, orderBy: 'startTime', maxResults: 2500,
  });
  return (res.items || [])
    .filter(e => e.start && e.start.dateTime) // skip all-day
    .filter(e => e.status !== 'cancelled' && e.transparency !== 'transparent')
    .filter(e => !(e.attendees || []).some(a => a.self && a.responseStatus === 'declined'))
    .map(e => ({ start: Date.parse(e.start.dateTime), end: Date.parse(e.end.dateTime), location: e.location || '' }));
}

function placeOf_(text) {
  return NON_PLACE.test(text) ? null : geocode_(text);
}

// ponytail: a vague location like "Office" may geocode to a random place; put real addresses in events.
function geocode_(text) {
  if (!text) return null;
  return cached_('geo|' + text, () => {
    const r = Maps.newGeocoder().setRegion('us').geocode(text);
    return r.status === 'OK' && r.results.length ? r.results[0].formatted_address : null;
  });
}

// Minutes by the faster of CONFIG.MODES; Infinity if unreachable.
function travelMin_(from, to, timeMs, isArrive) {
  if (from === to) return 0;
  const bucket = Math.round(timeMs / (30 * MIN)); // ponytail: 30-min time buckets for caching
  const v = cached_(['route', from, to, bucket, isArrive].join('|'), () => {
    let best = Infinity;
    CONFIG.MODES.forEach(mode => {
      try {
        const f = Maps.newDirectionFinder().setOrigin(from).setDestination(to).setMode(mode);
        if (isArrive) f.setArrive(new Date(timeMs)); else f.setDepart(new Date(timeMs));
        const r = f.getDirections();
        if (r.routes && r.routes.length) best = Math.min(best, r.routes[0].legs[0].duration.value / 60);
      } catch (err) {
        console.warn('directions failed', mode, err); // quota or no route: treat as unreachable
      }
    });
    return isFinite(best) ? Math.ceil(best) : -1;
  });
  return v < 0 ? Infinity : v;
}

function cached_(key, fn) {
  const cache = CacheService.getScriptCache();
  const k = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, key));
  const hit = cache.get(k);
  if (hit !== null) return JSON.parse(hit);
  const v = fn();
  cache.put(k, JSON.stringify(v), 21600);
  return v;
}

// ---------- small helpers ----------

function home_() { return prop_('HOME_ADDRESS'); }
function spot_() { return prop_('MEETING_SPOT'); }
function prop_(key) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('Scheduler not configured: set the ' + key + ' script property.');
  return v;
}

function bounds_(d) {
  const at = h => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).getTime();
  const now = Date.now();
  return {
    dayStart: at(CONFIG.DAY_START_H),
    dayEnd: at(CONFIG.DAY_END_H),
    earliest: now + CONFIG.MIN_NOTICE_H * HOUR,
    latest: now + CONFIG.MAX_DAYS * 24 * HOUR,
  };
}

function durationPeople_(people) {
  const n = Math.floor(Number(people));
  if (!(n >= 1)) throw new Error('Number of people must be at least 1.');
  return n;
}

function durationMin_(people) {
  return CONFIG.FIRST_PERSON_MIN + CONFIG.EXTRA_PERSON_MIN * (durationPeople_(people) - 1);
}

function addDays_(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function fmt_(d, pattern) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), pattern);
}

function clean_(s, max) {
  return String(s == null ? '' : s).trim().slice(0, max);
}
