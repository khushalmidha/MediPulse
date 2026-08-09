import { useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  Calendar,
  Check,
  ChevronLeftCircle,
  ChevronRightCircle,
  AlertTriangle,
} from 'lucide-react'
import { format } from 'date-fns'
import { Link } from 'react-router-dom'

const RecommendedCommunities = () => {
  const { communities, leaveCommunity } = useAuth()
  const [copy, setCopy] = useState(null)
  const scrollRef = useRef(null)
  const [showModal, setShowModal] = useState(false)
  const [selectedCommunity, setSelectedCommunity] = useState(null)
  const [loading, setLoading] = useState(false)
  const scrollLeft = () => {
    scrollRef.current.scrollBy({ left: -350, behavior: 'smooth' })
  }

  const scrollRight = () => {
    scrollRef.current.scrollBy({ left: 350, behavior: 'smooth' })
  }

  const shareCommunityLink = (communityId) => {
    const url = `${window.location.origin}/communities#${communityId}`
    navigator.clipboard.writeText(url)
    setCopy(communityId)
    setTimeout(() => {
      setCopy(null)
    }, 2000)
  }

  const LeaveCommunityModal = () => {
    if (!selectedCommunity) return null

    return (
      <>
        <div className='fixed inset-0 bg-black/40 backdrop-blur-sm z-40'></div>

        <div className='fixed inset-0 flex items-center justify-center p-4 z-50 pointer-events-none'>
          <div className='bg-white dark:bg-slate-950 rounded-lg shadow-xl w-full max-w-md overflow-hidden pointer-events-auto'>
            <div className='p-6'>
              <div className='flex flex-col items-center text-center mb-6'>
                <div className='w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4'>
                  <AlertTriangle className='text-red-500 h-8 w-8' />
                </div>
                <h3 className='text-xl font-bold text-gray-800 dark:text-slate-200 mb-1'>
                  Leave Community
                </h3>
                <p className='text-gray-600'>
                  Are you sure you want to leave{' '}
                  <span className='font-semibold'>
                    {selectedCommunity.title}
                  </span>
                  ?
                </p>
              </div>

              <div className='p-4 bg-amber-50 rounded-lg mb-6'>
                <p className='text-sm text-amber-800'>
                  You will no longer have access to this community's discussions
                  and resources. You can rejoin later if you change your mind.
                </p>
              </div>

              <div className='flex justify-end space-x-3'>
                <button
                  onClick={() => setShowModal(false)}
                  className='px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 dark:bg-slate-900 transition-colors'
                  disabled={loading}>
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setLoading(true)
                    leaveCommunity(selectedCommunity._id)
                    setShowModal(false)
                    setLoading(false)
                  }}
                  className='px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors flex items-center justify-center'
                  disabled={loading}>
                  {loading ? (
                    <div className='w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2'></div>
                  ) : null}
                  Leave Community
                </button>
              </div>
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className='bg-white dark:bg-slate-950 p-6 rounded-lg shadow-md w-full relative'>
        <div className='flex justify-between px-2'>
          <h3 className='text-lg font-bold mb-4'>Your Communities</h3>
          <Link to={'/communities'}>
            <button className='bg-red-600 dark:bg-red-700 text-white px-2 py-1 rounded-lg hover:bg-blue-700 transition-colors cursor-pointer'>
              Explore All
            </button>
          </Link>
        </div>

        {/* Scroll buttons */}
        {communities?.length > 3 && (
          <>
            <button
              onClick={scrollLeft}
              className='absolute left-2 top-1/2 transform -translate-y-1/2 bg-gray-300 rounded-full p-3 shadow-md cursor-pointer'>
              <ChevronLeftCircle className='bg-red-500 dark:bg-red-600 text-white rounded-2xl h-7 w-7' />
            </button>
            <button
              onClick={scrollRight}
              className='absolute right-2 top-1/2 transform -translate-y-1/2 bg-gray-300 rounded-full p-3 shadow-md cursor-pointer'>
              <ChevronRightCircle className='bg-red-500 dark:bg-red-600 text-white rounded-2xl h-7 w-7' />
            </button>
          </>
        )}

        {/* Horizontal Scrolling Container */}
        <div
          ref={scrollRef}
          className='flex overflow-x-auto space-x-6 scrollbar-hide p-3'>
          {communities?.length === 0 && (
            <div className='bg-white dark:bg-slate-950 rounded-lg shadow-md overflow-hidden text-center flex flex-col h-64 w-[100%] justify-center'>
              No Community Joined
            </div>
          )}
          {communities?.map((community) => (
            <div
              key={community._id}
              id={community._id}
              className='bg-white dark:bg-slate-950 rounded-lg shadow-md overflow-hidden flex flex-col h-64 hover:shadow-lg transition-shadow min-w-[350px] duration-300'>
              <div className='h-2 bg-red-500 dark:bg-red-600'></div>
              <div className='p-6 flex-1 flex flex-col'>
                <div className='flex items-center justify-between mb-3'>
                  <h3 className='text-xl font-bold text-gray-800 dark:text-slate-200 truncate'>
                    {community.title}
                  </h3>
                  <span className='px-2 py-1 bg-red-100 text-blue-800 text-xs font-medium rounded-full'>
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
                  {copy === community._id ? (
                    <Check className='w-4 h-4 text-white bg-green-700 rounded-2xl '></Check>
                  ) : (
                    <button
                      onClick={() => shareCommunityLink(community._id)}
                      className='text-red-500 hover:text-blue-700 cursor-pointer'
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
                  )}
                </div>

                <button
                  onClick={() => {
                    setSelectedCommunity(community)
                    setShowModal(true)
                  }}
                  className='w-full py-2 mt-auto bg-red-50 text-red-600 font-medium rounded hover:bg-red-100 transition-colors'>
                  Leave
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showModal && <LeaveCommunityModal />}
    </>
  )
}

export default RecommendedCommunities
