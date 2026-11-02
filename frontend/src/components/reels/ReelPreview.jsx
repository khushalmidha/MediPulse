/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { mediaUrl } from '../../utils/reels'

export default function ReelPreview({ reel }) {
  const video = useRef(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const node = video.current, src = mediaUrl(reel.playbackUrl)
    let hls
    setError('')
    if (!src) { setError('The video will be available after processing.'); return }
    if (/\.m3u8(?:\?|$)/i.test(src) && !node.canPlayType('application/vnd.apple.mpegurl')) {
      if (Hls.isSupported()) {
        hls = new Hls({ xhrSetup: xhr => { xhr.withCredentials = true } })
        hls.loadSource(src); hls.attachMedia(node)
        hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) setError('Video unavailable. Refresh the status and try again.') })
      } else setError('This browser cannot play this video format.')
    } else node.src = src
    const pauseWhenHidden = () => { if (document.hidden) node.pause() }
    document.addEventListener('visibilitychange', pauseWhenHidden)
    return () => { document.removeEventListener('visibilitychange', pauseWhenHidden); node.pause(); hls?.destroy(); node.removeAttribute('src'); node.load() }
  }, [reel.playbackUrl])
  return <>{error && <p role="alert" className="reels-note">{error}</p>}<video ref={video} className="reel-preview" controls playsInline preload="metadata" poster={mediaUrl(reel.thumbnailUrl)} aria-label={`Preview: ${reel.title}`} /></>
}
