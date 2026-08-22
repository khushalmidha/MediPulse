import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { Bot, ArrowRight, AlertTriangle, ShieldCheck, User as UserIcon } from 'lucide-react';
import { BACKEND_URL } from '../utils';

const SmartBooking = () => {
  const [symptoms, setSymptoms] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleAnalyze = async (e) => {
    e.preventDefault();
    if (!symptoms.trim()) return;

    setLoading(true);
    setError('');
    
    try {
      const response = await axios.post(`${BACKEND_URL}/api/triage/smart-booking`, { symptoms }, { withCredentials: true });
      setResult(response.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to process symptoms. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-8">
        
        {/* Header Section */}
        <div className="text-center space-y-2">
          <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
            <Bot className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100">Smart AI Booking</h1>
          <p className="text-gray-600 max-w-xl mx-auto">
            Describe how you are feeling, and our AI will predict your condition, determine the required medical specialty, and recommend the best doctors for you.
          </p>
        </div>

        {/* Form Section */}
        {!result && (
          <form onSubmit={handleAnalyze} className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
            <div className="space-y-4">
              <label htmlFor="symptoms" className="block text-sm font-medium text-gray-700 dark:text-slate-300">
                What are your symptoms? Please be as detailed as possible.
              </label>
              <textarea
                id="symptoms"
                rows={5}
                className="block w-full rounded-xl border-gray-300 dark:bg-slate-800 dark:border-slate-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-base p-4 resize-none"
                placeholder="e.g., I have been having severe headaches for the past 3 days, accompanied by nausea and sensitivity to light..."
                value={symptoms}
                onChange={(e) => setSymptoms(e.target.value)}
                disabled={loading}
              />
            </div>
            
            {error && <p className="mt-4 text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</p>}
            
            <button
              type="submit"
              disabled={loading || !symptoms.trim()}
              className="mt-6 w-full flex justify-center items-center py-4 px-4 border border-transparent rounded-xl shadow-sm text-base font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-blue-300 disabled:cursor-not-allowed transition-all duration-200"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-3"></div>
                  Analyzing Symptoms...
                </>
              ) : (
                <>
                  Analyze & Find Doctors <ArrowRight className="ml-2 w-5 h-5" />
                </>
              )}
            </button>
          </form>
        )}

        {/* Results Section */}
        {result && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* AI Assessment Card */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-4 sm:p-6">
                <div className="flex items-start gap-4">
                  {result.severity === 'EMERGENCY' || result.severity === 'HIGH' ? (
                    <AlertTriangle className="w-8 h-8 text-red-600 mt-1 flex-shrink-0" />
                  ) : (
                    <ShieldCheck className="w-8 h-8 text-blue-600 mt-1 flex-shrink-0" />
                  )}
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">AI Assessment Complete</h2>
                    <p className="">
                      {result.disclaimer}
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-3 gap-6">
                <div>
                  <p className="text-sm font-medium text-gray-500 dark:text-slate-400">Predicted Condition</p>
                  <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{result.disease}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500 dark:text-slate-400">Required Specialty</p>
                  <div className="mt-1 inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300">
                    {result.specialty}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500 dark:text-slate-400">Severity / ESI Level</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="">
                      {result.severity}
                    </span>
                    <span className="text-sm text-gray-500">Level {result.esi_level}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Recommended Doctors */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Recommended {result.specialty} Doctors</h3>
                <button 
                  onClick={() => { setResult(null); setSymptoms(''); }}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  Start Over
                </button>
              </div>
              
              {result.ranked_doctors?.length > 0 ? (
                <div className="grid gap-4">
                  {result.ranked_doctors.map((doctor) => (
                    <div key={doctor._id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-gray-200 dark:border-slate-700 flex flex-col sm:flex-row items-center sm:justify-between gap-4 transition-all hover:shadow-md">
                      <div className="flex items-center gap-4 w-full sm:w-auto">
                        {doctor.profilePicture ? (
                          <img src={doctor.profilePicture} alt={doctor.name} className="w-16 h-16 rounded-full object-cover shadow-sm border border-gray-100" />
                        ) : (
                          <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center border border-gray-200">
                            <UserIcon className="w-8 h-8 text-slate-400" />
                          </div>
                        )}
                        <div>
                          <h4 className="font-semibold text-lg text-gray-900 dark:text-white">Dr. {doctor.name}</h4>
                          <p className="text-sm text-gray-500 dark:text-slate-400">{doctor.specialty} • {doctor.experience} yrs exp.</p>
                          {doctor.clinic?.name && (
                            <p className="text-xs text-gray-400 mt-1">{doctor.clinic.name}</p>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center sm:flex-col gap-4 sm:gap-2 w-full sm:w-auto justify-between sm:justify-end">
                        <div className="text-left sm:text-right">
                          <p className="text-xs text-gray-500 uppercase tracking-wider font-medium">Consultation Fee</p>
                          {/* The backend now returns the doctor's own fee, which is exactly what the
                              wallet is debited at booking time. */}
                          <p className="font-bold text-gray-900 dark:text-white">₹{doctor.fee ?? 0}</p>

                        </div>
                        <Link 
                          to={`/appointment/book/${doctor._id}`}
                          className="px-6 py-2 bg-slate-900 dark:bg-red-600 hover:bg-slate-800 dark:hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap shadow-sm"
                        >
                          Book Now
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-white p-8 rounded-xl text-center border border-gray-200">
                  <p className="text-gray-500">No doctors available for this specialty right now.</p>
                  <Link to="/doctors" className="mt-4 inline-block text-blue-600 font-medium">View all doctors</Link>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SmartBooking;
