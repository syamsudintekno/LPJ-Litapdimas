import {Check, Close, Plus, RefreshCw, Save, Trash2, Wallet} from '../../components/ui/Icons.jsx';
import {useEffect, useRef, useState} from 'react';
import {callProjectRpc} from '../../rpc.js';
import layout from '../../Home.module.css';
import styles from './BudgetWorkspace.module.css';

const currency = new Intl.NumberFormat('id-ID', {style: 'currency', currency: 'IDR', maximumFractionDigits: 0});
const number = new Intl.NumberFormat('id-ID', {maximumFractionDigits: 3});
const labels = {DRAFT: 'Draf', APPROVED: 'Disahkan', SUPERSEDED: 'Digantikan'};
const emptyItem = () => ({key: crypto.randomUUID(), label: '', volume: '1', frequency: '1', unit: '', unit_price_amount: ''});
const emptyCategory = () => ({key: crypto.randomUUID(), category_code: '', label: '', items: [emptyItem()]});

function copyCategories(version) {
  return version.categories.map(category => ({
    key: crypto.randomUUID(), category_code: category.category_code, label: category.label,
    items: category.items.map(item => ({
      key: crypto.randomUUID(), label: item.label, unit: item.unit, volume: String(item.volume), frequency: String(item.frequency),
      unit_price_amount: String(item.unit_price_amount),
    })),
  }));
}

function BudgetForm({categories, setCategories, save, close, pending}) {
  const heading = useRef(null);
  useEffect(() => { heading.current.focus(); }, []);
  const changeCategory = (key, change) => setCategories(current =>
    current.map(category => category.key === key ? change(category) : category));
  const itemCount = categories.reduce((sum, category) => sum + category.items.length, 0);

  function submit(event) {
    event.preventDefault();
    save({categories: categories.map(category => ({
      category_code: category.category_code.trim(), label: category.label.trim(),
      items: category.items.map(item => ({
        label: item.label.trim(), unit: item.unit.trim(), volume: Number(item.volume),
        frequency: Number(item.frequency), unit_price_amount: Number(item.unit_price_amount),
      })),
    }))});
  }

  return <form className={styles.form} onSubmit={submit}>
    <h4 ref={heading} tabIndex={-1}><Wallet size={20} /> Susun versi RAB baru</h4>
    {categories.map((category, categoryIndex) => <fieldset key={category.key} disabled={pending}>
      <legend>Kategori {categoryIndex + 1}</legend>
      <div className={styles.fields}>
        {[['category_code', 'Kode kategori', 40], ['label', 'Nama kategori', 120]].map(([field, label, maxLength]) =>
          <label key={field}>{label}<input required maxLength={maxLength} value={category[field]}
            onChange={event => changeCategory(category.key, current => ({...current, [field]: event.target.value}))} /></label>)}
      </div>
      {category.items.map((item, itemIndex) => <fieldset key={item.key} className={styles.item}>
        <legend>Item {itemIndex + 1}</legend>
        <div className={styles.fields}>
          {[
            ['label', 'Uraian', {maxLength: 240}], ['volume', 'Volume', {type: 'number', min: 0.001, step: 0.001}],
            ['frequency', 'Frekuensi', {type: 'number', min: 1, step: 1}], ['unit', 'Satuan', {maxLength: 40}],
            ['unit_price_amount', 'Harga satuan (Rp)', {type: 'number', min: 0, step: 1, max: Number.MAX_SAFE_INTEGER}],
          ].map(([field, label, properties]) => <label key={field}>{label}
            <input required {...properties} value={item[field]} onChange={event => changeCategory(category.key, current => ({
              ...current, items: current.items.map(row => row.key === item.key ? {...row, [field]: event.target.value} : row),
            }))} />
          </label>)}
        </div>
        {category.items.length > 1 && <button type="button" className={layout.secondary}
          onClick={() => changeCategory(category.key, current => ({...current, items: current.items.filter(row => row.key !== item.key)}))}><Trash2 size={16} /> Hapus item {itemIndex + 1}</button>}
      </fieldset>)}
      <div className={styles.actions}>
        <button type="button" className={layout.secondary} disabled={itemCount >= 200}
          onClick={() => changeCategory(category.key, current => ({...current, items: [...current.items, emptyItem()]}))}><Plus size={16} /> Tambah item</button>
        {categories.length > 1 && <button type="button" className={layout.secondary}
          onClick={() => setCategories(current => current.filter(row => row.key !== category.key))}><Trash2 size={16} /> Hapus kategori {categoryIndex + 1}</button>}
      </div>
    </fieldset>)}
    <div className={styles.actions}>
      <button type="button" className={layout.secondary} disabled={pending || categories.length >= 30 || itemCount >= 200}
        onClick={() => setCategories(current => [...current, emptyCategory()])}><Plus size={16} /> Tambah kategori</button>
      <button type="button" className={layout.secondary} disabled={pending} onClick={close}><Close size={16} /> Tutup editor</button>
      <button type="submit" className={layout.primary} disabled={pending}><Save size={16} /> Simpan versi draf</button>
    </div>
  </form>;
}

export function BudgetWorkspace({endpoint, token, expire, projectId, role}) {
  const [selection, setSelection] = useState({id: ''});
  const [result, setResult] = useState(null);
  const [categories, setCategories] = useState(null);
  const [confirmedVersion, setConfirmedVersion] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const mutation = useRef(null);
  const retry = useRef(null);
  const current = result?.selection === selection ? result : null;
  const data = current?.data;
  const selected = data?.selected_version;
  const canEdit = data?.can_write && (role === 'OWNER' || role === 'EDITOR');

  useEffect(() => {
    const controller = new AbortController();
    const payload = selection.id ? {budget_version_id: selection.id} : undefined;
    callProjectRpc(endpoint, token, 'budgets.list_versions', projectId, controller.signal, payload)
      .then(data => {
        if (!controller.signal.aborted) setResult({selection, data});
      })
      .catch(failure => {
        if (controller.signal.aborted) return;
        if (failure.code === 'UNAUTHENTICATED') expire();
        else setResult({selection, error: failure.message});
      });
    return () => controller.abort();
  }, [endpoint, token, expire, projectId, selection]);

  useEffect(() => () => mutation.current?.abort(), []);

  async function submit(action, payload) {
    if (mutation.current) return;
    const controller = new AbortController();
    mutation.current = controller;
    const key = JSON.stringify([action, payload]);
    if (retry.current?.key !== key) retry.current = {key, id: crypto.randomUUID()};
    setPending(true);
    setError('');
    setMessage('');
    try {
      const saved = await callProjectRpc(endpoint, token, action, projectId, controller.signal, payload, retry.current.id);
      if (controller.signal.aborted) return;
      retry.current = null;
      setCategories(null);
      setConfirmedVersion('');
      setSelection({id: saved.budget_version_id});
      setMessage('Versi ' + saved.version_no + (saved.status === 'APPROVED' ? ' disahkan.' : ' tersimpan sebagai draf.'));
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure.code === 'UNAUTHENTICATED') expire();
      else setError(failure.message);
    } finally {
      if (!controller.signal.aborted) {
        mutation.current = null;
        setPending(false);
      }
    }
  }

  return <section className={styles.budget} aria-labelledby="budget-heading">
    <div className={styles.actions}>
      <h3 id="budget-heading"><Wallet size={20} /> Rencana Anggaran Biaya</h3>
      <button className={layout.secondary} type="button" disabled={!current || pending}
        onClick={() => {setError(''); setConfirmedVersion(''); setSelection({id: selection.id});}}><RefreshCw size={16} /> Muat ulang RAB</button>
    </div>
    {!current && <p role="status">Memuat versi RAB…</p>}
    {current?.error && <p role="alert" className={styles.error}>{current.error}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {message && <p role="status">{message}</p>}
    {data && <>
      <dl className={styles.summary}>
        <div><dt>Plafon resmi</dt><dd>{data.official_ceiling_amount === null ? '—' : currency.format(data.official_ceiling_amount)}</dd></div>
        <div><dt>Total rincian</dt><dd>{selected ? currency.format(selected.detail_total_amount) : '—'}</dd></div>
        <div><dt>Selisih plafon dan rincian</dt><dd>{selected && selected.difference_amount !== null ? currency.format(selected.difference_amount) : '—'}</dd></div>
      </dl>
      {selected ? <>
        <label className={styles.version}>Riwayat versi
          <select disabled={pending || Boolean(categories)} value={selected.budget_version_id}
            onChange={event => {
              setConfirmedVersion('');
              setError('');
              setMessage('');
              setSelection({id: event.target.value});
            }}>
            {data.versions.map(version => <option key={version.budget_version_id} value={version.budget_version_id}>
              Versi {version.version_no} · {labels[version.status]}
            </option>)}
          </select>
        </label>
        {selected.approved_at && <p>Disahkan pada {new Intl.DateTimeFormat('id-ID', {dateStyle: 'long', timeZone: 'Asia/Jakarta'}).format(new Date(selected.approved_at))}</p>}
        {selected.categories.map(category => <div key={category.budget_category_id} className={styles.tableArea} role="region"
          aria-label={category.label} tabIndex={0}>
          <table>
            <caption>{category.category_code} · {category.label}</caption>
            <thead><tr><th scope="col">Uraian</th><th scope="col">Volume</th><th scope="col">Frekuensi</th><th scope="col">Satuan</th>
              <th scope="col">Harga satuan</th><th scope="col">Jumlah</th></tr></thead>
            <tbody>{category.items.map(item => <tr key={item.budget_item_id}>
              <th scope="row">{item.label}</th><td>{number.format(item.volume)}</td><td>{number.format(item.frequency)}</td>
              <td>{item.unit}</td><td>{currency.format(item.unit_price_amount)}</td><td>{currency.format(item.line_amount)}</td>
            </tr>)}</tbody>
          </table>
        </div>)}
      </> : <p>Belum ada versi RAB untuk proyek ini.</p>}
      {canEdit && !categories && <div className={styles.actions}>
        <button className={layout.primary} type="button" disabled={pending}
          onClick={() => {setError(''); setConfirmedVersion(''); setCategories(selected ? copyCategories(selected) : [emptyCategory()]);}}>
          <Plus size={16} /> {selected ? 'Buat revisi dari versi ini' : 'Buat draf RAB'}
        </button>
        {role === 'OWNER' && selected?.status === 'DRAFT' && (confirmedVersion === selected.budget_version_id ? <>
          <span>{data.active_budget_version_id ? 'RAB aktif sebelumnya akan digantikan.' : 'Versi ini akan menjadi RAB aktif.'}</span>
          <button className={layout.primary} type="button" disabled={pending} onClick={() => submit('budgets.approve_version', {
            budget_version_id: selected.budget_version_id, expected_row_version: selected.row_version,
            expected_project_row_version: data.project_row_version,
          })}><Check size={16} /> Konfirmasi pengesahan</button>
          <button className={layout.secondary} type="button" disabled={pending} onClick={() => setConfirmedVersion('')}><Close size={16} /> Batal</button>
        </> : <button className={layout.secondary} type="button" disabled={pending}
          onClick={() => setConfirmedVersion(selected.budget_version_id)}><Check size={16} /> Sahkan versi ini</button>)}
      </div>}
      {!data.can_write && role !== 'VIEWER' && <p>RAB dapat diusulkan untuk proyek draf atau aktif yang memiliki plafon resmi.</p>}
    </>}
    {categories && <BudgetForm categories={categories} setCategories={setCategories} pending={pending}
      save={payload => submit('budgets.save_version', payload)} close={() => {setCategories(null); setError('');}} />}
    {pending && <p role="status">Menyimpan versi RAB…</p>}
  </section>;
}
