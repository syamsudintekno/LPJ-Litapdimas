const {readFileSync} = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');

function setup(options = {}) {
  const ids = ['20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002'];
  const properties = {SPREADSHEET_ID: 'synthetic-sheet', EXISTING_SETTING: 'keep'};
  const writes = [];
  let locked = false;
  let headers;
  const folders = new Map([
    ['synthetic-root', {name: 'LPJ', access: options.publicRoot ? 'ANYONE' : 'PRIVATE'}],
    ['synthetic-folder-A', {name: 'Bukti ' + ids[0], parent: 'synthetic-root'}],
    ['synthetic-folder-B', {name: 'Bukti ' + ids[1], parent: 'synthetic-root'}],
  ]);
  if (options.duplicateFolder) folders.set('synthetic-duplicate', {name: 'Bukti ' + ids[0], parent: 'synthetic-root'});
  function iterator(items) {
    const remaining = [...items];
    return {hasNext: () => remaining.length > 0, next: () => folder(remaining.shift())};
  }
  function folder(id) {
    const value = folders.get(id);
    if (!value) throw new Error('Folder unavailable');
    return {getId: () => id, isTrashed: () => false, getSharingAccess: () => value.access || 'PRIVATE',
      getFoldersByName: name => iterator([...folders.keys()].filter(key => folders.get(key).parent === id && folders.get(key).name === name))};
  }
  const context = vm.createContext({
    PROJECT_UUID_: /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
    normalizeEmail_: value => String(value || '').trim().toLowerCase(),
    Session: {getActiveUser: () => ({getEmail: () => options.anonymous ? '' : 'owner@example.test'})},
    rows_: (_id, name) => name === 'users' ? [{login_email: 'owner@example.test', active: !options.inactive, system_role: options.member ? 'MEMBER' : 'OWNER'}]
      : name === 'projects' ? ids.map(project_id => ({project_id})) : [],
    PropertiesService: {getScriptProperties: () => ({getProperty: key => properties[key], setProperties: (value, removeOthers) => {
      assert.equal(removeOthers, false); assert.equal(locked, true); writes.push(value); Object.assign(properties, value);
    }})},
    LockService: {getScriptLock: () => ({tryLock: () => options.busy ? false : (locked = true), releaseLock: () => {locked = false;}})},
    Sheets: {Spreadsheets: {get: () => ({properties: {title: options.production ? 'Production LPJ' : 'LPJ Data Uji'},
      sheets: Object.keys(headers).map(title => ({properties: {title}}))}),
    Values: {get: (_id, range) => ({values: [headers[range.split('!')[0]]]})}}},
    DriveApp: {Access: {PRIVATE: 'PRIVATE'}, getFolderById: folder,
      getFileById: () => ({getParents: () => iterator(['synthetic-root'])})},
    console: {log() {}},
  });
  vm.runInContext(['Attachments.gs', 'DeploymentSetup.gs'].map(file => readFileSync(path.join(__dirname, file), 'utf8')).join('\n'), context);
  headers = JSON.parse(vm.runInContext('JSON.stringify(DEPLOYMENT_HEADERS_)', context));
  if (options.missingHeader) headers.tax_assessments = ['tax_assessment_id'];
  return {properties, writes, ids, folders, run: () => JSON.parse(JSON.stringify(context.setupSyntheticFeatures()))};
}

test('aktivasi deployment memeriksa skema dan folder sebelum mengaktifkan fitur, mempertahankan properti lain dan aman diulang', () => {
  const env = setup();
  const first = env.run();
  assert.equal(first.ok, true);
  assert.equal(first.enabled_features.length, 10);
  assert.equal(first.project_count, 2);
  assert.equal(env.properties.EXISTING_SETTING, 'keep');
  assert.deepEqual(JSON.parse(env.properties.EVIDENCE_FOLDERS_JSON), {[env.ids[0]]: 'synthetic-folder-A', [env.ids[1]]: 'synthetic-folder-B'});
  assert.equal(env.properties.TAXES_ENABLED, 'true');
  assert.equal(env.properties.ATTACHMENTS_ENABLED, 'true');
  assert.deepEqual(env.run(), first);
});

test('aktivasi menolak identitas kosong/anggota/nonaktif, produksi, skema kurang, folder ambigu/publik dan lock sibuk tanpa menulis flag', () => {
  for (const options of [{anonymous: true}, {member: true}, {inactive: true}, {production: true}, {missingHeader: true},
    {duplicateFolder: true}, {publicRoot: true}, {busy: true}]) {
    const env = setup(options);
    const before = {...env.properties};
    assert.throws(env.run, undefined, JSON.stringify(options));
    assert.deepEqual(env.properties, before);
    assert.equal(env.writes.length, 0);
  }
});

test('aktivasi mempertahankan pemetaan folder yang sudah valid dan menolak pemetaan lintas proyek yang sama', () => {
  const env = setup();
  env.folders.set('custom-private-folder-A', {name: 'Custom A'});
  const mapping = {[env.ids[0]]: 'custom-private-folder-A', [env.ids[1]]: 'synthetic-folder-B'};
  env.properties.EVIDENCE_FOLDERS_JSON = JSON.stringify(mapping);
  env.run();
  assert.deepEqual(JSON.parse(env.properties.EVIDENCE_FOLDERS_JSON), mapping);
  const bad = setup();
  bad.properties.EVIDENCE_FOLDERS_JSON = JSON.stringify({[bad.ids[0]]: 'synthetic-folder-A', [bad.ids[1]]: 'synthetic-folder-A'});
  assert.throws(bad.run);
  assert.equal(bad.writes.length, 0);
});
