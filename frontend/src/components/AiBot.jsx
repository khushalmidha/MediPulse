import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Home, Building2 } from 'lucide-react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { BACKEND_URL } from '../utils';

const getDoctorNavigationPath = (doctor) => {
  if (doctor?.sourceType === 'hospital' && doctor?.hospitalContext?.hospitalSlug) {
    return `/hospitals/${doctor.hospitalContext.hospitalSlug}`;
  }
  return `/doctorsProfile/${doctor._id}`;
};

const AiBot = () => {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [doctors, setDoctors] = useState([]);
  const [communities, setCommunities] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [activeMode, setActiveMode] = useState(null);
  const { user, isAuth } = useAuth();
  const messagesEndRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [doctorsRes, commRes, hospRes] = await Promise.all([
          axios.get(`${BACKEND_URL}/doctor`, { withCredentials: true }),
          axios.get(`${BACKEND_URL}/community`, { withCredentials: true }),
          axios.get(`${BACKEND_URL}/api/hospitals`, { withCredentials: true }),
        ]);
        setDoctors(Array.isArray(doctorsRes.data) ? doctorsRes.data : doctorsRes.data?.items || []);
        setCommunities(Array.isArray(commRes.data) ? commRes.data : commRes.data?.items || []);
        setHospitals(Array.isArray(hospRes.data?.items) ? hospRes.data.items : []);
      } catch (error) {
        console.error('Error fetching data:', error);
      }
    };
    // FIXED: Hospital browsing in the chatbot should work for visitors before login too.
    fetchData();
  }, [user, isAuth]);

  useEffect(() => {
    if (isChatOpen && messages.length === 0) showMainMenu();
    scrollToBottom();
  }, [isChatOpen, messages]);

  const scrollToBottom = () => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); };

  const showMainMenu = () => {
    setActiveMode(null);
    setMessages([{
      role: 'assistant',
      content: "Hello! I'm your MediPulse AI assistant. How can I help you today?",
      options: [
        { label: '🏥 Browse Hospitals', value: 'hospital' },
        { label: '🩺 Suggest a Doctor', value: 'doctor' },
        { label: '👥 Suggest a Community', value: 'community' },
        { label: '💬 General Query', value: 'general' },
      ],
    }]);
  };

  const handleOptionSelect = (option) => {
    setActiveMode(option);
    const msgs = {
      hospital: 'Which type of hospital are you looking for? Allopathic, Ayurveda, Homeopathy, or Yoga & Wellness? You can also mention your city.',
      doctor: 'Please describe your health concern or the type of doctor you need.',
      community: 'What type of health community interests you?',
      general: 'What would you like to know about health or MediPulse?',
    };
    setMessages(prev => [...prev, { role: 'assistant', content: msgs[option] }]);
  };

  const suggestHospitals = async (query) => {
    setIsLoading(true);
    try {
      const lowerQuery = query.toLowerCase();
      const typeMap = { ayurveda: ['ayurveda','herbal','natural'], homeopathy: ['homeopathy','homeopathic','homeo'], yoga_wellness: ['yoga','wellness','meditation'], allopathic: ['allopathic','hospital','modern','clinic'] };
      let matched = hospitals;
      for (const [type, keywords] of Object.entries(typeMap)) {
        if (keywords.some(k => lowerQuery.includes(k))) { matched = hospitals.filter(h => h.medicineSystem === type); break; }
      }
      const cityMatch = hospitals.filter(h => h.address?.city && lowerQuery.includes(h.address.city.toLowerCase()));
      if (cityMatch.length > 0) matched = cityMatch;
      const toShow = (matched.length > 0 ? matched : hospitals).slice(0, 6);
      setMessages(prev => [...prev, { role: 'assistant', content: toShow.length ? 'Here are some matching hospitals:' : 'Showing available hospitals:', hospitalCards: toShow }]);
    } catch { setMessages(prev => [...prev, { role: 'assistant', content: 'Could not load hospitals. Try browsing at /hospitals.' }]); }
    setIsLoading(false);
  };

  const suggestDoctors = async (query) => {
    setIsLoading(true);
    try {
      const list = doctors.map(d => `ID: ${d._id}, Name: ${d.firstName||''} ${d.lastName||''}, Expertise: ${d.experience?.expertise||''}`).join('\n');
      const res = await axios.post(`${BACKEND_URL}/gemini/chat`, { prompt: `User: "${query}"\nMatch doctors from:\n${list}\nReturn only IDs comma-separated.`, type: 'doctor' }, { withCredentials: true });
      const ids = res.data.text.split(',').map(id => id.trim());
      const matched = doctors.filter(d => ids.some(id => String(d._id) === id));
      setMessages(prev => [...prev, { role: 'assistant', content: 'Here are matching doctors:', doctorCards: matched.length > 0 ? matched : doctors.slice(0, 5) }]);
    } catch { setMessages(prev => [...prev, { role: 'assistant', content: "Couldn't find matching doctors. Try describing differently." }]); }
    setIsLoading(false);
  };

  const suggestCommunities = async (query) => {
    setIsLoading(true);
    try {
      const list = communities.map(c => `ID: ${c._id}, Title: ${c.title}, Category: ${c.category}`).join('\n');
      const res = await axios.post(`${BACKEND_URL}/gemini/chat`, { prompt: `User: "${query}"\nMatch communities from:\n${list}\nReturn only IDs comma-separated.`, type: 'community' }, { withCredentials: true });
      const ids = res.data.text.split(',').map(id => id.trim());
      const matched = communities.filter(c => ids.some(id => String(c._id) === id));
      setMessages(prev => [...prev, { role: 'assistant', content: 'Here are matching communities:', communityCards: matched.length > 0 ? matched : communities.slice(0, 5) }]);
    } catch { setMessages(prev => [...prev, { role: 'assistant', content: "Couldn't find matching communities." }]); }
    setIsLoading(false);
  };

  const handleGeneralQuery = async (query) => {
    setIsLoading(true);
    try {
      const res = await axios.post(`${BACKEND_URL}/gemini/chat`, { prompt: query, type: 'general' }, { withCredentials: true });
      setMessages(prev => [...prev, { role: 'assistant', content: res.data.text }]);
    } catch { setMessages(prev => [...prev, { role: 'assistant', content: "Couldn't process your question. Please try again." }]); }
    setIsLoading(false);
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;
    setMessages(prev => [...prev, { role: 'user', content: inputMessage }]);
    const query = inputMessage;
    setInputMessage('');
    if (activeMode === 'hospital') await suggestHospitals(query);
    else if (activeMode === 'doctor') await suggestDoctors(query);
    else if (activeMode === 'community') await suggestCommunities(query);
    else if (activeMode === 'general') await handleGeneralQuery(query);
    else showMainMenu();
  };

  return (
    <div className="fixed bottom-0 right-0 z-50 m-4">
      {!isChatOpen && (
        <button onClick={() => setIsChatOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-white rounded-full p-4 shadow-xl transition-all duration-300 hover:scale-110" aria-label="Open AI Chat">
          <MessageCircle className="h-6 w-6" />
        </button>
      )}
      {isChatOpen && (
        <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden w-96 flex flex-col" style={{ maxHeight: '620px' }}>
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-4 flex justify-between items-center flex-shrink-0">
            <div>
              <h3 className="text-base font-bold">MediPulse Assistant</h3>
              <p className="text-xs text-blue-100">AI-powered healthcare guide</p>
            </div>
            <div className="flex gap-2">
              <button onClick={showMainMenu} className="rounded-full bg-white/20 hover:bg-white/30 p-1.5 transition-colors" title="Main menu"><Home className="h-4 w-4" /></button>
              <button onClick={() => setIsChatOpen(false)} className="rounded-full bg-white/20 hover:bg-white/30 p-1.5 transition-colors" title="Close"><X className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
            {messages.map((message, index) => (
              <div key={index} className="flex flex-col gap-2">
                <div className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`rounded-2xl p-3 max-w-[85%] text-sm shadow-sm ${message.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white text-gray-800 border border-slate-200'}`}>{message.content}</div>
                </div>
                {message.options && (
                  <div className="flex flex-wrap gap-2">
                    {message.options.map((opt, i) => (
                      <button key={i} onClick={() => handleOptionSelect(opt.value)} className="bg-white hover:bg-blue-50 text-blue-700 px-3 py-2 rounded-xl border border-blue-200 text-sm font-medium shadow-sm hover:shadow transition-all">{opt.label}</button>
                    ))}
                  </div>
                )}
                {message.hospitalCards && (
                  <div className="overflow-x-auto flex gap-3 pb-2">
                    {message.hospitalCards.map((h, i) => (
                      <div key={i} className="min-w-[190px] bg-white border border-slate-200 rounded-xl p-3 flex-shrink-0 cursor-pointer hover:border-teal-400 hover:shadow-md transition-all" onClick={() => { navigate(`/hospitals/${h.slug}`); setIsChatOpen(false); }}>
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-8 h-8 bg-teal-100 text-teal-600 rounded-full flex items-center justify-center"><Building2 size={14} /></div>
                          <p className="font-bold text-slate-900 text-xs truncate">{h.name}</p>
                        </div>
                        <p className="text-xs text-slate-500">{h.address?.city}, {h.address?.state}</p>
                        <span className="mt-1 inline-block text-xs bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full capitalize">{h.medicineSystem || 'hospital'}</span>
                        <button className="mt-2 w-full bg-teal-600 hover:bg-teal-700 text-white text-xs py-1.5 rounded-lg font-medium transition-colors">View Hospital</button>
                      </div>
                    ))}
                  </div>
                )}
                {message.doctorCards && (
                  <div className="overflow-x-auto flex gap-3 pb-2">
                    {message.doctorCards.map((doc, i) => (
                      <div key={i} className="min-w-[190px] bg-white border border-slate-200 rounded-xl p-3 flex-shrink-0 cursor-pointer hover:border-blue-400 hover:shadow-md transition-all" onClick={() => { navigate(getDoctorNavigationPath(doc)); setIsChatOpen(false); }}>
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-bold text-sm">{(doc.firstName || 'D')[0]}</div>
                          <p className="font-bold text-slate-900 text-xs">Dr. {doc.firstName} {doc.lastName}</p>
                        </div>
                        <p className="text-xs text-blue-700">{doc.experience?.expertise}</p>
                        <button className="mt-2 w-full bg-blue-600 hover:bg-blue-700 text-white text-xs py-1.5 rounded-lg font-medium transition-colors">View Profile</button>
                      </div>
                    ))}
                  </div>
                )}
                {message.communityCards && (
                  <div className="overflow-x-auto flex gap-3 pb-2">
                    {message.communityCards.map((c, i) => (
                      <div key={i} className="min-w-[190px] bg-white border border-slate-200 rounded-xl p-3 flex-shrink-0 cursor-pointer hover:border-green-400 hover:shadow-md transition-all" onClick={() => { navigate(`/communities#${c._id}`); setIsChatOpen(false); }}>
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-8 h-8 bg-green-100 text-green-600 rounded-full flex items-center justify-center font-bold text-sm">{(c.title || 'C')[0]}</div>
                          <p className="font-bold text-slate-900 text-xs truncate">{c.title}</p>
                        </div>
                        <span className="inline-block text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full">{c.category}</span>
                        <button className="mt-2 w-full bg-green-600 hover:bg-green-700 text-white text-xs py-1.5 rounded-lg font-medium transition-colors">Join Community</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="flex items-center gap-1 py-2">
                <span className="h-2 w-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="h-2 w-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="h-2 w-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          <form onSubmit={handleSendMessage} className="border-t border-slate-200 p-3 bg-white flex-shrink-0">
            <div className="flex gap-2">
              <input type="text" value={inputMessage} onChange={e => setInputMessage(e.target.value)} placeholder="Type your message..." className="flex-1 border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:border-blue-500 bg-slate-50" disabled={isLoading} />
              <button type="submit" className="bg-blue-600 text-white p-2.5 rounded-xl hover:bg-blue-700 disabled:opacity-40 transition-colors" disabled={isLoading || !inputMessage.trim()}><Send className="h-4 w-4" /></button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default AiBot;
