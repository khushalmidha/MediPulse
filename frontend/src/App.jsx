import { lazy, Suspense, useEffect } from "react";
import PageBoundary from "./components/PageBoundary";
import { Routes, Route, Navigate, useParams, useLocation } from "react-router-dom";
import { classifyHostname } from "./utils/productHosts";
import { useProduct } from "./context/ProductContext";
import { CompanyHome, ConnectHome, StaffHome, RouteNotFound } from "./pages/ProductHome";

import ProductShell from "./components/ProductShell";

import AiBot from "./components/AiBot";

const ReservationTracking = lazy(() => import("./pages/ReservationTracking"));
const PatientVisits = lazy(() => import("./pages/hospital-website/PatientVisits"));
const SignUp = lazy(() => import("./pages/SignUp"));
const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const EditProfile = lazy(() => import("./pages/EditProfile"));
const Chat = lazy(() => import("./pages/Chat"));
const DoctorsProfile = lazy(() => import("./pages/DoctorsProfile"));
const CommunityForm = lazy(() => import("./pages/CommunityForm"));
const Doctors = lazy(() => import("./pages/Doctors"));
const About = lazy(() => import("./pages/About"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Terms = lazy(() => import("./pages/Terms"));
const DataUsagePolicy = lazy(() => import("./pages/DataUsagePolicy"));
const AppointmentBooking = lazy(() => import("./pages/AppointmentBooking"));
const DoctorAppointments = lazy(() => import("./pages/DoctorAppointments"));
const MyAppointments = lazy(() => import("./pages/MyAppointments"));
const CurrentVisit = lazy(() => import("./pages/CurrentVisit"));
const Events = lazy(() => import("./pages/Events"));
const PastEvents = lazy(() => import("./pages/PastEvents"));
const VirtualTransactions = lazy(() => import("./pages/VirtualTransactions"));
const VirtualRefunds = lazy(() => import("./pages/VirtualRefunds"));
const VirtualAdminDashboard = lazy(() => import("./pages/VirtualAdminDashboard"));
const VirtualNotifications = lazy(() => import("./pages/VirtualNotifications"));
const HospitalWebsite = lazy(() => import("./pages/hospital-website/HospitalWebsite"));
const HospitalKiosk = lazy(() => import("./pages/hospital-website/HospitalKiosk"));
const HospitalsListPage = lazy(() => import("./pages/HospitalsListPage"));
const HospitalAdminSignup = lazy(() => import("./pages/HospitalAdminSignup"));
const HospitalAdminDashboard = lazy(() => import("./pages/HospitalAdminDashboard"));
const SaaSOperationsConsole = lazy(() => import("./pages/hospital-admin/SaaSOperationsConsole"));
const DoctorOpdConsole = lazy(() => import("./pages/hospital-staff/DoctorOpdConsole"));
const NursingStation = lazy(() => import("./pages/hospital-staff/NursingStation"));
const StaffCommunication = lazy(() => import("./pages/hospital-staff/StaffCommunication"));
const LaboratoryConsole = lazy(() => import("./pages/hospital-staff/LaboratoryConsole"));
const PharmacyConsole = lazy(() => import("./pages/hospital-staff/PharmacyConsole"));
const InpatientConsole = lazy(() => import("./pages/hospital-staff/InpatientConsole"));
const EmergencyTheatreConsole = lazy(() => import("./pages/hospital-staff/EmergencyTheatreConsole"));
const StaffAcceptInvite = lazy(() => import("./pages/StaffAcceptInvite"));
const HospitalAdminSetup = lazy(() => import("./pages/HospitalAdminSetup"));
const ReviewVisit = lazy(() => import("./pages/ReviewVisit"));
const OpdTriage = lazy(() => import("./pages/OpdTriage"));
const SmartBooking = lazy(() => import("./pages/SmartBooking"));
const PatientHealthPortal = lazy(() => import("./pages/PatientHealthPortal"));

function App() {
  const product = useProduct();
  const location = useLocation();
  if (product.kind === "patient") {
    return (
      <ProductShell type="patient">
        <PageBoundary key={location.pathname}>
          <Suspense fallback={<div className="mp-page" role="status" aria-live="polite" aria-busy="true">Loading your page...</div>}>
            <Routes>
              <Route path="/" element={<HospitalWebsite slug={product.slug} />} />
              <Route path="/login" element={<Login initialType="user" lockProfile />} />
              <Route path="/signup" element={<SignUp initialType="user" lockProfile />} />
              <Route path="/dashboard" element={<Navigate to="/visits" replace />} />
              <Route path="/visits" element={<PatientVisits slug={product.slug} />} />
              <Route path="/visits/:tokenId" element={<PatientVisits slug={product.slug} />} />
              <Route path="/kiosk" element={<HospitalKiosk slug={product.slug} />} />
              <Route path="/reservations/:reservationId" element={<ReservationTracking />} />
              <Route path="/profile/edit" element={<EditProfile />} />
              <Route path="/review" element={<ReviewVisit />} />
              <Route path="/staff/setup" element={<HospitalAdminSetup />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="*" element={<RouteNotFound />} />
            </Routes>
          </Suspense>
        </PageBoundary>
      </ProductShell>
    );
  }
  if (product.kind === "staff") {
    return (
      <ProductShell type="staff">
        <PageBoundary key={location.pathname}>
          <Suspense fallback={<div className="mp-page" role="status" aria-live="polite" aria-busy="true">Loading your page...</div>}>
            <Routes>
              <Route path="/" element={<StaffHome />} />
              <Route path="/hospital" element={<StaffHome />} />
              <Route path="/login" element={<Login initialType="hospital-admin" lockProfile />} />
              <Route path="/hospital/login" element={<Login initialType="hospital-admin" lockProfile />} />
              <Route path="/hospital/signup" element={<HospitalAdminSignup />} />
              <Route path="/signup/hospital-admin" element={<HospitalAdminSignup />} />
              <Route path="/hospital/admin" element={<HospitalAdminDashboard />} />
              <Route path="/hospital/operations" element={<SaaSOperationsConsole />} />
              <Route path="/hospital/saas" element={<SaaSOperationsConsole />} />
              <Route path="/hospital/doctor-opd" element={<DoctorOpdConsole />} />
              <Route path="/hospital/nursing-station" element={<NursingStation />} />
              <Route path="/hospital/reception" element={<NursingStation />} />
              <Route path="/hospital/staff-communication" element={<StaffCommunication />} />
              <Route path="/hospital/laboratory" element={<LaboratoryConsole />} />
              <Route path="/hospital/lab" element={<LaboratoryConsole />} />
              <Route path="/hospital/pharmacy" element={<PharmacyConsole />} />
              <Route path="/hospital/inpatient" element={<InpatientConsole initialTab="beds" />} />
              <Route path="/hospital/beds" element={<InpatientConsole initialTab="beds" />} />
              <Route path="/hospital/nursing" element={<InpatientConsole initialTab="nursing" />} />
              <Route path="/hospital/inpatient-care" element={<InpatientConsole initialTab="nursing" />} />
              <Route path="/hospital/handovers" element={<InpatientConsole initialTab="handovers" />} />
              <Route path="/hospital/emergency" element={<EmergencyTheatreConsole initialTab="emergency" />} />
              <Route path="/hospital/theatre" element={<EmergencyTheatreConsole initialTab="theatre" />} />
              <Route path="/hospital/ot" element={<EmergencyTheatreConsole initialTab="theatre" />} />
              <Route path="/hospital/checklist" element={<EmergencyTheatreConsole initialTab="checklist" />} />
              <Route path="/staff/accept-invite" element={<StaffAcceptInvite />} />
              <Route path="/staff/setup" element={<HospitalAdminSetup />} />
              <Route path="/hospital/setup" element={<HospitalAdminSetup />} />
              <Route path="*" element={<RouteNotFound />} />
            </Routes>
          </Suspense>
        </PageBoundary>
      </ProductShell>
    );
  }
  return (
    <ProductShell type={product.kind === "company" && location.pathname === "/" ? "company" : "care"}>
      <PageBoundary key={location.pathname}>
        <Suspense fallback={<div className="mp-page" role="status" aria-live="polite" aria-busy="true">Loading your page...</div>}>
          <Routes>
            <Route path="/" element={product.kind === "connect" ? <ConnectHome /> : <CompanyHome />} />
            <Route path="/signup" element={<SignUp />} />
            <Route path="/signup/:type" element={<SignUp />} />
            <Route path="/signup/hospital-admin" element={<StaffRedirect />} />
            <Route path="/review" element={<ReviewVisit />} />
            <Route path="/triage/:appointmentId" element={<OpdTriage />} />
            <Route path="/smart-booking" element={<SmartBooking />} />
            <Route path="/health-records" element={<PatientHealthPortal />} />
            <Route path="/hospitals" element={<HospitalsListPage />} />
            <Route path="/kiosk/:slug" element={<HospitalKiosk />} />
            <Route path="/hospitals/:slug/*" element={<HospitalProductRedirect />} />
            <Route path="/login" element={<Login />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/profile/edit" element={<EditProfile />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/doctorsProfile/:id" element={<DoctorsProfile />} />
            <Route path="/appointment/book/:doctorId" element={<AppointmentBooking />} />
            <Route path="/my-appointments" element={<MyAppointments />} />
            <Route path="/appointments/current/:appointmentId" element={<CurrentVisit />} />
            <Route path="/appointments/reservations/:reservationId" element={<ReservationTracking />} />
            <Route path="/doctor/appointments" element={<DoctorAppointments />} />
            <Route path="/communities" element={<CommunityForm />} />
            <Route path="/events" element={<Events />} />
            <Route path="/events/past" element={<PastEvents />} />
            <Route path="/wallet/transactions" element={<VirtualTransactions />} />
            <Route path="/wallet/refunds" element={<VirtualRefunds />} />
            <Route path="/wallet/notifications" element={<VirtualNotifications />} />
            <Route path="/admin/virtual-payments" element={<VirtualAdminDashboard />} />
            <Route path="/doctors" element={<Doctors />} />
            <Route path="/about" element={<About />} />
            <Route path="/staff/setup" element={<HospitalAdminSetup />} />
            <Route path="/hospital/setup" element={<HospitalAdminSetup />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/cookiepolicy" element={<DataUsagePolicy />} />
            <Route path="*" element={<RouteNotFound />} />
          </Routes>
        </Suspense>
      </PageBoundary>
      {location.pathname !== "/" && !/^\/(?:appointment\/book|appointments\/(?:reservations|current)|doctor\/appointments|triage|my-appointments|doctors(?:Profile)?|login|signup|profile\/edit)(?:\/|$)/.test(location.pathname) && <AiBot />}
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
