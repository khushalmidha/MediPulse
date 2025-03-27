import axios from 'axios'
import { createContext, useContext, useEffect, useState } from 'react'
import { BACKEND_URL } from '../utils'

const AuthContext = createContext(null)

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [isAuth, setIsAuth] = useState(false)
  const [role, setRole] = useState('user')
  const [communities, setcommunities] = useState(null)
  const [loader, setLoading] = useState(true)
  useEffect(() => {
    const check = async () => {
      try {
        const res = await axios.get(`${BACKEND_URL}/verify/`, {
          withCredentials: true,
          credentials: 'include',
        })
        if (res.status === 200) {
          console.log({ hi: res.data })
          setUser(res.data.data)
          setRole(res.data.role)
          setIsAuth(true)
          return
        }
      } catch (err) {
        console.log(err)
        setUser(null)
        setIsAuth(false)
      }
      finally{
        setLoading(false)
      }
    }
    check()
  }, [])
  useEffect(()=>{
    if(isAuth){
      fetchCommunities()
    }
  },[user])
  const fetchCommunities = async () => {
    try {
      const res = await axios.get(`${BACKEND_URL}/community/user`, {
        withCredentials: true,
        credentials: 'include',
      })
      console.log(res.data)
      setcommunities(res.data)
    } catch (err) {
      console.log(err)
    }
  }

  const leaveCommunity = async (id) => {
    try{
      const res = await axios.post(`${BACKEND_URL}/community/leave`,{ id },{ withCredentials: true, credentials: 'include' })
      console.log("leave" , res.data)
      setUser(res.data.user)
      fetchCommunities()
    }
    catch(err){
      console.log(err)
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
        loader
      }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
