import { NavLink, Link, useNavigate } from 'react-router-dom'
import {
  CircleUserRound,
  LogOut,
  Menu,
  X,
} from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import Cookies from 'js-cookie'
import React from 'react'
import { DotLottieReact } from '@lottiefiles/dotlottie-react'

const Navbar = () => {
  const [showProfile, setShowProfile] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const navigate = useNavigate()
  const { user, isAuth, role, setIsAuth, setUser } = useAuth()
  
  // Reference to detect clicks outside dropdown menus
  const profileRef = useRef(null)
  const mobileMenuRef = useRef(null)

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setShowProfile(false)
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target) && 
          !event.target.closest('button[aria-label="Toggle mobile menu"]')) {
        setShowMobileMenu(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Active link style
  const activeStyle = "text-blue-600 font-medium border-b-2 border-blue-600 pb-1"
  const inactiveStyle = "text-gray-700 hover:text-blue-600 transition-colors"
  
  return (
    <nav className="bg-white shadow-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          {/* Logo section */}
          <div className="flex-shrink-0 flex items-center">
            <Link to="/" className="flex items-center">
              <div className="w-25 h-20">
                <DotLottieReact
                  className="w-40 h-20"
                  src="https://lottie.host/da10eca5-8e52-45a4-9f51-1b1271270105/jlZWD8WyC2.lottie"
                  loop
                  autoplay
                />
              </div>
              <span className="ml-2 text-xl font-bold">MediPulse</span>
            </Link>
          </div>

          {/* Desktop navigation */}
          <div className="hidden md:flex items-center space-x-8">
            <NavLink
              to="/dashboard"
              className={({ isActive }) => isActive ? activeStyle : inactiveStyle}
            >
              Dashboard
            </NavLink>
            {role !== 'doctor' && (
              <NavLink
                to="/my-appointments"
                className={({ isActive }) => isActive ? activeStyle : inactiveStyle}
              >
                My Appointments
              </NavLink>
            )}
            <NavLink
              to="/communities"
              className={({ isActive }) => isActive ? activeStyle : inactiveStyle}
            >
              Communities
            </NavLink>
            <NavLink
              to="/chat"
              className={({ isActive }) => isActive ? activeStyle : inactiveStyle}
            >
              Chat
            </NavLink>
            <NavLink
              to="/doctors"
              className={({ isActive }) => isActive ? activeStyle : inactiveStyle}
            >
              Doctors
            </NavLink>
            {role === 'doctor' && (
              <NavLink
                to="/doctor/appointments"
                className={({ isActive }) => isActive ? activeStyle : inactiveStyle}
              >
                Appointments
              </NavLink>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden flex items-center">
            <button
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              className="inline-flex items-center justify-center p-2 rounded-md text-gray-700 hover:text-blue-600 hover:bg-blue-50 focus:outline-none"
              aria-label="Toggle mobile menu"
            >
              {showMobileMenu ? (
                <X className="block h-6 w-6" />
              ) : (
                <Menu className="block h-6 w-6" />
              )}
            </button>
          </div>

          {/* Profile section - desktop */}
          <div className="hidden md:flex items-center">
            {isAuth ? (
              <div className="relative" ref={profileRef}>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setShowProfile(!showProfile)}
                    className="focus:outline-none"
                  >
                    <CircleUserRound className="size-10 text-blue-600 bg-blue-100 p-0.5 border rounded-full" />
                  </button>
                  <span className="text-gray-700 hidden lg:inline-block">
                    {user?.firstName + " " + user?.lastName}
                  </span>
                </div>
                {showProfile && (
                  <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 shadow-lg rounded-lg overflow-hidden z-50">
                    <button
                      onClick={() => {
                        setIsAuth(false)
                        setShowProfile(false)
                        setUser(null)
                        Cookies.remove('token')
                        Cookies.remove('id')
                        navigate('/')
                      }}
                      className="flex items-center w-full px-4 py-2 text-left text-red-500 hover:bg-gray-100"
                    >
                      <LogOut className="w-4 h-4 mr-2" />
                      Log out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center space-x-4">
                <Link
                  to="/login"
                  className="text-gray-700 hover:text-blue-600"
                >
                  Login
                </Link>
                <Link
                  to="/signup"
                  className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
                >
                  Sign Up
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile menu dropdown */}
      {showMobileMenu && (
        <div className="md:hidden bg-white border-t border-gray-200" ref={mobileMenuRef}>
          <div className="px-2 pt-2 pb-3 space-y-1">
            <NavLink
              to="/dashboard"
              onClick={() => setShowMobileMenu(false)}
              className={({ isActive }) => 
                `block px-3 py-2 rounded-md ${isActive 
                  ? 'bg-blue-50 text-blue-600 font-medium' 
                  : 'text-gray-700 hover:bg-gray-50 hover:text-blue-600'}`
              }
            >
              Dashboard
            </NavLink>
            {role !== 'doctor' && (
              <NavLink
                to="/my-appointments"
                onClick={() => setShowMobileMenu(false)}
                className={({ isActive }) => 
                  `block px-3 py-2 rounded-md ${isActive 
                    ? 'bg-blue-50 text-blue-600 font-medium' 
                    : 'text-gray-700 hover:bg-gray-50 hover:text-blue-600'}`
                }
              >
                My Appointments
              </NavLink>
            )}
            <NavLink
              to="/new"
              onClick={() => setShowMobileMenu(false)}
              className={({ isActive }) => 
                `block px-3 py-2 rounded-md ${isActive 
                  ? 'bg-blue-50 text-blue-600 font-medium' 
                  : 'text-gray-700 hover:bg-gray-50 hover:text-blue-600'}`
              }
            >
              Communities
            </NavLink>
            <NavLink
              to="/chat"
              onClick={() => setShowMobileMenu(false)}
              className={({ isActive }) => 
                `block px-3 py-2 rounded-md ${isActive 
                  ? 'bg-blue-50 text-blue-600 font-medium' 
                  : 'text-gray-700 hover:bg-gray-50 hover:text-blue-600'}`
              }
            >
              Chat
            </NavLink>
            <NavLink
              to="/doctors"
              onClick={() => setShowMobileMenu(false)}
              className={({ isActive }) => 
                `block px-3 py-2 rounded-md ${isActive 
                  ? 'bg-blue-50 text-blue-600 font-medium' 
                  : 'text-gray-700 hover:bg-gray-50 hover:text-blue-600'}`
              }
            >
              Doctors
            </NavLink>
            {role === 'doctor' && (
              <NavLink
                to="/doctor/appointments"
                onClick={() => setShowMobileMenu(false)}
                className={({ isActive }) => 
                  `block px-3 py-2 rounded-md ${isActive 
                    ? 'bg-blue-50 text-blue-600 font-medium' 
                    : 'text-gray-700 hover:bg-gray-50 hover:text-blue-600'}`
                }
              >
                Appointments
              </NavLink>
            )}
            
            {/* Mobile profile options */}
            {isAuth ? (
              <>
                <div className="border-t border-gray-200 mt-3 pt-3">
                  <div className="px-3 py-2 flex items-center">
                    <CircleUserRound className="size-8 text-blue-600 bg-blue-100 p-0.5 border rounded-full mr-2" />
                    <span className="text-gray-700 font-medium">
                      {user?.firstName + " " + user?.lastName}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setIsAuth(false)
                      setShowMobileMenu(false)
                      setUser(null)
                      Cookies.remove('token')
                      Cookies.remove('id')
                      navigate('/')
                    }}
                    className="flex items-center w-full px-3 py-2 text-left text-red-500 hover:bg-gray-50"
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    Log out
                  </button>
                </div>
              </>
            ) : (
              <div className="border-t border-gray-200 mt-3 pt-3 flex flex-col space-y-2 px-3">
                <Link
                  to="/login"
                  onClick={() => setShowMobileMenu(false)}
                  className="w-full py-2 text-center text-gray-700 hover:text-blue-600 border border-gray-300 rounded-md"
                >
                  Login
                </Link>
                <Link
                  to="/signup"
                  onClick={() => setShowMobileMenu(false)}
                  className="w-full py-2 text-center bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Sign Up
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  )
}

export default Navbar
