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
    if (typeof raw !== 'string' || raw.length > 10000) throw new Error();
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

    const read = (name, fields) => rows_(spreadsheetId, name, fields);
    const users = read('users', ['user_id', 'login_email', 'system_role', 'active']);
    const matches = users.filter(user => normalizeEmail_(user.login_email) === email);
    const user = matches.length === 1 ? matches[0] : null;
    if (!user || !user.user_id || user.active !== true ||
        !['OWNER', 'MEMBER'].includes(user.system_role)) {
      return failure('FORBIDDEN', 'Akun tidak memiliki akses.');
    }

    const actions = ['projects.list', 'projects.get', 'stage0.write_probe', 'taxes.verify'];
    if (!request || request.api_version !== 1 || !actions.includes(request.action) ||
        typeof requestId !== 'string' || !requestId) {
      return failure('VALIDATION_ERROR', 'Permintaan uji tidak valid.');
    }

    const owner = user.system_role === 'OWNER';
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
    const success = data => ({ok: true, request_id: requestId, data});

    if (request.action !== 'projects.list') {
      if (typeof request.project_id !== 'string' || !request.project_id.trim()) {
        return failure('VALIDATION_ERROR', 'ID proyek wajib diisi.');
      }
      const role = roleFor(request.project_id);
      if (!role || (request.action === 'stage0.write_probe' && role === 'VIEWER') ||
          (request.action === 'taxes.verify' && !owner)) {
        return failure('FORBIDDEN', 'Akun tidak memiliki hak untuk tindakan ini.');
      }
    }

    const projects = read('projects', ['project_id', 'fiscal_year', 'title', 'project_code']);
    if (request.action === 'projects.list') {
      return success({projects: projects.filter(project => roleFor(project.project_id))});
    }

    const project = projects.find(row => row.project_id === request.project_id);
    if (!project) return failure('NOT_FOUND', 'Proyek tidak ditemukan.');

    if (request.action !== 'projects.get') {
      return success({authorized: true});
    }

    const people = read('people', ['person_id', 'display_name']);
    const assignments = read('project_people', ['project_id', 'person_id', 'assignment_role']);
    const personnel = assignments.filter(row => row.project_id === project.project_id).map(row => ({
      assignment_role: row.assignment_role,
      display_name: people.find(person => person.person_id === row.person_id)?.display_name ?? '',
    }));
    return success({project, access_role: roleFor(project.project_id), personnel});
  } catch (error) {
    return failure('TEMPORARY_FAILURE', 'Data uji tidak dapat dibaca. Periksa konfigurasi.');
  }
}

function normalizeEmail_(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function rows_(spreadsheetId, name, fields) {
  const result = Sheets.Spreadsheets.Values.get(spreadsheetId, name + '!A:Z', {
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const [headers = [], ...values] = result.values ?? [];
  const indexes = fields.map(field => headers.indexOf(field));
  if (indexes.includes(-1)) throw new Error('Kolom fixture tidak lengkap.');
  return values.filter(row => row[0]).map(row =>
    Object.fromEntries(fields.map((field, index) => [field, row[indexes[index]] ?? '']))
  );
}
