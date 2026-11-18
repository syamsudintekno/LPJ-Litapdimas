const PARTICIPANT_FIELDS_ = ['activity_participant_id', 'activity_id', 'person_id', 'attendance_status', 'row_version'];
const DISTRIBUTION_FIELDS_ = ['distribution_id', 'activity_participant_id', 'transaction_id', 'distribution_kind', 'quantity', 'received_at', 'row_version'];
const ATTENDANCE_ = ['UNRECORDED', 'PRESENT', 'ABSENT'];
const DISTRIBUTION_KINDS_ = ['SNACK', 'CONSUMPTION', 'TRANSPORT'];

function participantImportPlan_(rows, people, participants) {
  const counts = new Map();
  rows.forEach(row => counts.set(row.person_id, (counts.get(row.person_id) || 0) + 1));
  const summary = {valid: 0, duplicate: 0, correction: 0};
  const results = rows.map(row => {
    const matches = people.filter(person => person.person_id === row.person_id &&
      (person.active === true || !Object.prototype.hasOwnProperty.call(person, 'active')));
    let status = 'VALID';
    let message = '';
    if (!PROJECT_UUID_.test(row.person_id) || !ATTENDANCE_.includes(row.attendance_status) || matches.length !== 1) {
      status = 'CORRECTION'; message = 'ID harus merujuk satu personel aktif dan status hadir harus valid.';
    } else if (counts.get(row.person_id) > 1) {
      status = 'CORRECTION'; message = 'Personel muncul beberapa kali dalam berkas.';
    } else if (participants.some(person => person.person_id === row.person_id)) {
      status = 'DUPLICATE'; message = 'Sudah terdaftar. Status hadir dan distribusi tetap dipertahankan.';
    }
    summary[status.toLowerCase()]++;
    return {source_row: row.source_row, person_id: row.person_id, display_name: matches.length === 1 ? matches[0].display_name : '',
      attendance_status: row.attendance_status, status, message};
  });
  return {results, summary};
}

function participantsRpc_(spreadsheetId, user, request, role) {
  const {action, project_id, request_id, payload} = request;
  const fail = (code, message) => failure_(request_id, code, message);
  const ok = data => ({ok: true, request_id, data});
  const uuid = value => typeof value === 'string' && PROJECT_UUID_.test(value);
  if (PropertiesService.getScriptProperties().getProperty('PARTICIPANTS_ENABLED') !== 'true') {
    return fail('TEMPORARY_FAILURE', 'Pengelolaan peserta belum diaktifkan.');
  }
  const list = action === 'participants.list';
  const preview = action === 'participants.preview_import';
  const commit = action === 'participants.commit_import';
  const attendance = action === 'participants.save';
  const distribution = action === 'distributions.save';
  if (!uuid(payload?.activity_id) || (!list && !uuid(request_id))) {
    return fail('VALIDATION_ERROR', 'ID kegiatan atau permintaan tidak valid.');
  }
  let importRows;
  if (preview || commit) {
    if (!Array.isArray(payload.rows) || !payload.rows.length || payload.rows.length > 1000 ||
        !payload.rows.every(row => row && Number.isSafeInteger(row.source_row) && row.source_row > 0 &&
          typeof row.person_id === 'string' && row.person_id.length <= 80 &&
          typeof row.attendance_status === 'string' && row.attendance_status.length <= 40) ||
        new Set(payload.rows.map(row => row.source_row)).size !== payload.rows.length || (commit && !uuid(payload.import_token))) {
      return fail('VALIDATION_ERROR', 'Kirim 1–1.000 baris dengan nomor baris unik dan token pratinjau yang valid.');
    }
    importRows = payload.rows.map(row => ({source_row: row.source_row, person_id: row.person_id.trim(),
      attendance_status: row.attendance_status.trim() || 'UNRECORDED'}));
  }
  if ((attendance || distribution) && (!uuid(payload.activity_participant_id) ||
      !Number.isSafeInteger(payload.expected_row_version) || payload.expected_row_version < (distribution ? 0 : 1))) {
    return fail('VALIDATION_ERROR', 'ID peserta atau versi baris tidak valid.');
  }
  if (attendance && !ATTENDANCE_.includes(payload.attendance_status)) return fail('VALIDATION_ERROR', 'Status hadir tidak valid.');
  if (distribution && (!DISTRIBUTION_KINDS_.includes(payload.distribution_kind) ||
      !Number.isSafeInteger(payload.quantity) || payload.quantity < 0 || payload.quantity > 1000000 ||
      typeof payload.received_at !== 'string' ||
      (payload.quantity === 0 ? payload.received_at !== '' :
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(payload.received_at) ||
        !Number.isFinite(Date.parse(payload.received_at)) || new Date(payload.received_at).toISOString() !== payload.received_at) ||
      (payload.transaction_id !== undefined && payload.transaction_id !== ''))) {
    return fail('VALIDATION_ERROR', 'Isi jenis, jumlah unit, dan waktu UTC penerimaan yang valid. Penautan transaksi belum tersedia.');
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return fail('TEMPORARY_FAILURE', 'Peserta sedang diproses. Coba lagi.');
  try {
    const project = rows_(spreadsheetId, 'projects', ['project_id'], ['status']).find(row => row.project_id === project_id);
    if (!project) return fail('NOT_FOUND', 'Proyek tidak ditemukan.');
    const activity = rows_(spreadsheetId, 'activities', ['activity_id', 'project_id'])
      .find(row => row.activity_id === payload.activity_id && row.project_id === project_id);
    if (!activity) return fail('NOT_FOUND', 'Kegiatan tidak ditemukan dalam proyek ini.');
    const canWrite = ['OWNER', 'EDITOR'].includes(role) && ['DRAFT', 'ACTIVE'].includes(project.status);
    const digest = requestDigest_([action, project_id, payload]);
    if (!list && !preview) {
      const previous = rows_(spreadsheetId, 'mutation_requests', ['request_id', 'user_id', 'action', 'payload_digest', 'result_ref', 'status'])
        .find(row => row.request_id === request_id);
      if (previous) {
        if (previous.user_id !== user.user_id || previous.action !== action || previous.payload_digest !== digest ||
            previous.status !== 'COMPLETED') return fail('CONFLICT', 'ID permintaan sudah digunakan.');
        return ok(JSON.parse(previous.result_ref));
      }
    }
    if (!list && !canWrite) return fail('VALIDATION_ERROR', 'Peserta hanya dapat diubah pada proyek draf atau aktif.');
    const participants = rows_(spreadsheetId, 'activity_participants', PARTICIPANT_FIELDS_)
      .filter(row => row.activity_id === payload.activity_id);
    if (new Set(participants.map(row => row.person_id)).size !== participants.length) {
      return fail('CONFLICT', 'Daftar peserta mengandung ID personel ganda. Periksa data sumber.');
    }
    if (list) {
      const people = rows_(spreadsheetId, 'people', ['person_id', 'display_name'], ['active']);
      const distributions = rows_(spreadsheetId, 'distributions', DISTRIBUTION_FIELDS_);
      const assigned = rows_(spreadsheetId, 'project_people', ['project_id', 'person_id']).filter(row => row.project_id === project_id);
      const choices = people.filter(person => assigned.some(row => row.person_id === person.person_id) &&
        (person.active === true || !Object.prototype.hasOwnProperty.call(person, 'active')));
      return ok({can_write: canWrite, project_people: choices.map(({person_id, display_name}) => ({person_id, display_name})),
        participants: participants.map(person => ({...person,
          display_name: people.find(row => row.person_id === person.person_id)?.display_name || 'Personel tidak tersedia',
          distributions: distributions.filter(row => row.activity_participant_id === person.activity_participant_id),
        })).sort((a, b) => a.display_name.localeCompare(b.display_name, 'id-ID') || a.person_id.localeCompare(b.person_id))});
    }
    const cache = CacheService.getScriptCache();
    let plan;
    if (preview || commit) {
      const people = rows_(spreadsheetId, 'people', ['person_id', 'display_name'], ['active']);
      plan = participantImportPlan_(importRows, people, participants);
      const binding = {spreadsheetId, userId: user.user_id, project_id, activity_id: payload.activity_id,
        rowsDigest: requestDigest_(importRows), planDigest: requestDigest_(plan)};
      if (preview) {
        const token = Utilities.getUuid();
        cache.put('participants-import:' + token, JSON.stringify(binding), 600);
        return ok({import_token: token, ...plan});
      }
      if (cache.get('participants-import:' + payload.import_token) !== JSON.stringify(binding)) {
        return fail('CONFLICT', 'Pratinjau kedaluwarsa atau daftar peserta berubah. Buat pratinjau baru.');
      }
      if (!plan.summary.valid) return fail('VALIDATION_ERROR', 'Tidak ada peserta baru yang valid untuk diimpor.');
    }
    const time = new Date().toISOString();
    const stamp = {row_version: 1, created_at: time, updated_at: time};
    const adds = {};
    const updates = [];
    let result;
    let before = null;
    let after;
    if (commit) {
      const valid = new Set(plan.results.filter(row => row.status === 'VALID').map(row => row.source_row));
      adds.activity_participants = importRows.filter(row => valid.has(row.source_row)).map(row => ({
        activity_participant_id: Utilities.getUuid(), activity_id: payload.activity_id, person_id: row.person_id,
        attendance_status: row.attendance_status, ...stamp,
      }));
      result = {imported: plan.summary.valid, duplicate: plan.summary.duplicate, correction: plan.summary.correction};
      after = result;
    } else {
      const person = participants.find(row => row.activity_participant_id === payload.activity_participant_id);
      if (!person) return fail('NOT_FOUND', 'Peserta tidak ditemukan dalam kegiatan ini.');
      if (attendance) {
        before = person;
        if (person.row_version !== payload.expected_row_version) return fail('CONFLICT', 'Status hadir sudah berubah. Muat ulang peserta.');
        after = {attendance_status: payload.attendance_status, row_version: person.row_version + 1, updated_at: time};
        updates.push(['activity_participants', person.activity_participant_id, after]);
        result = {activity_participant_id: person.activity_participant_id, row_version: after.row_version};
      } else {
        const matches = rows_(spreadsheetId, 'distributions', DISTRIBUTION_FIELDS_).filter(row =>
          row.activity_participant_id === person.activity_participant_id && row.distribution_kind === payload.distribution_kind);
        if (matches.length > 1 || (matches[0]?.row_version || 0) !== payload.expected_row_version) {
          return fail('CONFLICT', 'Distribusi sudah berubah. Muat ulang peserta.');
        }
        before = matches[0] || null;
        if (before?.transaction_id) return fail('CONFLICT', 'Distribusi sudah tertaut transaksi dan memerlukan alur koreksi transaksi.');
        const distributionId = before?.distribution_id || Utilities.getUuid();
        after = {quantity: payload.quantity, received_at: payload.received_at,
          row_version: before ? before.row_version + 1 : 1, updated_at: time};
        if (before) updates.push(['distributions', distributionId, after]);
        else adds.distributions = [{distribution_id: distributionId, activity_participant_id: person.activity_participant_id,
          transaction_id: '', distribution_kind: payload.distribution_kind, ...stamp, ...after}];
        result = {distribution_id: distributionId, row_version: after.row_version};
      }
    }
    adds.audit_log = [{audit_id: Utilities.getUuid(), request_id, user_id: user.user_id, project_id, action,
      entity_type: commit ? 'activity_participants' : attendance ? 'activity_participant' : 'distribution',
      entity_id: commit ? payload.activity_id : attendance ? result.activity_participant_id : result.distribution_id,
      occurred_at: time, change_summary: JSON.stringify({before, after})}];
    adds.mutation_requests = [{request_id, user_id: user.user_id, action, payload_digest: digest,
      result_ref: JSON.stringify(result), status: 'COMPLETED', ...stamp}];
    budgetBatch_(spreadsheetId, adds, updates);
    if (commit) cache.remove('participants-import:' + payload.import_token);
    return ok(result);
  } finally {
    lock.releaseLock();
  }
}
