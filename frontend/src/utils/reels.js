import axios from 'axios'
import { BACKEND_URL } from '../utils'

// Use the shared axios instance so account CSRF and session-generation interceptors run.
const base = `${BACKEND_URL}/api/reels`
export const reelsApi = {
  get: (path, config) => axios.get(base + path, config),
  post: (path, body, config) => axios.post(base + path, body, config),
  put: (path, body, config) => axios.put(base + path, body, config),
  patch: (path, body, config) => axios.patch(base + path, body, config),
  delete: (path, config) => axios.delete(base + path, config),
}
export const reelKey = () => globalThis.crypto.randomUUID()
export const reelError = error => error.response?.data?.message || error.response?.data?.error || error.message || 'Please try again.'
export const mediaUrl = value => value?.startsWith('/') ? `${BACKEND_URL}${value}` : value
export const reelTopics = value => value.split(',').map(item => item.trim()).filter(Boolean).slice(0, 8)
