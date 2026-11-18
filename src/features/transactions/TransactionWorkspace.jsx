import {useEffect, useId, useRef, useState} from 'react';
import {Plus, ReceiptText, Trash2} from 'lucide-react';
import {callProjectRpc} from '../../rpc.js';
import layout from '../../Home.module.css';
import styles from './TransactionWorkspace.module.css';

const money = value => new Intl.NumberFormat('id-ID', {style: 'currency', currency: 'IDR', maximumFractionDigits: 0}).format(value);
const date = value => new Intl.DateTimeFormat('id-ID', {dateStyle: 'long', timeZone: 'Asia/Jakarta'}).format(new Date(value + 'T00:00:00Z'));
const kinds = {HONOR: 'Honor', TRANSPORT: 'Transport / uang saku', CONSUMPTION: 'Konsumsi', SNACK: 'Snack', OTHER: 'Lainnya'};
const status = {DRAFT: 'Draf · Belum diverifikasi', CONFIRMED: 'Terkonfirmasi', VOID: 'Dibatalkan'};
const newPayment = () => ({key: crypto.randomUUID(), payee_id: '', receipt_amount: '', withheld_tax_amount: '0'});

export function TransactionWorkspace({endpoint, token, expire, project}) {
  const id = useId();
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState(null);
  const [draft, setDraft] = useState(null);
  const [payments, setPayments] = useState([]);
  const [editing, setEditing] = useState(null);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const heading = useRef(null);
  const formHeading = useRef(null);
  const form = useRef(null);
  const returnFocus = useRef(null);
  const mutation = useRef(null);
  const attempt = useRef(null);
  const current = response?.revision === revision ? response : null;
  const data = current?.data;
  const transactions = (data?.transactions || []).filter(row => [row.description, row.budget_item_label, row.activity_title,
    ...row.payments.map(payment => payment.legal_name)].some(value => value.toLocaleLowerCase('id-ID').includes(query.trim().toLocaleLowerCase('id-ID'))));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(transactions.length / 8) - 1));

  useEffect(() => {
    const controller = new AbortController();
    callProjectRpc(endpoint, token, 'transactions.list', project.project_id, controller.signal)
      .then(data => {if (!controller.signal.aborted) setResponse({revision, data});})
      .catch(failure => {
        if (controller.signal.aborted) return;
        if (failure.code === 'UNAUTHENTICATED') expire();
        else setResponse({revision, error: failure.message});
      });
    return () => controller.abort();
  }, [endpoint, token, expire, project.project_id, revision]);
  useEffect(() => () => mutation.current?.abort(), []);

  function open(transaction, button) {
    returnFocus.current = button;
    setError(''); setMessage('');
    setDraft(transaction ? Object.fromEntries(['budget_item_id', 'activity_id', 'payment_date', 'expense_kind', 'description'].map(field => [field, transaction[field]])) :
      {budget_item_id: '', activity_id: '', payment_date: '', expense_kind: 'HONOR', description: ''});
    setEditing(transaction ? {transaction_id: transaction.transaction_id, expected_row_version: transaction.row_version,
      expected_payment_versions: Object.fromEntries(transaction.payments.map(row => [row.payment_detail_id, row.row_version]))} : null);
    setPayments(transaction ? transaction.payments.map(row => ({key: crypto.randomUUID(), payment_detail_id: row.payment_detail_id,
      payee_id: row.payee_id, receipt_amount: String(row.receipt_amount), withheld_tax_amount: String(row.withheld_tax_amount)})) : [newPayment()]);
    requestAnimationFrame(() => formHeading.current?.focus());
  }

  function updatePayment(key, field, value) {
    setPayments(rows => rows.map(row => row.key === key ? {...row, [field]: value} : row));
  }

  async function save(event) {
    event.preventDefault();
    if (mutation.current) return;
    attempt.current ??= {id: crypto.randomUUID(), payload: {...(editing || {}), transaction: {...draft},
      payments: payments.map(({key, receipt_amount, withheld_tax_amount, ...row}) =>
        ({...row, receipt_amount: Number(receipt_amount), withheld_tax_amount: Number(withheld_tax_amount)}))}};
    const controller = new AbortController();
    mutation.current = controller; setPending(true); setError('');
    try {
      await callProjectRpc(endpoint, token, 'transactions.save', project.project_id, controller.signal, attempt.current.payload, attempt.current.id);
      if (controller.signal.aborted) return;
      attempt.current = null; setUncertain(false); setDraft(null); setEditing(null);
      setRevision(value => value + 1); setMessage('Draf transaksi tersimpan. Nilai dan potongan masih perlu diverifikasi pemilik.');
      heading.current?.focus();
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure.code === 'UNAUTHENTICATED') expire();
      else {
        setError(failure.code === 'CONFLICT' ? failure.message + ' Batalkan penyuntingan, muat ulang, lalu buka versi terbaru.' : failure.message);
        if (['VALIDATION_ERROR', 'CONFLICT', 'FORBIDDEN', 'NOT_FOUND'].includes(failure.code)) {attempt.current = null; setUncertain(false);}
        else setUncertain(true);
      }
    } finally {
      if (!controller.signal.aborted) {mutation.current = null; setPending(false);}
    }
  }

  return <section className={styles.workspace} aria-labelledby={id + '-heading'}>
    <div className={styles.actions}>
      <h3 id={id + '-heading'} ref={heading} tabIndex={-1}><ReceiptText size={18} aria-hidden="true" /> Transaksi proyek</h3>
      <button className={layout.secondary} type="button" disabled={pending || uncertain}
        onClick={() => setRevision(value => value + 1)}>Muat ulang transaksi</button>
    </div>
    <p className={styles.context}>{project.fiscal_year} · {project.title}</p>
    {!current && <p role="status">Memuat transaksi…</p>}
    {current?.error && <p className={styles.error} role="alert">{current.error}</p>}
    {message && <p role="status">{message}</p>}
    {data && <>
      <dl className={styles.summary}>
        <div><dt>Nilai kwitansi draf</dt><dd>{money(data.draft_total_amount)}</dd></div>
        <div><dt>Nilai kwitansi terkonfirmasi</dt><dd>{money(data.confirmed_total_amount)}</dd></div>
      </dl>
      <div className={styles.actions}>
        <label className={styles.field}>Cari transaksi<input type="search" value={query} maxLength={120}
          placeholder="Uraian, kegiatan, atau penerima" onChange={event => {setQuery(event.target.value); setPage(0);}} /></label>
        {data.can_create && <button className={layout.primary} type="button" disabled={Boolean(draft)}
          aria-expanded={Boolean(draft)} aria-controls={id + '-form'} onClick={event => open(null, event.currentTarget)}>
          <Plus size={16} aria-hidden="true" /> Tambah transaksi</button>}
      </div>
      {data.can_write && !data.can_create && <p>Sahkan RAB aktif sebelum membuat transaksi.</p>}
      {data.can_write && !data.payees.length && <p>Belum ada penerima pembayaran untuk proyek ini. Pemilik perlu menyiapkan data penerima.</p>}
      {!transactions.length ? <p role="status">{query ? 'Tidak ada transaksi yang cocok.' : 'Belum ada transaksi untuk proyek ini.'}</p> : <>
        <ul className={styles.transactions} aria-label="Daftar transaksi">
          {transactions.slice(currentPage * 8, currentPage * 8 + 8).map(row => <li key={row.transaction_id}>
            <div className={styles.actions}><h4>{row.description}</h4>
              {row.can_edit && <button className={layout.secondary} type="button" disabled={Boolean(draft)}
                aria-label={'Sunting transaksi ' + row.description} onClick={event => open(row, event.currentTarget)}>Sunting</button>}
            </div>
            <p>{date(row.payment_date)} · {kinds[row.expense_kind]} · {status[row.status]}</p>
            <p className={styles.context}>{row.budget_item_label || 'Item RAB tidak tersedia'} · RAB versi {row.budget_version_no || '—'}</p>
            <p className={styles.context}>{row.activity_title || 'Tanpa kegiatan terkait'}</p>
            <dl className={styles.summary}>
              <div><dt>Nilai kwitansi</dt><dd>{money(row.totals.receipt_amount)}</dd></div>
              <div><dt>Potongan</dt><dd>{money(row.totals.withheld_tax_amount)}</dd></div>
              <div><dt>Jumlah diterima</dt><dd>{money(row.totals.net_paid_amount)}</dd></div>
            </dl>
            <ul className={styles.payments} aria-label={'Pembayaran ' + row.description}>
              {row.payments.map(payment => <li key={payment.payment_detail_id}>
                <strong>{payment.legal_name}</strong><span>Kwitansi {money(payment.receipt_amount)} · Potongan {money(payment.withheld_tax_amount)} · Diterima {money(payment.net_paid_amount)}</span>
              </li>)}
            </ul>
          </li>)}
        </ul>
        <div className={styles.actions} aria-label="Halaman transaksi">
          <button className={layout.secondary} type="button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Transaksi sebelumnya</button>
          <span role="status">Halaman {currentPage + 1} dari {Math.ceil(transactions.length / 8)} · {transactions.length} transaksi</span>
          <button className={layout.secondary} type="button" disabled={(currentPage + 1) * 8 >= transactions.length} onClick={() => setPage(currentPage + 1)}>Transaksi berikutnya</button>
        </div>
      </>}
    </>}
    {draft && <form ref={form} id={id + '-form'} className={styles.form} onSubmit={save}>
      <h4 ref={formHeading} tabIndex={-1}>{editing ? 'Sunting draf transaksi' : 'Draf transaksi baru'}</h4>
      <fieldset disabled={pending || uncertain}><legend>Rincian transaksi</legend>
        <div className={styles.fields}>
          <div className={styles.field}><label htmlFor={id + '-budget'}>Item RAB</label><select id={id + '-budget'} required
            value={draft.budget_item_id} onChange={event => setDraft({...draft, budget_item_id: event.target.value})}>
            <option value="">Pilih item RAB</option>
            {(data?.budget_items || []).filter(row => row.is_current || row.budget_item_id === draft.budget_item_id).map(row =>
              <option key={row.budget_item_id} value={row.budget_item_id}>Versi {row.version_no} · {row.label}{row.is_current ? '' : ' (versi sebelumnya)'}</option>)}
          </select></div>
          <div className={styles.field}><label htmlFor={id + '-activity'}>Kegiatan terkait (opsional)</label><select id={id + '-activity'}
            value={draft.activity_id} onChange={event => setDraft({...draft, activity_id: event.target.value})}>
            <option value="">Tanpa kegiatan terkait</option>
            {(data?.activities || []).map(row => <option key={row.activity_id} value={row.activity_id}>{row.title}</option>)}
          </select></div>
          <div className={styles.field}><label htmlFor={id + '-date'}>Tanggal pembayaran</label><input id={id + '-date'} required type="date"
            value={draft.payment_date} onChange={event => setDraft({...draft, payment_date: event.target.value})} /></div>
          <div className={styles.field}><label htmlFor={id + '-kind'}>Jenis belanja</label><select id={id + '-kind'} value={draft.expense_kind}
            onChange={event => setDraft({...draft, expense_kind: event.target.value})}>
            {Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></div>
        </div>
        <div className={styles.field}><label htmlFor={id + '-description'}>Tujuan pembayaran</label><textarea id={id + '-description'} required rows={3} maxLength={1000}
          value={draft.description} onChange={event => setDraft({...draft, description: event.target.value})} /></div>
      </fieldset>
      <fieldset disabled={pending || uncertain}><legend>Pembayaran ke penerima</legend>
        <p>Isi rupiah utuh. Potongan adalah usulan yang perlu diverifikasi pemilik. Nilai pajak tambahan belum dicatat pada draf ini.</p>
        {payments.map((row, index) => <fieldset key={row.key}><legend>Penerima {index + 1}</legend>
          <div className={styles.fields}>
            <div className={styles.field}><label htmlFor={id + '-payee-' + row.key}>Penerima {index + 1}</label>
              <select id={id + '-payee-' + row.key} required value={row.payee_id} onChange={event => updatePayment(row.key, 'payee_id', event.target.value)}>
                <option value="">Pilih penerima</option>
                {(data?.payees || []).map(payee => <option key={payee.payee_id} value={payee.payee_id}>{payee.legal_name}</option>)}
              </select></div>
            <div className={styles.field}><label htmlFor={id + '-receipt-' + row.key}>Nilai kwitansi {index + 1} (Rp)</label>
              <input id={id + '-receipt-' + row.key} required type="number" min="1" max={Number.MAX_SAFE_INTEGER} step="1" value={row.receipt_amount}
                onChange={event => updatePayment(row.key, 'receipt_amount', event.target.value)} /></div>
            <div className={styles.field}><label htmlFor={id + '-tax-' + row.key}>Usulan potongan {index + 1} (Rp)</label>
              <input id={id + '-tax-' + row.key} required type="number" min="0" max={row.receipt_amount || Number.MAX_SAFE_INTEGER} step="1" value={row.withheld_tax_amount}
                onChange={event => updatePayment(row.key, 'withheld_tax_amount', event.target.value)} /></div>
          </div>
          <button className={layout.secondary} type="button" disabled={payments.length === 1} onClick={() => {
            setPayments(rows => rows.filter(payment => payment.key !== row.key));
            requestAnimationFrame(() => form.current?.querySelector('[data-add-payment]')?.focus());
          }}><Trash2 size={16} aria-hidden="true" /> Hapus penerima {index + 1}</button>
        </fieldset>)}
        <button data-add-payment className={layout.secondary} type="button" disabled={payments.length >= 30} onClick={() => setPayments(rows => [...rows, newPayment()])}>
          <Plus size={16} aria-hidden="true" /> Tambah penerima</button>
      </fieldset>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {uncertain && <p role="status">Hasil simpan belum diketahui. Coba kembali dengan isian dan request yang sama untuk mencegah duplikasi.</p>}
      <div className={styles.actions}>
        <button className={layout.primary} type="submit" disabled={pending}>{pending ? 'Menyimpan…' : uncertain ? 'Coba simpan transaksi kembali' : 'Simpan draf transaksi'}</button>
        <button className={layout.secondary} type="button" disabled={pending || uncertain} onClick={() => {
          setDraft(null); setEditing(null); setError(''); requestAnimationFrame(() => returnFocus.current?.isConnected ? returnFocus.current.focus() : heading.current?.focus());
        }}>Batal</button>
      </div>
    </form>}
  </section>;
}
