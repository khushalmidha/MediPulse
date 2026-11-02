/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from 'react'
import { reelsApi, reelError, reelKey } from '../../utils/reels'

export default function ReelDialog({ reel, kind, close, signal }) {
  const dialog = useRef(null)
  const [items, setItems] = useState([]), [cursor, setCursor] = useState(null)
  const [text, setText] = useState(''), [reason, setReason] = useState('medical_misinformation')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const pendingKey = useRef(reelKey())
  const load = async next => {
    setBusy(true); setError('')
    try { const { data } = await reelsApi.get(`/${reel.id}/comments`, { params: { cursor: next || undefined }, signal }); if (!signal.aborted) { setItems(old => next ? [...old, ...data.items] : data.items); setCursor(data.nextCursor) } }
    catch (err) { if (!signal.aborted) setError(reelError(err)) }
    finally { if (!signal.aborted) setBusy(false) }
  }
  useEffect(() => {
    const previous = document.activeElement
    dialog.current.showModal()
    if (kind === 'comments') load()
    return () => previous?.focus()
    // The dialog is remounted for each reel and mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError('')
    try {
      if (kind === 'comments') {
        const { data } = await reelsApi.post(`/${reel.id}/comments`, { text, idempotencyKey: pendingKey.current }, { signal })
        if (!signal.aborted) { setItems(old => [...old.filter(item => item.id !== data.comment.id), data.comment]); setText(''); pendingKey.current = reelKey() }
      } else { await reelsApi.post(`/${reel.id}/report`, { reason, details: text }, { signal }); if (!signal.aborted) close() }
    } catch (err) { if (!signal.aborted) setError(reelError(err)) }
    finally { if (!signal.aborted) setBusy(false) }
  }
  return <dialog ref={dialog} className="mp-dialog reels-dialog" aria-labelledby="reel-dialog-title" onCancel={close} onClose={close}><div className="mp-dialog-header"><h2 id="reel-dialog-title">{kind === 'comments' ? 'Conversation' : 'Report this reel'}</h2><button className="mp-button mp-button--secondary" onClick={close} aria-label="Close dialog">Close</button></div><p className="reels-note">Do not include patient names, records or personal medical information.</p>{error && <p role="alert" className="mp-banner">{error}</p>}{kind === 'comments' && <><ul className="reel-comments">{items.map(item => <li key={item.id}><strong>{item.authorName}</strong><p>{item.text}</p><small>{new Date(item.createdAt).toLocaleString()}</small></li>)}</ul>{!items.length && !busy && <p>No comments yet.</p>}{cursor && <button disabled={busy} className="mp-button mp-button--secondary" onClick={() => load(cursor)}>More comments</button>}</>}<form onSubmit={submit}>{kind === 'report' && <label className="mp-field">Reason<select aria-label="Report reason" className="mp-input" value={reason} onChange={event => setReason(event.target.value)}>{['medical_misinformation', 'patient_privacy', 'harassment', 'spam', 'other'].map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>}<label className="mp-field">{kind === 'comments' ? 'Your comment' : 'Details'}<textarea className="mp-input" maxLength={kind === 'comments' ? 500 : 1000} required={kind === 'comments'} value={text} onChange={event => { setText(event.target.value); pendingKey.current = reelKey() }} /></label><button className="mp-button mp-button--primary" disabled={busy || (kind === 'comments' && !text.trim())}>{busy ? 'Please wait…' : kind === 'comments' ? 'Post comment' : 'Send report'}</button></form></dialog>
}
