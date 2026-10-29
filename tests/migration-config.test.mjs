import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

// what_bug_this_catches: deployment-specific anon tokens must not be reintroduced
// into migrations when scheduling or configuration changes.
test('migration source has no embedded JWT credentials', () => {
  const directory = new URL('../supabase/migrations/', import.meta.url);
  for (const name of readdirSync(directory).filter((file) => file.endsWith('.sql'))) {
    const sql = readFileSync(new URL(name, directory), 'utf8');
    assert.equal(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/.test(sql), false, name);
  }
});

test('optional migration configuration comes from session settings and omits missing values', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261010184731_create_app_config_and_reschedule_cron.sql', import.meta.url), 'utf8');
  assert.ok(sql.includes("nullif(current_setting('app.settings.supabase_url', true), '')"));
  assert.ok(sql.includes("nullif(current_setting('app.settings.anon_key', true), '')"));
  assert.ok(sql.includes('WHERE value IS NOT NULL'));
  assert.ok(sql.includes('ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value'));
});
