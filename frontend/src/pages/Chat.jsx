import { communityMemberCount } from "../utils/community";
import { useState, useEffect, useRef } from 'react'
import {
  Send,
  Plus,
  Search,
  Users,
  Menu,
  X,
  MessageCircle,
  Bell,
  Flag,
  ShieldAlert,
  AlertTriangle,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import axios from 'axios'
import Voice from '../components/Voice'
import { BACKEND_URL } from '../utils'
import { getSocket } from '../socket'
import { Link, useNavigate } from 'react-router-dom'
import { Banner, Button, Dialog, Field } from '../components/ui'

function Chat() {
  const { user, communities, isAuth } = useAuth()
  const [messages, setMessages] = useState([])
  const [inputMessage, setInputMessage] = useState('')
  const [voiceMessage, setVoiceMessage] = useState('')
  const [selectedCommunity, setSelectedCommunity] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [showSidebar, setShowSidebar] = useState(false)
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef(null)
  const prevCommunityIdRef = useRef(null)
  const navigate = useNavigate()
  const socketRef = useRef(null)

  // Report state
  const [reportTarget, setReportTarget] = useState(null)
  const [reportReason, setReportReason] = useState('')
  const [reportFeedback, setReportFeedback] = useState(null)
  const [reportBusy, setReportBusy] = useState(false)

  // Moderation queue state
  const [showModeration, setShowModeration] = useState(false)
  const [moderationReports, setModerationReports] = useState([])
  const [moderationLoading, setModerationLoading] = useState(false)
  const [moderationFeedback, setModerationFeedback] = useState(null)

  // Preferences state
  const [showPreferences, setShowPreferences] = useState(false)
  const [emailNotifications, setEmailNotifications] = useState(true)
  const [inAppNotifications, setInAppNotifications] = useState(true)
  const [prefFeedback, setPrefFeedback] = useState(null)
  const [prefBusy, setPrefBusy] = useState(false)

  useEffect(() => {
    if (!isAuth) navigate('/login')
  }, [isAuth, navigate])

  // ── Connect / disconnect socket on mount ──────────────────
  const socketConnected = useRef(false)

  useEffect(() => {
    const socket = getSocket()
    socketRef.current = socket

    if (!socket.connected) {
      socket.connect()
    }

    socket.on('connect', () => {

      socketConnected.current = true
      // Re-join room if one was selected
      if (prevCommunityIdRef.current) {
        socket.emit('joinCommunity', prevCommunityIdRef.current)
      }
    })

    socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message)
      socketConnected.current = false
    })

    // Listen for incoming messages
    socket.on('newMessage', (message) => {
      setMessages((prev) => {
        // Avoid duplicates (in case of race between REST response and socket)
        if (prev.some((m) => m._id === message._id)) return prev
        return [
          ...prev,
          { ...message, isUser: message.author === user?._id },
        ]
      })
    })

    return () => {
      socket.off('connect')
      socket.off('connect_error')
      socket.off('newMessage')
      // Leave current room on unmount
      if (prevCommunityIdRef.current) {
        socket.emit('leaveCommunity', prevCommunityIdRef.current)
      }
      socket.disconnect()
      socketConnected.current = false
    }
  }, [user?._id])

  // ── Fallback polling when socket is not connected ─────────
  const activeCommunityId = selectedCommunity !== null ? communities?.[selectedCommunity]?._id : null

  useEffect(() => {
    if (!activeCommunityId) return

    const interval = setInterval(async () => {
      // Only poll if socket is NOT connected
      if (socketConnected.current) return

      try {
        const response = await axios.get(
          `${BACKEND_URL}/community/${activeCommunityId}`,
          { withCredentials: true }
        )
        const rawList = Array.isArray(response.data) ? response.data : (response.data?.messages || []);
        const formattedMessages = rawList.map((msg) => ({
          ...msg,
          isUser: msg.author === user?._id,
        }))
        setMessages(formattedMessages)
      } catch (error) {
        console.error('Fallback polling error:', error)
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [activeCommunityId, user?._id])

  // Get user's first name and last initial
  const getUserInitials = (firstName, lastName) => {
    if (!firstName) return ''
    return lastName
      ? `${firstName.charAt(0)}${lastName.charAt(0)}`
      : firstName.charAt(0)
  }

  // Format timestamp for messages
  const formatMessageTime = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const currComm = selectedCommunity !== null ? communities?.[selectedCommunity] : null;
  const isOrganizer = Boolean(currComm && user?.role === "doctor" && (String(currComm.author?._id || currComm.author) === String(user?._id)));

  const handleReport = async (e) => {
    e.preventDefault();
    if (!reportReason.trim() || !reportTarget || !currComm) return;
    setReportBusy(true);
    try {
      await axios.post(
        `${BACKEND_URL}/community/${currComm._id}/messages/${reportTarget._id}/report`,
        { reason: reportReason.trim() },
        { withCredentials: true }
      );
      setReportFeedback({ tone: "positive", message: "Message reported for doctor review." });
      setTimeout(() => { setReportTarget(null); setReportFeedback(null); }, 1500);
    } catch (err) {
      setReportFeedback({ tone: "error", message: err.response?.data?.message || "Failed to submit report." });
    } finally {
      setReportBusy(false);
    }
  };

  const loadModerationReports = async () => {
    if (!currComm) return;
    setModerationLoading(true);
    setModerationFeedback(null);
    try {
      const res = await axios.get(`${BACKEND_URL}/community/${currComm._id}/reports`, { withCredentials: true });
      setModerationReports(res.data.reports || []);
    } catch (err) {
      setModerationFeedback({ tone: "error", message: err.response?.data?.message || "Failed to load moderation reports." });
    } finally {
      setModerationLoading(false);
    }
  };

  const handleModerateMessage = async (msgId) => {
    if (!currComm) return;
    try {
      await axios.delete(`${BACKEND_URL}/community/${currComm._id}/messages/${msgId}`, { withCredentials: true });
      setModerationFeedback({ tone: "positive", message: "Message removed by moderator." });
      loadModerationReports();
      setMessages(prev => prev.map(m => m._id === msgId ? { ...m, content: "[This message was removed by the doctor moderator]", isRemoved: true } : m));
    } catch (err) {
      setModerationFeedback({ tone: "error", message: err.response?.data?.message || "Failed to moderate message." });
    }
  };

  const handleDismissReport = async (msgId) => {
    if (!currComm) return;
    try {
      await axios.post(`${BACKEND_URL}/community/${currComm._id}/messages/${msgId}/dismiss`, {}, { withCredentials: true });
      setModerationFeedback({ tone: "positive", message: "Reports dismissed for this message." });
      loadModerationReports();
    } catch (err) {
      setModerationFeedback({ tone: "error", message: err.response?.data?.message || "Failed to dismiss report." });
    }
  };

  const openPreferences = async () => {
    if (!currComm) return;
    setShowPreferences(true);
    setPrefFeedback(null);
    try {
      const res = await axios.get(`${BACKEND_URL}/community/${currComm._id}/preferences`, { withCredentials: true });
      setEmailNotifications(Boolean(res.data.emailNotifications));
      setInAppNotifications(Boolean(res.data.inAppNotifications));
    } catch {
      setEmailNotifications(true);
      setInAppNotifications(true);
    }
  };

  const handleSavePreferences = async (e) => {
    e.preventDefault();
    if (!currComm) return;
    setPrefBusy(true);
    try {
      await axios.put(
        `${BACKEND_URL}/community/${currComm._id}/preferences`,
        { emailNotifications, inAppNotifications },
        { withCredentials: true }
      );
      setPrefFeedback({ tone: "positive", message: "Notification preferences saved." });
      setTimeout(() => { setShowPreferences(false); setPrefFeedback(null); }, 1200);
    } catch (err) {
      setPrefFeedback({ tone: "error", message: err.response?.data?.message || "Failed to save preferences." });
    } finally {
      setPrefBusy(false);
    }
  };

  // Handle sending a message via Socket.IO (with REST fallback)
  const handleSendMessage = async (e) => {
    e.preventDefault()
    const content = inputMessage || voiceMessage

    if (!content.trim() || selectedCommunity === null) {
      return
    }

    const socket = socketRef.current
    const communityId = communities[selectedCommunity]._id

    if (socket && socketConnected.current) {
      // Send via Socket.IO
      socket.emit('sendMessage', {
        communityId,
        content: content.trim(),
      })
    } else {
      // Fallback to REST API
      try {
        const response = await axios.post(
          `${BACKEND_URL}/message`,
          { id: communityId, content: content.trim() },
          { withCredentials: true }
        )
        if (response.data.msg) {
          const newMessage = {
            ...response.data.msg,
            isUser: response.data.msg.author === user?._id,
          }
          setMessages((prev) => [...prev, newMessage])
        }
      } catch (error) {
        console.error('Error sending message:', error)
      }
    }

    // Clear input fields immediately
    setInputMessage('')
    setVoiceMessage('')
  }

  // Handle community selection — join / leave socket rooms
  const handleChangeCommunity = async (index) => {
    try {
      setLoading(true)
      setSelectedCommunity(index)

      const socket = socketRef.current
      const newCommunityId = communities[index]._id

      // Leave previous room
      if (prevCommunityIdRef.current) {
        socket?.emit('leaveCommunity', prevCommunityIdRef.current)
      }

      // Join new room
      socket?.emit('joinCommunity', newCommunityId)
      prevCommunityIdRef.current = newCommunityId

      // Fetch existing messages via REST (initial load)
      const response = await axios.get(
        `${BACKEND_URL}/community/${newCommunityId}`,
        { withCredentials: true }
      )

      // Transform message objects to include isUser property
      const rawList = Array.isArray(response.data) ? response.data : (response.data?.messages || []);
      const formattedMessages = rawList.map((msg) => ({
        ...msg,
        isUser: msg.author === user?._id,
      }))

      setMessages(formattedMessages)
      setShowSidebar(false) // Close sidebar on mobile after selection
    } catch (error) {
      console.error('Error fetching community messages:', error)
    } finally {
      setLoading(false)
    }
  }

  // Fetch user's communities on component mount

// Auto-scroll message area to bottom when messages update
useEffect(() => {
  if (messages.length && messagesEndRef.current) {
    // This scrolls only the message container div
    const container = messagesEndRef.current;
    container.scrollTop = container.scrollHeight;
  }
}, [messages]);


  // Filter communities based on search term
  const filteredCommunities = communities?.filter((community) =>
    community.title?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // Generate color based on community name
  const getCommunityColor = (name) => {
    if (!name) return 'bg-red-500 dark:bg-red-600'

    const colors = [
      'bg-red-500 dark:bg-red-600',
      'bg-red-500',
      'bg-purple-500',
      'bg-pink-500',
      'bg-red-500',
      'bg-orange-500',
      'bg-amber-500',
      'bg-yellow-500',
      'bg-lime-500',
      'bg-green-500',
      'bg-emerald-500',
      'bg-teal-500',
      'bg-cyan-500',
    ]

    const charCode = name.charCodeAt(0)
    return colors[charCode % colors.length]
  }

  return (
    // Main container - adjusted to fit below navbar and above footer
    <div className="flex h-[calc(100vh-7rem)] bg-gray-50 dark:bg-slate-900 shadow-md rounded-lg overflow-hidden border border-gray-200 dark:border-red-900/40 m-4">
      {/* Mobile overlay for sidebar */}
      {showSidebar && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* Sidebar - with adjusted height */}
      <div
        className={`fixed lg:relative z-40 h-full bg-white dark:bg-slate-950 border-r border-gray-200 dark:border-red-900/40 w-72 max-w-[85%] transition-transform duration-300 
          ${showSidebar ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        {/* Community header */}
        <div className="p-4 border-b border-gray-200 dark:border-red-900/40 bg-gradient-to-r from-red-50 dark:from-red-950/20 to-red-50 dark:to-red-950/20">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-gray-800 dark:text-slate-200 truncate">Communities</h1>
            <div className="flex items-center">
              <Link
                to={"/communities"}
                className="text-red-600 dark:text-red-500 hover:bg-red-100 p-2 rounded-full transition-colors"
                title="Create new community"
              >
                <Plus size={18} />
              </Link>
              <button
                className="p-2 lg:hidden text-gray-500 hover:bg-gray-100 rounded-full ml-1"
                onClick={() => setShowSidebar(false)}
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="mt-3 relative">
            <input
              type="text"
              placeholder="Search communities..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-2 pl-9 bg-white dark:bg-slate-950 border border-gray-200 dark:border-red-900/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-800 dark:text-slate-200 text-sm"
            />
            <Search
              className="absolute left-3 top-2.5 text-gray-400"
              size={15}
            />
            {searchTerm && (
              <button
                className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
                onClick={() => setSearchTerm('')}
              >
                <X size={15} />
              </button>
            )}
          </div>
        </div>

        {/* Communities list - adjusted height to account for header */}
        <div className="overflow-y-auto h-[calc(100%-5.5rem)]">
          {loading && !communities?.length ? (
            <div className="p-3 flex justify-center">
              <div className="animate-pulse flex flex-col w-full space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center px-3 py-2">
                    <div className="w-10 h-10 rounded-full bg-gray-200 mr-3 flex-shrink-0"></div>
                    <div className="space-y-2 flex-1 min-w-0">
                      <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                      <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : communities?.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <div className="bg-gray-100 p-3 rounded-full w-14 h-14 mx-auto flex items-center justify-center mb-3">
                <Users size={24} className="text-gray-400" />
              </div>
              <p className="font-medium">No communities joined</p>
              <p className="text-sm mt-1">Join communities to start chatting</p>
              <Link to="/communities" className="mt-4 inline-block px-4 py-2 bg-red-600 dark:bg-red-700 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors">
                Browse Communities
              </Link>
            </div>
          ) : filteredCommunities?.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <div className="bg-gray-100 p-3 rounded-full w-14 h-14 mx-auto flex items-center justify-center mb-3">
                <Users size={24} className="text-gray-400" />
              </div>
              <p className="font-medium">No communities found</p>
              <p className="text-sm mt-1">Try a different search term</p>
            </div>
          ) : (
            filteredCommunities?.map((community, index) => (
              <div
                key={community._id}
                className={`p-3 hover:bg-gray-50 dark:bg-slate-900 cursor-pointer transition-colors ${
                  index === selectedCommunity
                    ? 'bg-red-50 border-l-4 border-red-600'
                    : ''
                }`}
                onClick={() => handleChangeCommunity(index)}
              >
                <div className="flex items-center min-w-0">
                  <div
                    className={`w-10 h-10 rounded-full ${getCommunityColor(
                      community.title
                    )} flex items-center justify-center text-white font-bold text-base shadow-sm flex-shrink-0`}
                  >
                    {community.title.charAt(0)}
                  </div>
                  <div className="ml-3 overflow-hidden flex-1">
                    <h2 className="font-medium text-gray-800 dark:text-slate-200 truncate">
                      {community.title}
                    </h2>
                    <div className="flex items-center text-xs text-gray-500">
                      <Users size={12} className="mr-1 flex-shrink-0" />
                      <span className="truncate">{communityMemberCount(community)} members</span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Chat Header */}
        {selectedCommunity !== null && communities[selectedCommunity] && (
          <div className="p-3 border-b border-gray-200 dark:border-red-900/40 bg-white dark:bg-slate-950 shadow-sm flex items-center justify-between">
            <div className="flex items-center min-w-0">
              <button
                className="mr-3 lg:hidden bg-gray-100 hover:bg-gray-200 p-2 rounded-full transition-colors flex-shrink-0"
                onClick={() => setShowSidebar(true)}
                aria-label="Open communities sidebar"
              >
                <Menu size={18} />
              </button>
              <div
                className={`w-9 h-9 rounded-full ${getCommunityColor(
                  communities[selectedCommunity].title
                )} flex items-center justify-center text-white font-bold shadow-sm flex-shrink-0`}
              >
                {communities[selectedCommunity].title.charAt(0)}
              </div>
              <div className="ml-3 overflow-hidden">
                <h2 className="text-base font-semibold text-gray-800 dark:text-slate-200 truncate">
                  {communities[selectedCommunity].title}
                </h2>
                <div className="flex items-center text-xs text-gray-500">
                  <Users size={12} className="mr-1 flex-shrink-0" />
                  <span className="truncate">
                    {communityMemberCount(communities[selectedCommunity])} members
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 ml-2 flex-shrink-0">
              {isOrganizer && (
                <button
                  type="button"
                  onClick={() => {
                    setShowModeration(true);
                    loadModerationReports();
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/60 transition-colors shadow-sm"
                  title="Community Moderation Queue"
                >
                  <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  <span className="hidden sm:inline">Moderation</span>
                </button>
              )}
              <button
                type="button"
                onClick={openPreferences}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 border border-gray-200 dark:border-slate-700 hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors shadow-sm"
                title="Notification Preferences"
              >
                <Bell className="w-4 h-4 text-gray-600 dark:text-slate-400" />
                <span className="hidden sm:inline">Preferences</span>
              </button>
              <div className="hidden md:flex items-center">
                <span className="px-3 py-1 bg-red-100 text-blue-800 rounded-full text-xs font-medium shadow-sm truncate max-w-[140px]">
                  {communities[selectedCommunity].category}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Messages Area - adjusted for better space utilization */}
        <div
          ref={messagesEndRef}
          className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50 dark:bg-slate-900"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3E%3Cg fill-rule='evenodd'%3E%3Cg fill='%239C92AC' fill-opacity='0.03'%3E%3Cpath opacity='.5' d='M96 95h4v1h-4v4h-1v-4h-9v4h-1v-4h-9v4h-1v-4h-9v4h-1v-4h-9v4h-1v-4h-9v4h-1v-4h-9v4h-1v-4h-9v4h-1v-4h-9v4h-1v-4H0v-1h15v-9H0v-1h15v-9H0v-1h15v-9H0v-1h15v-9H0v-1h15v-9H0v-1h15v-9H0v-1h15v-9H0v-1h15v-9H0v-1h15V0h1v15h9V0h1v15h9V0h1v15h9V0h1v15h9V0h1v15h9V0h1v15h9V0h1v15h9V0h1v15h4v1h-4v9h4v1h-4v9h4v1h-4v9h4v1h-4v9h4v1h-4v9h4v1h-4v9h4v1h-4v9h4v1h-4v9zm-1 0v-9h-9v9h9zm-10 0v-9h-9v9h9zm-10 0v-9h-9v9h9zm-10 0v-9h-9v9h9zm-10 0v-9h-9v9h9zm-10 0v-9h-9v9h9zm-10 0v-9h-9v9h9zm-10 0v-9h-9v9h9zm-9-10h9v-9h-9v9zm10 0h9v-9h-9v9zm10 0h9v-9h-9v9zm10 0h9v-9h-9v9zm10 0h9v-9h-9v9zm10 0h9v-9h-9v9zm10 0h9v-9h-9v9zm10 0h9v-9h-9v9zm9-10v-9h-9v9h9zm-10 0v-9h-9v9h9zm-10 0v-9h-9v9h9zm-10 0v-9h-9v9h9zm-10 0v-9h-9v9h9zm-10 0v-9h-9v9h9zm-10 0v-9h-9v9h9zm-10 0v-9h-9v9h9zm-9-10h9v-9h-9v9zm10 0h9v-9h-9v9zm10 0h9v-9h-9v9zm10 0h9v-9h-9v9zm10 0h9v-9h-9v9zm10 0h9v-9h-9v9zm10 0h9v-9h-9v9zm10 0h9v-9h-9v9z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
          }}
        >
          {selectedCommunity === null ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-4">
              <div className="bg-white dark:bg-slate-950 p-6 rounded-xl shadow-sm max-w-md border border-gray-100">
                <div className="bg-red-50 p-3 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                  <Users size={28} className="text-red-600 dark:text-red-500" />
                </div>
                <h2 className="text-xl font-bold text-gray-800 dark:text-slate-200 mb-3">
                  Welcome to Communities
                </h2>
                <p className="text-gray-600 mb-5">
                  Select a community from the sidebar to start chatting with
                  other members.
                </p>
                <button
                  onClick={() => setShowSidebar(true)}
                  className="px-4 py-2 bg-red-600 dark:bg-red-700 text-white rounded-md hover:bg-blue-700 transition-colors lg:hidden shadow-sm font-medium"
                >
                  Browse Communities
                </button>
              </div>
            </div>
          ) : loading && !messages.length ? (
            <div className="flex flex-col space-y-4 p-3">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className={`flex ${i % 2 === 0 ? "justify-end" : "justify-start"}`}
                >
                  <div className="animate-pulse flex items-start max-w-[80%]">
                    <div className="h-8 w-8 rounded-full bg-gray-200 flex-shrink-0"></div>
                    <div
                      className={`mx-3 ${
                        i % 2 === 0 ? "items-end" : "items-start"
                      }`}
                    >
                      <div className="h-3 bg-gray-200 rounded-full w-16 mb-1"></div>
                      <div className="h-12 bg-gray-200 rounded-lg w-32 sm:w-40"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-center p-4">
              <div className="bg-white dark:bg-slate-950 p-6 rounded-lg shadow-sm max-w-sm border border-gray-100">
                <div className="bg-red-100 rounded-full p-3 w-14 h-14 flex items-center justify-center mx-auto mb-4">
                  <MessageCircle size={24} className="text-red-600 dark:text-red-500" />
                </div>
                <h3 className="text-lg font-semibold text-gray-800 dark:text-slate-200 mb-2">
                  No messages yet
                </h3>
                <p className="text-gray-600 text-sm mb-3">
                  Be the first to send a message in this community!
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Message list */}
              {messages.map((message, index) => {
                const isFirstMessageFromUser =
                  index === 0 || messages[index - 1].author !== message.author

                return (
                  <div
                    key={message._id || index}
                    className={`flex ${
                      message.isUser ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`flex ${
                        message.isUser ? "flex-row-reverse" : "flex-row"
                      } items-end max-w-[85%] group`}
                    >
                      {isFirstMessageFromUser && (
                        <div
                          className={`${
                            message.isUser ? "ml-2" : "mr-2"
                          } flex-shrink-0`}
                        >
                          {message.avatar ? (
                            <img
                              src={message.avatar}
                              alt={message.author_name}
                              className="w-8 h-8 rounded-full object-cover border-2 border-white shadow-sm"
                            />
                          ) : (
                            <div
                              className={`w-8 h-8 rounded-full ${
                                message.isUser ? "bg-red-500 dark:bg-red-600" : "bg-gray-400"
                              } flex items-center justify-center text-white text-xs font-medium shadow-sm`}
                            >
                              {getUserInitials(
                                message.author_name?.split(" ")[0],
                                message.author_name?.split(" ")[1]
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      <div
                        className={`mx-1 ${
                          !isFirstMessageFromUser &&
                          (message.isUser ? "mr-10" : "ml-10")
                        } max-w-full`}
                      >
                        {isFirstMessageFromUser && (
                          <div
                            className={`flex ${
                              message.isUser ? "justify-end" : "justify-start"
                            } mb-1`}
                          >
                            <span className="font-medium text-xs text-gray-700 px-1 truncate max-w-[180px]">
                              {message.author_name || "Unknown"}
                            </span>
                          </div>
                        )}
                        <div className="flex items-end">
                          <div
                            className={`rounded-2xl px-3 py-2 ${
                              message.isUser
                                ? "bg-red-600 dark:bg-red-700 text-white rounded-tr-none shadow-sm"
                                : "bg-white dark:bg-slate-950 text-gray-800 dark:text-slate-200 rounded-tl-none border border-gray-200 dark:border-red-900/40 shadow-sm"
                            } relative group-hover:shadow-md transition-shadow max-w-full overflow-hidden`}
                          >
                            <p className={`whitespace-pre-wrap text-sm break-words ${message.isRemoved ? 'italic text-gray-400 dark:text-slate-500' : ''}`}>
                              {message.content}
                            </p>
                          </div>
                          <span
                            className={`text-xs text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity mx-2 flex-shrink-0`}
                          >
                            {formatMessageTime(message.createdAt || Date.now())}
                          </span>
                          {!message.isUser && !message.isRemoved && (
                            <button
                              type="button"
                              onClick={() => {
                                setReportTarget(message);
                                setReportReason('');
                                setReportFeedback(null);
                              }}
                              className="text-xs text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity p-1 ml-1 rounded hover:bg-gray-100 dark:hover:bg-slate-800"
                              title="Report message"
                            >
                              <Flag className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
              {/* This invisible element helps scroll to bottom */}

            </>
          )}
        </div>

        {/* Message Input */}
        {selectedCommunity !== null && (
          <form
            onSubmit={handleSendMessage}
            className="p-3 border-t border-gray-200 dark:border-red-900/40 bg-white dark:bg-slate-950 shadow-inner"
          >
            <div className="flex items-center">
              <input
                type="text"
                placeholder="Type your message..."
                value={inputMessage || voiceMessage}
                onChange={(e) => {
                  setInputMessage(e.target.value)
                  setVoiceMessage("") // Clear voice message when typing
                }}
                disabled={loading}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 shadow-inner text-sm"
              />

              <Voice setNewMessage={setVoiceMessage} />

              <button
                type="submit"
                disabled={(!inputMessage && !voiceMessage) || loading}
                className="ml-2 p-2.5 bg-red-600 dark:bg-red-700 text-white rounded-full hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-blue-400 disabled:cursor-not-allowed transition-colors shadow-sm flex-shrink-0"
                title="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Report Message Dialog */}
      <Dialog
        open={Boolean(reportTarget)}
        onClose={() => setReportTarget(null)}
        title="Report Message"
        description="Notify community organizers about inappropriate content or guideline violations."
      >
        <form onSubmit={handleReport} className="space-y-4">
          {reportFeedback && (
            <Banner tone={reportFeedback.tone}>{reportFeedback.message}</Banner>
          )}
          <div className="p-3 bg-gray-50 dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 text-xs">
            <span className="font-semibold text-gray-700 dark:text-slate-300">
              {reportTarget?.author_name || "Member"}:
            </span>{" "}
            <span className="text-gray-600 dark:text-slate-400 italic">
              &quot;{reportTarget?.content}&quot;
            </span>
          </div>
          <Field label="Reason for report (required)" hint="Explain why this violates community guidelines (max 500 characters)">
            <textarea
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-blue-500"
              rows={3}
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              placeholder="e.g., Harassment, misleading medical advice, spam..."
              maxLength={500}
              required
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setReportTarget(null)}
              disabled={reportBusy}
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={reportBusy || !reportReason.trim()}>
              {reportBusy ? "Submitting..." : "Submit Report"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Moderation Queue Dialog (Organizer Only) */}
      <Dialog
        open={showModeration}
        onClose={() => setShowModeration(false)}
        title="Community Moderation Queue"
        description="Review reported messages with full evidence and resolve reports."
      >
        <div className="space-y-4 max-h-[70vh] overflow-y-auto">
          {moderationFeedback && (
            <Banner tone={moderationFeedback.tone}>{moderationFeedback.message}</Banner>
          )}
          {moderationLoading ? (
            <p className="text-sm text-gray-500 py-4 text-center">Loading reported messages...</p>
          ) : moderationReports.length === 0 ? (
            <div className="text-center py-6 text-gray-500">
              <ShieldAlert className="w-10 h-10 mx-auto text-green-500 mb-2 opacity-80" />
              <p className="font-medium text-gray-700 dark:text-slate-300">No active reports</p>
              <p className="text-xs text-gray-500">Community feed is clean and within guidelines.</p>
            </div>
          ) : (
            moderationReports.map((item) => (
              <div
                key={item._id}
                className="p-3.5 border border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-slate-900 rounded-lg space-y-2"
              >
                <div className="flex justify-between items-start text-xs">
                  <div>
                    <span className="font-semibold text-gray-800 dark:text-slate-200">
                      {item.author?.name || "Author"}
                    </span>
                    <span className="text-gray-400 ml-2">
                      {formatMessageTime(item.createdAt)}
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
                    {item.reportCount || item.reports?.length || 1} report(s)
                  </span>
                </div>
                <div className="p-2.5 bg-white dark:bg-slate-950 rounded border border-gray-200 dark:border-slate-800 text-sm">
                  {item.isRemoved ? (
                    <span className="italic text-gray-400">
                      Original: &quot;{item.originalContent || item.content}&quot; (Currently removed)
                    </span>
                  ) : (
                    <span>&quot;{item.content}&quot;</span>
                  )}
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold text-gray-600 dark:text-slate-400 uppercase tracking-wider">
                    Report Reasons:
                  </p>
                  <ul className="text-xs space-y-1 text-gray-700 dark:text-slate-300">
                    {item.reports?.map((r, i) => (
                      <li key={i} className="flex items-start gap-1">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                        <span>
                          <strong className="text-gray-900 dark:text-slate-100">{r.reportedBy?.name || "Member"}:</strong> {r.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex justify-end gap-2 pt-2 border-t border-amber-200/60 dark:border-slate-800">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleDismissReport(item._id)}
                  >
                    Dismiss Reports
                  </Button>
                  {!item.isRemoved && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => handleModerateMessage(item._id)}
                    >
                      Remove Message
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
          <div className="flex justify-end pt-2">
            <Button variant="outline" onClick={() => setShowModeration(false)}>
              Close
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Notification Preferences Dialog */}
      <Dialog
        open={showPreferences}
        onClose={() => setShowPreferences(false)}
        title="Community Notification Preferences"
        description="Choose how you receive community announcements and event reminders."
      >
        <form onSubmit={handleSavePreferences} className="space-y-4">
          {prefFeedback && (
            <Banner tone={prefFeedback.tone}>{prefFeedback.message}</Banner>
          )}
          <div className="space-y-3 pt-1">
            <label className="flex items-start gap-3 cursor-pointer p-2.5 rounded-lg border border-gray-200 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-900 transition-colors">
              <input
                type="checkbox"
                checked={inAppNotifications}
                onChange={(e) => setInAppNotifications(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
              />
              <div className="text-sm">
                <span className="font-medium text-gray-800 dark:text-slate-200">In-App Notifications</span>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  Receive live alerts and socket updates for announcements and upcoming community events.
                </p>
              </div>
            </label>
            <label className="flex items-start gap-3 cursor-pointer p-2.5 rounded-lg border border-gray-200 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-900 transition-colors">
              <input
                type="checkbox"
                checked={emailNotifications}
                onChange={(e) => setEmailNotifications(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
              />
              <div className="text-sm">
                <span className="font-medium text-gray-800 dark:text-slate-200">Email Notifications</span>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  Receive email digests and reminders when organizers post announcements or schedule events.
                </p>
              </div>
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowPreferences(false)}
              disabled={prefBusy}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={prefBusy}>
              {prefBusy ? "Saving..." : "Save Preferences"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}

export default Chat