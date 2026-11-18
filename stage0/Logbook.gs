const LOGBOOK_FIELDS_ = ['logbook_entry_id', 'project_id', 'activity_id', 'entry_date', 'description', 'result', 'row_version'];

function logbookRpc_(spreadsheetId, user, request, role) {
  const {action, project_id, request_id, payload} = request;
  const fail = (code, message) => failure_(request_id, code, message);
  const ok = data => ({ok: true, request_id, data});
  if (PropertiesService.getScriptProperties().getProperty('LOGBOOK_ENABLED') !== 'true') {
    return fail('TEMPORARY_FAILURE', 'Pengelolaan logbook belum diaktifkan.');
  }
  const save = action === 'logbook.save';
  const entryId = payload?.logbook_entry_id;
  const update = entryId !== undefined;
  if (save && (typeof request_id !== 'string' || !PROJECT_UUID_.test(request_id) ||
      !validProjectDate_(payload?.entry_date) || !budgetText_(payload?.description, 4000) ||
      !budgetText_(payload?.result, 4000) ||
      (payload.activity_id !== undefined && payload.activity_id !== '' &&
        (typeof payload.activity_id !== 'string' || !PROJECT_UUID_.test(payload.activity_id))) ||
      (update && (typeof entryId !== 'string' || !PROJECT_UUID_.test(entryId) ||
        !Number.isSafeInteger(payload.expected_row_version) || payload.expected_row_version < 1)))) {
    return fail('VALIDATION_ERROR', 'Isi tanggal, uraian, hasil, dan versi logbook yang valid.');
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return fail('TEMPORARY_FAILURE', 'Logbook sedang diproses. Coba lagi.');
  try {
    const project = rows_(spreadsheetId, 'projects', ['project_id'], ['status'])
      .find(row => row.project_id === project_id);
    if (!project) return fail('NOT_FOUND', 'Proyek tidak ditemukan.');
    const canWrite = ['OWNER', 'EDITOR'].includes(role) && ['DRAFT', 'ACTIVE'].includes(project.status);
    if (save) {
      const digest = requestDigest_([action, project_id, payload]);
      const previous = rows_(spreadsheetId, 'mutation_requests', ['request_id', 'user_id', 'action', 'payload_digest', 'result_ref', 'status'])
        .find(row => row.request_id === request_id);
      if (previous) {
        if (previous.user_id !== user.user_id || previous.action !== action || previous.payload_digest !== digest ||
            previous.status !== 'COMPLETED') return fail('CONFLICT', 'ID permintaan sudah digunakan.');
        return ok(JSON.parse(previous.result_ref));
      }
      if (!canWrite) return fail('VALIDATION_ERROR', 'Logbook hanya dapat disimpan pada proyek draf atau aktif.');
      const activityId = payload.activity_id || '';
      if (activityId && !rows_(spreadsheetId, 'activities', ['activity_id', 'project_id'])
          .some(row => row.activity_id === activityId && row.project_id === project_id)) {
        return fail('NOT_FOUND', 'Kegiatan tidak ditemukan dalam proyek ini.');
      }
      const entries = rows_(spreadsheetId, 'logbook_entries', LOGBOOK_FIELDS_);
      const before = update ? entries.find(row => row.logbook_entry_id === entryId && row.project_id === project_id) : null;
      if (update && !before) return fail('NOT_FOUND', 'Entri logbook tidak ditemukan dalam proyek ini.');
      if (update && before.row_version !== payload.expected_row_version) {
        return fail('CONFLICT', 'Logbook sudah berubah. Muat ulang sebelum menyunting.');
      }
      const time = new Date().toISOString();
      const stamp = {row_version: 1, created_at: time, updated_at: time};
      const id = update ? entryId : Utilities.getUuid();
      const version = update ? before.row_version + 1 : 1;
      const changes = {activity_id: activityId, entry_date: payload.entry_date, description: payload.description.trim(),
        result: payload.result.trim(), row_version: version, updated_at: time};
      const result = {logbook_entry_id: id, row_version: version};
      const adds = {
        audit_log: [{audit_id: Utilities.getUuid(), request_id, user_id: user.user_id, project_id, action,
          entity_type: 'logbook_entry', entity_id: id, occurred_at: time,
          change_summary: JSON.stringify({before, after: changes})}],
        mutation_requests: [{request_id, user_id: user.user_id, action, payload_digest: digest,
          result_ref: JSON.stringify(result), status: 'COMPLETED', ...stamp}],
      };
      if (!update) adds.logbook_entries = [{logbook_entry_id: id, project_id, ...stamp, ...changes}];
      budgetBatch_(spreadsheetId, adds, update ? [['logbook_entries', id, changes]] : []);
      return ok(result);
    }
    const activities = rows_(spreadsheetId, 'activities', ['activity_id', 'project_id', 'title', 'activity_date'])
      .filter(row => row.project_id === project_id).sort((a, b) => a.activity_date.localeCompare(b.activity_date));
    const titles = new Map(activities.map(row => [row.activity_id, row.title]));
    const entries = rows_(spreadsheetId, 'logbook_entries', LOGBOOK_FIELDS_)
      .filter(row => row.project_id === project_id)
      .sort((a, b) => b.entry_date.localeCompare(a.entry_date) || a.logbook_entry_id.localeCompare(b.logbook_entry_id))
      .map(row => ({...row, activity_title: titles.get(row.activity_id) || ''}));
    return ok({entries, activities: activities.map(({activity_id, title, activity_date}) => ({activity_id, title, activity_date})), can_write: canWrite});
  } finally {
    lock.releaseLock();
  }
}
