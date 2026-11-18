import {useEffect, useRef, useState} from 'react';
import {Check, ChevronLeft, ChevronRight, Close, Plus, RefreshCw, Save, ShieldCheck} from '../../components/ui/Icons.jsx';
import {callProjectRpc} from '../../rpc.js';
import layout from '../../Home.module.css';
import fields from '../transactions/TransactionWorkspace.module.css';
import styles from './TaxRulesWorkspace.module.css';

const expenses = {HONOR: 'Honor', TRANSPORT: 'Transport', CONSUMPTION: 'Konsumsi', SNACK: 'Snack', OTHER: 'Lainnya'};
const payees = {PERSON: 'Orang', ORGANIZATION: 'Organisasi', GROUP: 'Kelompok'};
const blank = () => ({rule_code: '', tax_kind: '', expense_kind: 'HONOR', payee_kind: 'PERSON', base_kind: 'RECEIPT_AMOUNT',
  rate_bps: '', effective_from: '', effective_to: '', source_ref: '', grades: '', expected_latest_version: 0});

export function TaxRulesWorkspace({endpoint, token, expire}) {
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState(null);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const mutation = useRef(null);
  const attempt = useRef(null);
  const heading = useRef(null);
  const sectionHeading = useRef(null);
  const returnFocus = useRef(null);
  const current = response?.revision === revision ? response : null;
  const rules = current?.data?.rules || [];
  const codes = [...new Set(rules.map(row => row.rule_code))].filter(code => rules.some(row => row.rule_code === code &&
    [row.rule_code, row.tax_kind, row.source_ref].some(value => value.toLocaleLowerCase('id-ID').includes(query.trim().toLocaleLowerCase('id-ID')))));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(codes.length / 8) - 1));
  const locked = pending || uncertain;

  useEffect(() => {
    const controller = new AbortController();
    callProjectRpc(endpoint, token, 'taxes.list_rules', undefined, controller.signal)
      .then(data => {if (!controller.signal.aborted) setResponse({revision, data});})
      .catch(failure => {
        if (controller.signal.aborted) return;
        if (failure.code === 'UNAUTHENTICATED') expire();
        else setResponse({revision, error: failure.message});
      });
    return () => controller.abort();
  }, [endpoint, token, expire, revision]);
  useEffect(() => () => mutation.current?.abort(), []);

  function open(row, button) {
    returnFocus.current = button;
    setDraft(row ? {...row, rate_bps: String(row.rate_bps), grades: (row.eligibility.civil_service_grades || []).join(', '),
      expected_latest_version: row.version_no} : blank());
    setError(''); setMessage(''); setConflict(false);
    requestAnimationFrame(() => heading.current?.focus());
  }
  function close() {
    setDraft(null); setError(''); setConflict(false);
    requestAnimationFrame(() => (returnFocus.current?.isConnected && !returnFocus.current.disabled ? returnFocus.current : sectionHeading.current)?.focus());
  }
  async function save(event) {
    event.preventDefault();
    if (mutation.current || conflict || !current?.data) return;
    const grades = draft.grades.split(',').map(value => value.trim()).filter(Boolean);
    attempt.current ??= {id: crypto.randomUUID(), payload: {
      rule_code: draft.rule_code, expected_latest_version: draft.expected_latest_version, tax_kind: draft.tax_kind,
      expense_kind: draft.expense_kind, payee_kind: draft.payee_kind, base_kind: 'RECEIPT_AMOUNT', rate_bps: Number(draft.rate_bps),
      effective_from: draft.effective_from, effective_to: draft.effective_to, source_ref: draft.source_ref,
      eligibility: grades.length ? {civil_service_grades: grades} : {},
    }};
    const controller = new AbortController();
    mutation.current = controller; setPending(true); setError('');
    try {
      const saved = await callProjectRpc(endpoint, token, 'taxes.save_rule_version', undefined, controller.signal, attempt.current.payload, attempt.current.id);
      if (controller.signal.aborted) return;
      attempt.current = null; setUncertain(false); close();
      setMessage(`${saved.rule_code} versi ${saved.version_no} tersimpan. Versi terdahulu tetap tersedia.`);
      setRevision(value => value + 1);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure.code === 'UNAUTHENTICATED') expire();
      else {
        setError(failure.message);
        if (['VALIDATION_ERROR', 'CONFLICT', 'FORBIDDEN', 'NOT_FOUND'].includes(failure.code)) {
          attempt.current = null; setUncertain(false); setConflict(failure.code === 'CONFLICT');
          if (failure.code === 'CONFLICT') setRevision(value => value + 1);
        } else setUncertain(true);
      }
    } finally {if (!controller.signal.aborted) {mutation.current = null; setPending(false);}}
  }
  const update = (key, value) => setDraft(previous => ({...previous, [key]: value}));
  return <section id="aturan-pajak" tabIndex={-1} className={layout.panel} aria-labelledby="tax-rules-heading">
    <div className={layout.panelHeading}><h2 id="tax-rules-heading" ref={sectionHeading} tabIndex={-1}><ShieldCheck size={20} /> Aturan pajak</h2></div>
    <div className={styles.body}>
      <p>Aturan berlaku lintas proyek. Isi tarif berdasarkan referensi yang diperiksa pemilik; aplikasi tidak menyediakan tarif bawaan.</p>
      <p className={fields.context}>Untuk kode yang sama, tanggal pembayaran memilih versi tertinggi yang periodenya mencakup tanggal tersebut. Setelah itu syarat penerima/golongan diperiksa. Aturan dengan kode berbeda yang sama-sama cocok tetap memerlukan tinjauan pemilik.</p>
      <div className={fields.actions}>
        <button className={layout.secondary} type="button" disabled={locked} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} /> Muat ulang aturan</button>
        <button className={layout.primary} type="button" disabled={!current?.data || Boolean(draft)} onClick={event => open(null, event.currentTarget)}><Plus size={16} /> Aturan baru</button>
      </div>
      {!current && <p role="status">Memuat aturan pajak…</p>}
      {current?.error && <p role="alert" className={fields.error}>{current.error}</p>}
      {message && <p role="status">{message}</p>}
      {current?.data && <>
        <label className={fields.field}>Cari aturan<input type="search" maxLength={120} value={query} onChange={event => {setQuery(event.target.value); setPage(0);}} placeholder="Kode, jenis pajak, atau referensi" /></label>
        {!codes.length && <p role="status">{query ? 'Tidak ada aturan yang cocok.' : 'Belum ada aturan pajak.'}</p>}
        <ul className={styles.rules} aria-label="Daftar aturan pajak">
          {codes.slice(currentPage * 8, currentPage * 8 + 8).map(code => {
            const history = rules.filter(row => row.rule_code === code).sort((a, b) => b.version_no - a.version_no);
            return <li key={code}>
              <div className={fields.actions}><strong>{code}</strong><button className={layout.secondary} type="button" disabled={Boolean(draft)}
                aria-label={'Buat versi baru ' + code} onClick={event => open(history[0], event.currentTarget)}><Plus size={16} /> Buat versi baru</button></div>
              <p>{history[0].tax_kind} · {expenses[history[0].expense_kind]} · {payees[history[0].payee_kind]}</p>
              <details><summary>Riwayat {history.length} versi · versi terakhir {history[0].version_no}</summary>
                {history.map(row => <dl key={row.tax_rule_version_id} className={styles.version}>
                  <div><dt>Versi</dt><dd>{row.version_no}</dd></div>
                  <div><dt>Tarif</dt><dd>{row.rate_bps} basis point ({new Intl.NumberFormat('id-ID', {maximumFractionDigits: 2}).format(row.rate_bps / 100)}%)</dd></div>
                  <div><dt>Periode inklusif</dt><dd>{row.effective_from} sampai {row.effective_to || 'tanpa batas akhir'}</dd></div>
                  <div><dt>Golongan</dt><dd>{row.eligibility.civil_service_grades?.join(', ') || 'Semua golongan'}</dd></div>
                  <div><dt>Referensi</dt><dd>{row.source_ref}</dd></div>
                </dl>)}
              </details>
            </li>;
          })}
        </ul>
        {codes.length > 0 && <div className={fields.actions} aria-label="Halaman aturan">
          <button className={layout.secondary} type="button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /> Aturan sebelumnya</button>
          <span role="status">Halaman {currentPage + 1} dari {Math.ceil(codes.length / 8)}</span>
          <button className={layout.secondary} type="button" disabled={(currentPage + 1) * 8 >= codes.length} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /> Aturan berikutnya</button>
        </div>}
      </>}
      {draft && <form className={fields.form} onSubmit={save}>
        <h3 ref={heading} tabIndex={-1}><ShieldCheck size={20} /> {draft.expected_latest_version ? 'Versi aturan baru' : 'Aturan pajak baru'}</h3>
        <p className={fields.context}>Versi {draft.expected_latest_version + 1} akan ditambahkan tanpa mengubah versi lama. Pada periode yang tumpang tindih untuk kode ini, versi baru menjadi acuan. Periksa dampaknya pada penilaian pajak terdahulu.</p>
        <fieldset disabled={locked}><legend>Rincian aturan</legend><div className={fields.fields}>
          <label className={fields.field}>Kode aturan<input required pattern="[A-Z][A-Z0-9_]{0,79}" maxLength={80} readOnly={draft.expected_latest_version > 0}
            value={draft.rule_code} onChange={event => update('rule_code', event.target.value)} /><span>Huruf kapital, angka, dan garis bawah; awali dengan huruf.</span></label>
          <label className={fields.field}>Jenis pajak<input required maxLength={40} readOnly={draft.expected_latest_version > 0} value={draft.tax_kind} onChange={event => update('tax_kind', event.target.value)} /></label>
          <label className={fields.field}>Jenis belanja<select disabled={draft.expected_latest_version > 0} value={draft.expense_kind} onChange={event => update('expense_kind', event.target.value)}>{Object.entries(expenses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className={fields.field}>Jenis penerima<select disabled={draft.expected_latest_version > 0} value={draft.payee_kind} onChange={event => update('payee_kind', event.target.value)}>{Object.entries(payees).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className={fields.field}>Tarif (basis point)<input required type="number" min="0" max="10000" step="1" value={draft.rate_bps} onChange={event => update('rate_bps', event.target.value)} /><span>100 basis point = 1%. Dasar: nilai kwitansi.</span></label>
          <label className={fields.field}>Berlaku mulai<input required type="date" value={draft.effective_from} onChange={event => update('effective_from', event.target.value)} /></label>
          <label className={fields.field}>Berlaku sampai (opsional)<input type="date" min={draft.effective_from} value={draft.effective_to} onChange={event => update('effective_to', event.target.value)} /></label>
          <label className={fields.field}>Golongan (opsional)<input maxLength={1228} value={draft.grades} onChange={event => update('grades', event.target.value)} /><span>Pisahkan dengan koma. Kosong berarti semua golongan; data honor tetap harus lengkap.</span></label>
        </div><label className={fields.field}>Referensi aturan<textarea required maxLength={1000} rows={3} value={draft.source_ref} onChange={event => update('source_ref', event.target.value)} /></label></fieldset>
        {error && <p role="alert" className={fields.error}>{error}</p>}
        {uncertain && <p role="status">Hasil simpan belum diketahui. Coba kembali dengan isian dan request yang sama sebelum melanjutkan.</p>}
        {conflict && <button className={layout.secondary} type="button" disabled={!current?.data || locked} onClick={() => {
          const latest = Math.max(0, ...rules.filter(row => row.rule_code === draft.rule_code).map(row => row.version_no));
          setDraft(previous => ({...previous, expected_latest_version: latest})); setConflict(false); setError('');
        }}><Check size={16} /> Gunakan daftar termuat sebagai acuan versi</button>}
        <div className={fields.actions}>
          <button className={layout.primary} type="submit" disabled={pending || conflict || !current?.data}><Save size={16} /> {pending ? 'Menyimpan…' : uncertain ? 'Coba simpan aturan kembali' : 'Simpan versi aturan'}</button>
          <button className={layout.secondary} type="button" disabled={locked} onClick={close}><Close size={16} /> Batal aturan</button>
        </div>
      </form>}
    </div>
  </section>;
}
