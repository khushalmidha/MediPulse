import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Home } from 'lucide-react';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

// Initialize Gemini (you'll need to set up your API key)
const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY || "YOUR_API_KEY");

const AiBot = () => {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [doctors, setDoctors] = useState([]);
  const [communities, setCommunities] = useState([]);
  const [activeMode, setActiveMode] = useState(null); // null, 'doctor', 'community', 'general'
  const {user, isAuth} = useAuth();
  const messagesEndRef = useRef(null);
  const backendUri = import.meta.env.VITE_BACKEND_URL;
  const navigate = useNavigate();

  // Fetch doctors and communities when the component mounts
  useEffect(() => {
    const fetchData = async () => {
      try {
        const doctorsResponse = await axios.get(`${backendUri}/doctor`,{withCredentials: true});
        setDoctors(doctorsResponse.data);
        
        const communitiesResponse = await axios.get(`${backendUri}/community`,{withCredentials: true});
        setCommunities(communitiesResponse.data);
      } catch (error) {
        console.error('Error fetching data:', error);
      }
    };
    
    if(isAuth && user){
        fetchData();
    }
  }, [user, isAuth]);

  useEffect(() => {
    // Show welcome message and options when chat is first opened
    if (isChatOpen && messages.length === 0) {
      showMainMenu();
    }
    
    scrollToBottom();
  }, [isChatOpen, messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Function to show main menu options
  const showMainMenu = () => {
    setActiveMode(null);
    setMessages([
      {
        role: 'assistant',
        content: "Hello! I'm your MediPulse AI assistant. How can I help you today?",
        options: [
          { label: "Suggest a Doctor", value: "doctor" },
          { label: "Suggest a Community", value: "community" },
          { label: "Ask General Query", value: "general" }
        ]
      }
    ]);
  };

  // Handle button option selection
  const handleOptionSelect = (option) => {
    setActiveMode(option);
    
    if (option === 'doctor') {
      setMessages(prev => [...prev, 
        { role: 'assistant', content: "Please describe your health concern or the type of doctor you're looking for." }
      ]);
    } else if (option === 'community') {
      setMessages(prev => [...prev, 
        { role: 'assistant', content: "What type of health community are you interested in joining? Please describe your interests or needs." }
      ]);
    } else if (option === 'general') {
      setMessages(prev => [...prev, 
        { role: 'assistant', content: "What would you like to know about health or MediPulse services? Feel free to ask any question." }
      ]);
    }
  };

  // Function to suggest doctors based on the user's query
  const suggestDoctors = async (query) => {
    setIsLoading(true);
    try {
      // Use Gemini to analyze the query and match with doctor expertise
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      
      // Create prompt for Gemini to match doctors
      const doctorExpertiseList = doctors.map(doc => 
        `ID: ${doc._id}, Name: ${doc.firstName} ${doc.lastName || ""}, Expertise: ${doc.experience.expertise}, Years: ${doc.experience.years}`
      ).join('\n');
      
      const prompt = `
        Based on the user query: "${query}"
        Match the most relevant doctors from this list:
        ${doctorExpertiseList}
        
        Return only the IDs of the top 3-5 most relevant doctors separated by commas.
        For example: "507f1f77bcf86cd799439011, 507f1f77bcf86cd799439012, 507f1f77bcf86cd799439013"
        Only return the IDs, nothing else.
      `;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const doctorIds = response.text().split(',').map(id => id.trim());
      
      // Filter doctors based on the IDs returned by Gemini
      const suggestedDoctors = doctors.filter(doctor => 
        doctorIds.some(id => doctor._id === id || doctor._id.toString() === id)
      );
      
      // If no matching doctors, return a subset
      const doctorsToShow = suggestedDoctors.length > 0 ? suggestedDoctors : doctors.slice(0, 5);
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "Based on your description, here are some doctors who might be able to help you:",
        doctorCards: doctorsToShow
      }]);
      
    } catch (error) {
      console.error('Error suggesting doctors:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "I'm sorry, I couldn't find suitable doctors at the moment. Please try describing your needs differently."
      }]);
    }
    setIsLoading(false);
  };

  // Function to suggest communities based on the user's query
  const suggestCommunities = async (query) => {
    setIsLoading(true);
    try {
      // Use Gemini to analyze the query and match with community categories
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      
      // Create prompt for Gemini to match communities
      const communityList = communities.map(comm => 
        `ID: ${comm._id}, Title: ${comm.title}, Category: ${comm.category}, Description: ${comm.bio.substring(0, 50)}...`
      ).join('\n');
      
      const prompt = `
        Based on the user query: "${query}"
        Match the most relevant health communities from this list:
        ${communityList}
        
        Return only the IDs of the top 3-5 most relevant communities separated by commas.
        For example: "507f1f77bcf86cd799439011, 507f1f77bcf86cd799439012, 507f1f77bcf86cd799439013"
        Only return the IDs, nothing else.
      `;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const communityIds = response.text().split(',').map(id => id.trim());
      
      // Filter communities based on the IDs returned by Gemini
      const suggestedCommunities = communities.filter(comm => 
        communityIds.some(id => comm._id === id || comm._id.toString() === id)
      );
      
      // If no matching communities, return a subset
      const communitiesToShow = suggestedCommunities.length > 0 ? suggestedCommunities : communities.slice(0, 5);
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "Based on your interests, here are some communities you might want to join:",
        communityCards: communitiesToShow
      }]);
      
    } catch (error) {
      console.error('Error suggesting communities:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "I'm sorry, I couldn't find suitable communities at the moment. Please try describing your interests differently."
      }]);
    }
    setIsLoading(false);
  };

  // Function to handle general queries
  const handleGeneralQuery = async (query) => {
    setIsLoading(true);
    try {
      // Use Gemini to respond to general queries
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      
      // Create system prompt to keep Gemini focused on healthcare and MediPulse
      const systemPrompt = `
        You are MediPulse AI, a healthcare assistant.
        Give short, concise answers only not too long.
        Try to be point wise not more than 2-3 points 
        Only respond to health-related queries or questions about MediPulse services.
        If asked about non-health topics, politely redirect the conversation to healthcare.
        Keep responses focused on medical information, health advice, and MediPulse platform features.
        Do not provide specific medical diagnoses but can offer general health information.
      `;
      
      const chat = model.startChat({
        history: [{ role: "user", parts:[
            {"text" : systemPrompt}
        ] }]
      });
      
      const result = await chat.sendMessage(query);
      const response = result.response;
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: response.text()
      }]);
      
    } catch (error) {
      console.error('Error with general query:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "I'm sorry, I couldn't process your question. How else can I help you with health-related information?"
      }]);
    }
    setIsLoading(false);
  };

  // Handle navigation for doctor and community cards
  const handleDoctorCardClick = (doctorId) => {
    setIsChatOpen(false);
    navigate(`/doctorsprofile/${doctorId}`);
  };

  const handleCommunityCardClick = (communityId) => {
    setIsChatOpen(false);
    navigate(`/communities#${communityId}`);
  };

  // Handle sending a message
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;
    
    // Add user message to chat
    const userMessage = { role: 'user', content: inputMessage };
    setMessages(prev => [...prev, userMessage]);
    
    const query = inputMessage;
    setInputMessage('');
    
    // Process based on the active mode
    if (activeMode === 'doctor') {
      await suggestDoctors(query);
    } else if (activeMode === 'community') {
      await suggestCommunities(query);
    } else if (activeMode === 'general') {
      await handleGeneralQuery(query);
    } else {
      // If no mode is active, show the menu again
      showMainMenu();
    }
  };

  return (
    <div className="fixed bottom-0 right-0 z-50 m-4">
      {/* Chat Button - Only show when chat is closed */}
      {!isChatOpen && (
        <button
          onClick={() => setIsChatOpen(true)}
          className="bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-full p-4 shadow-lg transition-all duration-300 hover:scale-110 border-3 border-blue-500 ml-auto"
          aria-label="Open AI Chat"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      )}

      {/* Chat Window */}
      {isChatOpen && (
        <div className="bg-white rounded-xl shadow-xl border-3 border-blue-500 overflow-hidden w-96 transition-all duration-300">
          {/* Chat Header with Close Button */}
          <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white p-4 flex justify-between items-center">
            <div>
              <h3 className="text-lg font-semibold">MediPulse Assistant</h3>
              <p className="text-sm text-blue-100">How can I help you today?</p>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={showMainMenu}
                className="text-white hover:text-blue-100 transition-colors bg-blue-600 rounded-full p-2"
                aria-label="Main menu"
              >
                <Home className="h-5 w-5" />
              </button>
              <button
                onClick={() => setIsChatOpen(false)}
                className="text-white hover:text-blue-100 transition-colors bg-blue-600 rounded-full p-2"
                aria-label="Close chat"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Chat Messages */}
          <div className="h-96 overflow-y-auto p-4 space-y-4 bg-gray-50 custom-scrollbar">
            {messages.map((message, index) => (
              <div key={index} className="flex flex-col space-y-2">
                {/* Message bubble */}
                <div className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`rounded-2xl p-3 max-w-[80%] shadow-sm ${
                    message.role === 'user' 
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-800 border border-blue-200'
                  }`}>
                    <p className="text-sm">
                      {message.content}
                    </p>
                  </div>
                </div>
                
                {/* Option buttons */}
                {message.options && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {message.options.map((option, i) => (
                      <button
                        key={i}
                        onClick={() => handleOptionSelect(option.value)}
                        className="bg-white hover:bg-blue-50 text-blue-600 px-4 py-2 rounded-lg border border-blue-300 text-sm transition-colors font-medium shadow-sm hover:shadow"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
                
                {/* Doctor cards horizontal scrolling */}
                {message.doctorCards && (
                  <div className="overflow-x-auto flex space-x-4 py-2 pb-3 mt-2 custom-scrollbar">
                    {message.doctorCards.map((doctor, i) => (
                      <div 
                        key={i} 
                        className="min-w-[220px] bg-white border border-blue-200 rounded-xl p-4 flex-shrink-0 hover:border-blue-500 cursor-pointer transition-all duration-200 shadow-sm hover:shadow-md"
                        onClick={() => handleDoctorCardClick(doctor._id)}
                      >
                        <div className="flex items-center space-x-2 mb-2">
                          <div className="w-9 h-9 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-lg font-semibold">
                            {doctor.firstName[0]}
                          </div>
                          <h4 className="font-medium text-gray-800">
                            Dr. {doctor.firstName} {doctor.lastName || ""}
                          </h4>
                        </div>
                        <div className="mb-2 pb-2 border-b border-gray-100">
                          <p className="text-sm text-blue-700 font-medium">
                            {doctor.experience.expertise}
                          </p>
                          <p className="text-xs text-gray-600 mt-1">
                            {doctor.experience.years} years experience
                          </p>
                        </div>
                        {doctor.rating && (
                          <p className="text-xs text-amber-500 font-medium flex items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1 inline" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                            </svg>
                            {doctor.rating}
                          </p>
                        )}
                        <button 
                          className="mt-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium py-1.5 px-3 rounded-lg w-full transition-colors shadow-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDoctorCardClick(doctor._id);
                          }}
                        >
                          View Profile
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                
                {/* Community cards horizontal scrolling */}
                {message.communityCards && (
                  <div className="overflow-x-auto flex space-x-4 py-2 pb-3 mt-2 custom-scrollbar">
                    {message.communityCards.map((community, i) => (
                      <div 
                        key={i} 
                        className="min-w-[220px] bg-white border border-blue-200 rounded-xl p-4 flex-shrink-0 hover:border-blue-500 cursor-pointer transition-all duration-200 shadow-sm hover:shadow-md"
                        onClick={() => handleCommunityCardClick(community._id)}
                      >
                        <div className="flex items-center space-x-2 mb-2">
                          <div className="w-9 h-9 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-lg font-semibold">
                            {community.title[0]}
                          </div>
                          <h4 className="font-medium text-gray-800 line-clamp-1">
                            {community.title}
                          </h4>
                        </div>
                        <div className="mb-2 pb-2 border-b border-gray-100">
                          <span className="inline-block px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full mb-2">
                            {community.category}
                          </span>
                          <p className="text-xs text-gray-600 line-clamp-2">
                            {community.bio}
                          </p>
                        </div>
                        <button 
                          className="mt-2 bg-green-600 hover:bg-green-700 text-white text-xs font-medium py-1.5 px-3 rounded-lg w-full transition-colors shadow-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCommunityCardClick(community._id);
                          }}
                        >
                          Join Community
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            
            {isLoading && (
              <div className="flex items-center justify-center space-x-1 py-3">
                <div className="w-2 h-2 rounded-full bg-blue-400 animate-bounce"></div>
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" style={{ animationDelay: "0.2s" }}></div>
                <div className="w-2 h-2 rounded-full bg-blue-600 animate-bounce" style={{ animationDelay: "0.4s" }}></div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>

          {/* Chat Input */}
          <form onSubmit={handleSendMessage} className="border-t border-gray-200 p-4 bg-white">
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="Type your message..."
                className="flex-1 border border-gray-300 bg-gray-50 text-gray-800 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500"
                disabled={isLoading}
              />
              <button
                type="submit"
                className="bg-blue-600 text-white p-2.5 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:bg-gray-400"
                disabled={isLoading || !inputMessage.trim()}
                aria-label="Send message"
              >
                <Send className="h-5 w-5" />
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

// Add this CSS to your global styles or tailwind config
// .custom-scrollbar::-webkit-scrollbar {
//   width: 6px;
//   height: 6px;
// }
// .custom-scrollbar::-webkit-scrollbar-track {
//   background: #f1f5f9;
// }
// .custom-scrollbar::-webkit-scrollbar-thumb {
//   background-color: #cbd5e1;
//   border-radius: 20px;
// }

export default AiBot;