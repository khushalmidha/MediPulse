import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import SignUp from "./pages/SignUp";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Chat from "./pages/Chat";
import DoctorsProfile from "./pages/DoctorsProfile";
import CommunityForm from "./pages/CommunityForm";
import Doctors from "./pages/Doctors";
import About from "./pages/About";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import DataUsagePolicy  from "./pages/DataUsagePolicy"
import AiBot from "./components/AiBot";
import AppointmentBooking from "./pages/AppointmentBooking";
import DoctorAppointments from "./pages/DoctorAppointments";
import MyAppointments from "./pages/MyAppointments";
import Events from "./pages/Events";
import PastEvents from "./pages/PastEvents";
import VirtualTransactions from "./pages/VirtualTransactions";
import VirtualRefunds from "./pages/VirtualRefunds";
import VirtualAdminDashboard from "./pages/VirtualAdminDashboard";
import VirtualNotifications from "./pages/VirtualNotifications";


function App() {
  console.log("App");
  return (
    <>
      <Navbar/>

      <Routes>
      <Route path="/" element={<Home />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/signup/:type" element={<SignUp/>} />
        <Route path="/login" element={<Login/>} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/doctorsProfile/:id" element={<DoctorsProfile />} />
        <Route path="/appointment/book/:doctorId" element={<AppointmentBooking />} />
        <Route path="/my-appointments" element={<MyAppointments />} />
        <Route path="/doctor/appointments" element={<DoctorAppointments />} />
        <Route path="/communities" element={<CommunityForm />} />
        <Route path="/events" element={<Events />} />
        <Route path="/events/past" element={<PastEvents />} />
        <Route path="/wallet/transactions" element={<VirtualTransactions />} />
        <Route path="/wallet/refunds" element={<VirtualRefunds />} />
        <Route path="/wallet/notifications" element={<VirtualNotifications />} />
        <Route path="/admin/virtual-payments" element={<VirtualAdminDashboard />} />
        <Route path="/doctors" element={<Doctors />}/>
        <Route path="/about" element={<About />}/>
        <Route path="/privacy" element={<Privacy />}/>
        <Route path="/terms" element={<Terms />}/>
        <Route path="/cookiepolicy" element={<DataUsagePolicy />}/>
      </Routes>
      <AiBot />
      <Footer />
    </>
  );
}

export default App;
