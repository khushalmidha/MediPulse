import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import axios from 'axios'
import {
  Calendar,
  MapPin,
  Phone,
  Mail,
  User,
  Briefcase,
  Building,
  GraduationCap,
  ChevronLeft,
  CalendarPlus,
  X,
  Users,
} from 'lucide-react'
import { BACKEND_URL, MAPS_API } from '../utils'
import { useAuth } from '../context/AuthContext'

const DoctorsProfile = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const { role } = useAuth()
  const [doctor, setDoctor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showTab, setShowTab] = useState('about')

  // Google Maps API Key - Replace with your key
  const GOOGLE_MAPS_API_KEY = MAPS_API

  useEffect(() => {
    const fetchDoctorDetails = async () => {
      try {
        setLoading(true)
        const response = await axios.get(`${BACKEND_URL}/doctor/${id}`, {
          withCredentials: true,
        })
        console.log(response.data)
        setDoctor({...response.data.user, communities: response.data.communities})
        setLoading(false)
      } catch (err) {
        console.error('Error fetching doctor details:', err)
        setError('Failed to load doctor information. Please try again later.')
        setLoading(false)
      }
    }

    fetchDoctorDetails()
  }, [id])

  const getAvatarColor = (name) => {
    if (!name) return 'bg-blue-500'

    const colors = [
      'bg-blue-500',
      'bg-indigo-500',
      'bg-cyan-600',
      'bg-teal-500',
      'bg-green-500',
      'bg-emerald-500',
      'bg-purple-500',
    ]

    const charCode = name.charCodeAt(0)
    return colors[charCode % colors.length]
  }

  const handleBookAppointment = () => {
    // Navigate to appointment booking page
    navigate(`/appointment/book/${doctor._id}`)
  }

  const getGoogleMapsUrl = () => {
    if (!doctor?.clinic?.location) return null

    // Encode clinic location for Google Maps URL
    const encodedAddress = encodeURIComponent(
      `${doctor.clinic.name || ''}, ${doctor.clinic.location}`
    )

    // Generate embeddable Google Maps URL
    return `https://www.google.com/maps/embed/v1/place?key=${GOOGLE_MAPS_API_KEY}&q=${encodedAddress}&zoom=15`
  }

  // Display loading state with responsive skeleton
  if (loading) {
    return (
      <div className='min-h-screen bg-gray-50 py-6 sm:py-12 px-4 sm:px-6 lg:px-8'>
        <div className='max-w-5xl mx-auto'>
          <div className='animate-pulse'>
            <div className='h-40 sm:h-64 bg-gray-200 rounded-lg mb-6'></div>
            <div className='h-8 bg-gray-200 rounded w-1/3 mb-4'></div>
            <div className='h-4 bg-gray-200 rounded w-1/4 mb-6'></div>

            <div className='grid grid-cols-1 md:grid-cols-3 gap-6'>
              <div className='md:col-span-2 space-y-4'>
                <div className='h-32 bg-gray-200 rounded mb-4'></div>
                <div className='h-40 bg-gray-200 rounded'></div>
              </div>
              <div className='md:col-span-1'>
                <div className='h-64 sm:h-80 bg-gray-200 rounded'></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Display error state with responsive design
  if (error || !doctor) {
    return (
      <div className='min-h-screen bg-gray-50 py-6 sm:py-12 px-4 sm:px-6 lg:px-8 flex items-center justify-center'>
        <div className='w-full max-w-md text-center'>
          <div className='bg-white shadow rounded-lg p-6 sm:p-8'>
            <div className='inline-flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-full bg-red-100 text-red-600 mb-4 sm:mb-6'>
              <X className='h-6 w-6 sm:h-8 sm:w-8' />
            </div>
            <h2 className='text-xl sm:text-2xl font-bold text-gray-900 mb-2'>
              Error Loading Doctor Profile
            </h2>
            <p className='text-gray-600 mb-6'>{error || 'Doctor not found'}</p>
            <button
              onClick={() => navigate('/doctors')}
              className='w-full sm:w-auto px-4 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors'>
              <ChevronLeft className='inline mr-1 h-4 w-4' />
              Return to Doctors Directory
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='min-h-screen bg-gray-50 pb-8 sm:pb-12'>
      {/* Responsive Header with gradient background */}
      <div className='bg-gradient-to-r from-blue-600 to-indigo-600 pt-8 sm:pt-12 pb-24 sm:pb-32 px-4'>
        <div className='max-w-5xl mx-auto'>
          <button
            onClick={() => navigate('/doctors')}
            className='inline-flex items-center text-white opacity-80 hover:opacity-100 transition-opacity mb-4 sm:mb-6 text-sm sm:text-base'>
            <ChevronLeft className='h-4 w-4 sm:h-5 sm:w-5 mr-1' />
            Back to Doctors Directory
          </button>
        </div>
      </div>

      {/* Main content area that overlaps the header */}
      <div className='max-w-5xl mx-auto px-4 -mt-20 sm:-mt-24 space-y-6'>
        {/* Doctor Profile Card */}
        <div className='bg-white rounded-lg shadow-md overflow-hidden'>
          <div className='p-5 sm:p-8'>
            {/* Doctor info section - responsive layout */}
            <div className='flex flex-col sm:flex-row items-center sm:items-start'>
              {/* Doctor avatar - responsive sizing */}
              <div className='mb-5 sm:mb-0 sm:mr-6 flex flex-col items-center'>
                <div
                  className={`w-24 h-24 sm:w-28 sm:h-28 lg:w-32 lg:h-32 rounded-full flex items-center justify-center text-white text-2xl sm:text-3xl font-bold ${getAvatarColor(
                    doctor.firstName
                  )}`}>
                  {doctor.firstName.charAt(0)}
                  {doctor.lastName ? doctor.lastName.charAt(0) : ''}
                </div>
                <div className='mt-2 text-center'>
                  <div className='text-sm text-blue-600 font-medium'>
                    {doctor.gender === 'male'
                      ? 'Male'
                      : doctor.gender === 'female'
                      ? 'Female'
                      : 'Other'}
                  </div>
                </div>
              </div>

              {/* Doctor details - stacks on mobile, side by side on larger screens */}
              <div className='flex-grow text-center sm:text-left'>
                <div className='sm:flex sm:items-start sm:justify-between mb-4'>
                  <div>
                    <h1 className='text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900'>
                      Dr. {doctor.firstName} {doctor.lastName || ''}
                    </h1>
                    <p className='text-md sm:text-lg text-blue-600 font-medium mt-1'>
                      {doctor.experience?.expertise || 'Medical Professional'}
                    </p>
                  </div>

                  {doctor.experience?.qualification && (
                    <div className='mt-3 sm:mt-0.5 inline-flex items-center text-gray-700 bg-blue-50 px-3 py-1 rounded-full'>
                      <GraduationCap className='h-4 w-4 mr-1 text-blue-600 flex-shrink-0' />
                      <span className='text-sm'>
                        {doctor.experience.qualification}
                      </span>
                    </div>
                  )}
                </div>

                {/* Doctor details in grid - responsive columns */}
                <div className='grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-4 mb-6 text-sm sm:text-base'>
                  <div className='flex items-center justify-center sm:justify-start'>
                    <Briefcase className='h-4 w-4 sm:h-5 sm:w-5 text-blue-500 mr-2 flex-shrink-0' />
                    <span className='text-gray-700'>
                      {doctor.experience?.years || 0} years of experience
                    </span>
                  </div>

                  {doctor.clinic?.name && (
                    <div className='flex items-center justify-center sm:justify-start'>
                      <Building className='h-4 w-4 sm:h-5 sm:w-5 text-blue-500 mr-2 flex-shrink-0' />
                      <span className='text-gray-700 truncate max-w-[200px]'>
                        {doctor.clinic.name}
                      </span>
                    </div>
                  )}

                  {doctor.email && (
                    <div className='flex items-center justify-center sm:justify-start'>
                      <Mail className='h-4 w-4 sm:h-5 sm:w-5 text-blue-500 mr-2 flex-shrink-0' />
                      <span className='text-gray-700 max-w-[200px]'>
                        {doctor.email}
                      </span>
                    </div>
                  )}

                  {doctor.phone && (
                    <div className='flex items-center justify-center sm:justify-start'>
                      <Phone className='h-4 w-4 sm:h-5 sm:w-5 text-blue-500 mr-2 flex-shrink-0' />
                      <span className='text-gray-700'>{doctor.phone}</span>
                    </div>
                  )}
                </div>

                <div className='flex flex-wrap gap-2'>
                  {role === 'user' && (
                    <button
                      type='button'
                      onClick={handleBookAppointment}
                      className='inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700'>
                      <CalendarPlus className='mr-2 h-4 w-4' />
                      Book Appointment
                    </button>
                  )}
                  {role === 'doctor' && (
                    <button
                      type='button'
                      onClick={() => navigate('/doctor/appointments')}
                      className='inline-flex items-center rounded-md border border-blue-600 px-4 py-2 text-blue-700 hover:bg-blue-50'>
                      <CalendarPlus className='mr-2 h-4 w-4' />
                      Open Appointment Queue
                    </button>
                  )}
                </div>

              </div>
            </div>
          </div>

          {/* Tab navigation - horizontally scrollable on mobile */}
          <div className='border-t border-b'>
            <div className='flex overflow-x-auto scrollbar-hide'>
              <button
                onClick={() => setShowTab('about')}
                className={`px-4 sm:px-6 py-3 font-medium text-sm focus:outline-none whitespace-nowrap flex-1 ${
                  showTab === 'about'
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}>
                About & Experience
              </button>
              <button
                onClick={() => setShowTab('communities')}
                className={`px-4 sm:px-6 py-3 font-medium text-sm focus:outline-none whitespace-nowrap flex-1 ${
                  showTab === 'communities'
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}>
                Communities
              </button>
              <button
                onClick={() => setShowTab('location')}
                className={`px-4 sm:px-6 py-3 font-medium text-sm focus:outline-none whitespace-nowrap flex-1 ${
                  showTab === 'location'
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}>
                Location & Contact
              </button>
            </div>
          </div>

          {/* Tab content - responsive padding */}
          <div className='p-5 sm:p-8'>
            {/* About tab content */}
            {showTab === 'about' && (
              <div className='space-y-6'>
                {/* Bio section */}
                {doctor.bio && (
                  <div>
                    <h3 className='text-lg font-bold text-gray-800 mb-2 sm:mb-3'>
                      Biography
                    </h3>
                    <p className='text-gray-600 text-sm sm:text-base'>
                      {doctor.bio}
                    </p>
                  </div>
                )}

                {/* Experience section */}
                <div>
                  <h3 className='text-lg font-bold text-gray-800 mb-2 sm:mb-3'>
                    Professional Experience
                  </h3>
                  <div className='bg-gray-50 rounded-lg p-4 sm:p-5'>
                    <div className='flex flex-col sm:flex-row sm:items-start'>
                      <div className='bg-blue-100 p-2 rounded-full self-center sm:self-auto mb-3 sm:mb-0'>
                        <Briefcase className='h-5 w-5 text-blue-600' />
                      </div>
                      <div className='sm:ml-4 text-center sm:text-left'>
                        <h4 className='font-medium text-gray-900'>
                          {doctor.experience?.expertise ||
                            'Medical Professional'}
                        </h4>
                        <p className='text-gray-600 mt-1'>
                          {doctor.experience?.years || 0} years of experience
                        </p>
                        {doctor.experience?.qualification && (
                          <div className='mt-2 flex items-center justify-center sm:justify-start'>
                            <GraduationCap className='h-4 w-4 mr-1 text-blue-500 flex-shrink-0' />
                            <span className='text-sm text-gray-600'>
                              {doctor.experience.qualification}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Location tab content */}
            {showTab === 'location' && (
              <div className='space-y-6'>
                {/* Clinic info section */}
                {(doctor.clinic?.name || doctor.clinic?.location) && (
                  <div>
                    <h3 className='text-lg font-bold text-gray-800 mb-2 sm:mb-3'>
                      Clinic Information
                    </h3>
                    <div className='bg-gray-50 rounded-lg p-4 sm:p-5'>
                      {doctor.clinic?.name && (
                        <div className='flex items-center mb-3'>
                          <Building className='h-4 w-4 sm:h-5 sm:w-5 text-blue-500 mr-2 flex-shrink-0' />
                          <span className='text-gray-700 font-medium'>
                            {doctor.clinic.name}
                          </span>
                        </div>
                      )}

                      {doctor.clinic?.location && (
                        <div className='flex items-start mb-3'>
                          <MapPin className='h-4 w-4 sm:h-5 sm:w-5 text-blue-500 mr-2 mt-0.5 flex-shrink-0' />
                          <span className='text-gray-700'>
                            {doctor.clinic.location}
                            {doctor.clinic.pin
                              ? `, PIN: ${doctor.clinic.pin}`
                              : ''}
                          </span>
                        </div>
                      )}

                      {doctor.clinic?.phoneNumber && (
                        <div className='flex items-center'>
                          <Phone className='h-4 w-4 sm:h-5 sm:w-5 text-blue-500 mr-2 flex-shrink-0' />
                          <span className='text-gray-700'>
                            {doctor.clinic.phoneNumber}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Google Maps integration - responsive height */}
                {doctor.clinic?.location && (
                  <div>
                    <h3 className='text-lg font-bold text-gray-800 mb-2 sm:mb-3'>
                      Clinic Location
                    </h3>
                    <div className='bg-gray-200 rounded-lg overflow-hidden h-56 sm:h-64 md:h-80'>
                      <iframe
                        title='Clinic Location'
                        width='100%'
                        height='100%'
                        frameBorder='0'
                        src={getGoogleMapsUrl()}
                        allowFullScreen
                        loading='lazy'></iframe>
                    </div>
                    <div className='mt-2 text-center'>
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                          `${doctor.clinic.name || ''}, ${
                            doctor.clinic.location
                          }`
                        )}`}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='text-blue-600 hover:text-blue-800 text-sm inline-flex items-center'>
                        <MapPin className='h-4 w-4 mr-1' />
                        Open in Google Maps
                      </a>
                    </div>
                  </div>
                )}

                {/* Contact information */}
                <div>
                  <h3 className='text-lg font-bold text-gray-800 mb-2 sm:mb-3'>
                    Contact Information
                  </h3>
                  <div className='bg-gray-50 rounded-lg p-4 sm:p-5 space-y-3'>
                    {doctor.email && (
                      <div className='flex items-center'>
                        <Mail className='h-4 w-4 sm:h-5 sm:w-5 text-blue-500 mr-2 flex-shrink-0' />
                        <a
                          href={`mailto:${doctor.email}`}
                          className='text-blue-600 hover:text-blue-800 text-sm sm:text-base truncate'>
                          {doctor.email}
                        </a>
                      </div>
                    )}

                    {doctor.phone && (
                      <div className='flex items-center'>
                        <Phone className='h-4 w-4 sm:h-5 sm:w-5 text-blue-500 mr-2 flex-shrink-0' />
                        <a
                          href={`tel:${doctor.phone}`}
                          className='text-blue-600 hover:text-blue-800 text-sm sm:text-base'>
                          {doctor.phone}
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Communities tab content */}
            {showTab === 'communities' && (
              <div className='space-y-6'>
                <h3 className='text-lg font-bold text-gray-800 mb-2 sm:mb-3'>
                  Doctor's Communities
                </h3>

                {!doctor.communities || doctor.communities.length === 0 ? (
                  <div className='bg-gray-50 rounded-lg p-8 text-center'>
                    <div className='inline-flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-blue-600 mb-4'>
                      <User className='h-6 w-6' />
                    </div>
                    <h4 className='text-lg font-medium text-gray-900 mb-1'>
                      No Communities
                    </h4>
                    <p className='text-gray-600'>
                      This doctor hasn't created any communities yet.
                    </p>
                  </div>
                ) : (
                  <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                    {doctor.communities.map((community) => (
                      <Link
                        to={`/communities#${community._id}`}
                        key={community._id}
                        className='group bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow'>
                        <div className='flex items-start justify-between mb-2'>
                          <h4 className='font-bold text-gray-900 line-clamp-1 group-hover:text-blue-600 transition-colors'>
                            {community.title}
                          </h4>
                          <span className='px-2 py-0.5 bg-blue-100 text-blue-800 text-xs font-medium rounded-full whitespace-nowrap'>
                            {community.category}
                          </span>
                        </div>

                        <p className='text-gray-600 text-sm line-clamp-2 mb-3'>
                          {community.bio}
                        </p>

                        <div className='mt-auto flex items-center justify-between text-xs text-gray-500'>
                          <div className='flex items-center'>
                            <Users className='w-3 h-3 mr-1' />
                            <span>
                              {community.members?.length || 0} members
                            </span>
                          </div>
                          <div className='flex items-center'>
                            <Calendar className='w-3 h-3 mr-1' />
                            <span>
                              {new Date(
                                community.createdAt
                              ).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default DoctorsProfile
