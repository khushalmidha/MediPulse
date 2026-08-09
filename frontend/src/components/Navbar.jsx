import { NavLink, Link, useNavigate } from 'react-router-dom'
import {
  Building2,
  ClipboardList,
  Heart,
  LogOut,
  Menu,
  MessageSquare,
  Stethoscope,
  X,
  Moon,
  Sun,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import Cookies from 'js-cookie'
import axios from 'axios'
import { BACKEND_URL } from '../utils'
import { getSocket } from '../socket'

const Badge = ({ count }) =>
  count > 0 ? (
    <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
      {count > 99 ? '99+' : count}
    </span>
  ) : null

const Navbar = () => {
  const [showProfile, setShowProfile] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [walletBalance, setWalletBalance] = useState(null)
  const [appointmentBadge, setAppointmentBadge] = useState(0)
  const [staffOpdBadge, setStaffOpdBadge] = useState(0)
  const [toast, setToast] = useState(null)
  const navigate = useNavigate()
  const profileRef = useRef(null)
  const mobileMenuRef = useRef(null)

  const {
    user,
    isAuth,
    role,
    setIsAuth,
    setUser,
    isStaffAuth,
    staffUser,
    staffRole,
    staffHospital,
    logoutStaff,
  } = useAuth()

  const [isDarkMode, setIsDarkMode] = useState(() => {
    return document.documentElement.classList.contains('dark') || localStorage.theme === 'dark';
  })

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark')
      localStorage.theme = 'dark'
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.theme = 'light'
    }
  }, [isDarkMode])

  const isLoggedIn = isAuth || isStaffAuth
  const displayName = isStaffAuth
    ? staffUser?.name || 'Hospital Staff'
    : [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Profile'
  const initials = isStaffAuth
    ? (staffUser?.name || 'HS')
        .split(' ')
        .map((part) => part[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : `${user?.firstName?.trim()?.[0] || 'M'}${user?.lastName?.trim()?.[0] || ''}`.toUpperCase()

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setShowProfile(false)
      }
      if (
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(event.target) &&
        !event.target.closest('button[aria-label="Toggle mobile menu"]')
      ) {
        setShowMobileMenu(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (!showProfile || !isAuth || isStaffAuth) return

    let ignore = false
    axios
      .get(`${BACKEND_URL}/vpay/wallet/dashboard`, { withCredentials: true })
      .then((res) => {
        if (!ignore) setWalletBalance(Number(res.data?.wallet?.balance || 0))
      })
      .catch(() => {
        if (!ignore) setWalletBalance(null)
      })

    return () => {
      ignore = true
    }
  }, [showProfile, isAuth, isStaffAuth])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 7000)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!isLoggedIn) return undefined
    let cancelled = false

    const loadBadge = async () => {
      try {
        if (isStaffAuth && staffRole === 'DOCTOR') {
          const hospitalId = staffUser?.hospitalId || staffHospital?._id
          const doctorId = staffUser?._id || staffUser?.id
          if (!hospitalId || !doctorId) return
          const response = await axios.get(`${BACKEND_URL}/api/opd/${hospitalId}/${doctorId}/queue`, { withCredentials: true })
          if (!cancelled) setStaffOpdBadge(response.data?.waiting?.length || 0)
          return
        }

        if (isAuth && role === 'doctor') {
          const response = await axios.get(`${BACKEND_URL}/appointment/doctor/queue`, { withCredentials: true })
          if (!cancelled) setAppointmentBadge(response.data?.pendingCount || 0)
          return
        }

        if (isAuth && role === 'user') {
          const response = await axios.get(`${BACKEND_URL}/appointment/history`, { withCredentials: true })
          const activeCount = (response.data?.appointments || []).filter((appointment) => ['queued', 'active'].includes(appointment.status)).length
          if (!cancelled) setAppointmentBadge(activeCount)
        }
      } catch {
        if (!cancelled) {
          setAppointmentBadge(0)
          setStaffOpdBadge(0)
        }
      }
    }

    loadBadge()
    const socket = getSocket()
    if (!socket.connected) socket.connect()

    const refreshDoctorBadge = () => {
      loadBadge()
    }
    const handleNewBooking = () => {
      if (role !== 'doctor') return
      setToast({ title: 'New appointment booked', message: 'A patient joined your queue.' })
      loadBadge()
    }
    const handleOpdTokenIssued = ({ token } = {}) => {
      if (!(isStaffAuth && staffRole === 'DOCTOR')) return
      setToast({ title: 'New OPD token', message: `${token?.displayToken || 'Token'} added to your hospital queue.` })
      loadBadge()
    }
    const showPatientJoinToast = ({ doctorId, appointmentId } = {}) => {
      if (!(isAuth && role === 'user' && doctorId)) return
      setToast({
        title: 'Doctor started your appointment',
        message: 'Join the consultation room now.',
        actionLabel: 'Join meeting',
        action: () => {
          setToast(null)
          navigate(`/triage/${doctorId}`)
        },
      })
      if (appointmentId) {
        setAppointmentBadge(1)
      }
      loadBadge()
    }
    const handleAppointmentStarted = (payload = {}) => {
      showPatientJoinToast(payload)
    }
    const handleUserStatus = (payload = {}) => {
      if (payload.status === 'active') {
        showPatientJoinToast(payload)
        return
      }
      refreshDoctorBadge()
    }

    const handleOpdPatientCalled = (payload = {}) => {
      if (!(isAuth && role === 'user')) return
      setToast({
        title: `🏥 ${payload.hospitalName || 'Hospital'} — Your turn!`,
        message: `${payload.doctorName || 'Doctor'} is ready. Token: ${payload.displayToken || ''}. Please proceed to the consultation room.`,
        actionLabel: 'Go to Hospital',
        action: () => {
          setToast(null)
          if (payload.hospitalSlug) navigate(`/hospitals/${payload.hospitalSlug}`)
        },
      })
      loadBadge()
    }

    socket.on('appointment:brief-ready', handleNewBooking)
    socket.on('appointment:queue-updated', refreshDoctorBadge)
    socket.on('appointment:user-status', handleUserStatus)
    socket.on('appointment:started', handleAppointmentStarted)
    socket.on('opd:token-issued', handleOpdTokenIssued)
    socket.on('opd:consultation-started', handleAppointmentStarted)
    socket.on('opd:patient-called', handleOpdPatientCalled)
    socket.on('opd:consultation-completed', refreshDoctorBadge)
    socket.on('opd:no-show', refreshDoctorBadge)

    const interval = window.setInterval(loadBadge, 15000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      socket.off('appointment:brief-ready', handleNewBooking)
      socket.off('appointment:queue-updated', refreshDoctorBadge)
      socket.off('appointment:user-status', handleUserStatus)
      socket.off('appointment:started', handleAppointmentStarted)
      socket.off('opd:token-issued', handleOpdTokenIssued)
      socket.off('opd:consultation-started', handleAppointmentStarted)
      socket.off('opd:patient-called', handleOpdPatientCalled)
      socket.off('opd:consultation-completed', refreshDoctorBadge)
      socket.off('opd:no-show', refreshDoctorBadge)
    }
  }, [isLoggedIn, isAuth, role, isStaffAuth, staffRole, staffUser?._id, staffUser?.id, staffUser?.hospitalId, staffHospital?._id, navigate])

  const activeStyle = 'whitespace-nowrap text-red-600 dark:text-red-500 font-medium border-b-2 border-red-600 pb-1'
  const inactiveStyle = 'whitespace-nowrap text-gray-700 hover:text-red-600 dark:text-red-500 transition-colors'
  const mobileLinkStyle = ({ isActive }) =>
    `block rounded-md px-3 py-2 ${isActive ? 'bg-red-50 font-medium text-red-600 dark:text-red-500' : 'text-gray-700 hover:bg-gray-50 dark:bg-slate-900 hover:text-red-600 dark:text-red-500'}`

  const staffNavLinks = [
    { to: '/hospital/admin', label: 'Dashboard', icon: Building2 },
    ...(['HOSPITAL_ADMIN', 'NURSE', 'RECEPTIONIST'].includes(staffRole) ? [{ to: '/hospital/nursing-station', label: 'OPD Tokens', icon: ClipboardList }] : []),
    ...(staffRole === 'DOCTOR' ? [{ to: '/hospital/doctor-opd', label: 'Consultation', icon: Stethoscope, badge: staffOpdBadge }] : []),
    { to: '/hospital/staff-communication', label: 'Staff Chat', icon: MessageSquare },
  ]

  const userNavLinks = [
    { to: '/dashboard', label: 'Dashboard' },
    ...(role !== 'doctor' ? [{ to: '/my-appointments', label: 'My Appointments', badge: appointmentBadge }] : []),
    { to: '/doctors', label: 'Doctors' },
    { to: '/hospitals', label: 'Hospitals' },
    { to: '/communities', label: 'Communities' },
    { to: '/events', label: 'Events' },
    { to: '/chat', label: 'Chat' },
    ...(role === 'doctor' ? [{ to: '/doctor/appointments', label: 'Appointments', badge: appointmentBadge }] : []),
    ...(role === 'user' ? [{ to: '/health-records', label: 'Health Records' }] : []),
  ]

  const handleLogout = () => {
    if (isStaffAuth) {
      logoutStaff()
    } else {
      setIsAuth(false)
      setUser(null)
      Cookies.remove('token')
      Cookies.remove('id')
    }
    setShowProfile(false)
    setShowMobileMenu(false)
    navigate('/')
  }

  return (
    <nav className="sticky top-0 z-50 bg-white dark:bg-black border-b border-transparent dark:border-red-900 shadow-sm transition-colors duration-200">
      <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-5">
          <div className="flex min-w-fit flex-shrink-0 items-center">
            <Link to={isStaffAuth ? '/hospital/admin' : '/'} className="flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-500">
                <Heart size={28} strokeWidth={1.8} />
              </span>
              <span className="text-xl font-bold leading-none text-slate-950 dark:text-white">MediPulse</span>
            </Link>
            {isStaffAuth && staffHospital && (
              <span className="ml-3 hidden items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-blue-700 sm:flex">
                <Building2 size={12} />
                {staffHospital.name}
              </span>
            )}
          </div>

          <div className="hidden min-w-0 flex-1 items-center justify-center gap-4 text-sm lg:gap-5 xl:gap-6 md:flex">
            {isStaffAuth
              ? staffNavLinks.map(({ to, label, icon: Icon, badge }) => (
                  <NavLink key={to} to={to} className={({ isActive }) => `flex items-center gap-1.5 ${isActive ? activeStyle : inactiveStyle}`}>
                    <Icon size={16} />
                    {label}
                    <Badge count={badge || 0} />
                  </NavLink>
                ))
              : userNavLinks.map(({ to, label, badge }) => (
                  <NavLink key={to} to={to} className={({ isActive }) => (isActive ? activeStyle : inactiveStyle)}>
                    {label}
                    <Badge count={badge || 0} />
                  </NavLink>
                ))}
          </div>

          <div className="flex items-center md:hidden gap-2">
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="p-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full"
            >
              {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <button
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              className="inline-flex items-center justify-center rounded-md p-2 text-gray-700 dark:text-gray-300 hover:bg-red-50 dark:hover:bg-red-900/50 hover:text-red-600 dark:text-red-500 dark:hover:text-red-500 focus:outline-none"
              aria-label="Toggle mobile menu">
              {showMobileMenu ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>

          <div className="hidden min-w-fit items-center md:flex gap-3">
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="p-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full"
            >
              {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            {isLoggedIn ? (
              <div className="relative" ref={profileRef}>
                <button onClick={() => setShowProfile(!showProfile)} className="flex items-center gap-2 focus:outline-none">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-600 dark:bg-red-700 text-sm font-bold text-white">
                    {initials}
                  </span>
                  <span className="hidden text-gray-700 lg:inline-block">{displayName}</span>
                </button>

                {showProfile && (
                  <div className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-lg border border-gray-200 dark:border-red-900 bg-white dark:bg-black shadow-lg">
                    <div className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-600 dark:bg-red-600 text-base font-bold text-white">
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-gray-900 dark:text-gray-100">{displayName}</p>
                          <p className="truncate text-sm text-gray-500 dark:text-gray-400">{isStaffAuth ? staffUser?.email : user?.email}</p>
                          {isStaffAuth && (
                            <span className="mt-1 inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                              {staffRole?.replace(/_/g, ' ')}
                            </span>
                          )}
                        </div>
                      </div>

                      {isStaffAuth && staffHospital ? (
                        <div className="mt-4 rounded-md border border-blue-100 bg-red-50 p-3">
                          <p className="text-xs font-semibold text-blue-700">{staffHospital.name}</p>
                          <p className="mt-0.5 text-xs text-red-500">
                            {staffHospital.address?.city || 'City'}, {staffHospital.address?.state || 'State'}
                          </p>
                          {staffHospital.slug && (
                            <Link to={`/hospitals/${staffHospital.slug}`} onClick={() => setShowProfile(false)} className="mt-2 block text-xs font-semibold text-blue-700 underline">
                              View hospital website
                            </Link>
                          )}
                        </div>
                      ) : (
                        <div className="mt-4 rounded-md border border-gray-200 dark:border-red-900/40 bg-gray-50 dark:bg-slate-900 p-3">
                          <p className="text-xs text-gray-500">Wallet Balance</p>
                          <p className="mt-1 text-xl font-bold text-gray-900 dark:text-slate-100">
                            {walletBalance === null ? 'Loading...' : `INR ${walletBalance.toFixed(2)}`}
                          </p>
                        </div>
                      )}
                    </div>
                    <button onClick={handleLogout} className="flex w-full items-center border-t border-gray-100 px-4 py-3 text-left text-red-500 hover:bg-gray-100">
                      <LogOut className="mr-2 h-4 w-4" />
                      Log out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3 text-sm">
                <Link to="/login" className="whitespace-nowrap px-1 font-medium text-gray-700 hover:text-red-600 dark:text-red-500">
                  Login
                </Link>
                <Link to="/signup" className="whitespace-nowrap rounded-lg bg-red-600 dark:bg-red-700 px-4 py-2.5 font-semibold text-white hover:bg-blue-700">
                  Sign Up
                </Link>
                <Link to="/signup/hospital-admin" className="hidden whitespace-nowrap rounded-lg border border-red-600 px-4 py-2.5 font-semibold text-red-600 dark:text-red-500 hover:bg-red-50 xl:inline-flex">
                  Register Hospital
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {showMobileMenu && (
        <div className="border-t border-gray-200 dark:border-red-900 bg-white dark:bg-black md:hidden" ref={mobileMenuRef}>
          <div className="space-y-1 px-2 pb-3 pt-2">
            {(isStaffAuth ? staffNavLinks : userNavLinks).map(({ to, label, icon: Icon, badge }) => (
              <NavLink key={to} to={to} onClick={() => setShowMobileMenu(false)} className={mobileLinkStyle}>
                <span className="flex items-center gap-2">{Icon && <Icon size={16} />}{label}<Badge count={badge || 0} /></span>
              </NavLink>
            ))}

            <div className="mt-3 border-t border-gray-200 dark:border-red-900/40 pt-3">
              {isLoggedIn ? (
                <>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-600 dark:bg-red-700 text-xs font-bold text-white">{initials}</span>
                    <span className="font-medium text-gray-700">{displayName}</span>
                  </div>
                  <button onClick={handleLogout} className="flex w-full items-center px-3 py-2 text-left text-red-500 hover:bg-gray-50 dark:bg-slate-900">
                    <LogOut className="mr-2 h-4 w-4" />
                    Log out
                  </button>
                </>
              ) : (
                <div className="flex flex-col space-y-2 px-3">
                  <Link to="/login" onClick={() => setShowMobileMenu(false)} className="w-full rounded-md border border-gray-300 py-2 text-center text-gray-700">
                    Login
                  </Link>
                  <Link to="/signup" onClick={() => setShowMobileMenu(false)} className="w-full rounded-md bg-red-600 dark:bg-red-700 py-2 text-center text-white hover:bg-blue-700">
                    Sign Up
                  </Link>
                  <Link to="/signup/hospital-admin" onClick={() => setShowMobileMenu(false)} className="w-full rounded-md border border-red-600 py-2 text-center text-red-600 dark:text-red-500">
                    Register Hospital
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className="fixed left-4 top-20 z-[70] max-w-sm rounded-lg border border-blue-100 bg-white dark:bg-slate-950 p-4 shadow-xl">
          <p className="text-sm font-bold text-slate-950">{toast.title}</p>
          <p className="mt-1 text-sm text-slate-600">{toast.message}</p>
          {toast.action && (
            <button
              type="button"
              onClick={toast.action}
              className="mt-3 rounded-md bg-red-600 dark:bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
            >
              {toast.actionLabel || 'Open'}
            </button>
          )}
        </div>
      )}
    </nav>
  )
}

export default Navbar
