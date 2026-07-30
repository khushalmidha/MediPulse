import axios from 'axios'
import { createContext, useContext, useEffect, useState } from 'react'
import Cookies from 'js-cookie'
import { BACKEND_URL } from '../utils'

const AuthContext = createContext(null)

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [isAuth, setIsAuth] = useState(false)
  const [role, setRole] = useState('user')
  const [communities, setcommunities] = useState(null)
  const [loader, setLoading] = useState(true)
  const [staffUser, setStaffUser] = useState(null)
  const [isStaffAuth, setIsStaffAuth] = useState(false)
  const [staffRole, setStaffRole] = useState(null)
  const [staffHospital, setStaffHospital] = useState(null)

  const syncStaffSession = (payload) => {
    setStaffUser(payload.data)
    setStaffRole(payload.role)
    setStaffHospital(payload.hospital)
    setIsStaffAuth(true)
    sessionStorage.setItem(
      'medipulse.hospitalAdmin',
      JSON.stringify({ hospital: payload.hospital, staff: payload.data }),
    )
  }

  const clearStaffSession = () => {
    Cookies.remove('staffToken')
    Cookies.remove('staffId')
    sessionStorage.removeItem('medipulse.hospitalAdmin')
    setStaffUser(null)
    setIsStaffAuth(false)
    setStaffRole(null)
    setStaffHospital(null)
  }

  useEffect(() => {
    const checkBoth = async () => {
      try {
        const res = await axios.get(`${BACKEND_URL}/verify/`, { withCredentials: true })
        if (res.status === 200) {
          setUser(res.data.data)
          setRole(res.data.role)
          setIsAuth(true)
        }
      } catch {
        setUser(null)
        setIsAuth(false)
      }

      try {
        const res = await axios.get(`${BACKEND_URL}/verify/staff`, { withCredentials: true })
        if (res.status === 200) {
          syncStaffSession(res.data)
        }
      } catch {
        setStaffUser(null)
        setIsStaffAuth(false)
        setStaffRole(null)
        setStaffHospital(null)
      } finally {
        setLoading(false)
      }
    }

    checkBoth()
  }, [])

  useEffect(() => {
    if (isAuth) {
      fetchCommunities()
    }
  }, [isAuth, user])

  const fetchCommunities = async () => {
    try {
      const res = await axios.get(`${BACKEND_URL}/community/user`, {
        withCredentials: true,
        credentials: 'include',
      })
      setcommunities(res.data)
    } catch {
      setcommunities(null)
    }
  }

  const leaveCommunity = async (id) => {
    try {
      const res = await axios.post(
        `${BACKEND_URL}/community/leave`,
        { id },
        { withCredentials: true, credentials: 'include' },
      )
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
        logoutStaff: clearStaffSession,
      }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
