import {useState} from 'react';
import {Pencil} from '../../components/ui/Icons.jsx';
import {ProjectWizard} from '../projects/ProjectWizard.jsx';
import {Feedback, useRemote} from './shared.jsx';
import layout from '../../Home.module.css';

export function ProjectEditor({api, onSaved}) {
  const [open, setOpen] = useState(false);
  return <div><button className={layout.secondary} disabled={open} onClick={() => setOpen(true)}><Pencil size={16} /> Sunting identitas, tim, dan tahap</button>
    {open && <Editor api={api} close={() => setOpen(false)} onSaved={id => {setOpen(false); onSaved(id);}} />}</div>;
}
function Editor({api, close, onSaved}) {
  const remote = useRemote(api, 'projects.edit_data');
  return <><Feedback remote={remote} />{remote.error && <button className={layout.secondary} onClick={close}>Tutup penyuntingan</button>}
    {remote.data && <ProjectWizard endpoint={api.endpoint} token={api.token} expire={api.expire} initial={remote.data} onClose={close} onSaved={onSaved} />}</>;
}
