const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const read = name => readFileSync(path.join(__dirname, name), 'utf8');
const source = read('Code.gs');
const tables = ['users', 'project_members', 'projects', 'people', 'project_people'];

function setup() {
  const sheets = Object.fromEntries(tables.map(name => [
    name, read('fixtures/' + name + '.tsv').trimEnd().split(/\r?\n/).map(line =>
      line.split('\t').map(value => {
        if (value === 'TRUE') return true;
        if (/^\d+$/.test(value)) return Number(value);
        return value;
      })
    ),
  ]));
  const [owner, editor, viewer] = sheets.users.slice(1).map(row => row[1]);
  const [projectA, projectB] = sheets.projects.slice(1).map(row => row[0]);
  let email = '';
  const reads = [];
  const properties = {
    CAMPUS_DOMAIN: 'example.test',
    SPREADSHEET_ID: 'synthetic-id',
    GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com',
  };
  const claims = {
    aud: properties.GOOGLE_CLIENT_ID, iss: 'https://accounts.google.com', sub: 'fixture-subject',
    email: editor, email_verified: 'true', hd: 'example.test',
    exp: Math.floor(Date.now() / 1000) + 600,
  };
  const verifier = {status: 200, calls: 0};
  const context = vm.createContext({
    Session: {getActiveUser: () => ({getEmail: () => email})},
    PropertiesService: {getScriptProperties: () => ({getProperty: key => properties[key]})},
    ContentService: {
      MimeType: {JSON: 'application/json'},
      createTextOutput: content => ({setMimeType: mimeType => ({content, mimeType})}),
    },
    UrlFetchApp: {fetch(url, options) {
      assert.equal(url, 'https://oauth2.googleapis.com/tokeninfo');
      assert.equal(options.method, 'post');
      assert.equal(options.payload.id_token, 'test.jwt.signature');
      assert.equal(options.followRedirects, false);
      verifier.calls++;
      return {getResponseCode: () => verifier.status, getContentText: () => JSON.stringify(claims)};
    }},
    Sheets: {Spreadsheets: {Values: {get(id, range, options) {
      assert.equal(id, 'synthetic-id');
      assert.equal(options.valueRenderOption, 'UNFORMATTED_VALUE');
      const [tab] = range.split('!');
      reads.push(tab);
      return {values: sheets[tab]};
    }}}},
  });
  vm.runInContext(source, context);

  function rpc(sessionEmail, action, project_id, extra = {}) {
    email = sessionEmail;
    const request = {api_version: 1, action, project_id, request_id: randomUUID(), ...extra};
    const response = JSON.parse(JSON.stringify(context.dispatch(request)));
    assert.equal(response.request_id, request.request_id);
    return response;
  }
  function post(request, id_token) {
    const raw = JSON.stringify({id_token, request});
    const response = context.doPost({postData: {contents: raw}});
    assert.equal(response.mimeType, 'application/json');
    return JSON.parse(response.content);
  }
  return {rpc, post, owner, editor, viewer, projectA, projectB, sheets, reads, properties, claims, verifier};
}

test('pemilik melihat kedua tahun dan lulus kedua pemeriksaan hak', () => {
  const {rpc, owner, projectA, projectB} = setup();
  const list = rpc(owner, 'projects.list').data.projects;
  assert.deepEqual(list.map(project => project.fiscal_year), [2023, 2025]);
  for (const project of [projectA, projectB]) {
    assert.equal(rpc(owner, 'projects.get', project).data.access_role, 'OWNER');
    assert.equal(rpc(owner, 'stage0.write_probe', project).data.authorized, true);
    assert.equal(rpc(owner, 'taxes.verify', project).data.authorized, true);
  }
});

test('editor hanya dapat membaca dan menguji hak tulis proyek yang ditugaskan', () => {
  const {rpc, editor, projectA, projectB} = setup();
  assert.deepEqual(rpc(editor, 'projects.list').data.projects.map(p => p.project_id), [projectA]);
  assert.equal(rpc(editor, 'projects.get', projectA).data.access_role, 'EDITOR');
  assert.equal(rpc(editor, 'stage0.write_probe', projectA).data.authorized, true);
  for (const action of ['projects.get', 'stage0.write_probe']) {
    assert.equal(rpc(editor, action, projectB).error.code, 'FORBIDDEN');
  }
  assert.equal(rpc(editor, 'taxes.verify', projectA).error.code, 'FORBIDDEN');
});

test('viewer ditolak saat menguji hak tulis atau mengirim ID lintas proyek', () => {
  const {rpc, viewer, projectA, projectB} = setup();
  assert.deepEqual(rpc(viewer, 'projects.list').data.projects.map(p => p.project_id), [projectB]);
  assert.equal(rpc(viewer, 'projects.get', projectB).data.access_role, 'VIEWER');
  assert.equal(rpc(viewer, 'projects.get', projectA).error.code, 'FORBIDDEN');
  assert.equal(rpc(viewer, 'stage0.write_probe', projectB).error.code, 'FORBIDDEN');
  assert.equal(rpc(viewer, 'taxes.verify', projectB).error.code, 'FORBIDDEN');
});

test('sesi yang sama kehilangan hak tulis ketika diturunkan dan hak baca setelah dicabut', () => {
  const {rpc, editor, projectA, sheets} = setup();
  assert.equal(rpc(editor, 'stage0.write_probe', projectA).ok, true);
  sheets.project_members[1][3] = 'VIEWER';
  assert.equal(rpc(editor, 'projects.get', projectA).data.access_role, 'VIEWER');
  assert.equal(rpc(editor, 'stage0.write_probe', projectA).error.code, 'FORBIDDEN');
  sheets.project_members[1][4] = '2026-11-17T00:00:00Z';
  assert.deepEqual(rpc(editor, 'projects.list').data.projects, []);
  assert.equal(rpc(editor, 'projects.get', projectA).error.code, 'FORBIDDEN');
  assert.equal(rpc(editor, 'stage0.write_probe', projectA).error.code, 'FORBIDDEN');
});

test('identitas kosong dan domain luar ditolak sebelum Sheet dibaca', () => {
  const {rpc, owner, reads} = setup();
  assert.equal(rpc('', 'projects.list', undefined, {login_email: owner}).error.code, 'UNAUTHENTICATED');
  assert.equal(rpc('user@outside.test', 'projects.list').error.code, 'FORBIDDEN');
  assert.deepEqual(reads, []);
});

test('personel terlihat dalam proyek dan identitas nonanggota tidak diberi akses', () => {
  const {rpc, editor, owner, projectA, sheets} = setup();
  const detail = rpc(editor, 'projects.get', projectA).data;
  assert.deepEqual(detail.personnel.map(person => person.display_name), [
    'PPK Sintetis A', 'Bendahara Sintetis A', 'Mahasiswa Sintetis A',
  ]);
  for (const name of ['ppk', 'bendahara', 'mahasiswa', 'tanpa-undangan']) {
    const result = rpc(name + '@example.test', 'projects.get', projectA, {
      login_email: owner, system_role: 'OWNER', payload: {user_id: sheets.users[1][0]},
    });
    assert.equal(result.error.code, 'FORBIDDEN');
    assert.equal(result.data, undefined);
  }
  sheets.users[2][3] = false;
  assert.equal(rpc(editor, 'projects.get', projectA).error.code, 'FORBIDDEN');
});

test('aksi tak terdaftar, envelope keliru, dan data yang tidak tersedia gagal tertutup', () => {
  const {rpc, owner, editor, projectA, sheets, properties} = setup();
  assert.equal(rpc(owner, 'projects.save', projectA).error.code, 'VALIDATION_ERROR');
  assert.equal(rpc(owner, 'projects.get').error.code, 'VALIDATION_ERROR');
  assert.equal(rpc(owner, 'projects.list', undefined, {api_version: 2}).error.code, 'VALIDATION_ERROR');
  assert.equal(rpc(owner, 'projects.get', 'missing').error.code, 'NOT_FOUND');
  sheets.project_members.push([...sheets.project_members[1]]);
  assert.equal(rpc(editor, 'projects.get', projectA).error.code, 'FORBIDDEN');
  delete sheets.projects;
  assert.equal(rpc(owner, 'projects.list').error.code, 'TEMPORARY_FAILURE');
  delete properties.CAMPUS_DOMAIN;
  assert.equal(rpc(owner, 'projects.list').error.code, 'TEMPORARY_FAILURE');
});

test('POST Pages hanya memakai identitas terverifikasi dan membaca perubahan akses pada RPC berikutnya', () => {
  const {post, owner, projectA, projectB, sheets, claims} = setup();
  const request = {
    api_version: 1, action: 'projects.get', request_id: randomUUID(), project_id: projectB,
    login_email: owner, system_role: 'OWNER',
  };
  const token = 'test.jwt.signature';
  assert.equal(post(request, token).error.code, 'FORBIDDEN');
  request.project_id = projectA;
  assert.equal(post(request, token).data.access_role, 'EDITOR');
  sheets.project_members[1][3] = 'VIEWER';
  request.action = 'stage0.write_probe';
  assert.equal(post(request, token).error.code, 'FORBIDDEN');
  sheets.project_members[1][4] = '2026-11-17T00:00:00Z';
  request.action = 'projects.get';
  assert.equal(post(request, token).error.code, 'FORBIDDEN');
  claims.email = 'uninvited@gmail.com';
  delete claims.hd;
  assert.equal(post(request, token).error.code, 'FORBIDDEN');
  sheets.users[1][1] = 'invited-owner@gmail.com';
  claims.email = sheets.users[1][1];
  assert.equal(post(request, token).data.access_role, 'OWNER');
});

test('POST Pages menolak token hilang, klaim tak sah dan kegagalan verifier sebelum membaca Sheets', () => {
  const {post, reads, claims, verifier} = setup();
  const request = {api_version: 1, action: 'projects.list', request_id: randomUUID()};
  const token = 'test.jwt.signature';
  assert.equal(post(request).error.code, 'UNAUTHENTICATED');
  assert.equal(verifier.calls, 0);
  const invalid = {
    aud: 'wrong-client', iss: 'https://invalid.test', azp: 'wrong-client',
    exp: 1, sub: '', email_verified: 'false', email: '', hd: undefined,
  };
  for (const [key, value] of Object.entries(invalid)) {
    const validValue = claims[key];
    claims[key] = value;
    assert.equal(post(request, token).error.code, 'UNAUTHENTICATED', key);
    claims[key] = validValue;
  }
  verifier.status = 400;
  assert.equal(post(request, token).error.code, 'UNAUTHENTICATED');
  verifier.status = 429;
  assert.equal(post(request, token).error.code, 'TEMPORARY_FAILURE');
  assert.deepEqual(reads, []);
});
