import { useState, useEffect, useRef } from 'react'
import {
  Send,
  Plus,
  Search,
  Users,
  Menu,
  X,
  MessageCircle
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import axios from 'axios'
import Voice from '../components/Voice'
import { BACKEND_URL } from '../utils'
import { Link, useNavigate } from 'react-router-dom'

function Chat() {
  const { user, communities,isAuth } = useAuth()
  const [messages, setMessages] = useState([])
  const [inputMessage, setInputMessage] = useState('')
  const [voiceMessage, setVoiceMessage] = useState('')
  const [selectedCommunity, setSelectedCommunity] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [showSidebar, setShowSidebar] = useState(false)
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef(null)
  const navigate = useNavigate()
  useEffect(()=>{
    if(!isAuth) navigate("/login");
  },[isAuth]);
  // Format timestamp for messages
  const formatMessageTime = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  useEffect(() => {
    if (selectedCommunity === null) {
      return
    }
    
    const interval = setInterval(async() => {
      try {
        const response = await axios.get(
          `${BACKEND_URL}/community/${communities[selectedCommunity]._id}`,
          { withCredentials: true }
        )
        
        const formattedMessages = response.data.map((msg) => ({
          ...msg,
          isUser: msg.author === user?._id,
        }))
        
        setMessages(formattedMessages)
      } catch (error) {
        console.error("Error polling for messages:", error)
      }
    }, 2000)
    
    return () => clearInterval(interval)
  }, [selectedCommunity])

  // Get user's first name and last initial
  const getUserInitials = (firstName, lastName) => {
    if (!firstName) return ''
    return lastName
      ? `${firstName.charAt(0)}${lastName.charAt(0)}`
      : firstName.charAt(0)
  }

  // Handle sending a message
  const handleSendMessage = async (e) => {
    e.preventDefault()
    const content = inputMessage || voiceMessage
    
    if (!content.trim() || selectedCommunity === null) {
      return
    }

    try {
      setLoading(true)
      const response = await axios.post(
        `${BACKEND_URL}/message`,
        {
          id: communities[selectedCommunity]._id,
          content: content.trim(),
        },
        { withCredentials: true }
      )

      // Add the new message to the messages state
      if (response.data.msg) {
        const newMessage = {
          ...response.data.msg,
          isUser: response.data.msg.author === user?._id,
        }
        setMessages((prev) => [...prev, newMessage])
      }

      // Clear input fields
      setInputMessage('')
      setVoiceMessage('')
    } catch (error) {
      console.error('Error sending message:', error)
    } finally {
      setLoading(false)
    }
  }

  // Handle community selection
  const handleChangeCommunity = async (index) => {
    try {
      setLoading(true)
      setSelectedCommunity(index)

      const response = await axios.get(
        `${BACKEND_URL}/community/${communities[index]._id}`,
        { withCredentials: true }
      )

      // Transform message objects to include isUser property
      const formattedMessages = response.data.map((msg) => ({
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
    if (!name) return 'bg-blue-500'

    const colors = [
      'bg-blue-500',
      'bg-indigo-500',
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
    <div className="flex h-[calc(100vh-7rem)] bg-gray-50 shadow-md rounded-lg overflow-hidden border border-gray-200 m-4">
      {/* Mobile overlay for sidebar */}
      {showSidebar && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* Sidebar - with adjusted height */}
      <div
        className={`fixed lg:relative z-40 h-full bg-white border-r border-gray-200 w-72 max-w-[85%] transition-transform duration-300 
          ${showSidebar ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        {/* Community header */}
        <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-gray-800 truncate">Communities</h1>
            <div className="flex items-center">
              <Link
                to={"/communities"}
                className="text-blue-600 hover:bg-blue-100 p-2 rounded-full transition-colors"
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
              className="w-full px-4 py-2 pl-9 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-800 text-sm"
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
              <Link to="/communities" className="mt-4 inline-block px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors">
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
                className={`p-3 hover:bg-gray-50 cursor-pointer transition-colors ${
                  index === selectedCommunity
                    ? 'bg-blue-50 border-l-4 border-blue-600'
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
                    <h2 className="font-medium text-gray-800 truncate">
                      {community.title}
                    </h2>
                    <div className="flex items-center text-xs text-gray-500">
                      <Users size={12} className="mr-1 flex-shrink-0" />
                      <span className="truncate">{community.members?.length || 0} members</span>
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
          <div className="p-3 border-b border-gray-200 bg-white shadow-sm flex items-center justify-between">
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
                <h2 className="text-base font-semibold text-gray-800 truncate">
                  {communities[selectedCommunity].title}
                </h2>
                <div className="flex items-center text-xs text-gray-500">
                  <Users size={12} className="mr-1 flex-shrink-0" />
                  <span className="truncate">
                    {communities[selectedCommunity].members?.length || 0} members
                  </span>
                </div>
              </div>
            </div>
            <div className="hidden md:flex items-center ml-2 flex-shrink-0">
              <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium shadow-sm truncate max-w-[140px]">
                {communities[selectedCommunity].category}
              </span>
            </div>
          </div>
        )}

        {/* Messages Area - adjusted for better space utilization */}
        <div
          ref={messagesEndRef}
          className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3E%3Cg fill-rule='evenodd'%3E%3Cg fill='%239C92AC' fill-opacity='0.03'%3E%3Cpath opacity='.5' d='M96 95h4v1h-4v4h-1v-4h-9v4h-1v-4h-9v4h-1v-4h-9v4h-1v-4h-9v4h-1v-4h-9v4h-1v-4h-9v4h-1v-4h-9v4h-1v-4h-9v4h-1v-4H0v-1h15v-9H0v-1h15v-9H0v-1h15v-9H0v-1h15v-9H0v-1h15v-9H0v-1h15v-9H0v-1h15v-9H0v-1h15v-9H0v-1h15V0h1v15h9V0h1v15h9V0h1v15h9V0h1v15h9V0h1v15h9V0h1v15h9V0h1v15h9V0h1v15h4v1h-4v9h4v1h-4v9h4v1h-4v9h4v1h-4v9h4v1h-4v9h4v1h-4v9h4v1h-4v9h4v1h-4v9zm-1 0v-9h-9v9h9zm-10 0v-9h-9v9h9zm-10 0v-9h-9v9h9zm-10 0v-9h-9v9h9zm-10 0v-9h-9v9h9zm-10 0v-9h-9v9h9zm-10 0v-9h-9v9h9zm-10 0v-9h-9v9h9zm-9-10h9v-9h-9v9zm10 0h9v-9h-9v9zm10 0h9v-9h-9v9zm10 0h9v-9h-9v9zm10 0h9v-9h-9v9zm10 0h9v-9h-9v9zm10 0h9v-9h-9v9zm10 0h9v-9h-9v9zm9-10v-9h-9v9h9zm-10 0v-9h-9v9h9zm-10 0v-9h-9v9h9zm-10 0v-9h-9v9h9zm-10 0v-9h-9v9h9zm-10 0v-9h-9v9h9zm-10 0v-9h-9v9h9zm-10 0v-9h-9v9h9zm-9-10h9v-9h-9v9zm10 0h9v-9h-9v9zm10 0h9v-9h-9v9zm10 0h9v-9h-9v9zm10 0h9v-9h-9v9zm10 0h9v-9h-9v9zm10 0h9v-9h-9v9zm10 0h9v-9h-9v9z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
          }}
        >
          {selectedCommunity === null ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-4">
              <div className="bg-white p-6 rounded-xl shadow-sm max-w-md border border-gray-100">
                <div className="bg-blue-50 p-3 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                  <Users size={28} className="text-blue-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-800 mb-3">
                  Welcome to Communities
                </h2>
                <p className="text-gray-600 mb-5">
                  Select a community from the sidebar to start chatting with
                  other members.
                </p>
                <button
                  onClick={() => setShowSidebar(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors lg:hidden shadow-sm font-medium"
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
              <div className="bg-white p-6 rounded-lg shadow-sm max-w-sm border border-gray-100">
                <div className="bg-blue-100 rounded-full p-3 w-14 h-14 flex items-center justify-center mx-auto mb-4">
                  <MessageCircle size={24} className="text-blue-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-800 mb-2">
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
                                message.isUser ? "bg-blue-500" : "bg-gray-400"
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
                                ? "bg-blue-600 text-white rounded-tr-none shadow-sm"
                                : "bg-white text-gray-800 rounded-tl-none border border-gray-200 shadow-sm"
                            } relative group-hover:shadow-md transition-shadow max-w-full overflow-hidden`}
                          >
                            <p className="whitespace-pre-wrap text-sm break-words">
                              {message.content}
                            </p>
                          </div>
                          <span
                            className={`text-xs text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity mx-2 flex-shrink-0`}
                          >
                            {formatMessageTime(message.createdAt || Date.now())}
                          </span>
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
            className="p-3 border-t border-gray-200 bg-white shadow-inner"
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
                className="ml-2 p-2.5 bg-blue-600 text-white rounded-full hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-blue-400 disabled:cursor-not-allowed transition-colors shadow-sm flex-shrink-0"
                title="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

export default Chat