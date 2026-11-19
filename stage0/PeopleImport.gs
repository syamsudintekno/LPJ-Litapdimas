const IMPORT_PERSON_FIELDS_ = ['person_id', 'person_kind', 'display_name', 'nip', 'nim', 'unit_name', 'civil_service_grade'];

function importPeople_(spreadsheetId, user, request) {
  const {request_id, action, payload} = request;
  const fail = (code, message) => failure_(request_id, code, message);
  const ok = data => ({ok: true, request_id, data});
  if (PropertiesService.getScriptProperties().getProperty('PEOPLE_IMPORT_ENABLED') !== 'true') {
    return fail('TEMPORARY_FAILURE', 'Impor personel belum diaktifkan pada deployment ini.');
  }
  if (!PROJECT_UUID_.test(request_id) || !Array.isArray(payload?.rows) || !payload.rows.length ||
      payload.rows.length > 1000 || !payload.rows.every(row =>
        row && Number.isInteger(row.source_row) && row.source_row > 0 &&
        IMPORT_PERSON_FIELDS_.every(field => typeof row[field] === 'string' && row[field].length <= 240)) ||
      new Set(payload.rows.map(row => row.source_row)).size !== payload.rows.length) {
    return fail('VALIDATION_ERROR', 'Kirim 1–1.000 baris dengan nomor baris unik dan kolom teks yang valid.');
  }
  const rows = payload.rows.map(row => ({
    source_row: row.source_row,
    ...Object.fromEntries(IMPORT_PERSON_FIELDS_.map(field => [field, row[field].trim()])),
  }));
  const digest = requestDigest_(rows);
  const preview = action === 'people.preview_import';
  const cache = CacheService.getScriptCache();
  if (preview) {
    const plan = peopleImportPlan_(spreadsheetId, rows);
    const token = Utilities.getUuid();
    cache.put('people-import:' + token, JSON.stringify({
      spreadsheetId, userId: user.user_id, digest, planDigest: requestDigest_(plan),
    }), 600);
    return ok({import_token: token, ...plan});
  }

  const token = payload.import_token;
  if (typeof token !== 'string' || !PROJECT_UUID_.test(token)) return fail('VALIDATION_ERROR', 'Token pratinjau tidak valid.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return fail('TEMPORARY_FAILURE', 'Impor sedang diproses. Coba lagi.');
  try {
    const prior = rows_(spreadsheetId, 'mutation_requests', ['request_id', 'user_id', 'action', 'payload_digest', 'result_ref'])
      .find(row => row.request_id === request_id);
    const commitDigest = requestDigest_([token, digest]);
    if (prior) {
      if (prior.user_id !== user.user_id || prior.action !== action || prior.payload_digest !== commitDigest) {
        return fail('CONFLICT', 'ID permintaan sudah digunakan.');
      }
      return ok(JSON.parse(prior.result_ref));
    }

    const session = JSON.parse(cache.get('people-import:' + token) ?? 'null');
    if (!session || session.spreadsheetId !== spreadsheetId || session.userId !== user.user_id || session.digest !== digest) {
      return fail('CONFLICT', 'Pratinjau kedaluwarsa atau isinya berubah. Buat pratinjau baru.');
    }
    const plan = peopleImportPlan_(spreadsheetId, rows);
    if (requestDigest_(plan) !== session.planDigest) {
      return fail('CONFLICT', 'Master Personel berubah setelah pratinjau. Buat pratinjau baru.');
    }
    if (!plan.summary.valid) return fail('VALIDATION_ERROR', 'Tidak ada baris valid untuk diimpor.');
    const timestamps = {row_version: 1, created_at: new Date().toISOString()};
    timestamps.updated_at = timestamps.created_at;
    const valid = new Set(plan.results.filter(row => row.status === 'VALID').map(row => row.source_row));
    const records = rows.filter(row => valid.has(row.source_row)).map(({source_row, ...record}) => ({
      ...record, person_id: record.person_id || Utilities.getUuid(), active: true, ...timestamps,
    }));
    const result = {imported: records.length, duplicate: plan.summary.duplicate, correction: plan.summary.correction};
    const metadata = Sheets.Spreadsheets.get(spreadsheetId, {fields: 'sheets(properties(sheetId,title))'});
    const tables = Object.fromEntries(metadata.sheets.map(sheet => [sheet.properties.title, sheet.properties.sheetId]));
    const requests = Object.entries({
      people: records,
      audit_log: [{
        audit_id: Utilities.getUuid(), request_id, user_id: user.user_id, project_id: '', action,
        entity_type: 'people', entity_id: '', occurred_at: timestamps.created_at, change_summary: JSON.stringify(result),
      }],
      mutation_requests: [{
        request_id, user_id: user.user_id, action, payload_digest: commitDigest, result_ref: JSON.stringify(result),
        status: 'COMPLETED', ...timestamps,
      }],
    }).map(([name, entries]) => {
      const {values = []} = Sheets.Spreadsheets.Values.get(spreadsheetId, name + '!A1:Z1', {valueRenderOption: 'UNFORMATTED_VALUE'});
      const headers = values[0] ?? [];
      if (tables[name] === undefined || entries.some(record => Object.keys(record).some(field => !headers.includes(field)))) {
        throw new Error('Header impor belum lengkap.');
      }
      return {appendCells: {sheetId: tables[name], fields: 'userEnteredValue',
        rows: entries.map(record => ({values: headers.map(field => projectCell_(record[field]))}))}};
    });
    Sheets.Spreadsheets.batchUpdate({requests}, spreadsheetId);
    cache.remove('people-import:' + token);
    return ok(result);
  } finally {
    lock.releaseLock();
  }
}

function peopleImportKeys_(row) {
  return ['person_id', 'nip', 'nim'].filter(field => row[field])
    .map(field => field + ':' + String(row[field]).trim().toLowerCase());
}

function peopleImportErrors_(row) {
  const errors = [];
  if (!row.display_name) errors.push('Isi nama lengkap pada kolom display_name.');
  if (!['DOSEN', 'PEGAWAI', 'MAHASISWA', 'EKSTERNAL'].includes(row.person_kind)) errors.push('Pilih person_kind: DOSEN, PEGAWAI, MAHASISWA, atau EKSTERNAL.');
  if (!row.person_id && !row.nip && !row.nim) errors.push('Isi sedikitnya satu identitas: person_id, NIP, atau NIM.');
  for (const [field, label] of [['person_id', 'ID personel'], ['nip', 'NIP'], ['nim', 'NIM']]) {
    if (row[field] === '[simpan kolom sebagai teks]') errors.push(label + ' terbaca sebagai angka Excel. Ubah format kolom menjadi Text, lalu isi ulang dari sumber asli dan unggah kembali. Mengubah format saja tidak mengembalikan digit atau nol awal yang hilang.');
    else if (field === 'person_id' && row.person_id && !PROJECT_UUID_.test(row.person_id)) errors.push('person_id harus berupa UUID yang valid. Kosongkan jika NIP atau NIM sudah diisi.');
    else if (field === 'nip' && row.nip && !/^\d{5,30}$/.test(row.nip)) errors.push('NIP harus berisi 5–30 digit tanpa spasi atau notasi ilmiah, disimpan sebagai teks.');
    else if (field === 'nim' && row.nim && !/^[a-z0-9][a-z0-9-]{2,39}$/i.test(row.nim)) errors.push('NIM harus berisi 3–40 karakter huruf, angka, atau tanda hubung, diawali huruf/angka dan disimpan sebagai teks.');
  }
  return errors;
}

function peopleImportPlan_(spreadsheetId, rows) {
  const people = rows_(spreadsheetId, 'people', ['person_id', 'person_kind', 'display_name'], IMPORT_PERSON_FIELDS_.slice(3));
  const existing = new Map();
  for (const person of people) {
    for (const key of peopleImportKeys_(person)) {
      if (!existing.has(key)) existing.set(key, []);
      existing.get(key).push(person);
    }
  }
  const counts = new Map();
  for (const row of rows) {
    for (const key of peopleImportKeys_(row)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const summary = {valid: 0, duplicate: 0, correction: 0};
  const results = rows.map(row => {
    const keys = peopleImportKeys_(row);
    const matches = new Set(keys.flatMap(key => existing.get(key) ?? []));
    let status = 'VALID';
    let message = '';
    const errors = peopleImportErrors_(row);
    if (errors.length) {
      status = 'CORRECTION';
      message = errors.join(' ');
    } else if (keys.some(key => counts.get(key) > 1)) {
      status = 'CORRECTION';
      message = 'ID, NIP, atau NIM muncul beberapa kali dalam berkas.';
    } else if (matches.size) {
      const match = [...matches][0];
      const same = matches.size === 1 && IMPORT_PERSON_FIELDS_.every(field =>
        ((!row[field] && ['person_id', 'nip', 'nim'].includes(field)) ||
          String(match[field] ?? '').trim() === row[field]));
      status = same ? 'DUPLICATE' : 'CORRECTION';
      message = same ? 'Sudah ada di Master Personel.' : 'ID, NIP, atau NIM bertentangan dengan data master.';
    }
    summary[status.toLowerCase()]++;
    return {source_row: row.source_row, status, message};
  });
  return {results, summary};
}
