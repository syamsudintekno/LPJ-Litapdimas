import {useState} from 'react';
import {ChevronLeft, ChevronRight, RefreshCw, Save, ShieldCheck} from '../../components/ui/Icons.jsx';
import {Feedback, useOperation, useRemote} from './shared.jsx';
import layout from '../../Home.module.css';
import styles from './Operations.module.css';

export function AdministrationWorkspace({api, personnel}) {
  const [offset, setOffset] = useState(0), remote = useRemote(api, 'audit.list', {offset}), op = useOperation(api);
  const [email, setEmail] = useState(''), [role, setRole] = useState('EDITOR'), [confirmed, setConfirmed] = useState(false);
  const [payee, setPayee] = useState({payee_kind: 'PERSON', person_id: '', legal_name: '', tax_profile_ref: ''});
  const data = remote.data, currentUser = data?.users.find(row => row.login_email.toLowerCase() === email.trim().toLowerCase());
  const member = currentUser && data?.members.find(row => row.user_id === currentUser.user_id);
  return <section className={styles.workspace} aria-label="Akses, audit, dan cadangan">
    <div className={styles.actions}><h3><ShieldCheck size={20} /> Akses, audit, dan cadangan</h3><button className={layout.secondary} disabled={op.locked} onClick={remote.refresh}><RefreshCw size={16} /> Muat ulang pengelolaan</button></div>
    <Feedback remote={remote} operation={op} />
    {data && <>
      <h4>Penerima pembayaran</h4><p>Daftarkan penerima agar tersedia pada formulir transaksi. Setelah tersimpan, muat ulang bagian Transaksi proyek.</p>
      <form className={styles.form} onSubmit={event => {event.preventDefault(); op.run('payees.save', payee, () => {setPayee({payee_kind: 'PERSON', person_id: '', legal_name: '', tax_profile_ref: ''}); remote.refresh();});}}>
        <fieldset disabled={op.locked}><legend>Tambah penerima</legend><label className={styles.field}>Jenis penerima<select value={payee.payee_kind} onChange={event => setPayee({...payee, payee_kind: event.target.value})}><option value="PERSON">Personel</option><option value="ORGANIZATION">Vendor/badan</option><option value="GROUP">Kelompok penerima</option></select></label>
          {payee.payee_kind === 'PERSON' && <label className={styles.field}>Personel proyek<select required value={payee.person_id} onChange={event => setPayee({...payee, person_id: event.target.value, legal_name: personnel.find(row => row.person_id === event.target.value)?.display_name || ''})}><option value="">Pilih personel</option>{[...new Map(personnel.map(row => [row.person_id, row])).values()].map(row => <option key={row.person_id} value={row.person_id}>{row.display_name}</option>)}</select></label>}
          <label className={styles.field}>Nama resmi penerima<input required maxLength={240} value={payee.legal_name} onChange={event => setPayee({...payee, legal_name: event.target.value})} /></label>
          <label className={styles.field}>Referensi profil pajak (opsional)<input maxLength={240} value={payee.tax_profile_ref} onChange={event => setPayee({...payee, tax_profile_ref: event.target.value})} /></label>
        </fieldset><button className={layout.primary} disabled={op.locked}><Save size={16} /> Simpan penerima</button>
      </form>
      <h4>Anggota peneliti</h4><p>Hanya undang anggota peneliti. PPK, Bendahara Pengeluaran dan mahasiswa tetap personel LPJ tanpa akun aplikasi. Perubahan akses berlaku pada permintaan berikutnya dan tidak membagikan Sheets/Drive secara langsung.</p>
      <ul className={styles.list}>{data.members.map(row => <li key={row.project_member_id}><strong>{data.users.find(user => user.user_id === row.user_id)?.login_email}</strong><span>{row.revoked_at ? 'Akses dicabut' : row.project_role}</span><button className={layout.secondary} disabled={op.locked} onClick={() => {setEmail(data.users.find(user => user.user_id === row.user_id)?.login_email || ''); setRole(row.revoked_at ? 'REVOKED' : row.project_role);}}><ShieldCheck size={16} /> Ubah akses</button></li>)}</ul>
      <form className={styles.form} onSubmit={event => {event.preventDefault(); op.run('access.save', {login_email: email, project_role: role, expected_row_version: member?.row_version || 0}, () => {setEmail(''); remote.refresh();});}}>
        <fieldset disabled={op.locked}><legend>Undang atau ubah peran</legend><label className={styles.field}>Email akun Google<input type="email" required maxLength={240} value={email} onChange={event => setEmail(event.target.value)} /></label><label className={styles.field}>Peran<select value={role} onChange={event => setRole(event.target.value)}><option value="EDITOR">Editor</option><option value="VIEWER">Baca saja</option><option value="REVOKED">Cabut akses</option></select></label></fieldset>
        <button className={layout.primary} disabled={op.locked}><Save size={16} /> Simpan hak akses</button>
      </form>
      <h4>Cadangan lengkap</h4><p>Cadangan menyalin spreadsheet workspace beserta bukti dan arsip seluruh proyek ke Drive privat. Pemulihan membuat spreadsheet dan berkas baru; workspace aktif tidak ditimpa.</p>
      <button className={layout.secondary} disabled={op.locked} onClick={() => op.run('backups.create', {}, () => remote.refresh())}><Save size={16} /> Buat cadangan lengkap</button>
      <label className={styles.check}><input type="checkbox" checked={confirmed} disabled={op.locked} onChange={event => setConfirmed(event.target.checked)} /> Saya memahami pemulihan membuat salinan baru. Pengaktifan salinan dilakukan pemilik melalui konfigurasi Apps Script.</label>
      <ul className={styles.list}>{data.backups.map(row => <li key={row.backup_id}><strong>{row.created_at}</strong><a href={'https://drive.google.com/drive/folders/' + row.folder_id} target="_blank" rel="noreferrer">Buka folder cadangan privat</a><button className={layout.secondary} disabled={op.locked || !confirmed} onClick={() => op.run('backups.restore', {backup_id: row.backup_id, confirm_restore: true})}><Save size={16} /> Pulihkan ke salinan baru</button></li>)}</ul>
      {op.result?.spreadsheet_url && <div role="status"><p>Salinan pemulihan tersedia. Untuk mengaktifkan: cadangkan konfigurasi, ganti SPREADSHEET_ID di Script Properties dengan ID salinan ini, lalu jalankan activateRecoveredWorkspace dari editor.</p><a href={op.result.spreadsheet_url} target="_blank" rel="noreferrer">Buka spreadsheet hasil pemulihan</a></div>}
      <h4>Jejak audit</h4><ul className={styles.list}>{data.audit.map(row => <li key={row.audit_id}><strong>{row.action}</strong><span>{row.occurred_at} · {data.users.find(user => user.user_id === row.user_id)?.login_email || row.user_id}</span><details><summary>Rincian perubahan</summary><pre className={styles.audit}>{row.change_summary}</pre></details></li>)}</ul>
      <nav className={styles.actions} aria-label="Halaman audit"><button className={layout.secondary} disabled={op.locked || offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}><ChevronLeft size={16} /> Sebelumnya</button><span>{Math.min(offset + 1, data.audit_count)}–{Math.min(offset + 25, data.audit_count)} dari {data.audit_count}</span><button className={layout.secondary} disabled={op.locked || offset + 25 >= data.audit_count} onClick={() => setOffset(offset + 25)}>Berikutnya <ChevronRight size={16} /></button></nav>
    </>}
  </section>;
}
