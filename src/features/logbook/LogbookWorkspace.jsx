import {useEffect, useId, useRef, useState} from 'react';
import {BookOpen, Plus} from 'lucide-react';
import {callProjectRpc} from '../../rpc.js';
import layout from '../../Home.module.css';
import styles from './LogbookWorkspace.module.css';

const date = value => new Intl.DateTimeFormat('id-ID', {dateStyle: 'long', timeZone: 'Asia/Jakarta'})
  .format(new Date(value + 'T00:00:00Z'));
const empty = {entry_date: '', activity_id: '', description: '', result: ''};

export function LogbookWorkspace({endpoint, token, expire, project}) {
  const id = useId();
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState(null);
  const [draft, setDraft] = useState(null);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const heading = useRef(null);
  const formHeading = useRef(null);
  const returnFocus = useRef(null);
  const mutation = useRef(null);
  const attempt = useRef(null);
  const current = response?.revision === revision ? response : null;
  const entries = (current?.data?.entries || []).filter(entry =>
    [entry.description, entry.result, entry.activity_title].some(value => value.toLocaleLowerCase('id-ID').includes(query.trim().toLocaleLowerCase('id-ID'))));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(entries.length / 8) - 1));

  useEffect(() => {
    const controller = new AbortController();
    callProjectRpc(endpoint, token, 'logbook.list', project.project_id, controller.signal)
      .then(data => {if (!controller.signal.aborted) setResponse({revision, data});})
      .catch(failure => {
        if (controller.signal.aborted) return;
        if (failure.code === 'UNAUTHENTICATED') expire();
        else setResponse({revision, error: failure.message});
      });
    return () => controller.abort();
  }, [endpoint, token, expire, project.project_id, revision]);
  useEffect(() => () => mutation.current?.abort(), []);

  function open(entry, button) {
    returnFocus.current = button;
    setDraft(entry ? {entry_date: entry.entry_date, activity_id: entry.activity_id, description: entry.description,
      result: entry.result, logbook_entry_id: entry.logbook_entry_id, expected_row_version: entry.row_version} : {...empty});
    setError('');
    setMessage('');
    requestAnimationFrame(() => formHeading.current?.focus());
  }

  function close() {
    setDraft(null);
    setError('');
    requestAnimationFrame(() => returnFocus.current?.isConnected ? returnFocus.current.focus() : heading.current?.focus());
  }

  async function save(event) {
    event.preventDefault();
    if (mutation.current) return;
    attempt.current ??= {id: crypto.randomUUID(), payload: {...draft}};
    const controller = new AbortController();
    mutation.current = controller;
    setPending(true);
    setError('');
    try {
      await callProjectRpc(endpoint, token, 'logbook.save', project.project_id, controller.signal,
        attempt.current.payload, attempt.current.id);
      if (controller.signal.aborted) return;
      attempt.current = null;
      setUncertain(false);
      setDraft(null);
      setRevision(value => value + 1);
      setMessage('Entri logbook tersimpan.');
      heading.current?.focus();
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure.code === 'UNAUTHENTICATED') expire();
      else {
        setError(failure.code === 'CONFLICT' ? failure.message + ' Batalkan penyuntingan, muat ulang logbook, lalu buka kembali entri terbaru.' : failure.message);
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
      <h3 id={id + '-heading'} ref={heading} tabIndex={-1}><BookOpen size={18} aria-hidden="true" /> Logbook penelitian</h3>
      <button className={layout.secondary} type="button" disabled={pending}
        onClick={() => setRevision(value => value + 1)}>Muat ulang logbook</button>
    </div>
    <p className={styles.context}>{project.fiscal_year} · {project.title}</p>
    {!current && <p role="status">Memuat logbook…</p>}
    {current?.error && <p role="alert" className={styles.error}>{current.error}</p>}
    {message && <p role="status">{message}</p>}
    {current?.data && <>
      <div className={styles.actions}>
        <label className={styles.field}>Cari logbook<input type="search" maxLength={120} value={query}
          placeholder="Uraian, hasil, atau kegiatan" onChange={event => {setQuery(event.target.value); setPage(0);}} /></label>
        {current.data.can_write && <button className={layout.primary} type="button" disabled={Boolean(draft)}
          aria-expanded={Boolean(draft)} aria-controls={id + '-form'} onClick={event => open(null, event.currentTarget)}>
          <Plus size={16} aria-hidden="true" /> Tambah logbook</button>}
      </div>
      {!entries.length ? <p role="status">{query ? 'Tidak ada entri yang cocok.' : 'Belum ada entri logbook untuk proyek ini.'}</p> : <>
        <ol className={styles.entries} aria-label="Entri logbook">
          {entries.slice(currentPage * 8, currentPage * 8 + 8).map(entry => <li key={entry.logbook_entry_id}>
            <div className={styles.actions}><strong>{date(entry.entry_date)}</strong>
              {current.data.can_write && <button className={layout.secondary} type="button" disabled={Boolean(draft)}
                aria-label={'Sunting logbook ' + date(entry.entry_date) + ' · ' + entry.description.slice(0, 60)}
                onClick={event => open(entry, event.currentTarget)}>Sunting</button>}
            </div>
            <p className={styles.context}>{entry.activity_title || (entry.activity_id ? 'Kegiatan tidak tersedia' : 'Tanpa kegiatan terkait')}</p>
            <dl><dt>Uraian</dt><dd>{entry.description}</dd><dt>Hasil</dt><dd>{entry.result}</dd></dl>
          </li>)}
        </ol>
        <div className={styles.actions} aria-label="Halaman logbook">
          <button className={layout.secondary} type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Sebelumnya</button>
          <span role="status">Halaman {currentPage + 1} dari {Math.ceil(entries.length / 8)} · {entries.length} entri</span>
          <button className={layout.secondary} type="button" disabled={(currentPage + 1) * 8 >= entries.length} onClick={() => setPage(currentPage + 1)}>Berikutnya</button>
        </div>
      </>}
    </>}
    {draft && <form id={id + '-form'} className={styles.form} onSubmit={save}>
      <h4 ref={formHeading} tabIndex={-1}>{draft.logbook_entry_id ? 'Sunting entri logbook' : 'Entri logbook baru'}</h4>
      <fieldset disabled={pending || uncertain}>
        <legend>Catatan penelitian</legend>
        <label className={styles.field}>Tanggal catatan<input required type="date" value={draft.entry_date}
          onChange={event => setDraft({...draft, entry_date: event.target.value})} /></label>
        <label className={styles.field}>Kegiatan terkait (opsional)<select value={draft.activity_id}
          onChange={event => setDraft({...draft, activity_id: event.target.value})}>
          <option value="">Tanpa kegiatan terkait</option>
          {draft.activity_id && !current?.data?.activities.some(row => row.activity_id === draft.activity_id) &&
            <option value={draft.activity_id}>Kegiatan sebelumnya</option>}
          {(current?.data?.activities || []).map(row => <option key={row.activity_id} value={row.activity_id}>{date(row.activity_date)} · {row.title}</option>)}
        </select></label>
        {[['description', 'Uraian penelitian'], ['result', 'Hasil penelitian']].map(([field, label]) =>
          <div className={styles.field} key={field}><label htmlFor={id + '-' + field}>{label}</label>
            <textarea id={id + '-' + field} required rows={4} maxLength={4000}
              value={draft[field]} onChange={event => setDraft({...draft, [field]: event.target.value})} /></div>)}
      </fieldset>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {uncertain && <p role="status">Hasil simpan belum diketahui. Coba lagi dengan isian yang sama untuk memeriksa hasil tanpa menambah duplikat.</p>}
      <div className={styles.actions}>
        <button className={layout.primary} type="submit" disabled={pending}>{pending ? 'Menyimpan…' : uncertain ? 'Coba simpan logbook kembali' : 'Simpan logbook'}</button>
        <button className={layout.secondary} type="button" disabled={pending || uncertain} onClick={close}>Batal</button>
      </div>
    </form>}
  </section>;
}
