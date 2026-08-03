import { Routes, Route, useParams } from "react-router-dom";
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
import { getHospitalSlugFromHostname } from "./utils/hospitalSubdomain";
import HospitalWebsite from "./pages/hospital-website/HospitalWebsite";
import HospitalsListPage from "./pages/HospitalsListPage";
import HospitalAdminSignup from "./pages/HospitalAdminSignup";
import HospitalAdminDashboard from "./pages/HospitalAdminDashboard";
import DoctorOpdConsole from "./pages/hospital-staff/DoctorOpdConsole";
import NursingStation from "./pages/hospital-staff/NursingStation";
import StaffCommunication from "./pages/hospital-staff/StaffCommunication";
import StaffAcceptInvite from "./pages/StaffAcceptInvite";
import ReviewVisit from "./pages/ReviewVisit";
import OpdTriage from "./pages/OpdTriage";
import PatientHealthPortal from "./pages/PatientHealthPortal";


function App() {
  const hospitalSlug = getHospitalSlugFromHostname();

  if (hospitalSlug) {
    return <HospitalWebsite slug={hospitalSlug} />;
  }

  return (
    <>
      <Navbar/>

      <Routes>
      <Route path="/" element={<Home />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/signup/:type" element={<SignUp/>} />
        <Route path="/signup/hospital-admin" element={<HospitalAdminSignup />} />
        <Route path="/hospital/admin" element={<HospitalAdminDashboard />} />
        <Route path="/hospital/doctor-opd" element={<DoctorOpdConsole />} />
        <Route path="/hospital/nursing-station" element={<NursingStation />} />
        <Route path="/hospital/staff-communication" element={<StaffCommunication />} />
        <Route path="/staff/accept-invite" element={<StaffAcceptInvite />} />
        <Route path="/review" element={<ReviewVisit />} />
        <Route path="/opd/triage" element={<OpdTriage />} />
        <Route path="/health-records" element={<PatientHealthPortal />} />
        <Route path="/hospitals" element={<HospitalsListPage />} />
        <Route path="/hospitals/:slug" element={<HospitalByPath />} />
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

function HospitalByPath() {
  const { slug } = useParams();
  return <HospitalWebsite slug={slug} />;
}

export default App;
