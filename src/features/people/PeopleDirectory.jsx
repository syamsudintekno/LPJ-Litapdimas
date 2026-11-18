import {useEffect, useState} from 'react';
import {Search} from 'lucide-react';
import {callProjectRpc} from '../../rpc.js';
import {PeopleImport} from './PeopleImport.jsx';
import layout from '../../Home.module.css';
import styles from './PeopleDirectory.module.css';

const kindLabels = {DOSEN: 'Dosen', PEGAWAI: 'Pegawai', MAHASISWA: 'Mahasiswa', EKSTERNAL: 'Pihak eksternal'};
const formatCount = new Intl.NumberFormat('id-ID');

export function PeopleDirectory({endpoint, token, expire, canImport}) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState({query: ''});
  const [result, setResult] = useState(null);
  const current = result?.search === search ? result : null;

  useEffect(() => {
    const controller = new AbortController();
    callProjectRpc(endpoint, token, 'people.search', undefined, controller.signal, search)
      .then(data => {
        if (!controller.signal.aborted) setResult({search, data});
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        if (error.code === 'UNAUTHENTICATED') expire();
        else setResult({search, error: error.message});
      });
    return () => controller.abort();
  }, [endpoint, token, expire, search]);

  return <section id="master-personel" tabIndex={-1} className={layout.panel} aria-labelledby="people-heading">
    <div className={layout.panelHeading}><h2 id="people-heading">Master Personel</h2></div>
    <form className={styles.searchForm} onSubmit={event => {
      event.preventDefault();
      setSearch({query: query.trim()});
    }}>
      <label>
        Nama atau unit
        <input type="search" maxLength={120} placeholder="Cari nama atau unit kerja" value={query}
          onChange={event => setQuery(event.target.value)} />
      </label>
      <button type="submit" className={layout.secondary}><Search size={16} aria-hidden="true" /> Cari</button>
    </form>
    <div aria-busy={!current}>
      {!current && <p className={layout.feedback} role="status">Memuat personel…</p>}
      {current?.error && <p className={layout.error} role="alert">{current.error}</p>}
      {current?.data && (current.data.people.length ? <>
        <p className={layout.count} role="status">
          {current.data.total > current.data.people.length
            ? `Menampilkan 50 dari ${formatCount.format(current.data.total)} personel. Persempit pencarian untuk melihat hasil lain.`
            : `${formatCount.format(current.data.total)} personel`}
        </p>
        <div className={styles.tableArea} role="region" aria-label="Hasil pencarian personel" tabIndex={0}>
          <table>
            <thead><tr><th scope="col">Nama</th><th scope="col">Kategori</th><th scope="col">Unit</th></tr></thead>
            <tbody>{current.data.people.map(person => <tr key={person.person_id}>
              <th scope="row">{person.display_name}</th>
              <td>{kindLabels[person.person_kind] ?? person.person_kind}</td>
              <td>{person.unit_name || '—'}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </> : <p className={layout.feedback} role="status">
        {search.query ? 'Tidak ada personel yang cocok.' : 'Belum ada personel aktif.'}
      </p>)}
    </div>
    {canImport && <PeopleImport endpoint={endpoint} token={token} expire={expire}
      onCommitted={() => setSearch(currentSearch => ({...currentSearch}))} />}
  </section>;
}
