const ACTIVITY_FIELDS_ = ['activity_id', 'project_id', 'activity_kind', 'title', 'activity_date', 'location', 'status', 'row_version'];
const AGENDA_FIELDS_ = ['agenda_item_id', 'activity_id', 'start_time', 'end_time', 'title', 'speaker_person_id', 'row_version'];

function activityInput_(payload) {
  const activity = payload?.activity;
  const agenda = payload?.agenda;
  if (!activity || !budgetText_(activity.activity_kind, 80) || !budgetText_(activity.title, 240) ||
      !validProjectDate_(activity.activity_date) || !budgetText_(activity.location, 240) ||
      !Array.isArray(agenda) || agenda.length > 100) return null;
  const time = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  for (let index = 0; index < agenda.length; index++) {
    const item = agenda[index];
    if (!item || !time(item.start_time) || !time(item.end_time) || item.start_time >= item.end_time ||
        !budgetText_(item.title, 240) ||
        (item.speaker_person_id !== undefined && item.speaker_person_id !== '' &&
          (typeof item.speaker_person_id !== 'string' || !PROJECT_UUID_.test(item.speaker_person_id))) ||
        (index > 0 && item.start_time < agenda[index - 1].end_time)) return null;
  }
  return {
    activity: {activity_kind: activity.activity_kind.trim(), title: activity.title.trim(),
      activity_date: activity.activity_date, location: activity.location.trim()},
    agenda: agenda.map(item => ({start_time: item.start_time, end_time: item.end_time,
      title: item.title.trim(), speaker_person_id: item.speaker_person_id || ''})),
  };
}

function activityRpc_(spreadsheetId, user, request) {
  const {action, project_id, request_id, payload} = request;
  const fail = (code, message) => failure_(request_id, code, message);
  const ok = data => ({ok: true, request_id, data});
  if (PropertiesService.getScriptProperties().getProperty('ACTIVITIES_ENABLED') !== 'true') {
    return fail('TEMPORARY_FAILURE', 'Pengelolaan kegiatan belum diaktifkan.');
  }
  const save = action === 'activities.save';
  const get = action === 'activities.get';
  const input = save ? activityInput_(payload) : null;
  if ((save && (!PROJECT_UUID_.test(request_id) || !input || payload.activity_id !== undefined ||
      payload.activity?.activity_id !== undefined)) ||
      (get && (typeof payload?.activity_id !== 'string' || !PROJECT_UUID_.test(payload.activity_id)))) {
    return fail('VALIDATION_ERROR', 'Periksa kegiatan dan urutan rundown. Penyuntingan kegiatan belum tersedia.');
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return fail('TEMPORARY_FAILURE', 'Kegiatan sedang diproses. Coba lagi.');
  try {
    const project = rows_(spreadsheetId, 'projects', ['project_id'], ['status'])
      .find(row => row.project_id === project_id);
    if (!project) return fail('NOT_FOUND', 'Proyek tidak ditemukan.');
    if (!save) {
      const activities = rows_(spreadsheetId, 'activities', ACTIVITY_FIELDS_)
        .filter(row => row.project_id === project_id)
        .sort((a, b) => a.activity_date.localeCompare(b.activity_date) || a.activity_id.localeCompare(b.activity_id));
      if (!get) return ok({activities});
      const activity = activities.find(row => row.activity_id === payload.activity_id);
      if (!activity) return fail('NOT_FOUND', 'Kegiatan tidak ditemukan dalam proyek ini.');
      const agenda = rows_(spreadsheetId, 'agenda_items', AGENDA_FIELDS_)
        .filter(row => row.activity_id === activity.activity_id).sort((a, b) => a.start_time.localeCompare(b.start_time));
      return ok({activity, agenda});
    }
    const digest = requestDigest_([action, project_id, payload]);
    const previous = rows_(spreadsheetId, 'mutation_requests', ['request_id', 'user_id', 'action', 'payload_digest', 'result_ref', 'status'])
      .find(row => row.request_id === request_id);
    if (previous) {
      if (previous.user_id !== user.user_id || previous.action !== action || previous.payload_digest !== digest ||
          previous.status !== 'COMPLETED') return fail('CONFLICT', 'ID permintaan sudah digunakan.');
      return ok(JSON.parse(previous.result_ref));
    }
    if (!['DRAFT', 'ACTIVE'].includes(project.status)) {
      return fail('VALIDATION_ERROR', 'Kegiatan memerlukan proyek draf atau aktif.');
    }
    const speakerIds = input.agenda.map(item => item.speaker_person_id).filter(Boolean);
    if (speakerIds.length) {
      const people = rows_(spreadsheetId, 'people', ['person_id'], ['active']);
      if (speakerIds.some(id => people.filter(person => person.person_id === id &&
          (person.active === true || !Object.prototype.hasOwnProperty.call(person, 'active'))).length !== 1)) {
        return fail('VALIDATION_ERROR', 'Pembicara tidak tersedia dalam Master Personel aktif.');
      }
    }
    const time = new Date().toISOString();
    const stamp = {row_version: 1, created_at: time, updated_at: time};
    const activity_id = Utilities.getUuid();
    const result = {activity_id, status: 'DRAFT', row_version: 1};
    const adds = {
      activities: [{...input.activity, ...result, project_id, ...stamp}],
      audit_log: [{audit_id: Utilities.getUuid(), request_id, user_id: user.user_id, project_id, action,
        entity_type: 'activity', entity_id: activity_id, occurred_at: time,
        change_summary: JSON.stringify({status: 'DRAFT', agenda_count: input.agenda.length})}],
      mutation_requests: [{request_id, user_id: user.user_id, action, payload_digest: digest,
        result_ref: JSON.stringify(result), status: 'COMPLETED', ...stamp}],
    };
    if (input.agenda.length) adds.agenda_items = input.agenda.map(item => ({
      agenda_item_id: Utilities.getUuid(), activity_id, ...item, ...stamp,
    }));
    // Reuse the existing atomic Sheets writer, including literal text cell encoding.
    budgetBatch_(spreadsheetId, adds, []);
    return ok(result);
  } finally {
    lock.releaseLock();
  }
}
