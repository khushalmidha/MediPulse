import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { reelsApi, reelError, reelKey, reelTopics } from '../utils/reels'
import '../components/reels/reels.css'
import ReelPreview from '../components/reels/ReelPreview'
import ReelReports from '../components/reels/ReelReports'

const blank = { title: '', caption: '', topics: '', language: 'en', thumbnailSeconds: 0 }
export default function ReelStudio() {
  const { user, role, isAuth, loader } = useAuth()
  if (loader) return <main className="mp-page" role="status">Loading your account…</main>
  if (!isAuth) return <main className="mp-page"><h1 className="mp-title">Doctor studio</h1><Link className="mp-button mp-button--primary" to="/login?returnTo=%2Fdoctor%2Freels">Sign in as a doctor</Link></main>
  if (role !== 'doctor') return <main className="mp-page"><h1 className="mp-title">Doctor studio</h1><p>Publishing is available to verified doctor accounts.</p><Link to="/reels">Browse reels</Link></main>
  return <Studio key={user?._id || user?.id} />
}

function Studio() {
  const [controller] = useState(() => new AbortController())
  const [items, setItems] = useState([]), [reviews, setReviews] = useState([]), [canReview, setCanReview] = useState(false)
  const [form, setForm] = useState(blank), [editing, setEditing] = useState(null)
  const [file, setFile] = useState(null), [preview, setPreview] = useState(''), [duration, setDuration] = useState(0)
  const [attested, setAttested] = useState(false), [educational, setEducational] = useState(false)
  const [recording, setRecording] = useState(false), [elapsed, setElapsed] = useState(0), [cameraReady, setCameraReady] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [progress, setProgress] = useState(null)
  const [reviewReasons, setReviewReasons] = useState({})
  const camera = useRef(null), stream = useRef(null), recorder = useRef(null), timer = useRef(null), chunks = useRef([]), recordedDuration = useRef(0), recordingStarted = useRef(0), createKey = useRef(reelKey()), uploadKey = useRef(reelKey()), draft = useRef(null)
  const stopCamera = () => { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; setCameraReady(false) }
  useEffect(() => () => {
    controller.abort(); window.clearInterval(timer.current)
    if (recorder.current?.state === 'recording') recorder.current.stop()
    stream.current?.getTracks().forEach(track => track.stop())
  }, [controller])
  useEffect(() => {
    if (!file) { setPreview(''); setDuration(0); return }
    const url = URL.createObjectURL(file); setPreview(url); setDuration(0)
    return () => URL.revokeObjectURL(url)
  }, [file])
  const refresh = async () => {
    const { data } = await reelsApi.get('/mine', { signal: controller.signal })
    if (controller.signal.aborted) return
    setItems(data.items); setCanReview(Boolean(data.canReview))
    if (data.canReview) { const queue = await reelsApi.get('/moderation', { signal: controller.signal }); if (!controller.signal.aborted) setReviews(queue.data.items) }
  }
  useEffect(() => {
    refresh().catch(err => { if (!controller.signal.aborted) setError(reelError(err)) })
    const interval = window.setInterval(() => refresh().catch(() => {}), 15000)
    return () => window.clearInterval(interval)
    // Refresh is scoped to the mounted account session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const run = async operation => {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try { await operation(); if (!controller.signal.aborted) await refresh() }
    catch (err) { if (!controller.signal.aborted) setError(reelError(err)) }
    finally { if (!controller.signal.aborted) { setBusy(false); setProgress(null) } }
  }
  const chooseFile = (next, capturedDuration = 0) => {
    if (!next) return
    if (!['video/webm', 'video/mp4'].includes(next.type.split(';')[0])) { setError('Choose an MP4 or WebM video.'); return }
    if (next.size > 200 * 1024 * 1024) { setError('Choose a video smaller than 200 MB.'); return }
    setError(''); recordedDuration.current = capturedDuration; setFile(next); uploadKey.current = reelKey()
  }
  const openCamera = async () => {
    setError('')
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Camera recording requires a supported browser and a secure connection. You can upload an MP4 or WebM instead.')
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true })
      if (controller.signal.aborted) { stream.current.getTracks().forEach(track => track.stop()); return }
      setCameraReady(true)
      if (camera.current) { camera.current.srcObject = stream.current; camera.current.play().catch(() => {}) }
    } catch (err) { setError(reelError(err)) }
  }
  const startRecording = () => {
    try {
      const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type))
      if (!mimeType) throw new Error('Recording is unavailable in this browser. Upload an MP4 or WebM instead.')
      chunks.current = []; recorder.current = new MediaRecorder(stream.current, { mimeType })
      recorder.current.ondataavailable = event => { if (event.data.size) chunks.current.push(event.data) }
      recorder.current.onstop = () => {
        window.clearInterval(timer.current)
        if (!controller.signal.aborted) {
          chooseFile(new File(chunks.current, `doctor-reel.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`, { type: mimeType.split(';')[0] }), (performance.now() - recordingStarted.current) / 1000)
          setRecording(false); stopCamera()
        }
      }
      recorder.current.onerror = () => { setError('Recording failed. Please try again.'); window.clearInterval(timer.current); setRecording(false); stopCamera() }
      recordingStarted.current = performance.now(); recorder.current.start(1000); setRecording(true); setElapsed(0)
      const started = performance.now()
      timer.current = window.setInterval(() => { const seconds = Math.floor((performance.now() - started) / 1000); setElapsed(seconds); if (seconds >= 299 && recorder.current.state === 'recording') recorder.current.stop() }, 250)
    } catch (err) { setError(reelError(err)); stopCamera() }
  }
  const reset = () => { setForm(blank); setEditing(null); setFile(null); setAttested(false); setEducational(false); draft.current = null; createKey.current = reelKey(); uploadKey.current = reelKey(); setNotice('') }
  const save = event => {
    event.preventDefault()
    run(async () => {
      const metadata = { ...form, thumbnailSeconds: Number(form.thumbnailSeconds), topics: reelTopics(form.topics) }
      if (metadata.topics.some(topic => topic.length > 40)) throw new Error('Each topic must be 40 characters or fewer.')
      if (editing) {
        await reelsApi.patch(`/${editing.id}`, { ...metadata, version: editing.version }, { signal: controller.signal })
        reset(); setNotice('Metadata saved. Published edits require a new medical review.'); return
      }
      if (!file || !Number.isFinite(duration) || duration <= 0 || duration > 300) throw new Error('Choose a playable video up to five minutes long before uploading.')
      if (!attested || !educational) throw new Error('Confirm both content attestations before uploading.')
      if (!draft.current) {
        const { data } = await reelsApi.post('/', { ...metadata, privacyConfirmed: true, educationalOnly: true, idempotencyKey: createKey.current }, { signal: controller.signal })
        draft.current = data.reel
      }
      await reelsApi.put(`/${draft.current.id}/upload`, file, { signal: controller.signal, headers: { 'Content-Type': file.type, 'Idempotency-Key': uploadKey.current }, onUploadProgress: event => { if (!controller.signal.aborted && event.total) setProgress(Math.round(event.loaded / event.total * 100)) } })
      reset(); setNotice('Upload received. Processing and medical review must finish before publication.')
    })
  }
  const edit = reel => { reset(); setEditing(reel); setForm({ title: reel.title || '', caption: reel.caption || '', topics: (reel.topics || []).join(', '), language: reel.language || 'en', thumbnailSeconds: reel.thumbnailSeconds || 0 }); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  return <main className="mp-page reels-page"><div className="mp-section-heading"><div><p className="mp-eyebrow">Verified doctor workspace</p><h1>Reel studio</h1><p>Record, upload and prepare educational content for independent review.</p></div><Link className="mp-button mp-button--secondary" to="/reels">Browse reels</Link></div><p className="mp-banner mp-banner--info">No patient names, faces, records or identifiable clinical details. Educational videos only, up to five minutes. Submitting a reel requests medical moderation; it does not publish it.</p>{error && <p role="alert" className="mp-banner">{error}</p>}{notice && <p role="status" className="mp-banner mp-banner--info">{notice}</p>}<div className="reel-studio-grid"><section className="mp-card"><h2>{editing ? 'Edit reel metadata' : 'Create an educational reel'}</h2><form onSubmit={save}><fieldset className="mp-form-grid" disabled={busy}><label className="mp-field">Title<input className="mp-input" required maxLength={120} value={form.title} onChange={event => setForm(old => ({ ...old, title: event.target.value }))} /></label><label className="mp-field">Caption<textarea className="mp-input" maxLength={2000} value={form.caption} onChange={event => setForm(old => ({ ...old, caption: event.target.value }))} /></label><label className="mp-field">Topics, separated by commas<input className="mp-input" maxLength={400} value={form.topics} placeholder="Nutrition, prevention" onChange={event => setForm(old => ({ ...old, topics: event.target.value }))} /></label><label className="mp-field">Language<select className="mp-input" value={form.language} onChange={event => setForm(old => ({ ...old, language: event.target.value }))}>{[["en", "English"], ["hi", "Hindi"], ["pa", "Punjabi"], ["bn", "Bengali"], ["ta", "Tamil"], ["te", "Telugu"], ["mr", "Marathi"], ["gu", "Gujarati"], ["kn", "Kannada"], ["ml", "Malayalam"], ["ur", "Urdu"]].map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label><label className="mp-field">Thumbnail frame (seconds)<input className="mp-input" type="number" min="0" max={duration || editing?.duration || 300} step="0.1" value={form.thumbnailSeconds} onChange={event => setForm(old => ({ ...old, thumbnailSeconds: event.target.value }))} /></label>{!editing && <><label className="reel-attestation"><input required type="checkbox" checked={attested} onChange={event => setAttested(event.target.checked)} />I confirm this video contains no identifiable patient information and I have rights to all included media.</label><label className="reel-attestation"><input required type="checkbox" checked={educational} onChange={event => setEducational(event.target.checked)} />This content is educational, accurate to the best of my knowledge, and does not give individualized medical advice.</label></>}<div className="reel-actions"><button className="mp-button mp-button--primary" disabled={busy || recording || (!editing && !file)}>{busy ? progress == null ? 'Saving…' : `Uploading ${progress}%` : editing ? 'Save metadata' : draft.current ? 'Retry upload' : 'Upload draft'}</button>{editing && <button type="button" className="mp-button mp-button--secondary" disabled={busy} onClick={reset}>Cancel edit</button>}</div>{editing && <p className="reels-note">You are editing metadata only. Changes to a published reel return it to review.</p>}</fieldset></form></section><section className="mp-card reels-stack"><h2>{editing ? 'Current video' : 'Record or upload'}</h2>{editing ? <ReelPreview key={editing.id} reel={editing} /> : <><video ref={camera} hidden={!cameraReady} className="reel-preview" playsInline muted aria-label="Live camera preview" />{preview && <video key={preview} src={preview} controls className="reel-preview" aria-label="Recorded video preview" onLoadedMetadata={event => { const seconds = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : recordedDuration.current; setDuration(seconds); if (!Number.isFinite(seconds) || seconds > 300) setError('Video duration must be readable and no longer than five minutes. Upload a finalized MP4 or WebM if recording duration is unavailable.') }} />}<label className="mp-field">Choose a video (MP4 or WebM, max 200 MB)<input type="file" accept="video/mp4,video/webm" disabled={busy || recording} onChange={event => chooseFile(event.target.files?.[0])} /></label>{file && <p className="reels-note">{file.name} · {duration > 0 && Number.isFinite(duration) ? `${Math.round(duration)} seconds` : 'Checking duration…'}</p>}<div className="reel-actions">{!cameraReady ? <button className="mp-button mp-button--secondary" disabled={busy} onClick={openCamera}>Enable camera & microphone</button> : recording ? <button className="mp-button mp-button--danger" onClick={() => recorder.current?.stop()}>Stop recording · {elapsed}s / 300s</button> : <><button className="mp-button mp-button--primary" onClick={startRecording}>Start recording</button><button className="mp-button mp-button--secondary" onClick={stopCamera}>Close camera</button></>}</div><p className="reels-note">Preview your full recording before uploading. Use your device’s editor if you need to trim the video.</p></>}</section></div><section className="reel-library" aria-labelledby="my-reels"><div className="mp-section-heading"><h2 id="my-reels">My reels</h2><button className="mp-button mp-button--secondary" disabled={busy} onClick={() => run(refresh)}>Refresh status</button></div>{!items.length && <p className="mp-card">Your drafts and submissions will appear here.</p>}{items.map(reel => <article className="mp-card" key={reel.id}><div className="mp-card-heading"><h3>{reel.title}</h3><span className="reel-status">{reel.status?.replaceAll('_', ' ')} · {reel.mediaStatus?.replaceAll('_', ' ')}</span></div>{reel.processingError && <p role="alert">Processing failed: {reel.processingError}</p>}{reel.moderationReason && <p>Review feedback: {reel.moderationReason}</p>}<p className="reels-note">{reel.counts?.views || 0} views · {reel.counts?.likes || 0} likes · {reel.counts?.saves || 0} saves</p><div className="reel-actions">{reel.mediaStatus === "failed" && <button className="mp-button mp-button--secondary" disabled={busy} onClick={() => run(async () => { await reelsApi.post(`/${reel.id}/retry`, { version: reel.version }, { signal: controller.signal }); setNotice("Processing retry requested.") })}>Retry processing</button>}<button className="mp-button mp-button--secondary" disabled={busy || ["uploading", "processing", "queued"].includes(reel.mediaStatus)} onClick={() => edit(reel)}>Edit metadata</button>{!['published', 'pending_review', 'pending', 'removed'].includes(reel.status) && <button className="mp-button mp-button--primary" disabled={busy || reel.mediaStatus !== 'ready'} onClick={() => run(async () => { await reelsApi.post(`/${reel.id}/submit`, { version: reel.version }, { signal: controller.signal }); setNotice('Submitted for independent medical review.') })}>Submit for review</button>}<button className="mp-button mp-button--danger" disabled={busy} onClick={() => { if (window.confirm(`Delete “${reel.title}”? This hides the reel from viewers. Private media follows the approved retention policy.`)) run(async () => { await reelsApi.delete(`/${reel.id}`, { signal: controller.signal }); if (editing?.id === reel.id) reset(); setNotice('Reel deleted.') }) }}>Delete</button></div></article>)}</section>{canReview && <section className="reel-library" aria-labelledby="reel-review"><h2 id="reel-review">Independent medical review</h2><p className="reels-note">Review the full video and metadata. Publication requires your qualified, version-bound decision. You cannot approve your own content.</p>{!reviews.length && <p>No reels awaiting review.</p>}{reviews.map(reel => <article className="mp-card reels-stack" key={reel.id}><h3>{reel.title}</h3><p>{reel.doctor?.name} · Version {reel.version}</p><ReelPreview reel={reel} /><p>{reel.caption}</p><p>{reel.topics?.join(', ')}</p><label className="mp-field">Review reason<textarea className="mp-input" maxLength={1000} value={reviewReasons[reel.id] || ''} onChange={event => setReviewReasons(old => ({ ...old, [reel.id]: event.target.value }))} /></label><div className="reel-actions">{['publish', 'reject'].map(decision => <button key={decision} className={`mp-button mp-button--${decision === 'publish' ? 'primary' : 'danger'}`} disabled={busy || !reviewReasons[reel.id]?.trim()} onClick={() => run(async () => { await reelsApi.post(`/${reel.id}/moderate`, { version: reel.version, decision, reason: reviewReasons[reel.id] }, { signal: controller.signal }); setNotice(`Review decision recorded: ${decision}.`) })}>{decision === 'publish' ? 'Approve and publish' : 'Reject with feedback'}</button>)}</div></article>)}</section>}{canReview && <ReelReports signal={controller.signal} run={run} busy={busy} />}</main>
}
