/* eslint-disable react/prop-types */
import { useEffect, useState } from 'react'
import { reelsApi, reelError } from '../../utils/reels'
import ReelPreview from './ReelPreview'
export default function ReelReports({ signal, run, busy }) {
  const [reports, setReports] = useState([]), [error, setError] = useState(''), [reasons, setReasons] = useState({})
  const load = async () => {
    try { const { data } = await reelsApi.get('/reports', { signal }); if (!signal.aborted) { setReports(data.items); setError('') } }
    catch (err) { if (!signal.aborted) setError(reelError(err)) }
  }
  useEffect(() => { load() }, [signal]) // eslint-disable-line react-hooks/exhaustive-deps
  return <section className="reel-library" aria-labelledby="reel-reports"><div className="mp-section-heading"><h2 id="reel-reports">Reported content</h2><button className="mp-button mp-button--secondary" onClick={load}>Refresh reports</button></div>{error && <p role="alert">{error}</p>}{!reports.length && <p>No open reports.</p>}{reports.map(report => report.reel && <article className="mp-card reels-stack" key={report._id}><h3>{report.reel.title}</h3><p>{report.reason.replaceAll('_', ' ')} · {report.details}</p><ReelPreview reel={report.reel} /><label className="mp-field">Removal reason<textarea className="mp-input" maxLength={1000} value={reasons[report._id] || ''} onChange={e => setReasons(old => ({ ...old, [report._id]: e.target.value }))} /></label><button className="mp-button mp-button--danger" disabled={busy || !reasons[report._id]?.trim()} onClick={() => run(async () => { await reelsApi.post(`/${report.reel.id}/moderate`, { version: report.reel.version, decision: 'remove', reason: reasons[report._id] }, { signal }); await load() })}>Remove reported reel</button></article>)}</section>
}
