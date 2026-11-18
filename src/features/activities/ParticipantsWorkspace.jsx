import {ChevronLeft, ChevronRight, Eye, RefreshCw, Save, Upload, Users} from '../../components/ui/Icons.jsx';
import {useEffect, useId, useRef, useState} from 'react';
import {callProjectRpc} from '../../rpc.js';
import {readParticipantsCsv} from './readParticipantsCsv.js';
import layout from '../../Home.module.css';
import styles from './ParticipantsWorkspace.module.css';

const attendanceLabels = {UNRECORDED: 'Belum dicatat', PRESENT: 'Hadir', ABSENT: 'Tidak hadir'};
const kinds = {SNACK: 'Snack', CONSUMPTION: 'Konsumsi', TRANSPORT: 'Transport'};
const importLabels = {VALID: 'Valid', DUPLICATE: 'Duplikat', CORRECTION: 'Perlu koreksi'};
const receivedDate = value => new Intl.DateTimeFormat('id-ID', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta'}).format(new Date(value));
const localDate = value => value ? new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'})
  .format(new Date(value)).replace(' ', 'T') : '';

function ParticipantCard({person, canWrite, disabled, save}) {
  const id = useId();
  const [attendance, setAttendance] = useState(person.attendance_status);
  const [kind, setKind] = useState('SNACK');
  const existing = person.distributions.find(row => row.distribution_kind === kind);
  const [quantity, setQuantity] = useState(String(existing?.quantity || 0));
  const [received, setReceived] = useState(localDate(existing?.received_at));

  function chooseKind(value) {
    setKind(value);
    const current = person.distributions.find(row => row.distribution_kind === value);
    setQuantity(String(current?.quantity || 0));
    setReceived(localDate(current?.received_at));
  }

  return <li className={styles.card}>
    <h6>{person.display_name}</h6>
    <p>Kehadiran · {attendanceLabels[person.attendance_status]}</p>
    <ul className={styles.distributions} aria-label={'Distribusi ' + person.display_name}>
      {Object.entries(kinds).map(([value, label]) => {
        const current = person.distributions.find(row => row.distribution_kind === value);
        return <li key={value}><strong>{label}</strong> · {current?.quantity > 0 ?
          `${current.quantity} unit diterima · ${receivedDate(current.received_at)} WIB` : 'Belum diterima'}</li>;
      })}
    </ul>
    {canWrite && <>
      <form aria-label={'Kehadiran ' + person.display_name} onSubmit={event => {
        event.preventDefault();
        save('participants.save', {activity_participant_id: person.activity_participant_id,
          expected_row_version: person.row_version, attendance_status: attendance});
      }}>
        <fieldset disabled={disabled}><legend>Kehadiran</legend>
          <div className={styles.field}><label htmlFor={id + '-attendance'}>Status hadir</label>
            <select id={id + '-attendance'} value={attendance} onChange={event => setAttendance(event.target.value)}>
              {Object.entries(attendanceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></div>
          <button className={layout.secondary} type="submit"><Save size={16} /> Simpan kehadiran</button>
        </fieldset>
      </form>
      <form aria-label={'Penerimaan ' + person.display_name} onSubmit={event => {
        event.preventDefault();
        save('distributions.save', {activity_participant_id: person.activity_participant_id, distribution_kind: kind,
          expected_row_version: existing?.row_version || 0, quantity: Number(quantity),
          received_at: Number(quantity) > 0 ? new Date(received + '+07:00').toISOString() : ''});
      }}>
        <fieldset disabled={disabled}><legend>Penerimaan distribusi</legend>
          <div className={styles.field}><label htmlFor={id + '-kind'}>Jenis distribusi</label>
            <select id={id + '-kind'} value={kind} onChange={event => chooseKind(event.target.value)}>
              {Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></div>
          <div className={styles.field}><label htmlFor={id + '-quantity'}>Jumlah unit penerimaan</label>
            <input id={id + '-quantity'} required type="number" min="0" max="1000000" step="1" value={quantity}
              onChange={event => setQuantity(event.target.value)} /></div>
          <div className={styles.field}><label htmlFor={id + '-received'}>Waktu penerimaan (WIB)</label>
            <input id={id + '-received'} required={Number(quantity) > 0} type="datetime-local" step="60" value={received}
              onChange={event => setReceived(event.target.value)} /></div>
          <p>Jumlah 0 berarti belum diterima. Catatan ini terpisah dari status hadir dan nominal transaksi.</p>
          <button className={layout.secondary} type="submit"><Save size={16} /> Simpan distribusi</button>
        </fieldset>
      </form>
    </>}
  </li>;
}

export function ParticipantsWorkspace({endpoint, token, expire, projectId, activityId}) {
  const id = useId();
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState(null);
  const [rows, setRows] = useState(null);
  const [personId, setPersonId] = useState('');
  const [plan, setPlan] = useState(null);
  const [pending, setPending] = useState(false);
  const [reading, setReading] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const mutation = useRef(null);
  const attempt = useRef(null);
  const fileRead = useRef(0);
  const heading = useRef(null);
  const current = response?.revision === revision ? response : null;
  const disabled = pending || uncertain || reading;
  const matches = (current?.data?.participants || []).filter(person => person.display_name.toLocaleLowerCase('id-ID')
    .includes(query.trim().toLocaleLowerCase('id-ID')));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(matches.length / 8) - 1));

  useEffect(() => {
    const controller = new AbortController();
    callProjectRpc(endpoint, token, 'participants.list', projectId, controller.signal, {activity_id: activityId})
      .then(data => {if (!controller.signal.aborted) setResponse({revision, data});})
      .catch(failure => {
        if (controller.signal.aborted) return;
        if (failure.code === 'UNAUTHENTICATED') expire();
        else setResponse({revision, error: failure.message});
      });
    return () => controller.abort();
  }, [endpoint, token, expire, projectId, activityId, revision]);
  useEffect(() => () => {mutation.current?.abort(); fileRead.current++;}, []);

  async function run(action, payload, complete) {
    if (mutation.current || reading) return;
    attempt.current ??= {action, payload: {activity_id: activityId, ...payload}, id: crypto.randomUUID(), complete};
    const task = attempt.current;
    const controller = new AbortController();
    mutation.current = controller;
    setPending(true); setError(''); setMessage('');
    try {
      const data = await callProjectRpc(endpoint, token, task.action, projectId, controller.signal, task.payload, task.id);
      if (controller.signal.aborted) return;
      attempt.current = null; setUncertain(false);
      task.complete(data);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure.code === 'UNAUTHENTICATED') expire();
      else {
        setError(failure.code === 'CONFLICT' ? failure.message + ' Muat ulang peserta dan buat pratinjau baru bila sedang mengimpor.' : failure.message);
        if (['VALIDATION_ERROR', 'CONFLICT', 'FORBIDDEN', 'NOT_FOUND'].includes(failure.code)) {
          attempt.current = null; setUncertain(false);
          if (task.action === 'participants.commit_import') setPlan(null);
        } else setUncertain(true);
      }
    } finally {
      if (!controller.signal.aborted) {mutation.current = null; setPending(false);}
    }
  }

  function preview(batch) {
    setPlan(null);
    run('participants.preview_import', {rows: batch}, data => {setPlan({...data, rows: batch}); setMessage('Pratinjau peserta siap diperiksa.');});
  }

  function save(action, payload) {
    run(action, payload, () => {
      setRevision(value => value + 1); setPlan(null); setMessage('Catatan peserta tersimpan.'); heading.current?.focus();
    });
  }

  return <section className={styles.workspace} aria-labelledby={id + '-heading'}>
    <div className={styles.actions}>
      <h5 id={id + '-heading'} ref={heading} tabIndex={-1}><Users size={20} /> Peserta dan distribusi</h5>
      <button className={layout.secondary} type="button" disabled={disabled} onClick={() => {setRevision(value => value + 1); setPlan(null);}}><RefreshCw size={16} /> Muat ulang peserta</button>
    </div>
    {!current && <p role="status">Memuat peserta…</p>}
    {current?.error && <p className={styles.error} role="alert">{current.error}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {pending && <p role="status">Memproses peserta…</p>}
    {uncertain && <div className={styles.retry}><p>Hasil permintaan belum diketahui. Coba ulang dengan request yang sama untuk memeriksa hasil.</p>
      <button className={layout.primary} type="button" disabled={pending} onClick={() => run()}><RefreshCw size={16} /> Coba permintaan peserta kembali</button></div>}
    {current?.data && <>
      {current.data.can_write && <div className={styles.import}>
        <fieldset disabled={disabled}><legend>Tambah peserta dari personel proyek</legend>
          <div className={styles.field}><label htmlFor={id + '-person'}>Personel proyek</label>
            <select id={id + '-person'} value={personId} onChange={event => {setPersonId(event.target.value); setPlan(null);}}>
              <option value="">Pilih personel</option>
              {current.data.project_people.map(person => <option key={person.person_id} value={person.person_id}>{person.display_name}</option>)}
            </select></div>
          <button className={layout.secondary} type="button" disabled={!personId}
            onClick={() => preview([{source_row: 1, person_id: personId, attendance_status: 'UNRECORDED'}])}><Eye size={16} /> Pratinjau personel proyek</button>
        </fieldset>
        <fieldset disabled={disabled}><legend>Impor peserta dari CSV</legend>
          <p>Gunakan kolom person_id dari Master Personel. Kolom attendance_status opsional: UNRECORDED, PRESENT, atau ABSENT.</p>
          <div className={styles.field}><label htmlFor={id + '-csv'}>CSV peserta</label>
            <input id={id + '-csv'} type="file" accept=".csv,text/csv" onChange={async event => {
              const file = event.target.files?.[0];
              const version = ++fileRead.current;
              setRows(null); setPlan(null); setError('');
              if (!file) return;
              setReading(true);
              try {const batch = await readParticipantsCsv(file); if (version === fileRead.current) setRows(batch);}
              catch (failure) {if (version === fileRead.current) setError(failure.message);}
              finally {if (version === fileRead.current) setReading(false);}
            }} /></div>
          {reading && <p role="status">Membaca CSV…</p>}
          <button className={layout.secondary} type="button" disabled={!rows} onClick={() => preview(rows)}><Eye size={16} /> Pratinjau CSV peserta</button>
        </fieldset>
        {plan && <div className={styles.preview}>
          <p role="status">{plan.summary.valid} valid · {plan.summary.duplicate} duplikat · {plan.summary.correction} perlu koreksi</p>
          <div className={styles.table} role="region" aria-label="Pratinjau peserta" tabIndex={0}>
            <table><caption>Pratinjau peserta kegiatan</caption><thead><tr><th scope="col">Baris</th><th scope="col">Nama</th><th scope="col">Hadir</th><th scope="col">Hasil pemeriksaan</th></tr></thead>
              <tbody>{plan.results.map(row => <tr key={row.source_row}><td>{row.source_row}</td><td>{row.display_name || row.person_id}</td>
                <td>{attendanceLabels[row.attendance_status] || row.attendance_status}</td><td>{importLabels[row.status]}{row.message && ' · ' + row.message}</td></tr>)}</tbody>
            </table></div>
          <button className={layout.primary} type="button" disabled={disabled || !plan.summary.valid} onClick={() =>
            run('participants.commit_import', {rows: plan.rows, import_token: plan.import_token}, data => {
              setPlan(null); setRows(null); setPersonId(''); setRevision(value => value + 1);
              setMessage(data.imported + ' peserta ditambahkan.'); heading.current?.focus();
            })}><Upload size={16} /> Impor peserta valid</button>
        </div>}
      </div>}
      <label className={styles.field}>Cari peserta<input type="search" maxLength={120} value={query}
        onChange={event => {setQuery(event.target.value); setPage(0);}} /></label>
      {!matches.length ? <p role="status">{query ? 'Tidak ada peserta yang cocok.' : 'Belum ada peserta kegiatan.'}</p> : <>
        <ul className={styles.list} aria-label="Peserta kegiatan">
          {matches.slice(currentPage * 8, currentPage * 8 + 8).map(person => <ParticipantCard
            key={person.activity_participant_id + ':' + person.row_version + ':' + person.distributions.map(row => row.row_version).join(',')}
            person={person} disabled={disabled} canWrite={current.data.can_write} save={save} />)}
        </ul>
        <div className={styles.actions} aria-label="Halaman peserta">
          <button className={layout.secondary} type="button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /> Peserta sebelumnya</button>
          <span role="status">Halaman {currentPage + 1} dari {Math.ceil(matches.length / 8)} · {matches.length} peserta</span>
          <button className={layout.secondary} type="button" disabled={(currentPage + 1) * 8 >= matches.length} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /> Peserta berikutnya</button>
        </div>
      </>}
    </>}
  </section>;
}
