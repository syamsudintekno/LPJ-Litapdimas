import {useEffect, useId, useRef, useState} from 'react';
import {callProjectRpc} from '../../rpc.js';
import layout from '../../Home.module.css';
import fields from '../transactions/TransactionWorkspace.module.css';
import styles from './TaxReview.module.css';

const money = value => new Intl.NumberFormat('id-ID', {style: 'currency', currency: 'IDR', maximumFractionDigits: 0}).format(value);
const reasons = {NO_MATCHING_RULE: 'Belum ada aturan yang cocok.', OVERLAPPING_RULES: 'Lebih dari satu aturan cocok. Pemilik perlu meninjau pilihan aturan.',
  PROFILE_INCOMPLETE: 'Golongan atau profil penerima honor belum lengkap.', CLASSIFICATION_REVIEW_REQUIRED: 'Klasifikasi dan bukti konsumsi/snack perlu ditinjau pemilik.'};

export function TaxReview({endpoint, token, expire, projectId, paymentId, disabled, onVerified}) {
  const [open, setOpen] = useState(false);
  const button = useRef(null);
  return <div className={styles.review}>
    <button ref={button} className={layout.secondary} type="button" disabled={disabled || open} aria-expanded={open}
      onClick={() => setOpen(true)}>Tinjau pajak</button>
    {open && <TaxReviewPanel endpoint={endpoint} token={token} expire={expire} projectId={projectId} paymentId={paymentId}
      onVerified={onVerified} onClose={() => {setOpen(false); requestAnimationFrame(() => button.current?.focus());}} />}
  </div>;
}

function TaxReviewPanel({endpoint, token, expire, projectId, paymentId, onVerified, onClose}) {
  const id = useId();
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState(null);
  const [draft, setDraft] = useState(null);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef(null);
  const mutation = useRef(null);
  const attempt = useRef(null);
  const current = response?.revision === revision ? response : null;
  const data = current?.data;

  useEffect(() => {
    const controller = new AbortController();
    callProjectRpc(endpoint, token, 'taxes.preview', projectId, controller.signal, {payment_detail_id: paymentId})
      .then(data => {
        if (controller.signal.aborted) return;
        setResponse({revision, data});
        const old = data.assessment;
        setDraft({tax_kind: old?.tax_kind || data.proposal.tax_kind || '',
          tax_rule_version_id: data.candidates.some(row => row.tax_rule_version_id === old?.tax_rule_version_id) ? old.tax_rule_version_id : data.proposal.tax_rule_version_id,
          tax_base_amount: String(old?.tax_base_amount ?? data.payment.receipt_amount), amount: String(old?.amount ?? data.proposal.amount ?? data.payment.withheld_tax_amount),
          status: old?.status === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : 'VERIFIED', evidence_attachment_id: old?.evidence_attachment_id || '',
          decision_source_ref: old?.decision_source_ref || data.proposal.source_ref || '', override_reason: ''});
        requestAnimationFrame(() => heading.current?.focus());
      }).catch(failure => {
        if (controller.signal.aborted) return;
        if (failure.code === 'UNAUTHENTICATED') expire();
        else setResponse({revision, error: failure.message});
      });
    return () => controller.abort();
  }, [endpoint, token, expire, projectId, paymentId, revision]);
  useEffect(() => () => mutation.current?.abort(), []);

  async function verify(event) {
    event.preventDefault();
    if (mutation.current) return;
    attempt.current ??= {id: crypto.randomUUID(), payload: {...draft, payment_detail_id: paymentId, preview_token: data.preview_token,
      expected_transaction_row_version: data.transaction.row_version, expected_payment_row_version: data.payment.row_version,
      expected_assessment_row_version: data.assessment?.row_version || 0, amount: Number(draft.amount), tax_base_amount: Number(draft.tax_base_amount)}};
    const controller = new AbortController();
    mutation.current = controller; setPending(true); setError('');
    try {
      const saved = await callProjectRpc(endpoint, token, 'taxes.verify', projectId, controller.signal, attempt.current.payload, attempt.current.id);
      if (controller.signal.aborted) return;
      attempt.current = null; setUncertain(false); onVerified(saved);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure.code === 'UNAUTHENTICATED') expire();
      else {
        setError(failure.message);
        if (['VALIDATION_ERROR', 'CONFLICT', 'FORBIDDEN', 'NOT_FOUND'].includes(failure.code)) {attempt.current = null; setUncertain(false);}
        else setUncertain(true);
      }
    } finally {
      if (!controller.signal.aborted) {mutation.current = null; setPending(false);}
    }
  }

  const update = (field, value) => setDraft(previous => ({...previous, [field]: value}));
  return <section className={styles.panel} aria-labelledby={id + '-heading'}>
    <div className={fields.actions}>
      <h5 id={id + '-heading'} ref={heading} tabIndex={-1}>Penilaian pajak pembayaran</h5>
      <button className={layout.secondary} type="button" disabled={pending || uncertain} onClick={() => {setError(''); setRevision(value => value + 1);}}>Muat ulang penilaian</button>
    </div>
    {!current && <p role="status">Memuat penilaian pajak…</p>}
    {current?.error && <p role="alert" className={fields.error}>{current.error}</p>}
    {data && <>
      <p>{data.payee_name} · Nilai kwitansi {money(data.payment.receipt_amount)}</p>
      {data.assessment && <p>Keputusan tercatat: {data.assessment.status === 'NOT_APPLICABLE' ? 'Tidak dikenai pajak' : data.assessment.status === 'VERIFIED' ? 'Diverifikasi pemilik' : 'Perlu verifikasi'}
        {' · ' + money(data.assessment.amount)}{data.needs_review && ' · Perlu ditinjau ulang'}</p>}
      {data.assessment?.decision_source_ref && <p>Referensi keputusan: {data.assessment.decision_source_ref}</p>}
      {data.assessment?.override_reason && <p>Alasan keputusan: {data.assessment.override_reason}</p>}
      <p className={styles.notice}>{data.proposal.amount === null ? 'Perlu verifikasi. ' + (reasons[data.proposal.reason] || 'Pemilik perlu meninjau pembayaran.') :
        'Usulan potongan berdasarkan aturan: ' + money(data.proposal.amount) + '. Keputusan tetap memerlukan verifikasi pemilik.'}</p>
      {data.candidates.length > 0 && <ul className={styles.rules} aria-label="Aturan yang cocok">
        {data.candidates.map(row => <li key={row.tax_rule_version_id}>
          <strong>{row.rule_code} · Versi {row.version_no} · {new Intl.NumberFormat('id-ID', {style: 'percent', maximumFractionDigits: 2}).format(row.rate_bps / 10000)}</strong>
          <p>{row.tax_kind} · {row.source_ref}</p>
        </li>)}
      </ul>}
      {data.can_verify && draft ? <form className={fields.form} onSubmit={verify}>
        <fieldset disabled={pending || uncertain}><legend>Keputusan pemilik</legend>
          <div className={fields.field}><label htmlFor={id + '-rule'}>Versi aturan</label>
            <select id={id + '-rule'} value={draft.tax_rule_version_id} onChange={event => update('tax_rule_version_id', event.target.value)}>
              <option value="">Keputusan manual dengan alasan</option>
              {data.candidates.map(row => <option key={row.tax_rule_version_id} value={row.tax_rule_version_id}>{row.rule_code} · Versi {row.version_no}</option>)}
            </select></div>
          <div className={fields.fields}>
            <div className={fields.field}><label htmlFor={id + '-kind'}>Jenis pajak</label><input id={id + '-kind'} required maxLength={40}
              value={draft.tax_kind} onChange={event => update('tax_kind', event.target.value)} /></div>
            <div className={fields.field}><label htmlFor={id + '-status'}>Perlakuan</label><select id={id + '-status'} value={draft.status}
              onChange={event => setDraft({...draft, status: event.target.value, amount: event.target.value === 'NOT_APPLICABLE' ? '0' : draft.amount})}>
              <option value="VERIFIED">Potongan diverifikasi</option><option value="NOT_APPLICABLE">Tidak dikenai pajak</option>
            </select></div>
            <div className={fields.field}><label htmlFor={id + '-base'}>Dasar pajak (Rp)</label><input id={id + '-base'} required type="number" min="0" max={data.payment.receipt_amount} step="1"
              value={draft.tax_base_amount} onChange={event => update('tax_base_amount', event.target.value)} /></div>
            <div className={fields.field}><label htmlFor={id + '-amount'}>Potongan ditetapkan (Rp)</label><input id={id + '-amount'} required type="number" min="0" max={draft.status === 'NOT_APPLICABLE' ? 0 : data.payment.receipt_amount} step="1"
              value={draft.amount} onChange={event => update('amount', event.target.value)} /></div>
          </div>
          <div className={fields.field}><label htmlFor={id + '-evidence'}>Bukti yang diperiksa</label><select id={id + '-evidence'} required value={draft.evidence_attachment_id}
            onChange={event => update('evidence_attachment_id', event.target.value)}>
            <option value="">Pilih bukti transaksi</option>
            {data.evidence.map(row => <option key={row.attachment_id} value={row.attachment_id} disabled={!row.available}>
              {row.name || row.attachment_kind}{row.available ? '' : ' · Tidak tersedia atau akses belum privat'}</option>)}
          </select></div>
          {data.evidence.some(row => row.attachment_id === draft.evidence_attachment_id && row.available) && <a className={styles.proof}
            href={'https://drive.google.com/file/d/' + encodeURIComponent(data.evidence.find(row => row.attachment_id === draft.evidence_attachment_id).drive_file_id) + '/view'} target="_blank" rel="noreferrer">Buka bukti terpilih di Drive</a>}
          <div className={fields.field}><label htmlFor={id + '-source'}>Referensi keputusan</label><input id={id + '-source'} required maxLength={1000}
            value={draft.decision_source_ref} onChange={event => update('decision_source_ref', event.target.value)} /></div>
          <div className={fields.field}><label htmlFor={id + '-reason'}>Alasan keputusan atau koreksi</label><textarea id={id + '-reason'} rows={3} maxLength={1000}
            value={draft.override_reason} onChange={event => update('override_reason', event.target.value)} /></div>
          <p>Keputusan manual, tidak dikenai pajak, perubahan usulan, dan koreksi keputusan sebelumnya wajib disertai alasan.</p>
        </fieldset>
        {error && <p role="alert" className={fields.error}>{error}</p>}
        {uncertain && <p role="status">Hasil simpan belum diketahui. Coba kembali dengan bukti, isian, dan request yang sama.</p>}
        <button className={layout.primary} type="submit" disabled={pending}>{pending ? 'Menyimpan…' : uncertain ? 'Coba verifikasi kembali' : 'Simpan verifikasi pajak'}</button>
      </form> : <p>Keputusan hanya dapat disimpan pemilik untuk pembayaran draf yang belum tertaut kwitansi, setoran, atau distribusi. Penilaian beberapa jenis pajak sekaligus belum didukung.</p>}
    </>}
    <button className={layout.secondary} type="button" disabled={pending || uncertain} onClick={onClose}>Tutup penilaian</button>
  </section>;
}
