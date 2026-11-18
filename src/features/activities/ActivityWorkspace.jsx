import {useEffect, useId, useRef, useState} from 'react';
import {CalendarRange, Plus, Trash2} from 'lucide-react';
import {callProjectRpc} from '../../rpc.js';
import {ParticipantsWorkspace} from './ParticipantsWorkspace.jsx';
import {ActivityReportPreview} from './ActivityReportPreview.jsx';
import layout from '../../Home.module.css';
import styles from './ActivityWorkspace.module.css';

const date = value => new Intl.DateTimeFormat('id-ID', {dateStyle: 'long', timeZone: 'Asia/Jakarta'})
  .format(new Date(value + 'T00:00:00Z'));
const status = value => ({DRAFT: 'Draf', ACTIVE: 'Aktif', ARCHIVED: 'Diarsipkan'}[value] || value);
const emptySession = () => ({key: crypto.randomUUID(), start_time: '', end_time: '', title: '', speaker_person_id: ''});

export function ActivityWorkspace({endpoint, token, expire, project, people}) {
  const id = useId();
  const [revision, setRevision] = useState(0);
  const [list, setList] = useState(null);
  const [selection, setSelection] = useState(null);
  const [detail, setDetail] = useState(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [activity, setActivity] = useState({activity_kind: 'FGD', title: '', activity_date: '', location: ''});
  const [agenda, setAgenda] = useState([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const mutation = useRef(null);
  const attempt = useRef(null);
  const [uncertain, setUncertain] = useState(false);
  const createButton = useRef(null);
  const editButton = useRef(null);
  const reportButton = useRef(null);
  const formHeading = useRef(null);
  const detailHeading = useRef(null);
  const form = useRef(null);
  const current = list?.revision === revision ? list : null;
  const currentDetail = detail?.selection === selection ? detail : null;
  const matches = (current?.data?.activities || []).filter(row =>
    [row.title, row.activity_kind, row.location].some(value => value.toLocaleLowerCase('id-ID').includes(query.trim().toLocaleLowerCase('id-ID'))));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(matches.length / 8) - 1));
  const speakers = [...new Map(people.filter(person => person.person_id && person.display_name)
    .map(person => [person.person_id, person])).values()];

  useEffect(() => {
    const controller = new AbortController();
    callProjectRpc(endpoint, token, 'activities.list', project.project_id, controller.signal)
      .then(data => {if (!controller.signal.aborted) setList({revision, data});})
      .catch(failure => {
        if (controller.signal.aborted) return;
        if (failure.code === 'UNAUTHENTICATED') expire();
        else setList({revision, error: failure.message});
      });
    return () => controller.abort();
  }, [endpoint, token, expire, project.project_id, revision]);

  useEffect(() => {
    if (!selection) return;
    const controller = new AbortController();
    callProjectRpc(endpoint, token, 'activities.get', project.project_id, controller.signal, {activity_id: selection.id})
      .then(data => {if (!controller.signal.aborted) {setDetail({selection, data}); detailHeading.current?.focus();}})
      .catch(failure => {
        if (controller.signal.aborted) return;
        if (failure.code === 'UNAUTHENTICATED') expire();
        else setDetail({selection, error: failure.message});
      });
    return () => controller.abort();
  }, [endpoint, token, expire, project.project_id, selection]);

  useEffect(() => {if (creating) formHeading.current?.focus();}, [creating]);
  useEffect(() => () => mutation.current?.abort(), []);

  function closeForm() {
    setCreating(false);
    const wasEdit = Boolean(editing);
    setEditing(null);
    setError('');
    requestAnimationFrame(() => (wasEdit ? editButton : createButton).current?.focus());
  }

  function updateSession(key, field, value) {
    setAgenda(rows => rows.map(row => row.key === key ? {...row, [field]: value} : row));
  }

  async function save(event) {
    event.preventDefault();
    if (mutation.current) return;
    if (!attempt.current) {
      for (let index = 0; index < agenda.length; index++) {
        if (agenda[index].start_time >= agenda[index].end_time ||
            (index > 0 && agenda[index].start_time < agenda[index - 1].end_time)) {
          setError('Waktu selesai harus sesudah waktu mulai. Urutkan sesi tanpa waktu yang tumpang tindih.');
          form.current.querySelector(`[name="start-${index}"]`)?.focus();
          return;
        }
      }
      attempt.current = {id: crypto.randomUUID(), payload: {...(editing || {}), activity: {...activity},
        agenda: agenda.map(({key, ...row}) => row)}};
    }
    const controller = new AbortController();
    mutation.current = controller;
    setPending(true);
    setError('');
    setMessage('');
    try {
      const saved = await callProjectRpc(endpoint, token, 'activities.save', project.project_id,
        controller.signal, attempt.current.payload, attempt.current.id);
      if (controller.signal.aborted) return;
      attempt.current = null;
      setUncertain(false);
      setCreating(false);
      setEditing(null);
      setActivity({activity_kind: 'FGD', title: '', activity_date: '', location: ''});
      setAgenda([]);
      setRevision(value => value + 1);
      setSelection({id: saved.activity_id});
      setMessage(editing ? 'Perubahan kegiatan dan rundown tersimpan.' : 'Kegiatan dan rundown tersimpan sebagai draf.');
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure.code === 'UNAUTHENTICATED') expire();
      else {
        setError(failure.code === 'CONFLICT' ? failure.message + ' Batalkan penyuntingan lalu muat ulang sebelum membuka versi terbaru.' : failure.message);
        if (['VALIDATION_ERROR', 'FORBIDDEN', 'CONFLICT', 'NOT_FOUND'].includes(failure.code)) {
          attempt.current = null;
          setUncertain(false);
        } else setUncertain(true);
      }
    } finally {
      if (!controller.signal.aborted) {mutation.current = null; setPending(false);}
    }
  }

  return <section className={styles.workspace} aria-labelledby={id + '-heading'}>
    <div className={styles.actions}>
      <h3 id={id + '-heading'}><CalendarRange size={18} aria-hidden="true" /> Kegiatan dan rundown</h3>
      <button className={layout.secondary} type="button" disabled={pending}
        onClick={() => {setRevision(value => value + 1); if (selection) setSelection({id: selection.id});}}>Muat ulang kegiatan</button>
    </div>
    <p className={styles.context}>{project.fiscal_year} · {project.title}</p>
    {!current && <p role="status">Memuat kegiatan…</p>}
    {current?.error && <p role="alert" className={styles.error}>{current.error}</p>}
    {message && <p role="status">{message}</p>}
    {current?.data && <>
      <div className={styles.actions}>
        <label className={styles.field}>Cari kegiatan
          <input type="search" value={query} maxLength={120} placeholder="Judul, jenis, atau lokasi"
            onChange={event => {setQuery(event.target.value); setPage(0);}} />
        </label>
        {current.data.can_write && <button ref={createButton} className={layout.primary} type="button"
          disabled={creating} aria-expanded={creating} aria-controls={id + '-form'}
          onClick={() => {setEditing(null); setActivity({activity_kind: 'FGD', title: '', activity_date: '', location: ''});
            setAgenda([]); setCreating(true); setError(''); setMessage('');}}><Plus size={16} aria-hidden="true" /> Tambah kegiatan</button>}
      </div>
      {!matches.length ? <p role="status">{query ? 'Tidak ada kegiatan yang cocok.' : 'Belum ada kegiatan untuk proyek ini.'}</p> : <>
        <ul className={styles.list}>
          {matches.slice(currentPage * 8, currentPage * 8 + 8).map(row => <li key={row.activity_id}>
            <button className={styles.activity} type="button" disabled={creating} aria-expanded={selection?.id === row.activity_id}
              aria-controls={id + '-detail'} onClick={() => setSelection({id: row.activity_id})}>
              <strong>{row.title}</strong><span>{date(row.activity_date)} · {row.activity_kind}</span>
              <span>{row.location} · {status(row.status)}</span>
            </button>
          </li>)}
        </ul>
        <div className={styles.actions} aria-label="Halaman kegiatan">
          <button className={layout.secondary} type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Sebelumnya</button>
          <span role="status">Halaman {currentPage + 1} dari {Math.ceil(matches.length / 8)} · {matches.length} kegiatan</span>
          <button className={layout.secondary} type="button" disabled={(currentPage + 1) * 8 >= matches.length} onClick={() => setPage(currentPage + 1)}>Berikutnya</button>
        </div>
      </>}
    </>}
    {creating && <form id={id + '-form'} ref={form} className={styles.form} onSubmit={save}>
      <h4 ref={formHeading} tabIndex={-1}>{editing ? 'Sunting kegiatan dan rundown' : 'Kegiatan baru'}</h4>
      <fieldset disabled={pending || uncertain}>
        <legend>Identitas kegiatan</legend>
        <div className={styles.fields}>
          {[['title', 'Judul kegiatan', 'text', 240], ['activity_kind', 'Jenis kegiatan', 'text', 80],
            ['activity_date', 'Tanggal kegiatan', 'date'], ['location', 'Lokasi', 'text', 240]].map(([field, label, type, max]) =>
            <label className={styles.field} key={field}>{label}<input required type={type} maxLength={max}
              value={activity[field]} onChange={event => setActivity({...activity, [field]: event.target.value})} /></label>)}
        </div>
      </fieldset>
      <fieldset disabled={pending || uncertain}>
        <legend>Rundown</legend>
        <p>Tambahkan sesi sesuai urutan waktu pada tanggal kegiatan.</p>
        {agenda.map((row, index) => <fieldset className={styles.session} key={row.key}>
          <legend>Sesi {index + 1}</legend>
          <div className={styles.fields}>
            <label className={styles.field}>Mulai sesi {index + 1}<input required name={'start-' + index} type="time"
              value={row.start_time} onChange={event => updateSession(row.key, 'start_time', event.target.value)} /></label>
            <label className={styles.field}>Selesai sesi {index + 1}<input required type="time"
              value={row.end_time} onChange={event => updateSession(row.key, 'end_time', event.target.value)} /></label>
            <label className={styles.field}>Judul sesi {index + 1}<input required maxLength={240}
              value={row.title} onChange={event => updateSession(row.key, 'title', event.target.value)} /></label>
            <label className={styles.field}>Pembicara sesi {index + 1} (opsional)<select value={row.speaker_person_id}
              onChange={event => updateSession(row.key, 'speaker_person_id', event.target.value)}>
              <option value="">Belum ditetapkan</option>
              {row.speaker_person_id && !speakers.some(person => person.person_id === row.speaker_person_id) &&
                <option value={row.speaker_person_id}>Pembicara sebelumnya</option>}
              {speakers.map(person => <option key={person.person_id} value={person.person_id}>{person.display_name}</option>)}
            </select></label>
          </div>
          <button className={layout.secondary} type="button" onClick={() => {
            setAgenda(rows => rows.filter(item => item.key !== row.key));
            requestAnimationFrame(() => form.current?.querySelector('[data-add-session]')?.focus());
          }}><Trash2 size={16} aria-hidden="true" /> Hapus sesi {index + 1}</button>
        </fieldset>)}
        <button data-add-session className={layout.secondary} type="button" disabled={agenda.length >= 100}
          onClick={() => {setAgenda(rows => [...rows, emptySession()]); requestAnimationFrame(() =>
            form.current?.querySelector(`[name="start-${agenda.length}"]`)?.focus());}}><Plus size={16} aria-hidden="true" /> Tambah sesi</button>
      </fieldset>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {uncertain && <p role="status">Hasil penyimpanan belum diketahui. Coba lagi dengan isian yang sama untuk memeriksa hasil tanpa membuat duplikat.</p>}
      <div className={styles.actions}>
        <button className={layout.primary} type="submit" disabled={pending}>{pending ? 'Menyimpan…' : uncertain ? 'Coba simpan kembali' : editing ? 'Simpan perubahan kegiatan' : 'Simpan draf kegiatan'}</button>
        <button className={layout.secondary} type="button" disabled={pending || uncertain} onClick={closeForm}>Batal</button>
      </div>
    </form>}
    {selection && <section id={id + '-detail'} className={styles.detail} aria-busy={!currentDetail} aria-labelledby={id + '-detail-heading'}>
      <h4 id={id + '-detail-heading'} ref={detailHeading} tabIndex={-1}>{currentDetail?.data?.activity.title || 'Detail kegiatan'}</h4>
      {!currentDetail && <p role="status">Memuat rundown…</p>}
      {currentDetail?.error && <><p className={styles.error} role="alert">{currentDetail.error}</p>
        <button className={layout.secondary} type="button" onClick={() => setSelection({id: selection.id})}>Coba muat rundown lagi</button></>}
      {currentDetail?.data && <>
        <div className={styles.actions}>
          {currentDetail.data.can_write && <button ref={editButton} className={layout.secondary} type="button" disabled={creating}
            onClick={() => {
              const data = currentDetail.data;
              setEditing({activity_id: data.activity.activity_id, expected_row_version: data.activity.row_version,
                expected_agenda_versions: Object.fromEntries(data.agenda.map(row => [row.agenda_item_id, row.row_version]))});
              setActivity(Object.fromEntries(['title', 'activity_kind', 'activity_date', 'location'].map(field => [field, data.activity[field]])));
              setAgenda(data.agenda.map(row => ({key: crypto.randomUUID(), agenda_item_id: row.agenda_item_id,
                start_time: row.start_time, end_time: row.end_time, title: row.title, speaker_person_id: row.speaker_person_id})));
              setCreating(true); setError(''); setMessage('');
            }}>Sunting kegiatan</button>}
          {currentDetail.data.reports_enabled && <button ref={reportButton} className={layout.secondary} type="button"
            disabled={pending || uncertain} onClick={() => setReportOpen(true)}>Pratinjau dokumen kegiatan</button>}
        </div>
        <p>{date(currentDetail.data.activity.activity_date)} · {currentDetail.data.activity.activity_kind} · {status(currentDetail.data.activity.status)}</p>
        <p>{currentDetail.data.activity.location}</p>
        {currentDetail.data.agenda.length ? <ol className={styles.rundown} aria-label="Rundown kegiatan">
          {currentDetail.data.agenda.map(item => <li key={item.agenda_item_id}>
            <span>{item.start_time}–{item.end_time}</span><strong>{item.title}</strong>
            <span>{item.speaker_display_name || 'Pembicara belum ditetapkan'}</span>
          </li>)}
        </ol> : <p>Belum ada sesi rundown.</p>}
        {currentDetail.data.participants_enabled && <ParticipantsWorkspace key={currentDetail.data.activity.activity_id}
          endpoint={endpoint} token={token} expire={expire} projectId={project.project_id} activityId={currentDetail.data.activity.activity_id} />}
      </>}
    </section>}
    {reportOpen && selection && <ActivityReportPreview key={selection.id} endpoint={endpoint} token={token} expire={expire}
      projectId={project.project_id} activityId={selection.id} onClose={() => {
        setReportOpen(false); requestAnimationFrame(() => reportButton.current?.focus());
      }} />}
  </section>;
}
