const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isQuietTime } = require('../src/app/system-checkin-poller');
const env = { CYBERBOSS_QUIET_START_HOUR: '1', CYBERBOSS_QUIET_END_HOUR: '9', CYBERBOSS_QUIET_TIMEZONE: 'Asia/Shanghai' };
test('quiet hours use Shanghai time and include start but exclude end', () => {
  assert.equal(isQuietTime(new Date('2026-10-29T16:59:00Z'), env), false);
  assert.equal(isQuietTime(new Date('2026-10-29T17:00:00Z'), env), true);
  assert.equal(isQuietTime(new Date('2026-10-30T00:59:00Z'), env), true);
  assert.equal(isQuietTime(new Date('2026-10-30T01:00:00Z'), env), false);
});
test('default behavior unchanged and overnight ranges supported', () => {
  assert.equal(isQuietTime(new Date(), {}), false);
  assert.equal(isQuietTime(new Date('2026-10-29T16:00:00Z'), { ...env, CYBERBOSS_QUIET_START_HOUR:'23', CYBERBOSS_QUIET_END_HOUR:'7' }), true);
});
