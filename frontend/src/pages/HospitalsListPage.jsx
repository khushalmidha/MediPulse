import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { Building2, MapPin, Search, Star } from 'lucide-react'
import { BACKEND_URL } from '../utils'

const careSystems = [
  { value: '', label: 'All care systems' },
  { value: 'allopathic', label: 'Allopathic' },
  { value: 'ayurveda', label: 'Ayurveda' },
  { value: 'homeopathy', label: 'Homeopathy' },
  { value: 'yoga_wellness', label: 'Yoga & Wellness' },
  { value: 'integrative', label: 'Integrative' },
]

const careLabel = (value) => careSystems.find((item) => item.value === value)?.label || 'Allopathic'

const HospitalsListPage = () => {
  const [hospitals, setHospitals] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [city, setCity] = useState('')
  const [medicineSystem, setMedicineSystem] = useState('')

  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (search.trim()) params.set('name', search.trim())
    if (city.trim()) params.set('city', city.trim())
    if (medicineSystem) params.set('medicineSystem', medicineSystem)
    return params.toString()
  }, [search, city, medicineSystem])

  useEffect(() => {
    let ignore = false

    const load = async () => {
      setLoading(true)
      try {
        const res = await axios.get(`${BACKEND_URL}/api/hospitals${query ? `?${query}` : ''}`)
        if (!ignore) setHospitals(res.data.items || [])
      } catch {
        if (!ignore) setHospitals([])
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    load()
    return () => {
      ignore = true
    }
  }, [query])

  return (
    <main className="min-h-screen bg-gray-50">
      <section className="bg-gradient-to-r from-blue-700 to-cyan-600 px-4 py-14 text-white">
        <div className="mx-auto max-w-5xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-100">MediPulse Hospital Network</p>
          <h1 className="mt-3 text-4xl font-black md:text-5xl">Find a Hospital</h1>
          <p className="mx-auto mt-3 max-w-2xl text-blue-50">
            Browse approved hospitals, check OPD departments, and open their live hospital website.
          </p>
          <div className="mx-auto mt-7 grid max-w-4xl gap-3 md:grid-cols-[1fr_180px_220px]">
            <label className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search hospital name"
                className="w-full rounded-lg border-0 py-3 pl-10 pr-4 text-sm text-gray-900 outline-none ring-1 ring-white/20 focus:ring-2 focus:ring-white"
              />
            </label>
            <input
              value={city}
              onChange={(event) => setCity(event.target.value)}
              placeholder="City"
              className="w-full rounded-lg border-0 px-4 py-3 text-sm text-gray-900 outline-none ring-1 ring-white/20 focus:ring-2 focus:ring-white"
            />
            <select
              value={medicineSystem}
              onChange={(event) => setMedicineSystem(event.target.value)}
              className="w-full rounded-lg border-0 px-4 py-3 text-sm text-gray-900 outline-none ring-1 ring-white/20 focus:ring-2 focus:ring-white"
            >
              {careSystems.map((system) => (
                <option key={system.value || 'all'} value={system.value}>{system.label}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10">
        {loading ? (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((item) => (
              <div key={item} className="h-56 animate-pulse rounded-2xl bg-gray-200" />
            ))}
          </div>
        ) : hospitals.length ? (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {hospitals.map((hospital) => (
              <Link
                key={hospital._id}
                to={`/hospitals/${hospital.slug}`}
                className="group overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                <div className="h-28 bg-gradient-to-r from-blue-600 to-cyan-500 p-5">
                  <div className="flex items-center gap-3">
                    {hospital.branding?.logo ? (
                      <img src={hospital.branding.logo} alt={hospital.name} className="h-14 w-14 rounded-xl bg-white object-cover" />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white/20 text-white">
                        <Building2 size={26} />
                      </div>
                    )}
                    <div className="min-w-0 text-white">
                      <h2 className="truncate text-lg font-bold">{hospital.name}</h2>
                      <p className="mt-1 flex items-center gap-1 text-sm text-blue-50">
                        <MapPin size={14} />
                        {hospital.address?.city || 'City'}, {hospital.address?.state || 'State'}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="p-5">
                  <p className="min-h-10 text-sm text-gray-600">
                    {hospital.branding?.tagline || 'Smart OPD care, transparent queues, and trusted hospital services.'}
                  </p>
                  <span className="mt-4 inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                    {careLabel(hospital.medicineSystem)}
                  </span>
                  <div className="mt-5 flex items-center justify-between">
                    <span className="flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-700">
                      <Star size={15} fill="currentColor" />
                      {Number(hospital.stats?.avgRating || 0).toFixed(1)}
                    </span>
                    <span className="text-sm font-semibold text-blue-600 group-hover:underline">Open website</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center">
            <Building2 className="mx-auto text-gray-400" size={38} />
            <h2 className="mt-4 text-xl font-bold text-gray-900">No hospitals found</h2>
            <p className="mt-2 text-gray-500">Try a different name or city.</p>
          </div>
        )}
      </section>
    </main>
  )
}

export default HospitalsListPage
