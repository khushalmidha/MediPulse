import React, { useState, useEffect, useRef} from 'react'
import axios from 'axios'
import { Users, Plus, Calendar, Tag, Info, X } from 'lucide-react'
import { format } from 'date-fns'
import { useAuth } from '../context/AuthContext'
import { useLocation, useNavigate } from 'react-router-dom'
import { BACKEND_URL } from '../utils'

const CreateCommunityModal = ({ onClose, onCreate,newCommunity,user }) => {
  const [formData, setFormData] = useState(newCommunity || {
    title: '',
    bio: '',
    category: 'Health',
  });
  
  const handleInputChange = (e) => {
    e.preventDefault();
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };
  
  const handleSubmit = (e) => {
    e.preventDefault();
    onCreate(formData);
  };
  return (
    <>
      <div
        className='fixed inset-0 bg-black/40 backdrop-blur-sm z-40'
        onClick={onClose}></div>

      <div className='fixed inset-0 flex items-center justify-center p-4 z-50 pointer-events-none'>
        <div
          className='bg-white rounded-lg shadow-xl w-full max-w-md pointer-events-auto'
          onClick={(e) => e.stopPropagation()}>
          <div className='flex justify-between items-center border-b p-4'>
            <h2 className='text-xl font-bold text-gray-800'>
              Create New Community
            </h2>
            <button
              onClick={onClose}
              className='text-gray-400 hover:text-gray-600'>
              <X size={20} />
            </button>
          </div>

          <form
            onSubmit={handleSubmit}
            className='p-6'>
            <div className='mb-4'>
              <label
                className='block text-gray-700 text-sm font-medium mb-2'
                htmlFor='title'>
                Community Name
              </label>
              <input
                id='title'
                name='title'
                type='text'
                value={formData.title}
                onChange={handleInputChange}
                className='w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500'
                placeholder='Enter community name'
                required
              />
            </div>

            <div className='mb-4'>
              <label
                className='block text-gray-700 text-sm font-medium mb-2'
                htmlFor='category'>
                Category
              </label>
              <select
                id='category'
                name='category'
                value={formData.category}
                onChange={handleInputChange}
                className='w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500'
                required>
                <option value='Support Group'>Support Group</option>
                <option value='Health'>Health</option>
                <option value='Technology'>Technology</option>
                <option value='Education'>Education</option>
                <option value='Others'>Others</option>
              </select>
            </div>

            <div className='mb-4'>
              <label
                className='block text-gray-700 text-sm font-medium mb-2'
                htmlFor='bio'>
                Description
              </label>
              <textarea
                id='bio'
                name='bio'
                value={formData.bio}
                onChange={handleInputChange}
                className='w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 h-32 resize-none'
                placeholder='Tell us about your community'
                required></textarea>
            </div>

            <div className='mb-6'>
              <label
                className='block text-gray-700 text-sm font-medium mb-2'
                htmlFor='author'>
                Author
              </label>
              <input
                id='author'
                name='author'
                type='text'
                value={`${user?.firstName || ''} ${user?.lastName || ''}`}
                className='w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-100 cursor-not-allowed'
                disabled
              />
            </div>

            <div className='flex justify-end'>
              <button
                type='button'
                onClick={onClose}
                className='mr-2 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50'>
                Cancel
              </button>
              <button
                type='submit'
                className='px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700'>
                Create Community
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}

const CommunityCard = () => {
  const { user, setUser, role, loader, isAuth } = useAuth()
  const [availableCommunities, setAvailableCommunities] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedCommunity, setSelectedCommunity] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newCommunity, setNewCommunity] = useState({
    title: '',
    bio: '',
    category: 'Health',
  })
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  const communityRefs = useRef({})
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if(loader){
      return
    }
    if(!isAuth){
      navigate("/login")
    }
  },[loader,isAuth])

  useEffect(() => {
    if (showModal || showCreateModal) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'auto'
    }

    return () => {
      document.body.style.overflow = 'auto'
    }
  }, [showModal, showCreateModal])

  useEffect(() => {
    const fetchCommunities = async () => {
      try {
        setLoading(true)
        console.log("fetching communities")
        console.log(user)
        const res = await axios.get(`${BACKEND_URL}/community`, {
          withCredentials: true,
        })

        const userCommunityIds = user?.communities || []
        const notJoinedCommunities = res.data.filter(
          (community) => !userCommunityIds.includes(community._id)
        )

        setAvailableCommunities(notJoinedCommunities)
      } catch (error) {
        console.error('Error fetching communities:', error)
        setError('Failed to load communities')
      } finally {
        setLoading(false)
      }
    }

    fetchCommunities()
  }, [user])

  useEffect(() => {
    const hash = location.hash?.substring(1)

    if (hash && !loading && availableCommunities.length > 0) {
      setTimeout(() => {
        const element = communityRefs.current[hash]
        if (element) {
          element.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          })

          element.classList.add('ring-4', 'ring-blue-500', 'ring-opacity-50')
          setTimeout(() => {
            element.classList.remove(
              'ring-4',
              'ring-blue-500',
              'ring-opacity-50'
            )
            setSelectedCommunity(
              availableCommunities?.find((c) => c._id === hash)
            )
            setShowModal(true)
          }, 1000)
        }
      }, 500)
    }
  }, [location.hash, availableCommunities, loading, loader])

  const handleJoinCommunity = async (communityId) => {
    try {
      await axios.post(
        `${BACKEND_URL}/community/join`,
        {id: communityId},
        { withCredentials: true }
      )
      setUser((prev) => {
        return {
          ...prev,
          communities: [...prev.communities, communityId],
        }
      })

      setSuccess('Successfully joined the community!')
      setTimeout(() => setSuccess(null), 3000)
      setShowModal(false)
    } catch (error) {
      console.error('Error joining community:', error)
      setError('Failed to join community')
      setTimeout(() => setError(null), 3000)
    }
  }

  const handleCreateCommunity = async (newCommunity) => {
    try {
      const res = await axios.post(`${BACKEND_URL}/community/create`, newCommunity, {
        withCredentials: true,
      })

      setSuccess('Community created successfully!')
      setTimeout(() => setSuccess(null), 3000)
      setShowCreateModal(false)
      setUser((prev) => {
        return {
          ...prev,
          communities: [...prev.communities, res.data.community._id],
        }
      })
      setNewCommunity({
        title: '',
        bio: '',
        category: 'Health',
      })
    } catch (error) {
      console.error('Error creating community:', error)
      setError('Failed to create community')
      setTimeout(() => setError(null), 3000)
    }
  }

  const shareCommunityLink = (communityId) => {
    const url = `${window.location.origin}/communities#${communityId}`
    navigator.clipboard.writeText(url)
    setSuccess('Community link copied to clipboard!')
    setTimeout(() => setSuccess(null), 3000)
  }

  const CommunityDetailModal = ({ community, onClose, onJoin }) => {
    if (!community) return null

    return (
      <>
        <div
          className='fixed inset-0 bg-black/40 backdrop-blur-sm z-40'
          onClick={onClose}></div>
        <div className='fixed inset-0 flex items-center justify-center p-4 z-50 pointer-events-none'>
          <div
            className='bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden pointer-events-auto'
            onClick={(e) => e.stopPropagation()}>
            <div className='relative'>
              <div className='h-32 bg-gradient-to-r from-blue-500 to-indigo-600'></div>
              <button
                onClick={onClose}
                className='absolute top-3 right-3 bg-white rounded-full p-1 shadow-md hover:bg-gray-100'>
                <X size={20} />
              </button>
              <div className='absolute top-16 left-6 w-20 h-20 rounded-full bg-white p-1 shadow-md'>
                <div className='w-full h-full rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-2xl font-bold'>
                  {community.title.charAt(0)}
                </div>
              </div>
            </div>

            <div className='pt-12 px-6 pb-6'>
              <div className='flex items-center justify-between'>
                <h2 className='text-2xl font-bold text-gray-800'>
                  {community.title}
                </h2>
                <button
                  onClick={() => shareCommunityLink(community._id)}
                  className='text-blue-500 hover:text-blue-700'
                  title='Share community link'>
                  <svg
                    xmlns='http://www.w3.org/2000/svg'
                    fill='none'
                    viewBox='0 0 24 24'
                    stroke='currentColor'
                    className='w-5 h-5'>
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z'
                    />
                  </svg>
                </button>
              </div>

              <div className='mt-4 space-y-4'>
                <div className='flex items-start gap-2'>
                  <Info
                    className='text-blue-500 flex-shrink-0 mt-1'
                    size={18}
                  />
                  <p className='text-gray-600'>{community.bio}</p>
                </div>

                <div className='flex items-center gap-2'>
                  <Tag
                    className='text-blue-500'
                    size={18}
                  />
                  <span className='px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded-full'>
                    {community.category}
                  </span>
                </div>

                <div className='flex items-center gap-2'>
                  <Users
                    className='text-blue-500'
                    size={18}
                  />
                  <span className='text-gray-600'>
                    {community.members?.length || 0} members
                  </span>
                </div>

                <div className='flex items-center gap-2'>
                  <Calendar
                    className='text-blue-500'
                    size={18}
                  />
                  <span className='text-gray-600'>
                    Created on{' '}
                    {format(new Date(community.createdAt), 'MMM d, yyyy')}
                  </span>
                </div>
              </div>

              <button
                disabled={community.members?.includes(user?._id)}
                onClick={() => onJoin(community._id)}
                className='mt-6 w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors'>
                Join Community
              </button>
            </div>
          </div>
        </div>
      </>
    )
  }

  

  return (
    <div className='mx-4 sm:mx-8 md:mx-12 lg:mx-16 my-8'>
      {success && (
        <div className='fixed top-4 right-4 bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded z-50'>
          <span>{success}</span>
        </div>
      )}

      {error && (
        <div className='fixed top-4 right-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded z-50'>
          <span>{error}</span>
        </div>
      )}

      <div className='flex justify-between items-center mb-8'>
        <h2 className='text-2xl font-bold text-gray-800'>
          Discover Communities
        </h2>
        {(role==="doctor") && (<button
          onClick={() => setShowCreateModal(true)}
          className='flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors'>
          <Plus size={18} />
          Create Community
        </button>)}
      </div>

      {loading ? (
        <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'>
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className='bg-white rounded-lg shadow-md p-4 h-64 animate-pulse'>
              <div className='h-6 bg-gray-200 rounded w-3/4 mb-4'></div>
              <div className='h-4 bg-gray-200 rounded w-1/4 mb-3'></div>
              <div className='h-4 bg-gray-200 rounded w-full mb-2'></div>
              <div className='h-4 bg-gray-200 rounded w-full mb-2'></div>
              <div className='h-4 bg-gray-200 rounded w-3/4 mb-4'></div>
              <div className='h-8 bg-gray-200 rounded w-1/3 mt-auto'></div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {availableCommunities.length === 0 ? (
            <div className='bg-white rounded-lg shadow-md p-8 text-center'>
              <Users className='text-blue-600 bg-blue-100 size-16 p-4 rounded-full mx-auto mb-4' />
              <h3 className='text-xl font-semibold mb-2'>
                No New Communities Available
              </h3>
              <p className='text-gray-600 mb-6'>
                You've joined all available communities or there aren't any
                communities yet.
              </p>
              <button
                onClick={() => setShowCreateModal(true)}
                className='px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors'>
                Create Your Own
              </button>
            </div>
          ) : (
            <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'>
              {availableCommunities.map((community) => (
                <div
                  key={community._id}
                  id={community._id}
                  ref={(el) => (communityRefs.current[community._id] = el)}
                  className='bg-white rounded-lg shadow-md overflow-hidden flex flex-col h-64 hover:shadow-lg transition-all duration-300'>
                  <div className='h-2 bg-blue-500'></div>
                  <div className='p-6 flex-1 flex flex-col'>
                    <div className='flex items-center justify-between mb-3'>
                      <h3 className='text-xl font-bold text-gray-800 truncate'>
                        {community.title}
                      </h3>
                      <span className='px-2 py-1 bg-blue-100 text-blue-800 text-xs font-medium rounded-full'>
                        {community.category}
                      </span>
                    </div>

                    <p className='text-gray-600 line-clamp-3 mb-3'>
                      {community.bio}
                    </p>

                    <div className='flex items-center justify-between text-gray-500 text-sm mt-auto mb-3'>
                      <div className='flex items-center'>
                        <Calendar
                          size={14}
                          className='mr-1'
                        />
                        {format(new Date(community.createdAt), 'MMM d, yyyy')}
                      </div>
                      <button
                        onClick={() => shareCommunityLink(community._id)}
                        className='text-blue-500 hover:text-blue-700'
                        title='Share community link'>
                        <svg
                          xmlns='http://www.w3.org/2000/svg'
                          fill='none'
                          viewBox='0 0 24 24'
                          stroke='currentColor'
                          className='w-4 h-4'>
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth={2}
                            d='M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z'
                          />
                        </svg>
                      </button>
                    </div>

                    <button
                      onClick={() => {
                        setSelectedCommunity(community)
                        setShowModal(true)
                      }}
                      className='w-full py-2 mt-auto bg-blue-50 text-blue-600 font-medium rounded hover:bg-blue-100 transition-colors'>
                      View More
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {showModal && (
        <CommunityDetailModal
          community={selectedCommunity}
          onClose={() => setShowModal(false)}
          onJoin={handleJoinCommunity}
        />
      )}

      {showCreateModal && (
        <CreateCommunityModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateCommunity}
          newCommunity={newCommunity}
          user={user}
        />
      )}
    </div>
  )
}

export default CommunityCard
