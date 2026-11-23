// Run: node test.js  — checks slot math with a fake calendar and fake travel times.
process.env.TZ = 'America/Los_Angeles';
const assert = require('assert');
const vm = require('vm');
const ctx = vm.createContext({ Date, Math, Number, String, Array, Object, JSON, isFinite, Infinity, console });
vm.runInContext(require('fs').readFileSync(__dirname + '/src/Code.js', 'utf8'), ctx);
const computeSlotsVm = vm.runInContext("computeSlots_", ctx);
const computeSlots = o => Array.from(computeSlotsVm(o)); // copy out of the vm realm for deepStrictEqual
const resolveLocations = vm.runInContext('resolveLocations_', ctx);

const at = (h, m = 0) => new Date(2030, 0, 15, h, m).getTime(); // far future so Date.now() clamp is a no-op
const label = ms => new Date(ms).toTimeString().slice(0, 5);
const TRAVEL = { 'Office|Mission Bay': 10, 'Mission Bay|Office': 10, 'Office|San Jose': 90, 'San Jose|Office': 90, 'Office|Island': Infinity };
const travel = (a, b) => (a === b ? 0 : TRAVEL[a + '|' + b] ?? 30);
const day = { dayStart: at(9), dayEnd: at(21), earliest: 0, latest: Infinity, travel };
const work = { start: at(9), end: at(17), loc: 'Office' };
const slots = (sessionLoc, events, durMin = 90) => computeSlots({ ...day, durMin, events, sessionLoc }).map(label);

// The example from the brief: office 9–5, then Mission Bay at 5:30 works, San Jose at 5:30 does not.
assert.deepStrictEqual(slots('Mission Bay', [work]).slice(0, 2), ['17:30', '18:00']);
assert.deepStrictEqual(slots('San Jose', [work]), ['19:00', '19:30']); // 17:00 + 90 + 15 = 18:45 → 19:00; must end by 21:00

// Must also reach the next event: 20:00 at Office, 10 min + 15 buffer → session ends by 19:35.
assert.deepStrictEqual(slots('Mission Bay', [work, { start: at(20), end: at(21), loc: 'Office' }]), ['17:30', '18:00']);

// Household of 2 = 150 min.
assert.deepStrictEqual(slots('Mission Bay', [work], 150).at(-1), '18:30');

// Same place as the previous event (e.g. roommate booked back to back): no travel, no buffer.
assert.deepStrictEqual(slots('Office', [work])[0], '17:00');

// Unreachable → nothing after the event.
assert.deepStrictEqual(slots('Island', [work]), []);

// Notice window and horizon.
assert.deepStrictEqual(computeSlots({ ...day, earliest: at(20), durMin: 60, events: [], sessionLoc: 'X' }).map(label), ['20:00']);
assert.deepStrictEqual(computeSlots({ ...day, latest: at(9), durMin: 90, events: [], sessionLoc: 'X' }).map(label), ['09:00']);

// Location resolution: empty → home, non-place → previous, real place → itself.
const evs = resolveLocations(
  [{ location: 'Oracle Park' }, { location: 'https://zoom.us/j/1' }, { location: '' }, { location: 'TBD' }],
  'HOME', t => (/zoom|tbd/i.test(t) ? null : t.toUpperCase()));
assert.deepStrictEqual(Array.from(evs, e => e.loc), ['ORACLE PARK', 'ORACLE PARK', 'HOME', 'HOME']);

console.log('ok');
