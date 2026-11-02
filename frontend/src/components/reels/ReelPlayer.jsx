/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { mediaUrl, reelsApi, reelKey } from '../../utils/reels'
import { watchedDelta } from '../../utils/reelsPlayback'

export default function ReelPlayer({ reel, active, muted, signal }) {
  const video = useRef(null)
  const streaming = useRef(null)
  const session = useRef(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const node = video.current
    let hls
    setError('')
    const src = mediaUrl(reel.playbackUrl)
    if (!src) return
    if (/\.m3u8(?:\?|$)/i.test(src) && !node.canPlayType('application/vnd.apple.mpegurl')) {
      if (Hls.isSupported()) {
        hls = new Hls({ autoStartLoad: false, xhrSetup: xhr => { xhr.withCredentials = true } })
        streaming.current = hls
        hls.loadSource(src); hls.attachMedia(node)
        hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) setError('Video could not be loaded. Try another reel or reload the feed.') })
      } else setError('This browser cannot play this video format.')
    } else node.src = src
    return () => { node.pause(); hls?.destroy(); streaming.current = null; node.removeAttribute('src'); node.load() }
  }, [reel.playbackUrl])
  useEffect(() => {
    const node = video.current
    let cancelled = false
    let lastTime = node.currentTime
    let watched = 0
    let totalWatched = 0
    let sequence = 0
    let queue = Promise.resolve()
    session.current = null
    const send = type => {
      if (!session.current || signal.aborted) return
      const delta = Math.min(15000, Math.round(watched)); watched = 0
      if (type === 'watch' && !delta) return
      const payload = { eventId: reelKey(), sessionId: session.current, sequence: ++sequence, type, watchMs: delta }
      queue = queue.then(async () => {
        if (signal.aborted) return
        try { await reelsApi.post(`/${reel.id}/events`, payload, { signal }) }
        catch (err) { if (!signal.aborted && (!err.response || err.response.status >= 500)) await reelsApi.post(`/${reel.id}/events`, payload, { signal }) }
      }).catch(() => {})
    }
    const tick = () => {
      const current = node.currentTime
      const delta = watchedDelta(lastTime, current, { active, hidden: document.hidden, paused: node.paused, seeking: node.seeking })
      watched += delta; totalWatched += delta
      lastTime = current
    }
    const visibility = () => {
      if (document.hidden) { node.pause(); streaming.current?.stopLoad(); send('watch') }
      else if (active) { streaming.current?.startLoad(); node.play().catch(() => {}) }
    }
    const share = event => { if (event.detail === reel.id && active) { send('watch'); send('share') } }
    if (active) {
      reelsApi.post(`/${reel.id}/playback`, {}, { signal }).then(({ data }) => { if (!cancelled) session.current = data.sessionId }).catch(() => {})
      if (!document.hidden) { streaming.current?.startLoad(); node.play().catch(() => {}) }
    } else { node.pause(); streaming.current?.stopLoad() }
    node.addEventListener('timeupdate', tick)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('medipulse:reel-share', share)
    const timer = window.setInterval(() => send('watch'), 5000)
    return () => {
      cancelled = true; node.pause(); send('watch'); if (active && totalWatched < Math.min(5000, (reel.duration || 1) * 300)) send('skip'); session.current = null
      window.clearInterval(timer); node.removeEventListener('timeupdate', tick); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('medipulse:reel-share', share)
    }
  }, [active, reel.id, reel.duration, signal])
  return <>{error && <p role="alert" className="mp-banner">{error}</p>}<video ref={video} className="reel-video" muted={muted} controls playsInline preload="metadata" poster={mediaUrl(reel.thumbnailUrl)} aria-label={reel.title} onError={() => setError('Video unavailable. Please reload the feed.')} /></>
}
