import { Bot, Users, Heart, MessageCircle, Stethoscope, Shield, UserPlus, Users2, Building2, Leaf, Flower2, ChevronRight, Star, Clock, Activity, ArrowRight, Phone } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useEffect, useState, useRef } from 'react'
import axios from 'axios'
import { BACKEND_URL } from '../utils'

const SERVICES = [
  {
    icon: Stethoscope,
    title: 'Smart OPD Booking',
    description: 'Book appointments with top doctors and hospitals. Get your OPD token instantly and track your live queue position in real time.',
    color: 'from-red-600 to-blue-400',
    bg: 'bg-red-50',
    iconColor: 'text-red-600 dark:text-red-500',
  },
  {
    icon: Activity,
    title: 'AI Health Assistant',
    description: 'Our AI chatbot guides you to the right department, suggests doctors, and even asks pre-consultation questions to save your time.',
    color: 'from-purple-600 to-purple-400',
    bg: 'bg-purple-50',
    iconColor: 'text-purple-600',
  },
  {
    icon: Building2,
    title: 'Multi-Hospital Network',
    description: 'Access a network of Allopathic, Ayurvedic, Homeopathic hospitals and Yoga wellness centers — all in one place.',
    color: 'from-teal-600 to-teal-400',
    bg: 'bg-teal-50',
    iconColor: 'text-teal-600',
  },
  {
    icon: Leaf,
    title: 'Ayurveda & Wellness',
    description: 'Explore certified Ayurveda clinics, Yoga centers, and Homeopathy hospitals partnered with MediPulse for holistic care.',
    color: 'from-green-600 to-green-400',
    bg: 'bg-green-50',
    iconColor: 'text-green-600',
  },
  {
    icon: Heart,
    title: 'Blood Bank AI',
    description: 'AI-powered blood bank demand forecasting ensures hospitals are never short of critical blood groups when it matters most.',
    color: 'from-red-600 to-red-400',
    bg: 'bg-red-50',
    iconColor: 'text-red-600',
  },
  {
    icon: Shield,
    title: 'Secure Video Consult',
    description: 'Crystal-clear peer-to-peer video consultations via WebRTC. No waiting rooms, no travel, consult from home safely.',
    color: 'from-red-600 to-indigo-400',
    bg: 'bg-red-50',
    iconColor: 'text-red-600',
  },
  {
    icon: Users,
    title: 'Community Support',
    description: 'Join health communities tailored for differently-abled individuals, caregivers, and chronic condition support groups.',
    color: 'from-orange-600 to-orange-400',
    bg: 'bg-orange-50',
    iconColor: 'text-orange-600',
  },
  {
    icon: Flower2,
    title: 'Digital Prescriptions',
    description: 'Get e-prescriptions with QR code verification after every consultation. Download, share, or store them securely.',
    color: 'from-pink-600 to-pink-400',
    bg: 'bg-pink-50',
    iconColor: 'text-pink-600',
  },
]

const SPECIALTIES = [
  { type: 'Cardiology', icon: Heart, desc: 'Heart and cardiovascular care', color: 'text-red-600 dark:text-red-500', bg: 'bg-red-100' },
  { type: 'Neurology', icon: Activity, desc: 'Brain and nervous system', color: 'text-blue-600', bg: 'bg-blue-100' },
  { type: 'Pediatrics', icon: Users, desc: 'Medical care for children', color: 'text-yellow-600', bg: 'bg-yellow-100' },
  { type: 'Dermatology', icon: Star, desc: 'Skin, hair, and nail care', color: 'text-purple-600', bg: 'bg-purple-100' },
]

const TESTIMONIALS = [
  { name: 'Priya Sharma', city: 'Delhi', rating: 5, text: 'MediPulse made booking a specialist so easy. I got my OPD token in 2 minutes!' },
  { name: 'Rahul Gupta', city: 'Mumbai', rating: 5, text: 'The video consultation feature is incredible. My doctor prescribed medicine without me leaving home.' },
  { name: 'Anjali Singh', city: 'Bangalore', rating: 5, text: 'Found an Ayurveda clinic near me through MediPulse. The pre-consultation AI questions saved so much time.' },
]

const HERO_SLIDES = [
  {
    image: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=1800&q=85',
    eyebrow: 'Telehealth consultations',
    title: 'Doctor video visits with secure wallet booking',
    text: 'Patients can book online consultations, verify OTP, join live video rooms, and receive digital care notes.',
  },
  {
    image: 'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=1800&q=85',
    eyebrow: 'Hospital OPD network',
    title: 'Live hospital queues and instant OPD tokens',
    text: 'Hospitals publish departments, doctors, fees, queue status, and patient token position in one public website.',
  },
  {
    image: 'https://images.unsplash.com/photo-1538108149393-fbbd81895907?auto=format&fit=crop&w=1800&q=85',
    eyebrow: 'AI operations',
    title: 'AI triage, bed demand, and blood-bank forecasting',
    text: 'Pre-consultation questions save OPD time while hospital dashboards predict next-month capacity pressure.',
  },
  {
    image: 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&w=1800&q=85',
    eyebrow: 'Holistic care',
    title: 'Ayurveda, Yoga, Homeopathy, and modern medicine',
    text: 'MediPulse supports multiple care systems so patients can choose the right treatment path for their needs.',
  },
]

const Home = () => {
  const { isAuth } = useAuth()
  const [membersCount, setMembersCount] = useState(0)
  const [communityCount, setCommunityCount] = useState(0)
  const [doctorsCount, setDoctorsCount] = useState(0)
  const [targets, setTargets] = useState({ members: 10000, communities: 100, doctors: 1000, loaded: false })
    const [reviews, setReviews] = useState([])
  const [pendingReview, setPendingReview] = useState(null)

  useEffect(() => {
    axios.get(`/api/reviews/global`).then(res => setReviews(res.data.reviews || [])).catch(() => {})
  }, [])
  
  useEffect(() => {
    if (isAuth) {
      axios.get(`/api/reviews/pending`, { withCredentials: true }).then(res => setPendingReview(res.data.pending)).catch(() => {})
    } else {
      setPendingReview(null)
    }
  }, [isAuth])
  const [currentSlide, setCurrentSlide] = useState(0)
  const [heroSlide, setHeroSlide] = useState(0)
  const [autoPlay, setAutoPlay] = useState(true)
  const statsRef = useRef(null)
  const animatedRef = useRef(false)
  const slideRef = useRef(null)
  const animationDuration = 1800

  const isInViewport = (element) => {
    if (!element) return false
    const rect = element.getBoundingClientRect()
    return rect.top < (window.innerHeight || document.documentElement.clientHeight) && rect.bottom >= 0
  }

  const animateCounter = (setter, target, duration) => {
    const step = Math.ceil(target / (duration / 20))
    const interval = setInterval(() => {
      setter(prev => {
        const next = prev + step
        if (next >= target) { clearInterval(interval); return target }
        return next
      })
    }, 20)
  }

  useEffect(() => {
    const fetchCount = async () => {
      try {
        const res = await axios.get(`${BACKEND_URL}/count`)
        setTargets({ members: res.data.users || 10000, communities: res.data.communities || 100, doctors: res.data.doctors || 1000, loaded: true })
      } catch { setTargets(prev => ({ ...prev, loaded: true })) }
    }
    fetchCount()
  }, [])

  useEffect(() => {
    if (!targets.loaded) return
    const handleScroll = () => {
      if (!animatedRef.current && statsRef.current && isInViewport(statsRef.current)) {
        animateCounter(setMembersCount, targets.members, animationDuration)
        animateCounter(setCommunityCount, targets.communities, animationDuration)
        animateCounter(setDoctorsCount, targets.doctors, animationDuration)
        animatedRef.current = true
        window.removeEventListener('scroll', handleScroll)
      }
    }
    window.addEventListener('scroll', handleScroll)
    handleScroll()
    return () => window.removeEventListener('scroll', handleScroll)
  }, [targets.loaded, targets.members, targets.communities, targets.doctors])

  const totalSlides = Math.ceil(SERVICES.length / 4)
  
  useEffect(() => {
    if (!autoPlay) return
    const timer = setInterval(() => {
      setCurrentSlide(prev => (prev + 1) % totalSlides)
    }, 3500)
    return () => clearInterval(timer)
  }, [autoPlay, totalSlides])

  useEffect(() => {
    const timer = setInterval(() => {
      setHeroSlide(prev => (prev + 1) % HERO_SLIDES.length)
    }, 4500)
    return () => clearInterval(timer)
  }, [])

  const visibleServices = SERVICES.slice(currentSlide * 4, currentSlide * 4 + 4)

  return (
          <div className="min-h-screen bg-white dark:bg-black transition-colors duration-200">
        {pendingReview && (
          <div className="bg-gradient-to-r from-red-600 to-red-500 px-4 py-3 text-white text-center flex flex-col sm:flex-row items-center justify-center gap-3 shadow-md z-50 relative">
            <span className="font-medium">How was your visit with {pendingReview.token?.doctorId?.name || 'your doctor'} at {pendingReview.token?.hospitalId?.name}?</span>
            <a href={pendingReview.url} className="bg-white text-red-600 px-4 py-1.5 rounded-full text-sm font-bold shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
              Rate your OPD Experience
            </a>
          </div>
        )}
      {/* HERO SECTION */}
      <section className="relative flex min-h-[92vh] items-center overflow-hidden bg-slate-950">
        {HERO_SLIDES.map((slide, index) => (
          <img
            key={slide.image}
            src={slide.image}
            alt={slide.title}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ${index === heroSlide ? 'opacity-100' : 'opacity-0'}`}
          />
        ))}
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/75 to-slate-950/20" />

        <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 py-24 sm:px-6 lg:grid-cols-[1fr_440px] lg:px-8">
          <div className="text-left">
          <div className="inline-flex items-center gap-2 rounded-full bg-red-500 dark:bg-red-600/10 border border-red-500/20 px-4 py-2 text-sm font-semibold text-red-300 mb-8">
            <Activity size={16} className="text-red-400" />
            India's Most Advanced Healthcare Platform
          </div>
          
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-black text-white leading-tight tracking-tight">
            Healthcare,
            <span className="block bg-gradient-to-r from-red-400 to-cyan-400 bg-clip-text text-transparent">
              Reimagined
            </span>
          </h1>
          
          <p className="mt-6 max-w-2xl text-xl leading-relaxed text-slate-300">
            Book OPD appointments, consult doctors online, track live queues, and access Ayurveda, Yoga & Homeopathy — all from one intelligent platform.
          </p>

          <div className="mt-10 flex flex-col gap-4 sm:flex-row">
            {isAuth ? (
              <>
                <Link to="/hospitals" className="inline-flex items-center gap-2 rounded-2xl bg-red-600 dark:bg-red-700 hover:bg-red-500 dark:bg-red-600 transition-all duration-300 px-8 py-4 text-base font-bold text-white shadow-lg shadow-red-600/30 hover:shadow-red-600/50 hover:-translate-y-0.5">
                  <Building2 size={20} /> Browse Hospitals <ArrowRight size={18} />
                </Link>
                <Link to="/smart-booking" className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/10 dark:bg-slate-950/10 backdrop-blur hover:bg-white/20 dark:bg-slate-950/20 transition-all duration-300 px-8 py-4 text-base font-bold text-white"><Bot size={20} /> Smart AI Booking</Link>
              </>
            ) : (
              <>
                <Link to="/signup/user" className="inline-flex items-center gap-2 rounded-2xl bg-red-600 dark:bg-red-700 hover:bg-red-500 dark:bg-red-600 transition-all duration-300 px-8 py-4 text-base font-bold text-white shadow-lg shadow-red-600/30 hover:shadow-red-600/50 hover:-translate-y-0.5">
                  <UserPlus size={20} /> Join as Patient <ArrowRight size={18} />
                </Link>
                <Link to="/signup/doctor" className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/10 dark:bg-slate-950/10 backdrop-blur hover:bg-white/20 dark:bg-slate-950/20 transition-all duration-300 px-8 py-4 text-base font-bold text-white">
                  <Stethoscope size={20} /> Register as Doctor
                </Link>
              </>
            )}
          </div>

          {/* Stats row */}
          <div ref={statsRef} className="mt-16 grid max-w-2xl grid-cols-3 gap-6">
            {[
              { value: (membersCount + doctorsCount).toLocaleString() + '+', label: 'Active Members' },
              { value: communityCount + '+', label: 'Communities' },
              { value: doctorsCount.toLocaleString() + '+', label: 'Verified Doctors' },
            ].map((stat) => (
              <div key={stat.label} className="rounded-2xl bg-white/5 dark:bg-slate-950/5 border border-white/10 p-5 backdrop-blur">
                <p className="text-3xl font-black text-white">{stat.value}</p>
                <p className="mt-1 text-sm text-slate-400">{stat.label}</p>
              </div>
            ))}
          </div>
          </div>
          <div className="rounded-3xl border border-white/15 bg-white/10 dark:bg-slate-950/10 p-5 text-white backdrop-blur">
            <p className="text-sm font-bold uppercase tracking-widest text-red-200">{HERO_SLIDES[heroSlide].eyebrow}</p>
            <h2 className="mt-3 text-3xl font-black leading-tight">{HERO_SLIDES[heroSlide].title}</h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-200">{HERO_SLIDES[heroSlide].text}</p>
            <div className="mt-6 flex gap-2">
              {HERO_SLIDES.map((slide, index) => (
                <button
                  key={slide.title}
                  onClick={() => setHeroSlide(index)}
                  className={`h-2 rounded-full transition-all ${index === heroSlide ? 'w-8 bg-cyan-300' : 'w-2 bg-white/50 dark:bg-slate-950/50'}`}
                  aria-label={`Show ${slide.eyebrow}`}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* SERVICES SLIDING SECTION */}
      <section className="py-20 bg-slate-50 dark:bg-black">
        <div className="mx-auto max-w-7xl px-4">
          <div className="text-center mb-12">
            <p className="text-sm font-bold uppercase tracking-widest text-red-600 dark:text-red-500 mb-3">Everything You Need</p>
            <h2 className="text-4xl font-black text-slate-900 dark:text-white">What MediPulse Offers</h2>
            <p className="mt-4 text-lg text-slate-500 dark:text-slate-400 max-w-xl mx-auto">A complete healthcare ecosystem — from booking to billing, consultation to community.</p>
          </div>

          {/* Animated slide of services */}
          <div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5"
            onMouseEnter={() => setAutoPlay(false)}
            onMouseLeave={() => setAutoPlay(true)}
          >
            {visibleServices.map((service) => {
              const Icon = service.icon
              return (
                <div
                  key={service.title}
                  className={`group rounded-2xl ${service.bg} dark:bg-slate-900 border border-white dark:border-slate-800 p-6 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-default`}
                >
                  <div className={`flex h-12 w-12 items-center justify-center rounded-xl bg-white dark:bg-slate-800 shadow-sm ${service.iconColor} dark:text-white mb-5 group-hover:scale-110 transition-transform duration-300`}>
                    <Icon size={24} />
                  </div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white">{service.title}</h3>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{service.description}</p>
                </div>
              )
            })}
          </div>

          {/* Slide dots */}
          <div className="flex justify-center gap-2 mt-8">
            {Array.from({ length: totalSlides }).map((_, i) => (
              <button
                key={i}
                onClick={() => { setCurrentSlide(i); setAutoPlay(false); setTimeout(() => setAutoPlay(true), 5000) }}
                className={`rounded-full transition-all duration-300 ${i === currentSlide ? 'w-8 h-3 bg-red-600 dark:bg-red-700' : 'w-3 h-3 bg-slate-300 hover:bg-slate-400'}`}
              />
            ))}
          </div>
        </div>
      </section>

      {/* HOSPITAL TYPES SECTION */}
      <section className="py-20 bg-white dark:bg-black">
        <div className="mx-auto max-w-7xl px-4">
          <div className="text-center mb-12">
            <p className="text-sm font-bold uppercase tracking-widest text-red-600 dark:text-red-500 mb-3">Top Specialties</p>
            <h2 className="text-4xl font-black text-slate-900 dark:text-white">Find Specialists by Department</h2>
            <p className="mt-4 text-lg text-slate-500 dark:text-slate-400 max-w-xl mx-auto">Connect with highly qualified doctors and specialists across various medical fields.</p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {SPECIALTIES.map((h) => {
              const Icon = h.icon
              return (
                <Link to={`/doctors?specialty=${h.type}`} key={h.type} className="group flex flex-col items-center rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 hover:bg-white dark:bg-slate-950 dark:hover:bg-slate-800 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 p-8 text-center">
                  <div className={`flex h-16 w-16 items-center justify-center rounded-2xl ${h.bg} dark:bg-red-900/20 ${h.color} dark:text-red-400 mb-4 group-hover:scale-110 transition-transform duration-300`}>
                    <Icon size={30} />
                  </div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white">{h.type}</h3>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{h.desc}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-red-600 dark:text-red-500">
                    Browse <ChevronRight size={14} />
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="py-20 bg-gradient-to-br from-slate-950 via-red-950 to-slate-900 text-white">
        <div className="mx-auto max-w-7xl px-4">
          <div className="text-center mb-14">
            <p className="text-sm font-bold uppercase tracking-widest text-red-400 mb-3">Simple & Fast</p>
            <h2 className="text-4xl font-black">How It Works</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            {[
              { step: '01', title: 'Create Account', desc: 'Sign up as a patient or doctor in under 2 minutes.', icon: UserPlus },
              { step: '02', title: 'Find Hospital/Doctor', desc: 'Search hospitals, departments, or doctors near you.', icon: Building2 },
              { step: '03', title: 'Book Appointment', desc: 'Get an instant OPD token or schedule a video call.', icon: Clock },
              { step: '04', title: 'Get Treated', desc: 'Consult, get e-prescriptions, and track your health.', icon: Heart },
            ].map((item, i) => {
              const Icon = item.icon
              return (
                <div key={item.step} className="relative">
                  {i < 3 && <div className="hidden md:block absolute top-8 left-full w-full h-0.5 bg-blue-800 z-0" />}
                  <div className="relative z-10 flex flex-col items-center text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-600 dark:bg-red-700 shadow-lg shadow-red-600/40 mb-5">
                      <Icon size={28} />
                    </div>
                    <span className="text-xs font-black text-red-400 mb-2">{item.step}</span>
                    <h3 className="text-lg font-black">{item.title}</h3>
                    <p className="mt-2 text-sm text-slate-400">{item.desc}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section className="py-20 bg-white dark:bg-black">
        <div className="mx-auto max-w-7xl px-4">
          <div className="text-center mb-12">
            <p className="text-sm font-bold uppercase tracking-widest text-purple-600 dark:text-red-500 mb-3">Patient Stories</p>
            <h2 className="text-4xl font-black text-slate-900 dark:text-white">What Our Users Say</h2>
          </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {(reviews.length > 0 ? reviews : TESTIMONIALS).map((t, i) => {
                const name = t.isAnonymous ? "Anonymous Patient" : (t.patientId?.firstName ? t.patientId.firstName + ' ' + (t.patientId.lastName || '') : (t.name || 'MediPulse User'));
                const text = t.comment || t.text;
                const rating = t.overallRating || t.rating || 5;
                const location = t.hospitalId?.name || t.city;
                return (
                <div key={t._id || t.name + i} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-6 hover:shadow-lg transition-shadow duration-300">
                  <div className="flex text-yellow-500 mb-4">
                    {[1,2,3,4,5].map(s => <Star key={s} size={18} fill={s <= rating ? "currentColor" : "none"} />)}
                  </div>
                  <p className="text-slate-700 dark:text-slate-300 text-sm leading-relaxed italic">&ldquo;{text}&rdquo;</p>
                  <div className="mt-5 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30 font-black text-blue-700 dark:text-red-400 text-sm">
                      {name ? name[0] : 'A'}
                    </div>
                    <div>
                      <p className="font-bold text-slate-900 dark:text-white text-sm line-clamp-1">{name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">{location}</p>
                    </div>
                  </div>
                </div>
              )})}
            </div>
        </div>
      </section>

      {/* CTA SECTION */}
      <section className="py-20 bg-red-600 dark:bg-red-900">
        <div className="mx-auto max-w-4xl px-4 text-center">
          <h2 className="text-4xl font-black text-white">Start Your Health Journey Today</h2>
          <p className="mt-4 text-xl text-red-100 max-w-xl mx-auto">Join thousands of patients and doctors already using MediPulse for smarter, faster healthcare.</p>
          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            <Link to={isAuth ? '/hospitals' : '/signup/user'} className="inline-flex items-center gap-2 rounded-2xl bg-white dark:bg-slate-950 hover:bg-red-50 transition-all duration-300 px-8 py-4 text-base font-black text-blue-700 shadow-xl hover:-translate-y-0.5">
              {isAuth ? <><Building2 size={20} /> Browse Hospitals</> : <><UserPlus size={20} /> Get Started Free</>}
            </Link>
            <Link to="/smart-booking" className="inline-flex items-center gap-2 rounded-2xl border-2 border-white/30 hover:border-white/60 transition-all duration-300 px-8 py-4 text-base font-bold text-white"><Bot size={20} /> Smart AI Booking</Link>
          </div>
        </div>
      </section>
    </div>
  )
}

export default Home











