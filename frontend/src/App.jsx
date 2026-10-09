import { useEffect } from "react";
import { Routes, Route, Navigate, useParams, useLocation } from "react-router-dom";
import { classifyHostname } from "./utils/productHosts";
import { useProduct } from "./context/ProductContext";
import { CompanyHome, ConnectHome, StaffHome, RouteNotFound } from "./pages/ProductHome";
import PatientVisits from "./pages/hospital-website/PatientVisits";
import ProductShell from "./components/ProductShell";
import SignUp from "./pages/SignUp";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import EditProfile from "./pages/EditProfile";
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
import SmartBooking from "./pages/SmartBooking";
import PatientHealthPortal from "./pages/PatientHealthPortal";


function App() {
  const product = useProduct();
  const location = useLocation();
  if (product.kind === "patient") {
    return <ProductShell type="patient"><Routes>
      <Route path="/" element={<HospitalWebsite slug={product.slug} />} />
      <Route path="/login" element={<Login initialType="user" lockProfile />} />
      <Route path="/signup" element={<SignUp initialType="user" lockProfile />} />
      <Route path="/dashboard" element={<Navigate to="/visits" replace />} />
      <Route path="/visits" element={<PatientVisits slug={product.slug} />} />
      <Route path="/visits/:tokenId" element={<PatientVisits slug={product.slug} />} />
      <Route path="/profile/edit" element={<EditProfile />} />
      <Route path="/review" element={<ReviewVisit />} />
      <Route path="/privacy" element={<Privacy />} /><Route path="/terms" element={<Terms />} />
      <Route path="*" element={<RouteNotFound />} />
    </Routes></ProductShell>;
  }
  if (product.kind === "staff") return <ProductShell type="staff"><Routes>
    <Route path="/" element={<StaffHome />} /><Route path="/hospital" element={<StaffHome />} />
    <Route path="/login" element={<Login initialType="hospital-admin" lockProfile />} />
    <Route path="/hospital/login" element={<Login initialType="hospital-admin" lockProfile />} />
    <Route path="/hospital/signup" element={<HospitalAdminSignup />} />
    <Route path="/signup/hospital-admin" element={<HospitalAdminSignup />} />
    <Route path="/hospital/admin" element={<HospitalAdminDashboard />} />
    <Route path="/hospital/doctor-opd" element={<DoctorOpdConsole />} />
    <Route path="/hospital/nursing-station" element={<NursingStation />} />
    <Route path="/hospital/staff-communication" element={<StaffCommunication />} />
    <Route path="/staff/accept-invite" element={<StaffAcceptInvite />} />
    <Route path="*" element={<RouteNotFound />} />
  </Routes></ProductShell>;
  return (
    <ProductShell type={product.kind === "company" && location.pathname === "/" ? "company" : "care"}>

      <Routes>
      <Route path="/" element={product.kind === "connect" ? <ConnectHome /> : <CompanyHome />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/signup/:type" element={<SignUp/>} />
        <Route path="/signup/hospital-admin" element={<StaffRedirect />} />
        <Route path="/review" element={<ReviewVisit />} />
        <Route path="/triage/:appointmentId" element={<OpdTriage />} />
          <Route path="/smart-booking" element={<SmartBooking />} />
        <Route path="/health-records" element={<PatientHealthPortal />} />
        <Route path="/hospitals" element={<HospitalsListPage />} />
        <Route path="/hospitals/:slug/*" element={<HospitalProductRedirect />} />
        <Route path="/login" element={<Login/>} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/profile/edit" element={<EditProfile />} />
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
        <Route path="*" element={<RouteNotFound />} />
      </Routes>
      {(product.kind !== "company" || location.pathname !== "/") && <AiBot />}
    </ProductShell>
  );
}

function companyOrigin() {
  const baseDomain = import.meta.env.VITE_BASE_DOMAIN || "medipulse.live";
  const context = classifyHostname(window.location.hostname, { baseDomain, appDomains: (import.meta.env.VITE_APP_DOMAINS || "").split(",") });
  return context.kind === "company" ? window.location.origin : `https://${baseDomain}`;
}

function HospitalProductRedirect() {
  const { slug, "*": nested } = useParams();
  const location = useLocation();
  const valid = /^[a-z0-9-]+$/i.test(slug || "");
  const target = valid ? `${companyOrigin()}/hospitals/${slug.toLowerCase()}${nested ? `/${nested}` : ""}${location.search}${location.hash}` : null;
  useEffect(() => { if (target) window.location.replace(target); }, [target]);
  return target ? <main className="p-8" role="status">Opening hospital website...</main> : <RouteNotFound />;
}

function StaffRedirect() {
  const target = `${companyOrigin()}/hospital/signup`;
  return <main className="p-8"><h1>Hospital registration</h1><a className="underline" href={target}>Open hospital workspace</a></main>;
}

export default App;


