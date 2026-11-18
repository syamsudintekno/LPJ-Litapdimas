function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Uji akses LPJ Litapdimas')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function dispatch(request) {
  return dispatch_(request, () => {
    const email = normalizeEmail_(Session.getActiveUser().getEmail());
    if (!email) return {error: 'UNAUTHENTICATED'};
    const domain = normalizeEmail_(PropertiesService.getScriptProperties().getProperty('CAMPUS_DOMAIN'));
    if (!domain) return {error: 'TEMPORARY_FAILURE'};
    return email.split('@')[1] === domain ? {email} : {error: 'FORBIDDEN'};
  });
}

function doPost(event) {
  let body;
  try {
    const raw = event?.postData?.contents;
    if (typeof raw !== 'string' || raw.length > 500000) throw new Error();
    body = JSON.parse(raw);
  } catch {
    return json_(failure_(null, 'VALIDATION_ERROR', 'Permintaan uji tidak valid.'));
  }
  return json_(dispatch_(body?.request, () => pagesIdentity_(body?.id_token)));
}

function json_(response) {
  return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
}

function pagesIdentity_(token) {
  if (typeof token !== 'string' || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) {
    return {error: 'UNAUTHENTICATED'};
  }
  const clientId = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
  if (!clientId) return {error: 'TEMPORARY_FAILURE'};

  // Google documents tokeninfo for testing. Replace it before handling real LPJ data.
  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo', {
    method: 'post',
    payload: {id_token: token},
    muteHttpExceptions: true,
    followRedirects: false,
  });
  const status = response.getResponseCode();
  if ([400, 401].includes(status)) return {error: 'UNAUTHENTICATED'};
  if (status !== 200) return {error: 'TEMPORARY_FAILURE'};
  const claims = JSON.parse(response.getContentText());
  const email = normalizeEmail_(claims.email);
  const expiry = Number(claims.exp);
  if (claims.aud !== clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) ||
      (claims.azp && claims.azp !== clientId) || !claims.sub || !Number.isFinite(expiry) ||
      expiry <= Date.now() / 1000 || ![true, 'true'].includes(claims.email_verified) ||
      !/^[^@\s]+@[^@\s]+$/.test(email)) {
    return {error: 'UNAUTHENTICATED'};
  }
  // The fixture uses email as its allowlist key. Google must be authoritative for it.
  if (!email.endsWith('@gmail.com') && !claims.hd) return {error: 'UNAUTHENTICATED'};
  return {email};
}

function failure_(requestId, code, message) {
  return {ok: false, request_id: requestId, error: {code, message, field_errors: {}}};
}

function dispatch_(request, identify) {
  const requestId = request && typeof request.request_id === 'string'
    ? request.request_id : null;
  const failure = (code, message) => failure_(requestId, code, message);

  try {
    const {email, error} = identify();
    if (!email) {
      if (error === 'FORBIDDEN') return failure(error, 'Akun tidak memiliki akses.');
      if (error === 'TEMPORARY_FAILURE') return failure(error, 'Layanan identitas Google belum tersedia.');
      return failure('UNAUTHENTICATED', 'Identitas Google tidak dapat diverifikasi.');
    }

    const spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (!spreadsheetId) {
      return failure('TEMPORARY_FAILURE', 'Konfigurasi uji belum lengkap.');
    }

    const read = (name, fields, optionalFields) => rows_(spreadsheetId, name, fields, optionalFields);
    const users = read('users', ['user_id', 'login_email', 'system_role', 'active']);
    const matches = users.filter(user => normalizeEmail_(user.login_email) === email);
    const user = matches.length === 1 ? matches[0] : null;
    if (!user || !user.user_id || user.active !== true ||
        !['OWNER', 'MEMBER'].includes(user.system_role)) {
      return failure('FORBIDDEN', 'Akun tidak memiliki akses.');
    }

    const actions = ['projects.list', 'projects.get', 'projects.save', 'projects.activate',
      'people.search', 'people.preview_import', 'people.commit_import', 'budgets.list_versions',
      'budgets.save_version', 'budgets.approve_version', 'activities.list', 'activities.get',
      'activities.save', 'logbook.list', 'logbook.save', 'participants.list', 'participants.preview_import',
      'participants.commit_import', 'participants.save', 'distributions.save', 'reports.preview',
      'transactions.list', 'transactions.save', 'stage0.write_probe', 'stage0.tax_probe', 'taxes.preview', 'taxes.verify',
      'taxes.list_rules', 'taxes.save_rule_version'];
    if (!request || request.api_version !== 1 || !actions.includes(request.action) ||
        typeof requestId !== 'string' || !requestId) {
      return failure('VALIDATION_ERROR', 'Permintaan uji tidak valid.');
    }

    const owner = user.system_role === 'OWNER';
    const success = data => ({ok: true, request_id: requestId, data});

    if (['taxes.list_rules', 'taxes.save_rule_version'].includes(request.action)) {
      if (!owner) return failure('FORBIDDEN', 'Hanya pemilik yang dapat mengelola aturan pajak.');
      return taxRulesRpc_(spreadsheetId, user, request);
    }

    if (['projects.save', 'projects.activate'].includes(request.action)) {
      if (!owner) return failure('FORBIDDEN', 'Hanya pemilik yang dapat mengelola proyek.');
      return writeProject_(spreadsheetId, user, request);
    }

    if (['people.preview_import', 'people.commit_import'].includes(request.action)) {
      if (!owner) return failure('FORBIDDEN', 'Hanya pemilik yang dapat mengimpor Master Personel.');
      return importPeople_(spreadsheetId, user, request);
    }

    if (request.action === 'people.search') {
      if (!owner) return failure('FORBIDDEN', 'Akun tidak memiliki hak untuk mengakses Master Personel.');
      const query = request.payload?.query;
      if (typeof query !== 'string' || query.length > 120) {
        return failure('VALIDATION_ERROR', 'Kata kunci pencarian maksimal 120 karakter.');
      }
      const keyword = query.trim().toLowerCase();
      const people = read('people', ['person_id', 'person_kind', 'display_name'], ['unit_name', 'active']);
      const matches = people.filter(person =>
        person.person_id && person.display_name &&
        (person.active === true || !Object.prototype.hasOwnProperty.call(person, 'active')) &&
        [person.display_name, person.unit_name].some(value => String(value ?? '').toLowerCase().includes(keyword))
      ).sort((first, second) => first.display_name.localeCompare(second.display_name, 'id-ID') ||
        first.person_id.localeCompare(second.person_id));
      return success({
        people: matches.slice(0, 50).map(({person_id, person_kind, display_name, unit_name}) =>
          ({person_id, person_kind, display_name, unit_name: unit_name ?? ''})),
        total: matches.length,
      });
    }

    const memberships = owner ? [] : read('project_members', [
      'project_id', 'user_id', 'project_role', 'revoked_at',
    ]).filter(member => member.user_id === user.user_id);
    const roleFor = projectId => {
      if (owner) return 'OWNER';
      const assigned = memberships.filter(member => member.project_id === projectId);
      const member = assigned.length === 1 ? assigned[0] : null;
      return member && member.revoked_at === '' &&
        ['EDITOR', 'VIEWER'].includes(member.project_role) ? member.project_role : null;
    };

    if (request.action.startsWith('taxes.')) {
      if (typeof request.project_id !== 'string' || !PROJECT_UUID_.test(request.project_id)) return failure('VALIDATION_ERROR', 'ID proyek tidak valid.');
      const role = roleFor(request.project_id);
      if (!role || role === 'VIEWER' || (request.action === 'taxes.verify' && role !== 'OWNER')) {
        return failure('FORBIDDEN', 'Verifikasi pajak hanya dapat dilakukan pemilik.');
      }
      return taxRpc_(spreadsheetId, user, request, role);
    }

    if (request.action.startsWith('transactions.')) {
      if (typeof request.project_id !== 'string' || !PROJECT_UUID_.test(request.project_id)) {
        return failure('VALIDATION_ERROR', 'ID proyek tidak valid.');
      }
      const role = roleFor(request.project_id);
      if (!role || (request.action === 'transactions.save' && role === 'VIEWER')) {
        return failure('FORBIDDEN', 'Akun tidak memiliki hak untuk tindakan transaksi ini.');
      }
      return transactionRpc_(spreadsheetId, user, request, role);
    }

    if (request.action === 'reports.preview') {
      if (typeof request.project_id !== 'string' || !PROJECT_UUID_.test(request.project_id)) {
        return failure('VALIDATION_ERROR', 'ID proyek tidak valid.');
      }
      if (!roleFor(request.project_id)) return failure('FORBIDDEN', 'Akun tidak memiliki akses pratinjau proyek ini.');
      return activityReport_(spreadsheetId, request);
    }

    if (request.action.startsWith('participants.') || request.action === 'distributions.save') {
      if (typeof request.project_id !== 'string' || !PROJECT_UUID_.test(request.project_id)) {
        return failure('VALIDATION_ERROR', 'ID proyek tidak valid.');
      }
      const role = roleFor(request.project_id);
      if (!role || (request.action !== 'participants.list' && role === 'VIEWER')) {
        return failure('FORBIDDEN', 'Akun tidak memiliki hak untuk tindakan peserta ini.');
      }
      return participantsRpc_(spreadsheetId, user, request, role);
    }

    if (request.action.startsWith('logbook.')) {
      if (typeof request.project_id !== 'string' || !PROJECT_UUID_.test(request.project_id)) {
        return failure('VALIDATION_ERROR', 'ID proyek tidak valid.');
      }
      const role = roleFor(request.project_id);
      if (!role || (request.action === 'logbook.save' && role === 'VIEWER')) {
        return failure('FORBIDDEN', 'Akun tidak memiliki hak untuk tindakan logbook ini.');
      }
      return logbookRpc_(spreadsheetId, user, request, role);
    }

    if (request.action.startsWith('activities.')) {
      if (typeof request.project_id !== 'string' || !PROJECT_UUID_.test(request.project_id)) {
        return failure('VALIDATION_ERROR', 'ID proyek tidak valid.');
      }
      const role = roleFor(request.project_id);
      if (!role || (request.action === 'activities.save' && role === 'VIEWER')) {
        return failure('FORBIDDEN', 'Akun tidak memiliki hak untuk tindakan kegiatan ini.');
      }
      return activityRpc_(spreadsheetId, user, request, role);
    }

    if (request.action.startsWith('budgets.')) {
      if (typeof request.project_id !== 'string' || !PROJECT_UUID_.test(request.project_id)) {
        return failure('VALIDATION_ERROR', 'ID proyek tidak valid.');
      }
      const role = roleFor(request.project_id);
      if (!role || (request.action === 'budgets.save_version' && role === 'VIEWER') ||
          (request.action === 'budgets.approve_version' && role !== 'OWNER')) {
        return failure('FORBIDDEN', 'Akun tidak memiliki hak untuk tindakan RAB ini.');
      }
      return budgetRpc_(spreadsheetId, user, request);
    }

    if (request.action !== 'projects.list') {
      if (typeof request.project_id !== 'string' || !request.project_id.trim()) {
        return failure('VALIDATION_ERROR', 'ID proyek wajib diisi.');
      }
      const role = roleFor(request.project_id);
      if (!role || (request.action === 'stage0.write_probe' && role === 'VIEWER') ||
          (request.action === 'stage0.tax_probe' && !owner)) {
        return failure('FORBIDDEN', 'Akun tidak memiliki hak untuk tindakan ini.');
      }
    }

    const projects = read('projects', ['project_id', 'fiscal_year', 'title', 'project_code'], ['status', 'row_version']);
    if (request.action === 'projects.list') {
      return success({
        projects: projects.filter(project => roleFor(project.project_id)),
        system_role: user.system_role,
        can_create_project: owner && PropertiesService.getScriptProperties().getProperty('PROJECT_WRITES_ENABLED') === 'true',
        can_import_people: owner && PropertiesService.getScriptProperties().getProperty('PEOPLE_IMPORT_ENABLED') === 'true',
        can_manage_tax_rules: owner && PropertiesService.getScriptProperties().getProperty('TAXES_ENABLED') === 'true',
      });
    }

    const project = projects.find(row => row.project_id === request.project_id);
    if (!project) return failure('NOT_FOUND', 'Proyek tidak ditemukan.');

    if (request.action !== 'projects.get') {
      return success({authorized: true});
    }

    const people = read('people', ['person_id', 'display_name']);
    const assignments = read('project_people', ['project_id', 'person_id', 'assignment_role']);
    const personnel = assignments.filter(row => row.project_id === project.project_id).map(row => ({
      person_id: row.person_id,
      assignment_role: row.assignment_role,
      display_name: people.find(person => person.person_id === row.person_id)?.display_name ?? '',
    }));
    return success({project, access_role: roleFor(project.project_id), personnel,
      budgets_enabled: PropertiesService.getScriptProperties().getProperty('BUDGETS_ENABLED') === 'true',
      activities_enabled: PropertiesService.getScriptProperties().getProperty('ACTIVITIES_ENABLED') === 'true',
      logbook_enabled: PropertiesService.getScriptProperties().getProperty('LOGBOOK_ENABLED') === 'true',
      transactions_enabled: PropertiesService.getScriptProperties().getProperty('TRANSACTIONS_ENABLED') === 'true'});
  } catch (error) {
    return failure('TEMPORARY_FAILURE', 'Data uji tidak dapat dibaca. Periksa konfigurasi.');
  }
}

function normalizeEmail_(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function requestDigest_(value) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, JSON.stringify(value), Utilities.Charset.UTF_8));
}

function rows_(spreadsheetId, name, fields, optionalFields = []) {
  const result = Sheets.Spreadsheets.Values.get(spreadsheetId, name + '!A:Z', {
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const [headers = [], ...values] = result.values ?? [];
  const indexes = fields.map(field => headers.indexOf(field));
  if (indexes.includes(-1)) throw new Error('Kolom fixture tidak lengkap.');
  const columns = fields.map((field, index) => [field, indexes[index]]);
  for (const field of optionalFields) {
    const index = headers.indexOf(field);
    if (index !== -1) columns.push([field, index]);
  }
  return values.filter(row => row[0]).map(row =>
    Object.fromEntries(columns.map(([field, index]) => [field, row[index] ?? '']))
  );
}
