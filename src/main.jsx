import {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowRight, CalendarRange, ChevronLeft, ChevronRight, ClipboardList, FolderOpen, LayoutDashboard, LogOut, Menu, RefreshCw, Search, Users} from 'lucide-react';
import {callProjectRpc, loadConfig, loadGoogleSignIn} from './rpc.js';
import './styles/tokens.css';
import './styles/globals.css';
import styles from './Home.module.css';

const roleLabels = {OWNER: 'Pemilik', EDITOR: 'Editor', VIEWER: 'Baca saja'};

function Brand() {
  return <div className={styles.brand}>
    <span className={styles.brandIcon}><ClipboardList size={20} aria-hidden="true" /></span>
    LPJ Litapdimas
  </div>;
}

function AppShell({children, onSignOut}) {
  const [sidebarOpen, setSidebarOpen] = useState(() => matchMedia('(min-width: 861px)').matches);
  const [section, setSection] = useState(() => location.hash === '#daftar-proyek' ? 'daftar-proyek' : 'ringkasan');

  function navigate(target) {
    setSection(target);
    document.getElementById(target)?.focus({preventScroll: true});
    if (!matchMedia('(min-width: 861px)').matches) setSidebarOpen(false);
  }

  return <div className={styles.shell} data-sidebar-open={sidebarOpen}>
    <aside id="workspace-sidebar" className={styles.sidebar} hidden={!sidebarOpen}>
      <Brand />
      <nav className={styles.navigation} aria-label="Ruang kerja">
        <a href="#ringkasan" aria-current={section === 'ringkasan' ? 'location' : undefined} onClick={() => navigate('ringkasan')}>
          <LayoutDashboard size={18} aria-hidden="true" /> Ringkasan
        </a>
        <a href="#daftar-proyek" aria-current={section === 'daftar-proyek' ? 'location' : undefined} onClick={() => navigate('daftar-proyek')}>
          <FolderOpen size={18} aria-hidden="true" /> Daftar proyek
        </a>
      </nav>
    </aside>
    <div className={styles.shellBody}>
      <header className={styles.appHeader}>
        <div className={styles.appContext}>
          <button className={styles.secondary} type="button" aria-label={sidebarOpen ? 'Tutup navigasi' : 'Buka navigasi'}
            aria-expanded={sidebarOpen} aria-controls="workspace-sidebar" onClick={() => setSidebarOpen(open => !open)}>
            <Menu size={18} aria-hidden="true" />
          </button>
          <span>Ruang kerja</span>
          <ChevronRight size={14} aria-hidden="true" />
          <strong>Proyek</strong>
        </div>
        <button className={styles.secondary} type="button" onClick={onSignOut}>
          <LogOut size={16} aria-hidden="true" /> Keluar
        </button>
      </header>
      {children}
    </div>
  </div>;
}

function useProjectData(endpoint, token, action, projectId, revision, expire) {
  const [state, setState] = useState(null);
  const key = JSON.stringify([action, projectId, revision]);
  useEffect(() => {
    if (!endpoint || !token || (action === 'projects.get' && !projectId)) return;
    const controller = new AbortController();
    callProjectRpc(endpoint, token, action, projectId, controller.signal)
      .then(data => {
        if (!controller.signal.aborted) setState({key, token, data});
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        if (error.code === 'UNAUTHENTICATED') expire();
        else setState({key, token, error: error.message});
      });
    return () => controller.abort();
  }, [endpoint, token, action, projectId, revision, key, expire]);
  return state?.key === key && state.token === token ? state : null;
}

function Workspace({endpoint, token, expire}) {
  const [query, setQuery] = useState('');
  const [year, setYear] = useState('');
  const [selected, setSelected] = useState(() => new URLSearchParams(location.search).get('project_id') || '');
  const [revision, setRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const detailHeading = useRef(null);
  const projectSelect = useRef(null);
  const list = useProjectData(endpoint, token, 'projects.list', undefined, revision, expire);
  const detail = useProjectData(endpoint, token, 'projects.get', selected, detailRevision, expire);
  const projects = list?.data?.projects ?? [];
  const years = [...new Set(projects.map(project => String(project.fiscal_year)))].sort((a, b) => Number(b) - Number(a));
  const activeYear = years.includes(year) ? year : '';
  const search = query.trim().toLocaleLowerCase('id-ID');
  const visible = projects.filter(project =>
    (!activeYear || String(project.fiscal_year) === activeYear) &&
    [project.title, project.project_code].some(value => String(value ?? '').toLocaleLowerCase('id-ID').includes(search))
  ).sort((a, b) => Number(b.fiscal_year) - Number(a.fiscal_year) || a.title.localeCompare(b.title, 'id-ID'));

  useEffect(() => {
    if (selected) detailHeading.current?.focus();
  }, [selected]);

  function openProject(id) {
    setSelected(id);
    setDetailRevision(value => value + 1);
  }

  function updateProjects() {
    setRevision(value => value + 1);
    setDetailRevision(value => value + 1);
  }

  return <main id="ringkasan" tabIndex={-1} className={styles.workspace}>
    <div className={styles.heading}>
      <div>
        <h1>Proyek penelitian</h1>
        <p>Telusuri proyek dan lihat personel LPJ per tahun anggaran.</p>
      </div>
      <button className={styles.secondary} type="button" onClick={updateProjects} disabled={!list}>
        <RefreshCw size={16} aria-hidden="true" /> Muat ulang
      </button>
    </div>

    {list?.data && <dl className={styles.summary} aria-label="Ringkasan proyek">
      <div className={styles.summaryProjects}>
        <dt>Proyek yang dapat diakses</dt>
        <dd>{projects.length}</dd>
        <FolderOpen size={30} aria-hidden="true" />
      </div>
      <div className={styles.summaryYears}>
        <dt>Tahun anggaran terdaftar</dt>
        <dd>{years.length}</dd>
        <CalendarRange size={30} aria-hidden="true" />
      </div>
      <div className={styles.summaryLatest}>
        <dt>Tahun anggaran terbaru</dt>
        <dd>{years[0] ?? '—'}</dd>
        <ClipboardList size={30} aria-hidden="true" />
      </div>
    </dl>}

    <section id="daftar-proyek" tabIndex={-1} className={styles.panel} aria-labelledby="list-heading" aria-busy={!list}>
      <div className={styles.panelHeading}><h2 id="list-heading">Daftar proyek</h2></div>
      <div className={styles.toolbar}>
        <label>
          Cari proyek
          <span className={styles.search}>
            <Search size={17} aria-hidden="true" />
            <input type="search" placeholder="Judul atau kode proyek" value={query} onChange={event => setQuery(event.target.value)} />
          </span>
        </label>
        <label>
          Tahun anggaran
          <select value={activeYear} onChange={event => setYear(event.target.value)}>
            <option value="">Semua tahun</option>
            {years.map(value => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label>
          Pilih proyek
          <select ref={projectSelect} value={projects.some(project => project.project_id === selected) ? selected : ''} onChange={event => openProject(event.target.value)}>
            <option value="">Pilih proyek</option>
            {projects.map(project => <option key={project.project_id} value={project.project_id}>{project.fiscal_year} · {project.title}</option>)}
          </select>
        </label>
      </div>

      {!list && <p className={styles.feedback} role="status">Memuat daftar proyek…</p>}
      {list?.error && <p className={styles.error} role="alert">{list.error}</p>}
      {list?.data && (visible.length ? <>
        <p className={styles.count} role="status">{visible.length} proyek</p>
        <ul className={styles.projects}>
          {visible.map(project => <li key={project.project_id}>
            <button className={styles.project} type="button" aria-label={'Lihat ' + project.title}
              aria-expanded={selected === project.project_id} aria-controls="project-detail"
              onClick={() => openProject(project.project_id)}>
              <span className={styles.folder}><FolderOpen size={22} aria-hidden="true" /></span>
              <span className={styles.projectName}>
                <strong>{project.title}</strong>
                <span>{project.project_code}</span>
              </span>
              <span className={styles.year}><CalendarRange size={16} aria-hidden="true" />{project.fiscal_year}</span>
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </li>)}
        </ul>
      </> : <div className={styles.empty} role="status">
        <FolderOpen size={28} aria-hidden="true" />
        <strong>{projects.length ? 'Proyek tidak ditemukan' : 'Belum ada proyek'}</strong>
        <span>{projects.length ? 'Coba kata kunci atau tahun anggaran lain.' : 'Proyek yang dapat Anda akses akan muncul di sini.'}</span>
        {projects.length > 0 && <button className={styles.secondary} type="button" onClick={() => {setQuery(''); setYear('');}}>Hapus filter</button>}
      </div>)}
    </section>

    <section id="project-detail" className={styles.panel} hidden={!selected} aria-labelledby="detail-heading" aria-busy={Boolean(selected && !detail)}>
      <div className={styles.detailHeader}>
        <h2 id="detail-heading" ref={detailHeading} tabIndex={-1}>{detail?.data?.project.title ?? 'Detail proyek'}</h2>
        <button className={styles.secondary} type="button" onClick={() => {setSelected(''); projectSelect.current.focus();}}>
          <ChevronLeft size={16} aria-hidden="true" /> Tutup detail
        </button>
      </div>
      {selected && !detail && <p className={styles.feedback} role="status">Memuat detail proyek…</p>}
      {detail?.error && <p className={styles.error} role="alert">{detail.error}</p>}
      {detail?.data && <div className={styles.detailBody}>
        <dl className={styles.metadata}>
          <div><dt>Kode proyek</dt><dd>{detail.data.project.project_code || '—'}</dd></div>
          <div><dt>Tahun anggaran</dt><dd>{detail.data.project.fiscal_year}</dd></div>
          <div><dt>Hak akses</dt><dd>{roleLabels[detail.data.access_role] ?? detail.data.access_role}</dd></div>
        </dl>
        <h3><Users size={18} aria-hidden="true" /> Personel LPJ</h3>
        {detail.data.personnel.length ? <ul className={styles.personnel}>
          {detail.data.personnel.map((person, index) => <li key={index}>
            <strong>{person.display_name || '—'}</strong>
            <span>{person.assignment_role}</span>
          </li>)}
        </ul> : <p>Belum ada personel untuk proyek ini.</p>}
      </div>}
    </section>
  </main>;
}

function SignIn({message, error, ready}) {
  const button = useRef(null);
  useEffect(() => {
    if (ready) window.google.accounts.id.renderButton(button.current, {type: 'standard', size: 'large', text: 'signin_with'});
  }, [ready]);

  return <main className={styles.welcome}>
    <div className={styles.welcomeCopy}>
      <Brand />
      <div>
        <h1>Pertanggungjawaban penelitian</h1>
        <p>Ruang kerja bagi pemilik dan anggota peneliti untuk mengakses proyek dan personel LPJ.</p>
      </div>
    </div>
    <section className={styles.signIn} aria-labelledby="sign-in-heading">
      <h2 id="sign-in-heading">Masuk ke ruang kerja</h2>
      <p>Gunakan akun Google yang terdaftar untuk proyek Anda.</p>
      <div ref={button} />
      {error ? <p role="alert" className={styles.signInError}>{error}</p> :
        message && <p role="status">{message}</p>}
    </section>
  </main>;
}

function App() {
  const [token, setToken] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    loadConfig(controller.signal).then(async config => {
      const google = await loadGoogleSignIn();
      if (controller.signal.aborted) return;
      google.initialize({client_id: config.clientId, callback: ({credential}) => {
        if (!credential) return;
        setMessage('');
        setToken(credential);
      }});
      setEndpoint(config.endpoint);
      setReady(true);
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure.message);
    });
    return () => controller.abort();
  }, []);

  const expire = useRef(() => {
    setMessage('Sesi berakhir. Silakan masuk kembali.');
    setToken('');
    window.google?.accounts.id.disableAutoSelect();
  }).current;

  function signOut() {
    setMessage('Anda telah keluar.');
    setToken('');
    window.google?.accounts.id.disableAutoSelect();
  }

  return token ? <AppShell onSignOut={signOut}>
    <Workspace endpoint={endpoint} token={token} expire={expire} />
  </AppShell> : <SignIn ready={ready} error={error} message={message || (!ready ? 'Menyiapkan login…' : '')} />;
}

createRoot(document.getElementById('root')).render(<App />);
