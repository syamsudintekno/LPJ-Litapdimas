import {ArrowRight, ChevronLeft, Close, FolderOpen, Plus, RefreshCw, Save, Trash2} from '../../components/ui/Icons.jsx';
import {useEffect, useRef, useState} from 'react';
import {callProjectRpc} from '../../rpc.js';
import layout from '../../Home.module.css';
import styles from './ProjectWizard.module.css';

const steps = ['Identitas', 'Tim', 'Pejabat', 'Tahap LPJ', 'Tinjau'];
const teamRoles = ['Ketua', 'Penanggung Jawab', 'Anggota Peneliti', 'Mahasiswa'];
const officialRoles = ['PPK', 'Bendahara Pengeluaran', 'Pejabat Tambahan'];
const optionalRoles = ['Anggota Peneliti', 'Mahasiswa', 'Pejabat Tambahan'];
const money = new Intl.NumberFormat('id-ID', {style: 'currency', currency: 'IDR', maximumFractionDigits: 0});
const percent = new Intl.NumberFormat('id-ID', {style: 'percent', maximumFractionDigits: 2});

export function ProjectWizard({endpoint, token, expire, onClose, onSaved}) {
  const [step, setStep] = useState(0);
  const [identity, setIdentity] = useState({title: '', project_code: '', fiscal_year: '', official_ceiling_amount: ''});
  const [assignments, setAssignments] = useState(() => [...teamRoles, ...officialRoles]
    .filter(role => !optionalRoles.includes(role))
    .map(role => ({key: crypto.randomUUID(), assignment_role: role, person: null})));
  const [stages, setStages] = useState(() => [
    {key: crypto.randomUUID(), label: 'Tahap 1', target: '70', cutoff_date: ''},
    {key: crypto.randomUUID(), label: 'Tahap akhir', target: '100', cutoff_date: ''},
  ]);
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState(null);
  const [searchError, setSearchError] = useState('');
  const [searchVersion, setSearchVersion] = useState(0);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [attemptPending, setAttemptPending] = useState(false);
  const attempt = useRef(null);
  const pendingSave = useRef(null);
  const heading = useRef(null);
  const personnelStep = step === 1 || step === 2;

  useEffect(() => {
    heading.current.focus();
  }, [step]);

  useEffect(() => () => pendingSave.current?.abort(), []);

  useEffect(() => {
    if (!personnelStep) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      callProjectRpc(endpoint, token, 'people.search', undefined, controller.signal, {query: query.trim()})
        .then(data => {
          if (!controller.signal.aborted) setPeople(data);
        })
        .catch(error => {
          if (controller.signal.aborted) return;
          if (error.code === 'UNAUTHENTICATED') expire();
          else setSearchError(error.message);
        });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [endpoint, token, expire, query, personnelStep, searchVersion]);

  const payload = {
    project: {...identity, title: identity.title.trim(), project_code: identity.project_code.trim(),
      fiscal_year: Number(identity.fiscal_year), official_ceiling_amount: Number(identity.official_ceiling_amount)},
    personnel: assignments.map(row => ({assignment_role: row.assignment_role, ...(row.assignment_role === 'Mahasiswa'
      ? {student: {display_name: (row.student?.display_name || '').trim(), nip: (row.student?.nip || '').trim(), nim: (row.student?.nim || '').trim()}}
      : {person_id: row.person?.person_id})})),
    stages: stages.map((row, index) => ({
      sequence_no: index + 1, label: row.label.trim(), target_bps: Math.round(Number(row.target) * 100), cutoff_date: row.cutoff_date,
    })),
  };

  async function advance(event) {
    event.preventDefault();
    if (step < steps.length - 1) {
      setSaveError('');
      setStep(step + 1);
      return;
    }
    if (pendingSave.current) return;
    attempt.current ??= {requestId: crypto.randomUUID(), payload};
    const controller = new AbortController();
    pendingSave.current = controller;
    setSaving(true);
    setAttemptPending(true);
    setSaveError('');
    try {
      const result = await callProjectRpc(endpoint, token, 'projects.save', undefined, controller.signal,
        attempt.current.payload, attempt.current.requestId);
      if (!controller.signal.aborted) onSaved(result.project_id);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error.code === 'UNAUTHENTICATED') expire();
      else {
        setSaveError(error.message);
        if (['VALIDATION_ERROR', 'FORBIDDEN', 'CONFLICT'].includes(error.code)) {
          attempt.current = null;
          setAttemptPending(false);
        }
      }
    } finally {
      if (!controller.signal.aborted) {
        pendingSave.current = null;
        setSaving(false);
      }
    }
  }

  function personInputs(roles) {
    return <>
      <label>Cari nama atau unit untuk pilihan di bawah
        <input type="search" maxLength={120} value={query} onChange={event => {
          setPeople(null); setSearchError(''); setQuery(event.target.value);
        }} />
      </label>
      {searchError ? <div role="alert">{searchError} <button type="button" className={layout.secondary}
        onClick={() => {setSearchError(''); setSearchVersion(value => value + 1);}}><RefreshCw size={16} /> Coba lagi</button></div> :
        <p role="status">{!people ? 'Memuat pilihan personel…' : people.total > 50
          ? '50 hasil pertama. Persempit kata kunci untuk melihat hasil lain.'
          : people.total ? people.total + ' personel ditemukan.' : 'Tidak ada personel yang cocok.'}</p>}
      {roles.map(role => <div key={role} className={styles.group}>
        {role === 'Mahasiswa' && <p>Nama dan NIP/NIM mahasiswa diketik langsung. Isi setidaknya salah satu nomor identitas; tidak perlu menyiapkan data di Google Sheets.</p>}
        {assignments.filter(row => row.assignment_role === role).map(row => {
          if (role === 'Mahasiswa') return <fieldset key={row.key}>
            <legend>Mahasiswa {assignments.filter(item => item.assignment_role === role).findIndex(item => item.key === row.key) + 1}</legend>
            <div className={styles.fields}>
              {[
                ['display_name', 'Nama mahasiswa', {required: true, maxLength: 240, pattern: '.*\\S.*'}],
                ['nip', 'NIP mahasiswa (jika ada)', {required: !row.student?.nim?.trim(), inputMode: 'numeric', maxLength: 30, pattern: '[0-9]{5,30}'}],
                ['nim', 'NIM mahasiswa (jika ada)', {required: !row.student?.nip?.trim(), maxLength: 40, pattern: '[a-zA-Z0-9][a-zA-Z0-9-]{2,39}'}],
              ].map(([field, label, properties]) => <label key={field}>{label}
                <input type="text" {...properties} value={row.student?.[field] || ''} onChange={event => setAssignments(items =>
                  items.map(item => item.key === row.key ? {...item, student: {...item.student, [field]: event.target.value}} : item))} />
              </label>)}
            </div>
            <button type="button" className={layout.secondary} onClick={() => setAssignments(items => items.filter(item => item.key !== row.key))}><Trash2 size={16} /> Hapus Mahasiswa</button>
          </fieldset>;
          const matches = people?.people ?? [];
          const options = row.person && !matches.some(item => item.person_id === row.person.person_id)
            ? [row.person, ...matches] : matches;
          return <div className={styles.fields} key={row.key}>
            <label>{role}
              <select required value={row.person?.person_id ?? ''} onChange={event => {
                const person = options.find(item => item.person_id === event.target.value) ?? null;
                setAssignments(items => items.map(item => item.key === row.key ? {...item, person} : item));
              }}>
                <option value="">Pilih personel</option>
                {options.map(person => <option key={person.person_id} value={person.person_id}>
                  {[person.display_name, person.person_kind, person.unit_name].filter(Boolean).join(' · ')}
                </option>)}
              </select>
            </label>
            {optionalRoles.includes(role) && <button type="button" className={layout.secondary}
              onClick={() => setAssignments(items => items.filter(item => item.key !== row.key))}><Trash2 size={16} /> Hapus {role}</button>}
          </div>;
        })}
        {optionalRoles.includes(role) && <button type="button" className={layout.secondary} disabled={assignments.length >= 40}
          onClick={() => setAssignments(items => [...items, {key: crypto.randomUUID(), assignment_role: role, person: null}])}><Plus size={16} /> Tambah {role}</button>}
      </div>)}
    </>;
  }

  function identityInput(field, label, properties) {
    return <label>{label}
      <input {...properties} value={identity[field]}
        onChange={event => setIdentity(current => ({...current, [field]: event.target.value}))} />
    </label>;
  }

  return <section className={layout.panel} aria-labelledby="wizard-heading">
    <div className={layout.detailHeader}>
      <h2 id="wizard-heading" tabIndex={-1} ref={heading}><FolderOpen size={20} /> Proyek baru · {steps[step]}</h2>
      <button type="button" className={layout.secondary} disabled={saving || attemptPending} onClick={onClose}><Close size={16} /> Tutup</button>
    </div>
    <ol className={styles.steps} aria-label="Langkah wizard">
      {steps.map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined}>{label}</li>)}
    </ol>
    <form className={styles.form} onSubmit={advance}>
      {step === 0 && <>
        {identityInput('title', 'Judul proyek', {required: true, maxLength: 240, pattern: '.*\\S.*'})}
        {identityInput('project_code', 'Kode proyek', {maxLength: 80})}
        {identityInput('fiscal_year', 'Tahun anggaran', {required: true, type: 'number', min: 1900, max: 9999})}
        {identityInput('official_ceiling_amount', 'Plafon resmi (rupiah)', {required: true, type: 'number', min: 1, max: Number.MAX_SAFE_INTEGER})}
      </>}
      {step === 1 && personInputs(teamRoles)}
      {step === 2 && personInputs(officialRoles)}
      {step === 3 && <>
        <p>Masukkan persentase kumulatif. Tahap terakhir harus 100%.</p>
        {stages.map((stage, index) => <fieldset key={stage.key}>
          <legend>Tahap {index + 1}</legend>
          <div className={styles.fields}>
            {[
              ['label', 'Nama tahap', {maxLength: 80, pattern: '.*\\S.*'}],
              ['target', 'Target (%)', {type: 'number', min: 0.01, max: 100, step: 0.01}],
              ['cutoff_date', 'Tanggal batas', {type: 'date'}],
            ].map(([field, label, properties]) => <label key={field}>{label}
              <input required {...properties} value={stage[field]} onChange={event => setStages(items =>
                items.map(item => item.key === stage.key ? {...item, [field]: event.target.value} : item))} />
            </label>)}
          </div>
          {stages.length > 1 && <button type="button" className={layout.secondary} onClick={() =>
            setStages(items => items.filter(item => item.key !== stage.key))}><Trash2 size={16} /> Hapus tahap {index + 1}</button>}
        </fieldset>)}
        <button type="button" className={layout.secondary} disabled={stages.length >= 10} onClick={() =>
          setStages(items => [...items, {key: crypto.randomUUID(), label: '', target: '', cutoff_date: ''}])}><Plus size={16} /> Tambah tahap</button>
      </>}
      {step === 4 && <>
        <h3>{payload.project.title}</h3>
        <p>Tahun {identity.fiscal_year} · {money.format(payload.project.official_ceiling_amount)}</p>
        {payload.project.project_code && <p>Kode proyek {payload.project.project_code}</p>}
        <ul>{assignments.map(row => <li key={row.key}>{row.assignment_role} · {row.assignment_role === 'Mahasiswa'
          ? [row.student?.display_name, row.student?.nip && 'NIP ' + row.student.nip, row.student?.nim && 'NIM ' + row.student.nim].filter(Boolean).join(' · ')
          : row.person?.display_name}</li>)}</ul>
        <ul>{payload.stages.map(stage => <li key={stage.sequence_no}>
          {stage.label} · {percent.format(stage.target_bps / 10000)} · {stage.cutoff_date}
        </li>)}</ul>
      </>}
      {saveError && <p className={styles.error} role="alert">{saveError}</p>}
      {attemptPending && !saving && <p role="status">Coba lagi untuk memastikan hasil penyimpanan sebelum mengubah draf.</p>}
      <div className={styles.actions}>
        {step > 0 && <button type="button" className={layout.secondary} disabled={saving || attemptPending}
          onClick={() => {setSaveError(''); setStep(step - 1);}}><ChevronLeft size={16} /> Kembali</button>}
        <button type="submit" className={layout.primary} disabled={saving}>
          {step === 4 ? <Save size={16} /> : <ArrowRight size={16} />} {saving ? 'Menyimpan…' : step === 4 ? 'Simpan draf' : 'Lanjut'}
        </button>
      </div>
    </form>
  </section>;
}
