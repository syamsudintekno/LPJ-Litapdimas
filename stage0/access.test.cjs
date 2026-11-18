const assert = require('node:assert/strict');
const {createHash, randomUUID} = require('node:crypto');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const vm = require('node:vm');

const read = name => readFileSync(path.join(__dirname, name), 'utf8');
const source = ['Code.gs', 'Projects.gs', 'PeopleImport.gs', 'Budgets.gs', 'Activities.gs'].map(read).join('\n');
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
  const writes = {batches: 0, fail: false, locked: false};
  const cache = new Map();
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
    CacheService: {getScriptCache: () => ({
      get: key => cache.get(key) ?? null,
      put: (key, value) => cache.set(key, value),
      remove: key => cache.delete(key),
    })},
    LockService: {getScriptLock: () => ({
      tryLock() {
        if (writes.locked) return false;
        writes.locked = true;
        return true;
      },
      releaseLock() { writes.locked = false; },
    })},
    Utilities: {
      getUuid: randomUUID,
      DigestAlgorithm: {SHA_256: 'sha256'}, Charset: {UTF_8: 'utf8'},
      computeDigest: (algorithm, text, encoding) => createHash(algorithm).update(text, encoding).digest(),
      base64EncodeWebSafe: bytes => bytes.toString('base64url'),
    },
    Sheets: {Spreadsheets: {get() {
      return {sheets: Object.keys(sheets).map((title, sheetId) => ({properties: {title, sheetId}}))};
    }, batchUpdate({requests}) {
      if (!writes.locked) throw new Error('Perubahan di luar lock.');
      if (writes.fail) throw new Error('Batch ditolak.');
      const valueOf = ({userEnteredValue: value}) => value?.numberValue ?? value?.stringValue ?? value?.boolValue ?? '';
      const names = Object.keys(sheets);
      for (const {appendCells, updateCells} of requests) {
        if (appendCells) sheets[names[appendCells.sheetId]].push(...appendCells.rows.map(row => row.values.map(valueOf)));
        else {
          const {sheetId, rowIndex, columnIndex} = updateCells.start;
          sheets[names[sheetId]][rowIndex][columnIndex] = valueOf(updateCells.rows[0].values[0]);
        }
      }
      writes.batches++;
    }, Values: {get(id, range, options) {
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
  return {rpc, post, owner, editor, viewer, projectA, projectB, sheets, reads, properties, claims, verifier, writes};
}

test('kegiatan dan rundown terikat proyek, disimpan atomik, serta tidak terduplikasi saat retry', () => {
  const {rpc, owner, editor, viewer, projectA, projectB, sheets, properties, writes} = setup();
  const stamp = ['row_version', 'created_at', 'updated_at'];
  sheets.projects[0].push('status');
  sheets.projects.slice(1).forEach(row => row.push('ACTIVE'));
  sheets.activities = [['activity_id', 'project_id', 'activity_kind', 'title', 'activity_date', 'location', 'status', ...stamp]];
  sheets.agenda_items = [['agenda_item_id', 'activity_id', 'start_time', 'end_time', 'title', 'speaker_person_id', ...stamp]];
  sheets.audit_log = [['audit_id', 'request_id', 'user_id', 'project_id', 'action', 'entity_type', 'entity_id', 'occurred_at', 'change_summary']];
  sheets.mutation_requests = [['request_id', 'user_id', 'action', 'payload_digest', 'result_ref', 'status', ...stamp]];
  const payload = {
    activity: {activity_kind: 'FGD', title: '=FGD sintetis', activity_date: '2026-11-18', location: 'Ruang uji'},
    agenda: [
      {start_time: '09:00', end_time: '10:00', title: 'Pembukaan', speaker_person_id: sheets.people[1][0]},
      {start_time: '10:00', end_time: '11:00', title: 'Diskusi'},
    ],
  };
  const request_id = randomUUID();
  const save = (data = payload, account = editor, project = projectA, id = request_id) =>
    rpc(account, 'activities.save', project, {request_id: id, payload: data});
  const list = (account = editor, project = projectA) => rpc(account, 'activities.list', project);
  assert.equal(list().error.code, 'TEMPORARY_FAILURE');
  properties.ACTIVITIES_ENABLED = 'true';
  assert.equal(save(payload, viewer, projectB).error.code, 'FORBIDDEN');
  assert.equal(save(payload, editor, projectB).error.code, 'FORBIDDEN');
  assert.equal(list(viewer, projectA).error.code, 'FORBIDDEN');
  assert.deepEqual(list().data.activities, []);
  assert.equal(list().data.can_write, true);
  assert.equal(list(viewer, projectB).data.can_write, false);
  assert.equal(rpc(editor, 'projects.get', projectA).data.activities_enabled, true);
  assert.equal(rpc(editor, 'projects.get', projectA).data.personnel[0].person_id, sheets.people[1][0]);
  for (const data of [
    {...payload, activity: {...payload.activity, activity_date: '2026-02-30'}},
    {...payload, activity: {...payload.activity, title: ' '}},
    {...payload, activity_id: randomUUID()},
    {...payload, agenda: [{...payload.agenda[0], start_time: '24:00'}]},
    {...payload, agenda: [{...payload.agenda[0], end_time: '09:00'}]},
    {...payload, agenda: [payload.agenda[0], {...payload.agenda[1], start_time: '09:59'}]},
    {...payload, agenda: [{...payload.agenda[0], speaker_person_id: randomUUID()}]},
  ]) assert.equal(save(data).error.code, 'VALIDATION_ERROR');
  writes.locked = true;
  assert.equal(save().error.code, 'TEMPORARY_FAILURE');
  writes.locked = false;
  writes.fail = true;
  assert.equal(save().error.code, 'TEMPORARY_FAILURE');
  assert.equal(sheets.activities.length, 1);
  assert.equal(sheets.agenda_items.length, 1);
  assert.equal(sheets.audit_log.length, 1);
  assert.equal(sheets.mutation_requests.length, 1);
  assert.equal(writes.locked, false);
  writes.fail = false;
  const created = save().data;
  assert.equal(created.status, 'DRAFT');
  assert.deepEqual(save().data, created);
  assert.equal(writes.batches, 1);
  assert.equal(save({...payload, agenda: []}).error.code, 'CONFLICT');
  assert.equal(save(payload, owner).error.code, 'CONFLICT');
  assert.equal(list().data.activities[0].title, '=FGD sintetis');
  const get = (account, project) => rpc(account, 'activities.get', project, {payload: {activity_id: created.activity_id}});
  const detail = get(editor, projectA).data;
  assert.equal(detail.agenda.length, 2);
  assert.equal(detail.agenda[0].speaker_display_name, sheets.people[1][2]);
  assert.ok(detail.agenda.every(item => item.activity_id === created.activity_id));
  assert.equal(detail.agenda[1].speaker_person_id, '');
  assert.equal(get(viewer, projectB).error.code, 'NOT_FOUND');
  sheets.projects[1][4] = 'ARCHIVED';
  assert.equal(list().data.can_write, false);
  assert.equal(save(payload, editor, projectA, randomUUID()).error.code, 'VALIDATION_ERROR');
  assert.deepEqual(save().data, created);
  assert.equal(get(editor, projectA).ok, true);
  sheets.project_members[1][4] = '2026-11-18T00:00:00Z';
  assert.equal(save().error.code, 'FORBIDDEN');
  assert.equal(get(editor, projectA).error.code, 'FORBIDDEN');
});

test('RAB menghitung rupiah, menjaga riwayat revisi, dan hanya dapat disahkan pemilik', () => {
  const {rpc, owner, editor, viewer, projectA, projectB, sheets, properties, writes} = setup();
  const stamp = ['row_version', 'created_at', 'updated_at'];
  sheets.projects[0].push('official_ceiling_amount', 'status', 'active_budget_version_id', ...stamp);
  for (const row of sheets.projects.slice(1)) row.push(17500000, 'ACTIVE', '', 1);
  sheets.budget_versions = [['budget_version_id', 'project_id', 'version_no', 'status', 'approved_by_user_id', 'approved_at', ...stamp]];
  sheets.budget_categories = [['budget_category_id', 'budget_version_id', 'category_code', 'label', 'sort_order', ...stamp]];
  sheets.budget_items = [['budget_item_id', 'budget_category_id', 'label', 'volume', 'frequency', 'unit', 'unit_price_amount', ...stamp]];
  sheets.audit_log = [['audit_id', 'request_id', 'user_id', 'project_id', 'action', 'entity_type', 'entity_id', 'occurred_at', 'change_summary']];
  sheets.mutation_requests = [['request_id', 'user_id', 'action', 'payload_digest', 'result_ref', 'status', ...stamp]];
  const item = {label: 'FGD sintetis', volume: 1.505, frequency: 1, unit: 'paket', unit_price_amount: 100};
  const categories = [{category_code: 'FGD', label: 'Kegiatan', items: [item]}];
  const saveId = randomUUID();
  const save = (account, project, data = categories, request_id = saveId) =>
    rpc(account, 'budgets.save_version', project, {request_id, payload: {categories: data}});
  const list = (account, project, id) => rpc(account, 'budgets.list_versions', project, {payload: {budget_version_id: id}});
  assert.equal(list(owner, projectA).error.code, 'TEMPORARY_FAILURE');
  properties.BUDGETS_ENABLED = 'true';
  assert.equal(list(editor, projectB).error.code, 'FORBIDDEN');
  assert.equal(save(viewer, projectB).error.code, 'FORBIDDEN');
  assert.equal(save(editor, projectA, [categories[0], categories[0]]).error.code, 'VALIDATION_ERROR');
  assert.equal(save(editor, projectA, [{...categories[0], items: [{...item, unit_price_amount: 12.5}]}]).error.code, 'VALIDATION_ERROR');
  const first = save(editor, projectA).data;
  assert.equal(first.status, 'DRAFT');
  assert.deepEqual(save(editor, projectA).data, first);
  const before = list(editor, projectA).data;
  assert.equal(before.selected_version.detail_total_amount, 151);
  assert.equal(before.selected_version.difference_amount, 17499849);
  assert.equal(list(viewer, projectB, first.budget_version_id).error.code, 'NOT_FOUND');

  const approve = (account, version, expected_project_row_version, request_id = randomUUID()) =>
    rpc(account, 'budgets.approve_version', projectA, {request_id, payload: {
      budget_version_id: version.budget_version_id, expected_row_version: version.row_version, expected_project_row_version,
    }});
  assert.equal(approve(editor, first, 1).error.code, 'FORBIDDEN');
  assert.equal(approve(owner, first, 2).error.code, 'CONFLICT');
  const approved = approve(owner, first, 1).data;
  assert.equal(approved.status, 'APPROVED');
  const second = save(owner, projectA, [{...categories[0], items: [{...item, unit_price_amount: 1000}]}], randomUUID()).data;
  assert.equal(second.version_no, 2);
  assert.equal(list(owner, projectA).data.active_budget_version_id, first.budget_version_id);
  writes.fail = true;
  const approvalId = randomUUID();
  assert.equal(approve(owner, second, 2, approvalId).error.code, 'TEMPORARY_FAILURE');
  assert.equal(list(owner, projectA).data.active_budget_version_id, first.budget_version_id);
  writes.fail = false;
  assert.equal(approve(owner, second, 2, approvalId).data.status, 'APPROVED');
  assert.equal(approve(owner, second, 2, approvalId).data.status, 'APPROVED');
  const current = list(owner, projectA).data;
  const history = list(editor, projectA, first.budget_version_id).data;
  assert.equal(current.selected_version.detail_total_amount, 1505);
  assert.equal(current.active_budget_version_id, second.budget_version_id);
  assert.equal(history.selected_version.status, 'SUPERSEDED');
  assert.equal(history.selected_version.detail_total_amount, 151);
  assert.equal(history.selected_version.categories[0].items[0].budget_item_id, before.selected_version.categories[0].items[0].budget_item_id);
  assert.equal(writes.batches, 4);
  assert.equal(sheets.audit_log.length, 5);
});

test('impor personel memvalidasi pratinjau, menjaga NIP sebagai teks, dan mencegah duplikasi', () => {
  const {rpc, owner, editor, sheets, properties, writes} = setup();
  const rowFields = ['row_version', 'created_at', 'updated_at'];
  sheets.people[0].push('nip', 'nim', 'unit_name', 'civil_service_grade', 'active', ...rowFields);
  sheets.audit_log = [['audit_id', 'request_id', 'user_id', 'project_id', 'action', 'entity_type', 'entity_id', 'occurred_at', 'change_summary']];
  sheets.mutation_requests = [['request_id', 'user_id', 'action', 'payload_digest', 'result_ref', 'status', ...rowFields]];
  const fields = {person_id: '', person_kind: 'DOSEN', display_name: 'Dosen Sintetis', nip: '001234567890123456', nim: '', unit_name: 'Unit Riset', civil_service_grade: 'III/a'};
  const rows = [{source_row: 3, ...fields}, {source_row: 5, ...fields, nip: 'TIDAK-VALID'}];
  const preview = (account = owner, batch = rows) =>
    rpc(account, 'people.preview_import', undefined, {payload: {rows: batch}});
  assert.equal(preview().error.code, 'TEMPORARY_FAILURE');
  properties.PEOPLE_IMPORT_ENABLED = 'true';
  assert.equal(preview(editor).error.code, 'FORBIDDEN');
  assert.equal(rpc(owner, 'projects.list').data.can_import_people, true);
  const repeated = preview(owner, [rows[0], {...rows[0], source_row: 4}]);
  assert.equal(repeated.data.summary.correction, 2);

  const {data} = preview();
  assert.deepEqual(data.summary, {valid: 1, duplicate: 0, correction: 1});
  assert.deepEqual(data.results.map(row => row.source_row), [3, 5]);
  assert.equal(writes.batches, 0);
  const request_id = randomUUID();
  const commit = (batch = rows) => rpc(owner, 'people.commit_import', undefined, {
    request_id, payload: {import_token: data.import_token, rows: batch},
  });
  assert.equal(commit([{...rows[0], display_name: 'Nama berubah'}]).error.code, 'CONFLICT');
  writes.fail = true;
  assert.equal(commit().error.code, 'TEMPORARY_FAILURE');
  writes.fail = false;
  assert.deepEqual(commit().data, {imported: 1, duplicate: 0, correction: 1});
  assert.deepEqual(commit().data, {imported: 1, duplicate: 0, correction: 1});
  assert.equal(writes.batches, 1);
  assert.equal(sheets.people.at(-1)[3], fields.nip);
  assert.equal(sheets.people.at(-1)[7], true);
  assert.equal(preview().data.summary.duplicate, 1);
  assert.equal(preview(owner, [{...rows[0], display_name: 'Nama konflik'}]).data.summary.correction, 1);
});

test('pembuatan draf dan aktivasi memeriksa izin, integritas, versi, dan idempotensi', () => {
  const {rpc, owner, editor, sheets, properties, writes} = setup();
  const rowFields = ['row_version', 'created_at', 'updated_at'];
  sheets.projects[0].push('official_ceiling_amount', 'status', 'active_budget_version_id', ...rowFields);
  sheets.project_people[0].push(...rowFields);
  sheets.report_stages = [['report_stage_id', 'project_id', 'sequence_no', 'label', 'target_bps', 'cutoff_date', 'status', ...rowFields]];
  sheets.audit_log = [['audit_id', 'request_id', 'user_id', 'project_id', 'action', 'entity_type', 'entity_id', 'occurred_at', 'change_summary']];
  sheets.mutation_requests = [['request_id', 'user_id', 'action', 'payload_digest', 'result_ref', 'status', ...rowFields]];
  const person = sheets.people[1][0];
  const payload = {
    project: {title: '=Judul tersimpan sebagai teks', project_code: 'UJI', fiscal_year: 2026, official_ceiling_amount: 17500000},
    personnel: ['Ketua', 'Penanggung Jawab', 'PPK', 'Bendahara Pengeluaran'].map(assignment_role => ({assignment_role, person_id: person})),
    stages: [
      {sequence_no: 1, label: 'Tahap awal', target_bps: 6000, cutoff_date: '2026-08-01'},
      {sequence_no: 2, label: 'Tahap akhir', target_bps: 10000, cutoff_date: '2026-12-01'},
    ],
  };
  const request_id = randomUUID();
  const create = (account = owner, data = payload) => rpc(account, 'projects.save', undefined, {request_id, payload: data});
  assert.equal(create().error.code, 'TEMPORARY_FAILURE');
  properties.PROJECT_WRITES_ENABLED = 'true';
  assert.equal(create(editor).error.code, 'FORBIDDEN');
  assert.equal(create(owner, {...payload, personnel: payload.personnel.slice(1)}).error.code, 'VALIDATION_ERROR');
  writes.fail = true;
  assert.equal(create().error.code, 'TEMPORARY_FAILURE');
  assert.equal(sheets.projects.length, 3);
  assert.equal(sheets.mutation_requests.length, 1);
  writes.fail = false;
  const {project_id} = create().data;
  assert.deepEqual(create().data, {project_id, status: 'DRAFT', row_version: 1});
  assert.equal(create(owner, {...payload, project: {...payload.project, fiscal_year: 2027}}).error.code, 'CONFLICT');
  assert.equal(rpc(owner, 'projects.get', project_id).data.project.title, payload.project.title);
  assert.equal(sheets.report_stages[1][4], 6000);

  const activate = (version, id = randomUUID(), account = owner) =>
    rpc(account, 'projects.activate', project_id, {request_id: id, payload: {expected_row_version: version}});
  assert.equal(activate(1, randomUUID(), editor).error.code, 'FORBIDDEN');
  assert.equal(activate(2).error.code, 'CONFLICT');
  sheets.report_stages[2][5] = '2026-02-30';
  assert.equal(activate(1).error.code, 'VALIDATION_ERROR');
  sheets.report_stages[2][5] = '2026-12-01';
  const activationId = randomUUID();
  assert.deepEqual(activate(1, activationId).data, {project_id, status: 'ACTIVE', row_version: 2});
  assert.equal(activate(1, activationId).data.status, 'ACTIVE');
  assert.equal(activate(1).error.code, 'CONFLICT');
  assert.equal(writes.batches, 2);
  assert.equal(writes.locked, false);
  assert.equal(sheets.audit_log.length, 3);
  assert.equal(sheets.mutation_requests.length, 3);
});

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

test('Master Personel hanya tersedia bagi pemilik dan menyaring entri aktif', () => {
  const {rpc, owner, editor, viewer, sheets, reads} = setup();
  assert.equal(rpc(owner, 'projects.list').data.system_role, 'OWNER');
  assert.equal(rpc(editor, 'projects.list').data.system_role, 'MEMBER');
  reads.length = 0;
  for (const account of [editor, viewer]) {
    assert.equal(rpc(account, 'people.search', undefined, {payload: {query: ''}}).error.code, 'FORBIDDEN');
  }
  assert.equal(reads.includes('people'), false);
  assert.equal(rpc(owner, 'people.search', undefined, {payload: {query: 'x'.repeat(121)}}).error.code, 'VALIDATION_ERROR');

  const search = query => rpc(owner, 'people.search', undefined, {payload: {query}}).data;
  assert.equal(search('  PPK SINTETIS ').total, 2);
  sheets.people[0].push('unit_name', 'active', 'nip');
  sheets.people[1].push('Unit Riset', true, '00001');
  sheets.people[2].push('Unit Riset', false, '00002');
  const result = search('unit riset');
  assert.equal(result.total, 1);
  assert.deepEqual(result.people[0], {
    person_id: sheets.people[1][0], person_kind: 'PEGAWAI', display_name: 'PPK Sintetis A', unit_name: 'Unit Riset',
  });

  for (let index = 0; index < 55; index++) {
    sheets.people.push([randomUUID(), 'DOSEN', 'Peneliti ' + index, 'Unit Riset', true]);
  }
  assert.equal(search('Unit Riset').total, 56);
  assert.equal(search('Unit Riset').people.length, 50);
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
  assert.equal(rpc(owner, 'projects.delete', projectA).error.code, 'VALIDATION_ERROR');
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
