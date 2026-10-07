import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import QnK from './QnK';
import {isAdmin,onAuthChange} from './services';
function App(){const [allowed,setAllowed]=useState(false);const [initialNow]=useState(Date.now);async function refresh(){setAllowed(await isAdmin());}useEffect(()=>{refresh();return onAuthChange(refresh);},[]);return <QnK adminAllowed={allowed} initialNow={initialNow} onAdminChange={refresh}/>;}
const root=document.getElementById('root');
if(root)createRoot(root).render(<App/>);
