import { useState, useEffect } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { Shield } from "lucide-react";
import { BACKEND_URL } from "../utils";

const EventCard = () => {
  const [eventCount, setEventCount] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    axios.get(`${BACKEND_URL}/event`, {
      params: { status: "upcoming" },
      withCredentials: true,
    })
      .then((res) => {
        const eventsThisWeek = (res.data.events || []).filter(isThisWeek);
        setEventCount(eventsThisWeek.length);
      })
      .catch((err) => console.error("Error fetching events", err));
  }, []);

  // Helper function to check if an event is in the current week
  const isThisWeek = (event) => {
    const eventDate = new Date(event.time);
    const today = new Date();
    const startOfWeek = new Date(today.setDate(today.getDate() - today.getDay())); // Start of week
    const endOfWeek = new Date(today.setDate(today.getDate() - today.getDay() + 6)); // End of week

    return eventDate >= startOfWeek && eventDate <= endOfWeek;
  };

  return (
    <div 
      className="bg-white p-4 rounded-lg shadow-md cursor-pointer hover:shadow-lg transition"
      onClick={() => navigate("/events")} // Redirect to the events page
    >
      <div className="flex items-center gap-4">
      <div className="">
        <Shield className="text-blue-600 bg-blue-100 size-10 p-2 border rounded-lg"/>
      </div>
      <div>
      <h3 className="text-lg font-semibold">Upcoming Events</h3>
      <p className="text-gray-600">{eventCount} events this week</p>
      </div>
      </div>
    </div>
  );
};

export default EventCard;


