import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { reelsApi, reelError, mediaUrl } from '../utils/reels'
import ReelPlayer from '../components/reels/ReelPlayer'
import ReelDialog from '../components/reels/ReelDialog'
import '../components/reels/reels.css'

export default function Reels() {
  const { isAuth, user, role, loader } = useAuth()
  if (loader) return <main className="mp-page" role="status">Loading your account…</main>
  if (!isAuth) return <main className="mp-page"><h1 className="mp-title">Doctor Reels</h1><p className="mp-lead">Sign in to discover educational videos from verified doctors.</p><Link className="mp-button mp-button--primary" to={"/login?returnTo=" + encodeURIComponent("/reels" + window.location.search)}>Sign in</Link></main>
  return <ReelFeed key={`${role}:${user?._id || user?.id}`} doctor={role === 'doctor'} />
}

/* eslint-disable react/prop-types */
function ReelFeed({ doctor }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const sharedReel = searchParams.get('reel') || ''
  const [controller] = useState(() => new AbortController()), [items, setItems] = useState([])
  const [mode, setMode] = useState('for-you'), [query, setQuery] = useState(''), [search, setSearch] = useState(''), [topic, setTopic] = useState('')
  const [cursor, setCursor] = useState(null), [active, setActive] = useState(null), [muted, setMuted] = useState(true)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [dialog, setDialog] = useState(null), [pending, setPending] = useState({})
  const [preferences, setPreferences] = useState(null)
  const feed = useRef(null), generation = useRef(0)
  useEffect(() => () => controller.abort(), [controller])
  useEffect(() => { reelsApi.get('/preferences', { signal: controller.signal }).then(({ data }) => setPreferences(data)).catch(() => {}) }, [controller])
  const load = async (next, currentGeneration = generation.current) => {
    setBusy(true); setError('')
    try {
      const { data } = await reelsApi.get('/feed', { params: { mode: mode === 'saved' ? 'for-you' : mode, saved: mode === 'saved' ? true : undefined, reelId: sharedReel || undefined, q: search || undefined, topic: topic || undefined, cursor: next || undefined }, signal: controller.signal })
      if (!controller.signal.aborted && generation.current === currentGeneration) {
        setItems(old => next ? [...old, ...data.items.filter(item => !old.some(existing => existing.id === item.id))] : data.items)
        setCursor(data.nextCursor)
      }
    } catch (err) { if (!controller.signal.aborted && generation.current === currentGeneration) setError(reelError(err)) }
    finally { if (!controller.signal.aborted && generation.current === currentGeneration) setBusy(false) }
  }
  useEffect(() => {
    generation.current++; setItems([]); setCursor(null); setActive(null); feed.current?.scrollTo(0, 0); load(null, generation.current)
    // Filters define a new feed generation, preserving account cancellation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, search, topic, sharedReel])
  useEffect(() => {
    const ratios = new Map()
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) ratios.set(entry.target.closest('[data-reel]').dataset.reel, entry.isIntersecting ? entry.intersectionRatio : 0)
      const visible = [...ratios.entries()].sort((a, b) => b[1] - a[1])[0]
      setActive(visible && visible[1] >= .55 ? visible[0] : null)
    }, { threshold: [0, .25, .55, .75, 1] })
    feed.current?.querySelectorAll('[data-reel] video').forEach(node => observer.observe(node))
    return () => observer.disconnect()
  }, [items])
  const action = async (key, operation) => {
    if (pending[key]) return
    setPending(old => ({ ...old, [key]: true })); setError('')
    try { await operation() } catch (err) { if (!controller.signal.aborted) setError(reelError(err)) }
    finally { if (!controller.signal.aborted) setPending(old => ({ ...old, [key]: false })) }
  }
  const reaction = (reel, kind) => action(`${reel.id}-${kind}`, async () => {
    const { data } = await reelsApi.post(`/${reel.id}/reactions`, { kind, active: !reel[kind === 'like' ? 'liked' : 'saved'] }, { signal: controller.signal })
    if (!controller.signal.aborted) setItems(old => old.map(item => item.id === reel.id ? { ...item, [kind === 'like' ? 'liked' : 'saved']: data.active, counts: data.counts } : item))
  })
  const preference = payload => action('preferences', async () => {
    await reelsApi.post('/preferences', { personalizationEnabled: preferences?.personalizationEnabled ?? false, ...payload }, { signal: controller.signal })
    if (!controller.signal.aborted) { setPreferences(old => ({ ...old, ...payload })); generation.current++; await load(null, generation.current) }
  })
  return <main className="mp-page reels-page"><div className="mp-section-heading"><div><p className="mp-eyebrow">MediPulse Connect</p><h1>Doctor Reels</h1><p>Useful health knowledge, one short video at a time.</p></div>{doctor && <Link className="mp-button mp-button--primary" to="/doctor/reels">Open studio</Link>}</div><div className="reels-toolbar"><nav className="reel-actions" aria-label="Reel feeds">{[['for-you', 'For You'], ['following', 'Following'], ['explore', 'Explore'], ['saved', 'Saved']].map(([value, label]) => <button key={value} className={`mp-button mp-button--${mode === value ? 'primary' : 'secondary'}`} aria-pressed={mode === value} onClick={() => { setMode(value); if (sharedReel) setSearchParams({}) }}>{label}</button>)}</nav><form onSubmit={event => { event.preventDefault(); setSearch(query) }}><input className="mp-input" aria-label="Search reels" placeholder="Search health topics" value={query} onChange={event => setQuery(event.target.value)} maxLength={100} /><button className="mp-button mp-button--secondary">Search</button></form></div>{error && <p className="mp-banner" role="alert">{error} <button onClick={() => load(cursor)}>Retry</button></p>}<div className="reels-layout"><div ref={feed} className="reels-feed" tabIndex={0} aria-label="Video feed. Scroll to browse reels.">{items.map(reel => <article key={reel.id} data-reel={reel.id} className="reel-card"><ReelPlayer reel={reel} active={active === String(reel.id) && !dialog} muted={muted} signal={controller.signal} /><div className="reel-doctor">{reel.doctor.photo && <img src={mediaUrl(reel.doctor.photo)} alt="" />}<div><Link to={`/doctorsProfile/${reel.doctor.id}`}>{reel.doctor.name}</Link><small>Verified doctor · {reel.doctor.specialty}</small></div><button className="mp-button mp-button--secondary" disabled={pending[`follow-${reel.doctor.id}`]} onClick={() => action(`follow-${reel.doctor.id}`, async () => { const { data } = await reelsApi.post(`/doctors/${reel.doctor.id}/follow`, { active: !reel.following }, { signal: controller.signal }); if (!controller.signal.aborted) setItems(old => old.map(item => item.doctor.id === reel.doctor.id ? { ...item, following: data.active } : item)) })}>{reel.following ? 'Following' : 'Follow'}</button></div><h2 className="reel-title">{reel.title}</h2><p className="reel-caption">{reel.caption}</p><p className="reels-note">{reel.topics?.join(' · ')} {reel.language && `· ${reel.language}`}</p><div className="reel-actions"><button className="mp-button mp-button--secondary" aria-pressed={reel.liked} disabled={pending[`${reel.id}-like`]} onClick={() => reaction(reel, 'like')}>Like · {reel.counts?.likes || 0}</button><button className="mp-button mp-button--secondary" aria-pressed={reel.saved} disabled={pending[`${reel.id}-save`]} onClick={() => reaction(reel, 'save')}>{reel.saved ? 'Saved' : 'Save'} · {reel.counts?.saves || 0}</button><button className="mp-button mp-button--secondary" onClick={() => setDialog({ reel, kind: 'comments' })}>Comments · {reel.counts?.comments || 0}</button><button className="mp-button mp-button--secondary" onClick={() => action(`share-${reel.id}`, async () => { const url = `${window.location.origin}/reels?reel=${encodeURIComponent(reel.id)}`; if (navigator.share) await navigator.share({ title: reel.title, text: `${reel.title} — ${reel.doctor.name}`, url }); else { await navigator.clipboard.writeText(`${reel.title} — ${url}`); } window.dispatchEvent(new CustomEvent('medipulse:reel-share', { detail: reel.id })) })}>Share</button><button className="mp-button mp-button--ghost" onClick={() => setDialog({ reel, kind: 'report' })}>Report</button><Link className="mp-button mp-button--ghost" to={`/appointment/book/${reel.doctor.id}`}>Book appointment</Link></div></article>)}{busy && <p className="mp-card" role="status">Loading reels…</p>}{!busy && !items.length && <div className="mp-empty"><h2>{mode === 'following' ? 'Follow doctors to build your feed' : 'No reels to show yet'}</h2><p>Try another topic or explore the latest published videos.</p></div>}{cursor && <button className="mp-button mp-button--secondary" disabled={busy} onClick={() => load(cursor)}>Load more reels</button>}</div><aside className="reels-stack"><section className="mp-card"><h2>Learn with care</h2><p className="reels-note">Educational content only. Reels do not replace a consultation, diagnosis or emergency care. Please keep patient information out of comments.</p><button className="mp-button mp-button--secondary" aria-pressed={!muted} onClick={() => setMuted(value => !value)}>{muted ? 'Enable sound' : 'Mute videos'}</button></section><section className="mp-card reels-stack"><h2>Your discovery settings</h2><label className="mp-field">Filter by topic<input className="mp-input" value={topic} maxLength={60} onChange={event => setTopic(event.target.value)} placeholder="e.g. heart health" /></label>{preferences && <><label className="reel-attestation"><input type="checkbox" checked={preferences.personalizationEnabled} disabled={pending.preferences} onChange={event => preference({ personalizationEnabled: event.target.checked })} />Use my viewing activity to personalize For You</label><button className="mp-button mp-button--secondary" disabled={pending.preferences} onClick={() => preference({ resetHistory: true })}>Reset viewing history</button></>}</section></aside></div>{dialog && <ReelDialog key={`${dialog.reel.id}-${dialog.kind}`} {...dialog} signal={controller.signal} close={() => setDialog(null)} />}</main>
}
