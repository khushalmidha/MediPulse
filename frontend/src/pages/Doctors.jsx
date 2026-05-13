import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { MapPin, Briefcase, Search, Filter, User, GraduationCap, Building, X } from 'lucide-react';
import { BACKEND_URL } from '../utils';

const Doctors = () => {
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [selectedSpecialty, setSelectedSpecialty] = useState('');
  const [specialties,setSpecialities] = useState([])

  useEffect(() => {
    const fetchDoctors = async () => {
      try {
        setLoading(true);
        const response = await axios.get(`${BACKEND_URL}/doctor`, {
          withCredentials: true
        });
        const data = new Set(response.data.map(doctor => doctor.experience?.expertise))
        console.log("speciality",[...data])
        setSpecialities([...data])
        setDoctors(response.data);
        setLoading(false);
      } catch (err) {
        console.error('Error fetching doctors:', err);
        setError('Failed to load doctors. Please try again later.');
        setLoading(false);
      }
    };

    fetchDoctors();
  }, []);

  // Filter doctors based on search term and filters
  const filteredDoctors = doctors.filter(doctor => {
    const fullName = `${doctor.firstName} ${doctor.lastName || ''}`.toLowerCase();
    const expertise = doctor.experience?.expertise?.toLowerCase() || '';
    const clinic = doctor.clinic?.name?.toLowerCase() || '';
    const qualification = doctor.experience?.qualification?.toLowerCase() || '';
    
    const matchesSearch = 
      fullName.toLowerCase().includes(searchTerm.toLowerCase()) || 
      expertise?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      clinic?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      qualification?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSpecialty = !selectedSpecialty || 
      expertise?.toLowerCase().includes(selectedSpecialty.toLowerCase());
      
    if (selectedFilter === 'all') return matchesSearch && matchesSpecialty;
    if (selectedFilter === 'experience') return matchesSearch && matchesSpecialty && doctor.experience?.years >= 5;
    
    return matchesSearch && matchesSpecialty;
  });

  // Generate a color based on doctor's name
  const getAvatarColor = (name) => {
    const colors = [
      'bg-blue-500', 'bg-indigo-500', 'bg-cyan-600', 'bg-teal-500', 
      'bg-green-500', 'bg-emerald-500', 'bg-purple-500'
    ];
    
    const charCode = name.charCodeAt(0);
    return colors[charCode % colors.length];
  };

  return (
    <div className="bg-gray-50 min-h-screen pb-12">
      {/* Header Section */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-12 px-4">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl md:text-4xl font-bold mb-3">Connect Doctor</h1>
          
          {/* Search Section */}
          <div className="bg-white rounded-lg p-1 flex flex-col sm:flex-row items-center shadow-md max-w-3xl">
            <div className="flex-grow flex items-center w-full sm:w-auto">
              <Search className="text-gray-500 ml-3" size={20} />
              <input
                type="text"
                placeholder="Search by name, specialty, or clinic..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="flex-grow py-2 px-4 outline-none text-gray-700 w-full"
              />
              {searchTerm && (
                <button 
                  onClick={() => setSearchTerm('')}
                  className="text-gray-400 hover:text-gray-600 mr-2"
                >
                  <X size={18} />
                </button>
              )}
            </div>
            <div className="flex items-center space-x-2 py-2 w-full sm:w-auto">
              <div className="relative w-full sm:w-auto">
                <select 
                  className="appearance-none bg-blue-50 text-blue-700 py-2 px-4 pr-8 rounded-md font-medium cursor-pointer"
                  value={selectedFilter}
                  onChange={(e) => setSelectedFilter(e.target.value)}
                >
                  <option value="all">All Doctors</option>
                  <option value="experience">Experienced (5+ yrs)</option>
                </select>
                <Filter className="absolute right-2 top-2.5 text-blue-700 pointer-events-none" size={16} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Specialty Filter */}
      <div className="max-w-7xl mx-auto px-4 pt-6 pb-0">
        <div className="overflow-x-auto pb-3">
          <div className="flex space-x-2 min-w-max">
            <button
              className={`px-4 py-2 rounded-full whitespace-nowrap text-sm font-medium transition-colors cursor-pointer
                ${selectedSpecialty === '' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              onClick={() => setSelectedSpecialty('')}
            >
              All Doctors
            </button>
            {specialties?.map(specialty => (
              <button
                key={specialty}
                className={`px-4 py-2 rounded-full whitespace-nowrap text-sm font-medium transition-colors cursor-pointer
                  ${selectedSpecialty === specialty ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                onClick={() => setSelectedSpecialty(specialty)}
              >
                {specialty}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-white rounded-lg shadow-md p-6 animate-pulse">
                <div className="flex items-center space-x-4 mb-4">
                  <div className="w-16 h-16 bg-gray-200 rounded-full"></div>
                  <div className="space-y-2 flex-1">
                    <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                    <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                  </div>
                </div>
                <div className="space-y-3 mt-6">
                  <div className="h-3 bg-gray-200 rounded w-full"></div>
                  <div className="h-3 bg-gray-200 rounded w-full"></div>
                  <div className="h-3 bg-gray-200 rounded w-3/4"></div>
                </div>
                <div className="h-9 bg-gray-200 rounded-md mt-6"></div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="bg-red-50 p-8 rounded-lg text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 text-red-500 mb-4">
              <X size={32} />
            </div>
            <h3 className="text-xl font-bold text-gray-800 mb-2">Something went wrong</h3>
            <p className="text-red-600 mb-4">{error}</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Try Again
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-800">
                {filteredDoctors.length > 0 
                  ? `${filteredDoctors.length} ${filteredDoctors.length === 1 ? 'Doctor' : 'Doctors'} Available`
                  : 'No doctors match your criteria'}
              </h2>
              
              {(searchTerm || selectedSpecialty || selectedFilter !== 'all') && (
                <button
                  onClick={() => {
                    setSearchTerm('');
                    setSelectedFilter('all');
                    setSelectedSpecialty('');
                  }}
                  className="text-sm text-blue-600 hover:text-blue-800 flex items-center"
                >
                  <X size={16} className="mr-1" />
                  Clear filters
                </button>
              )}
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredDoctors.map((doctor) => (
                <div
                  key={doctor._id}
                  className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow duration-300 border border-gray-100 border-t-blue-500 border-t-8"
                >
                  <div className="p-6">
                    <div className="flex items-start">
                      <div className={`flex-shrink-0 w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold mr-4 ${getAvatarColor(doctor.firstName)}`}>
                        {doctor.firstName.charAt(0)}{doctor.lastName ? doctor.lastName.charAt(0) : ''}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <h3 className="text-xl font-bold text-gray-800 truncate">
                          Dr. {doctor.firstName} {doctor.lastName || ''}
                        </h3>
                        
                        <p className="text-blue-600 font-medium truncate">
                          {doctor.experience?.expertise || 'Medical Professional'}
                        </p>
                      </div>
                    </div>
                    
                    <div className="mt-5 space-y-2.5 text-sm">
                      <div className="flex items-center text-gray-600">
                        <Briefcase className="w-4 h-4 mr-2 text-blue-500 flex-shrink-0" />
                        <span>{doctor.experience?.years || 0} years of experience</span>
                      </div>
                      
                      {doctor.experience?.qualification && (
                        <div className="flex items-center text-gray-600">
                          <GraduationCap className="w-4 h-4 mr-2 text-blue-500 flex-shrink-0" />
                          <span>{doctor.experience.qualification}</span>
                        </div>
                      )}
                      
                      {doctor.clinic?.name && (
                        <div className="flex items-center text-gray-600">
                          <Building className="w-4 h-4 mr-2 text-blue-500 flex-shrink-0" />
                          <span className="truncate">{doctor.clinic.name}</span>
                        </div>
                      )}
                      
                      {doctor.clinic?.location && (
                        <div className="flex items-start text-gray-600">
                          <MapPin className="w-4 h-4 mr-2 text-blue-500 flex-shrink-0 mt-0.5" />
                          <span className="line-clamp-1">{doctor.clinic.location}</span>
                        </div>
                      )}
                    </div>
                    
                    <div className="mt-6">
                      <Link
                        to={`/doctorsProfile/${doctor._id}`}
                        className="block w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-center rounded-md transition duration-200 font-medium"
                      >
                        View Profile
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            {filteredDoctors.length === 0 && (
              <div className="text-center py-16 bg-white rounded-lg shadow-sm">
                <User className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-lg font-medium text-gray-900">No doctors found</h3>
                <p className="mt-1 text-gray-500">Try adjusting your search criteria or filters</p>
                <button 
                  onClick={() => {
                    setSearchTerm('');
                    setSelectedFilter('all');
                    setSelectedSpecialty('');
                  }}
                  className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Reset All Filters
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Doctors;
