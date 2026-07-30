import { NavLink, Link, useNavigate } from 'react-router-dom'
import {
  Building2,
  ClipboardList,
  LogOut,
  Menu,
  MessageSquare,
  Stethoscope,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import Cookies from 'js-cookie'
import { DotLottieReact } from '@lottiefiles/dotlottie-react'
import axios from 'axios'
import { BACKEND_URL } from '../utils'

const Navbar = () => {
  const [showProfile, setShowProfile] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [walletBalance, setWalletBalance] = useState(null)
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

  const activeStyle = 'text-blue-600 font-medium border-b-2 border-blue-600 pb-1'
  const inactiveStyle = 'text-gray-700 hover:text-blue-600 transition-colors'
  const mobileLinkStyle = ({ isActive }) =>
    `block rounded-md px-3 py-2 ${isActive ? 'bg-blue-50 font-medium text-blue-600' : 'text-gray-700 hover:bg-gray-50 hover:text-blue-600'}`

  const staffNavLinks = [
    { to: '/hospital/admin', label: 'Dashboard', icon: Building2 },
    { to: '/hospital/nursing-station', label: 'OPD Tokens', icon: ClipboardList },
    { to: '/hospital/doctor-opd', label: 'OPD Console', icon: Stethoscope },
    { to: '/hospital/staff-communication', label: 'Staff Chat', icon: MessageSquare },
  ]

  const userNavLinks = [
    { to: '/dashboard', label: 'Dashboard' },
    ...(role !== 'doctor' ? [{ to: '/my-appointments', label: 'My Appointments' }] : []),
    { to: '/doctors', label: 'Doctors' },
    { to: '/hospitals', label: 'Hospitals' },
    { to: '/communities', label: 'Communities' },
    { to: '/events', label: 'Events' },
    { to: '/chat', label: 'Chat' },
    ...(role === 'doctor' ? [{ to: '/doctor/appointments', label: 'Appointments' }] : []),
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
    <nav className="sticky top-0 z-50 bg-white shadow-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 justify-between">
          <div className="flex flex-shrink-0 items-center">
            <Link to={isStaffAuth ? '/hospital/admin' : '/'} className="flex items-center">
              <div className="h-20 w-25">
                <DotLottieReact
                  className="h-20 w-40"
                  src="https://lottie.host/da10eca5-8e52-45a4-9f51-1b1271270105/jlZWD8WyC2.lottie"
                  loop
                  autoplay
                />
              </div>
              <span className="ml-2 text-xl font-bold">MediPulse</span>
            </Link>
            {isStaffAuth && staffHospital && (
              <span className="ml-3 hidden items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 sm:flex">
                <Building2 size={12} />
                {staffHospital.name}
              </span>
            )}
          </div>

          <div className="hidden items-center space-x-6 md:flex">
            {isStaffAuth
              ? staffNavLinks.map(({ to, label, icon: Icon }) => (
                  <NavLink key={to} to={to} className={({ isActive }) => `flex items-center gap-1.5 ${isActive ? activeStyle : inactiveStyle}`}>
                    <Icon size={16} />
                    {label}
                  </NavLink>
                ))
              : userNavLinks.map(({ to, label }) => (
                  <NavLink key={to} to={to} className={({ isActive }) => (isActive ? activeStyle : inactiveStyle)}>
                    {label}
                  </NavLink>
                ))}
          </div>

          <div className="flex items-center md:hidden">
            <button
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              className="inline-flex items-center justify-center rounded-md p-2 text-gray-700 hover:bg-blue-50 hover:text-blue-600 focus:outline-none"
              aria-label="Toggle mobile menu">
              {showMobileMenu ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>

          <div className="hidden items-center md:flex">
            {isLoggedIn ? (
              <div className="relative" ref={profileRef}>
                <button onClick={() => setShowProfile(!showProfile)} className="flex items-center gap-2 focus:outline-none">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
                    {initials}
                  </span>
                  <span className="hidden text-gray-700 lg:inline-block">{displayName}</span>
                </button>

                {showProfile && (
                  <div className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                    <div className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-600 text-base font-bold text-white">
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-gray-900">{displayName}</p>
                          <p className="truncate text-sm text-gray-500">{isStaffAuth ? staffUser?.email : user?.email}</p>
                          {isStaffAuth && (
                            <span className="mt-1 inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                              {staffRole?.replace(/_/g, ' ')}
                            </span>
                          )}
                        </div>
                      </div>

                      {isStaffAuth && staffHospital ? (
                        <div className="mt-4 rounded-md border border-blue-100 bg-blue-50 p-3">
                          <p className="text-xs font-semibold text-blue-700">{staffHospital.name}</p>
                          <p className="mt-0.5 text-xs text-blue-500">
                            {staffHospital.address?.city || 'City'}, {staffHospital.address?.state || 'State'}
                          </p>
                          {staffHospital.slug && (
                            <Link to={`/hospitals/${staffHospital.slug}`} onClick={() => setShowProfile(false)} className="mt-2 block text-xs font-semibold text-blue-700 underline">
                              View hospital website
                            </Link>
                          )}
                        </div>
                      ) : (
                        <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3">
                          <p className="text-xs text-gray-500">Wallet Balance</p>
                          <p className="mt-1 text-xl font-bold text-gray-900">
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
              <div className="flex items-center space-x-4">
                <Link to="/login" className="text-gray-700 hover:text-blue-600">
                  Login
                </Link>
                <Link to="/signup" className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
                  Sign Up
                </Link>
                <Link to="/signup/hospital-admin" className="rounded-md border border-blue-600 px-4 py-2 text-blue-600 hover:bg-blue-50">
                  Register Hospital
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {showMobileMenu && (
        <div className="border-t border-gray-200 bg-white md:hidden" ref={mobileMenuRef}>
          <div className="space-y-1 px-2 pb-3 pt-2">
            {(isStaffAuth ? staffNavLinks : userNavLinks).map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} onClick={() => setShowMobileMenu(false)} className={mobileLinkStyle}>
                <span className="flex items-center gap-2">{Icon && <Icon size={16} />}{label}</span>
              </NavLink>
            ))}

            <div className="mt-3 border-t border-gray-200 pt-3">
              {isLoggedIn ? (
                <>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">{initials}</span>
                    <span className="font-medium text-gray-700">{displayName}</span>
                  </div>
                  <button onClick={handleLogout} className="flex w-full items-center px-3 py-2 text-left text-red-500 hover:bg-gray-50">
                    <LogOut className="mr-2 h-4 w-4" />
                    Log out
                  </button>
                </>
              ) : (
                <div className="flex flex-col space-y-2 px-3">
                  <Link to="/login" onClick={() => setShowMobileMenu(false)} className="w-full rounded-md border border-gray-300 py-2 text-center text-gray-700">
                    Login
                  </Link>
                  <Link to="/signup" onClick={() => setShowMobileMenu(false)} className="w-full rounded-md bg-blue-600 py-2 text-center text-white hover:bg-blue-700">
                    Sign Up
                  </Link>
                  <Link to="/signup/hospital-admin" onClick={() => setShowMobileMenu(false)} className="w-full rounded-md border border-blue-600 py-2 text-center text-blue-600">
                    Register Hospital
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}

export default Navbar
