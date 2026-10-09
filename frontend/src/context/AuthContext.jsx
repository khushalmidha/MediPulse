import { useProduct } from "./ProductContext"
import axios from 'axios'
import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { clearSessionState } from '../utils/sessionHttp'
import { BACKEND_URL } from '../utils'

const AuthContext = createContext(null)

export const AuthProvider = ({ children }) => {
  const product = useProduct()
  const [user, setUser] = useState(null)
  const [isAuth, setIsAuth] = useState(false)
  const [role, setRole] = useState('user')
  const [communities, setcommunities] = useState(null)
  const [loader, setLoading] = useState(true)
  const [staffUser, setStaffUser] = useState(null)
  const [isStaffAuth, setIsStaffAuth] = useState(false)
  const [staffRole, setStaffRole] = useState(null)
  const [staffHospital, setStaffHospital] = useState(null)
  const sessionGeneration = useRef(0)

  const syncStaffSession = useCallback((payload) => {
    setUser(null)
    setIsAuth(false)
    setcommunities(null)
    setStaffUser(payload.data)
    setStaffRole(payload.role)
    setStaffHospital(payload.hospital)
    setIsStaffAuth(true)
    sessionStorage.setItem(
      'medipulse.hospitalAdmin',
      JSON.stringify({ hospital: payload.hospital, staff: payload.data }),
    )
  }, [])

  const clearStaffSession = useCallback(() => {

    sessionStorage.removeItem('medipulse.hospitalAdmin')
    setStaffUser(null)
    setIsStaffAuth(false)
    setStaffRole(null)
    setStaffHospital(null)
  }, [])

  const clearLocalSession = () => {
    sessionGeneration.current++
    clearSessionState()
    setUser(null)
    setIsAuth(false)
    setcommunities(null)
    clearStaffSession()
  }

  const logoutAccount = async () => {
    await axios.post(`${BACKEND_URL}/user/logout`, {})
    sessionGeneration.current++
    clearSessionState()
    setUser(null)
    setIsAuth(false)
    setcommunities(null)
    clearStaffSession()
  }
  const logoutStaff = async () => {
    await axios.post(`${BACKEND_URL}/user/staff/logout`, {})
    sessionGeneration.current++
    clearSessionState()
    clearStaffSession()
    setUser(null)
    setIsAuth(false)
  }

  useEffect(() => {
    const switched = ({ detail }) => {
      sessionGeneration.current++
      setLoading(false)
      const { scope, payload } = detail
      if (scope === 'staff') syncStaffSession({ data: payload.result || payload.staff, role: (payload.result || payload.staff)?.role, hospital: payload.hospital })
      else {
        clearStaffSession()
        setcommunities(null)
        setUser(payload.result)
        setIsAuth(true)
        setRole(payload.role || (detail.payload.result?.experience ? 'doctor' : 'user'))
      }
    }
    window.addEventListener('medipulse:session', switched)
    return () => window.removeEventListener('medipulse:session', switched)
  }, [syncStaffSession, clearStaffSession])

  useEffect(() => {
    const generation = sessionGeneration.current
    const checkBoth = async () => {
      if (product.kind !== "staff") try {
        const res = await axios.get(`${BACKEND_URL}/verify/`, { withCredentials: true })
        if (generation !== sessionGeneration.current) return
        if (res.status === 200) {
          setUser(res.data.data)
          setRole(res.data.role)
          setIsAuth(true)
          clearStaffSession()
          setLoading(false)
          return
        }
      } catch {
        if (generation !== sessionGeneration.current) return
        setUser(null)
        setIsAuth(false)
      }

      if (["connect", "patient"].includes(product.kind)) {
        clearStaffSession()
        setLoading(false)
        return
      }
      try {
        const res = await axios.get(`${BACKEND_URL}/verify/staff`, { withCredentials: true })
        if (generation !== sessionGeneration.current) return
        if (res.status === 200) {
          syncStaffSession(res.data)
        }
      } catch {
        if (generation !== sessionGeneration.current) return
        clearStaffSession()
        setStaffUser(null)
        setIsStaffAuth(false)
        setStaffRole(null)
        setStaffHospital(null)
      } finally {
        if (generation === sessionGeneration.current) setLoading(false)
      }
    }

    checkBoth()
  }, [clearStaffSession, syncStaffSession, product.kind])

  const fetchCommunities = useCallback(async () => {
    const generation = sessionGeneration.current
    try {
      const res = await axios.get(`${BACKEND_URL}/community/user`, {
        withCredentials: true,
        credentials: 'include',
      })
      if (generation === sessionGeneration.current) setcommunities(res.data)
    } catch {
      if (generation === sessionGeneration.current) setcommunities(null)
    }
  }, [])

  useEffect(() => {
    if (isAuth) {
      fetchCommunities()
    }
  }, [isAuth, user, fetchCommunities])


  const leaveCommunity = async (id) => {
    const generation = sessionGeneration.current
    try {
      const res = await axios.post(
        `${BACKEND_URL}/community/leave`,
        { id },
        { withCredentials: true, credentials: 'include' },
      )
      if (generation !== sessionGeneration.current) return
      setUser(res.data.user)
      fetchCommunities()
    } catch {
      // Leave the current UI state untouched if the request fails.
    }
  }

  return (
    <AuthContext.Provider
      value={{
        isAuth,
        user,
        setUser,
        setIsAuth,
        role,
        setRole,
        communities,
        fetchCommunities,
        leaveCommunity,
        loader,
        isStaffAuth,
        staffUser,
        staffRole,
        staffHospital,
        setStaffUser,
        setStaffRole,
        setStaffHospital,
        setIsStaffAuth,
        syncStaffSession,
        logoutStaff,
        logoutAccount,
        clearLocalSession,
      }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
