const googleButton = document.querySelector('#google-sign-in');
const actions = document.querySelector('#actions');
const form = document.querySelector('#probe');
const projectId = document.querySelector('#project-id');
const projects = document.querySelector('#projects');
const result = document.querySelector('#result');
const detail = document.querySelector('#detail');
const refresh = document.querySelector('#refresh');
const requestedProject = new URLSearchParams(location.search).get('project_id');
let endpoint;
let credential;
let pending;

async function configure() {
  const response = await fetch('./config.json', {cache: 'no-store'});
  if (!response.ok) throw new Error();
  const {apps_script_url, google_client_id} = await response.json();
  const url = new URL(apps_script_url);
  if (url.origin !== 'https://script.google.com' || url.username || url.password ||
      !/^\/macros\/s\/[\w-]+\/exec$/.test(url.pathname) || url.search || url.hash) {
    result.textContent = 'Masukkan URL /exec dari script.google.com.';
    return;
  }
  if (!window.google?.accounts?.id) {
    result.textContent = 'Google Sign-In gagal dimuat. Muat ulang halaman.';
    return;
  }
  endpoint = url.href;
  google.accounts.id.initialize({
    client_id: google_client_id,
    callback: ({credential: token}) => {
      credential = token;
      googleButton.hidden = true;
      actions.hidden = false;
      if (requestedProject) {
        projectId.value = requestedProject;
        run('projects.get', requestedProject);
      } else {
        run('projects.list');
      }
    },
  });
  google.accounts.id.renderButton(googleButton, {type: 'standard'});
  result.textContent = 'Pilih akun Google uji.';
}

function signOut(message = 'Sesi uji ditutup.') {
  pending?.abort();
  pending = undefined;
  credential = undefined;
  google.accounts.id.disableAutoSelect();
  actions.hidden = true;
  googleButton.hidden = false;
  projects.replaceChildren();
  detail.textContent = '';
  result.textContent = message;
}

async function run(action, id) {
  if (!credential || pending) return;
  const controller = new AbortController();
  pending = controller;
  const timeout = setTimeout(() => controller.abort(), 20000);
  const request = {api_version: 1, action, request_id: crypto.randomUUID(), project_id: id};
  if (action === 'projects.list') projects.replaceChildren();
  detail.textContent = '';
  result.textContent = 'Memeriksa akses…';
  try {
    // A string body uses text/plain and keeps this request eligible for simple CORS.
    const http = await fetch(endpoint, {
      method: 'POST',
      credentials: 'omit',
      body: JSON.stringify({id_token: credential, request}),
      signal: controller.signal,
    });
    if (!http.ok) throw new Error();
    const response = await http.json();
    if (pending !== controller) return;
    if (response.request_id !== request.request_id) throw new Error();
    if (!response.ok) {
      const message = response.error.code + ' · ' + response.error.message;
      if (response.error.code === 'UNAUTHENTICATED') signOut(message);
      else result.textContent = message;
      return;
    }
    if (action === 'projects.list') {
      for (const project of response.data.projects) {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = project.fiscal_year + ' · ' + project.title;
        button.addEventListener('click', () => {
          projectId.value = project.project_id;
          run('projects.get', project.project_id);
        });
        item.append(button);
        projects.append(item);
      }
      result.textContent = projects.childElementCount ? 'Daftar proyek dimuat.' : 'Daftar proyek kosong.';
    } else if (action === 'projects.get') {
      const {project, access_role, personnel} = response.data;
      detail.textContent = [
        project.fiscal_year + ' · ' + project.title,
        'Hak akses: ' + access_role,
        ...personnel.map(person => person.assignment_role + ' · ' + person.display_name),
      ].join('\n');
      result.textContent = 'Proyek dapat dibaca.';
    } else {
      result.textContent = 'Pemeriksaan hak akses berhasil. Data tetap utuh.';
    }
  } catch {
    if (pending === controller) result.textContent = 'Koneksi Apps Script gagal. Periksa deployment dan respons lintas origin.';
  } finally {
    clearTimeout(timeout);
    if (pending === controller) pending = undefined;
  }
}

document.querySelector('#sign-out').addEventListener('click', () => signOut());
refresh.addEventListener('click', () => run('projects.list'));
form.addEventListener('submit', event => {
  event.preventDefault();
  run(event.submitter?.value ?? 'projects.get', projectId.value.trim());
});
configure().catch(() => {
  result.textContent = 'Konfigurasi uji belum tersedia. Periksa deployment GitHub Pages.';
});
