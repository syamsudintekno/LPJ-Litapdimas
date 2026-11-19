export async function loadConfig(signal) {
  const response = await fetch('./config.json', {cache: 'no-store', signal});
  if (!response.ok) throw new Error('Konfigurasi aplikasi belum tersedia.');
  const {apps_script_url, google_client_id} = await response.json();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(apps_script_url) ||
      !/^[\w-]+\.apps\.googleusercontent\.com$/.test(google_client_id)) {
    throw new Error('Konfigurasi login atau layanan tidak valid.');
  }
  return {endpoint: apps_script_url, clientId: google_client_id};
}

export async function callProjectRpc(endpoint, token, action, projectId, signal, payload, requestId = crypto.randomUUID()) {
  const request = {api_version: 1, action, request_id: requestId, project_id: projectId, payload};
  const http = await fetch(endpoint, {
    method: 'POST',
    credentials: 'omit',
    body: JSON.stringify({id_token: token, request}),
    signal: AbortSignal.any([signal, AbortSignal.timeout(['reports.finalize', 'backups.create', 'backups.restore', 'attachments.upload'].includes(action) ? 300000 : 60000)]),
  });
  if (!http.ok) throw new Error('Layanan proyek tidak dapat dihubungi.');
  const response = await http.json();
  if (response.request_id !== request.request_id) throw new Error('Respons layanan tidak sesuai.');
  if (!response.ok) {
    const error = new Error(response.error?.message || 'Permintaan proyek gagal.');
    error.code = response.error?.code;
    throw error;
  }
  return response.data;
}

let signInScript;

export function loadGoogleSignIn() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  signInScript ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
      if (window.google?.accounts?.id) resolve(window.google.accounts.id);
      else reject(new Error('Google Sign-In gagal dimuat.'));
    };
    script.onerror = () => reject(new Error('Google Sign-In gagal dimuat.'));
    document.head.append(script);
  });
  return signInScript;
}
