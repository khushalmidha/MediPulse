import React, { useEffect, useState } from 'react'
import { useRef } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import {
  MapPin,
  Briefcase,
  GraduationCap,
  Building,
  ChevronLeftCircle,
  ChevronRightCircle,
} from 'lucide-react'
import { BACKEND_URL } from '../utils'

const RecommendationDoctors = () => {
  const [doctors, setDoctors] = useState([])
  const [loading, setLoading] = useState(true)
  
  useEffect(() => {
    const fetchDoctors = async () => {
      try {
        setLoading(true)
        const res = await axios.get(`${BACKEND_URL}/doctor`, {
          withCredentials: true,
        })
        const doctorItems = Array.isArray(res.data) ? res.data : res.data?.items || []
        const val = doctorItems.sort(
          (a, b) => b.experience?.years - a.experience?.years
        )
        setDoctors(val.slice(0, Math.min(8, val.length)))
      } catch (error) {
        console.error("Error fetching doctors:", error)
      } finally {
        setLoading(false)
      }
    }
    fetchDoctors()
  }, [])

  const scrollRef = useRef(null)

  const scrollLeft = () => {
    scrollRef.current.scrollBy({ left: -430, behavior: 'smooth' })
  }

  const scrollRight = () => {
    scrollRef.current.scrollBy({ left: 430, behavior: 'smooth' })
  }

  const getAvatarColor = (name) => {
    const colors = [
      'bg-blue-500 dark:bg-red-600', 'bg-indigo-500', 'bg-cyan-600', 'bg-teal-500', 
      'bg-green-500', 'bg-emerald-500', 'bg-purple-500'
    ];
    
    const charCode = name.charCodeAt(0);
    return colors[charCode % colors.length];
  };

  // Skeleton loader for doctors
  const DoctorSkeleton = () => (
    <div className='bg-white dark:bg-slate-950 rounded-lg shadow-md border border-gray-100 border-t-blue-500 border-t-8 min-w-[400px] p-6'>
      <div className='animate-pulse'>
        <div className='flex items-start'>
          <div className='flex-shrink-0 w-16 h-16 rounded-full bg-gray-200 mr-4'></div>
          <div className='flex-1 min-w-0'>
            <div className='h-5 bg-gray-200 rounded w-3/4 mb-2'></div>
            <div className='h-4 bg-gray-200 rounded w-1/2'></div>
          </div>
        </div>

        <div className='mt-5 space-y-3 text-sm'>
          <div className='flex items-center'>
            <div className='w-4 h-4 mr-2 bg-gray-200 rounded-full'></div>
            <div className='h-4 bg-gray-200 rounded w-2/3'></div>
          </div>
          <div className='flex items-center'>
            <div className='w-4 h-4 mr-2 bg-gray-200 rounded-full'></div>
            <div className='h-4 bg-gray-200 rounded w-3/4'></div>
          </div>
          <div className='flex items-center'>
            <div className='w-4 h-4 mr-2 bg-gray-200 rounded-full'></div>
            <div className='h-4 bg-gray-200 rounded w-4/5'></div>
          </div>
          <div className='flex items-center'>
            <div className='w-4 h-4 mr-2 bg-gray-200 rounded-full'></div>
            <div className='h-4 bg-gray-200 rounded w-3/4'></div>
          </div>
        </div>

        <div className='mt-6'>
          <div className='h-10 bg-gray-200 rounded-md'></div>
        </div>
      </div>
    </div>
  );

  return (
    <div className='bg-white dark:bg-slate-950 p-6 rounded-lg shadow-md w-full relative'>
      {/* Scroll buttons - only show when not loading and have enough doctors */}
      {!loading && doctors?.length > 3 && (
        <>
          <button
            onClick={scrollLeft}
            className='absolute left-2 top-1/2 transform -translate-y-1/2 bg-gray-300 rounded-full p-3 shadow-md cursor-pointer z-10'>
            <ChevronLeftCircle className='bg-blue-500 dark:bg-red-600 text-white rounded-2xl h-7 w-7' />
          </button>
          <button
            onClick={scrollRight}
            className='absolute right-2 top-1/2 transform -translate-y-1/2 bg-gray-300 rounded-full p-3 shadow-md cursor-pointer z-10'>
            <ChevronRightCircle className='bg-blue-500 dark:bg-red-600 text-white rounded-2xl h-7 w-7' />
          </button>
        </>
      )}

      {/* Horizontal Scrolling Container */}
      <div
        ref={scrollRef}
        className='flex overflow-x-auto space-x-6 scrollbar-hide p-3'>
        
        {/* Show skeleton loaders while loading */}
        {loading ? (
          // Create 4 skeleton loaders
          Array.from({ length: 4 }).map((_, index) => (
            <DoctorSkeleton key={index} />
          ))
        ) : (
          // Show actual doctor data when loaded
          doctors?.map((doctor) => (
            <div
              key={doctor._id}
              className='bg-white dark:bg-slate-950 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-300 border border-gray-100 border-t-blue-500 border-t-8 min-w-[400px]'>
              <div className='p-6'>
                <div className='flex items-start'>
                  <div
                    className={`flex-shrink-0 w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold mr-4 ${getAvatarColor(
                      doctor.firstName
                    )}`}>
                    {doctor.firstName.charAt(0)}
                    {doctor.lastName ? doctor.lastName.charAt(0) : ''}
                  </div>

                  <div className='flex-1 min-w-0'>
                    <h3 className='text-xl font-bold text-gray-800 dark:text-slate-200 truncate'>
                      Dr. {doctor.firstName} {doctor.lastName || ''}
                    </h3>

                    <p className='text-blue-600 dark:text-red-500 font-medium truncate'>
                      {doctor.experience?.expertise || 'Medical Professional'}
                    </p>
                  </div>
                </div>

                <div className='mt-5 space-y-2.5 text-sm'>
                  <div className='flex items-center text-gray-600'>
                    <Briefcase className='w-4 h-4 mr-2 text-blue-500 flex-shrink-0' />
                    <span>
                      {doctor.experience?.years || 0} years of experience
                    </span>
                  </div>

                  {doctor.experience?.qualification && (
                    <div className='flex items-center text-gray-600'>
                      <GraduationCap className='w-4 h-4 mr-2 text-blue-500 flex-shrink-0' />
                      <span>{doctor.experience.qualification}</span>
                    </div>
                  )}

                  {doctor.clinic?.name && (
                    <div className='flex items-center text-gray-600'>
                      <Building className='w-4 h-4 mr-2 text-blue-500 flex-shrink-0' />
                      <span className='truncate'>{doctor.clinic.name}</span>
                    </div>
                  )}

                  {doctor.clinic?.location && (
                    <div className='flex items-start text-gray-600'>
                      <MapPin className='w-4 h-4 mr-2 text-blue-500 flex-shrink-0 mt-0.5' />
                      <span className='line-clamp-1'>
                        {doctor.clinic.location}
                      </span>
                    </div>
                  )}
                </div>

                <div className='mt-6'>
                  <Link
                    to={
                      doctor.sourceType === "hospital" && doctor.hospitalContext?.hospitalSlug
                        ? `/hospitals/${doctor.hospitalContext.hospitalSlug}`
                        : `/doctorsprofile/${doctor._id}`
                    }
                    className='block w-full py-2.5 bg-blue-600 dark:bg-red-700 hover:bg-blue-700 text-white text-center rounded-md transition duration-200 font-medium'>
                    {doctor.sourceType === "hospital" ? "Book at Hospital" : "View Profile"}
                  </Link>
                </div>
              </div>
            </div>
          ))
        )}

        {/* Show empty state if no doctors found and not loading */}
        {!loading && doctors.length === 0 && (
          <div className='flex flex-col items-center justify-center w-full py-12 text-center'>
            <div className='bg-blue-50 rounded-full p-4 mb-4'>
              <Briefcase className='h-8 w-8 text-blue-500' />
            </div>
            <h3 className='text-xl font-semibold text-gray-800 dark:text-slate-200 mb-2'>No doctors found</h3>
            <p className='text-gray-600 max-w-md'>
              We couldn't find any doctors to recommend at the moment. Please check back later.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default RecommendationDoctors