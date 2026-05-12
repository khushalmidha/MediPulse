import React, { useState, useCallback, useEffect, useRef } from "react";
import { UserCircle2, Stethoscope, Mail, Lock, Phone, AlertCircle, User, FileText, HeartPulse, Users, MapPin, ArrowLeft } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import { BACKEND_URL } from "../utils";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

let googleScriptPromise;

const loadGoogleScript = () => {
  if (window.google?.accounts?.id) {
    return Promise.resolve();
  }

  if (!googleScriptPromise) {
    googleScriptPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector("script[src='https://accounts.google.com/gsi/client']");
      if (existingScript) {
        existingScript.addEventListener("load", resolve, { once: true });
        existingScript.addEventListener("error", reject, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = reject;
      document.body.appendChild(script);
    });
  }

  return googleScriptPromise;
};

const GoogleSignupButton = ({ disabled, onCredential, userType }) => {
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !buttonRef.current) {
      return;
    }

    let isMounted = true;

    loadGoogleScript()
      .then(() => {
        if (!isMounted || !buttonRef.current) {
          return;
        }

        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: onCredential,
        });
        buttonRef.current.innerHTML = "";
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: "outline",
          size: "large",
          text: "signup_with",
          shape: "rectangular",
          width: buttonRef.current.offsetWidth || 320,
        });
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [onCredential]);

  if (!GOOGLE_CLIENT_ID) {
    return (
      <p className="text-sm text-center text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
        Add VITE_GOOGLE_CLIENT_ID to frontend/.env to enable Google signup.
      </p>
    );
  }

  return (
    <div className={disabled ? "pointer-events-none opacity-60" : ""}>
      <div
        ref={buttonRef}
        aria-label={`Sign up as ${userType} with Google`}
        className="flex justify-center min-h-[44px]"
      />
    </div>
  );
};

const ProfileSelection = ({ setUserType }) => (
  <div className="space-y-8">
    <div className="text-center">
      <h3 className="text-xl font-semibold text-gray-800">Choose your profile type</h3>
      <p className="mt-2 text-gray-600">
        Select how you want to join MediPulse
      </p>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <button
        onClick={() => setUserType("user")}
        className="flex flex-col items-center p-6 border-2 border-gray-200 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-all duration-200 shadow-sm hover:shadow"
      >
        <div className="bg-blue-100 p-4 rounded-full">
          <UserCircle2 className="h-10 w-10 text-blue-600" />
        </div>
        <h4 className="mt-4 text-lg font-medium text-gray-800">Join as User</h4>
        <p className="mt-2 text-center text-sm text-gray-600">
          Connect with healthcare providers and support communities
        </p>
      </button>
      <button
        onClick={() => setUserType("doctor")}
        className="flex flex-col items-center p-6 border-2 border-gray-200 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-all duration-200 shadow-sm hover:shadow"
      >
        <div className="bg-blue-100 p-4 rounded-full">
          <Stethoscope className="h-10 w-10 text-blue-600" />
        </div>
        <h4 className="mt-4 text-lg font-medium text-gray-800">Join as Doctor</h4>
        <p className="mt-2 text-center text-sm text-gray-600">
          Provide care and support to differently abled individuals
        </p>
      </button>
    </div>
  </div>
);

const InputField = ({ icon, label, ...props }) => (
  <div className="mb-4">
    <label htmlFor={props.id} className="block text-sm font-medium text-gray-700 mb-1">
      {label}
    </label>
    <div className="relative">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        {icon}
      </div>
      <input
        {...props}
        className="appearance-none block w-full px-3 py-2.5 pl-10 bg-white border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
      />
    </div>
  </div>
);

const SectionHeading = ({ title }) => (
  <div className="mt-8 mb-4">
    <h3 className="text-lg font-semibold text-gray-800 border-l-4 border-blue-500 pl-3">
      {title}
    </h3>
    <div className="mt-2 border-t border-gray-100"></div>
  </div>
);

const AuthDivider = () => (
  <div className="flex items-center gap-3 my-2">
    <div className="h-px flex-1 bg-gray-200" />
    <span className="text-xs font-medium uppercase tracking-wide text-gray-400">or</span>
    <div className="h-px flex-1 bg-gray-200" />
  </div>
);

const PatientSignUp = ({ handleSubmit, handleGoogleSignup, message, patient, setPatient, isloading }) => (
  <form className="space-y-4" onSubmit={handleSubmit}>
    {message && (
      <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-md flex items-start">
        <AlertCircle className="h-5 w-5 text-red-500 mr-3 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-red-700">{message}</p>
      </div>
    )}

    <SectionHeading title="General Information" />
    
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <InputField
        icon={<Mail className="h-5 w-5 text-gray-400" />}
        label="Email"
        id="email"
        name="email"
        type="email"
        required
        disabled={isloading}
        value={patient.email || ""}
        onChange={(e) => setPatient({ ...patient, email: e.target.value })}
        placeholder="Enter your email address"
      />
      
      <InputField
        icon={<Lock className="h-5 w-5 text-gray-400" />}
        label="Password"
        id="password"
        name="password"
        type="password"
        required
        disabled={isloading}
        value={patient.password || ""}
        onChange={(e) => setPatient({ ...patient, password: e.target.value })}
        placeholder="Create a password"
      />
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <InputField
        icon={<User className="h-5 w-5 text-gray-400" />}
        label="First Name"
        id="firstname"
        name="firstname"
        type="text"
        required
        disabled={isloading}
        value={patient.firstName || ""}
        onChange={(e) => setPatient({ ...patient, firstName: e.target.value })}
        placeholder="Enter your first name"
      />
      
      <InputField
        icon={<User className="h-5 w-5 text-gray-400" />}
        label="Last Name"
        id="lastname"
        name="lastname"
        type="text"
        disabled={isloading}
        value={patient.lastName || ""}
        onChange={(e) => setPatient({ ...patient, lastName: e.target.value })}
        placeholder="Enter your last name"
      />
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="mb-4">
        <label htmlFor="gender" className="block text-sm font-medium text-gray-700 mb-1">
          Gender
        </label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Users className="h-5 w-5 text-gray-400" />
          </div>
          <select
            id="gender"
            name="gender"
            required
            disabled={isloading}
            value={patient.gender || ""}
            onChange={(e) => setPatient({ ...patient, gender: e.target.value })}
            className="appearance-none block w-full px-3 py-2.5 pl-10 bg-white border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          >
            <option value="" disabled>Select your gender</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>
      
      <InputField
        icon={<Phone className="h-5 w-5 text-gray-400" />}
        label="Phone Number"
        id="phone-number"
        name="phone-number"
        type="tel"
        disabled={isloading}
        value={patient.phone || ""}
        onChange={(e) => setPatient({ ...patient, phone: e.target.value })}
        placeholder="Enter your phone number"
      />
    </div>

    <InputField
      icon={<FileText className="h-5 w-5 text-gray-400" />}
      label="Bio"
      id="bio"
      name="bio"
      type="text"
      disabled={isloading}
      value={patient.bio || ""}
      onChange={(e) => setPatient({ ...patient, bio: e.target.value })}
      placeholder="Tell us about yourself"
    />

    <SectionHeading title="Medical History" />
    
    <InputField
      icon={<HeartPulse className="h-5 w-5 text-gray-400" />}
      label="Primary Condition"
      id="primary-condition"
      name="primary-condition"
      type="text"
      disabled={isloading}
      value={patient.primaryCondition || ""}
      onChange={(e) => setPatient({ ...patient, primaryCondition: e.target.value })}
      placeholder="Enter your primary medical condition"
    />

    <SectionHeading title="Emergency Contact" />
    
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <InputField
        icon={<User className="h-5 w-5 text-gray-400" />}
        label="Contact Name"
        id="emergency-name"
        name="emergency-name"
        type="text"
        disabled={isloading}
        value={patient.emergencyContact || ""}
        onChange={(e) => setPatient({ ...patient, emergencyContact: e.target.value })}
        placeholder="Enter emergency contact name"
      />
      
      <InputField
        icon={<Users className="h-5 w-5 text-gray-400" />}
        label="Relationship"
        id="relation"
        name="relation"
        type="text"
        disabled={isloading}
        value={patient.emergencyRelation || ""}
        onChange={(e) => setPatient({ ...patient, emergencyRelation: e.target.value })}
        placeholder="Your relationship to this person"
      />
    </div>

    <InputField
      icon={<Phone className="h-5 w-5 text-gray-400" />}
      label="Emergency Contact Phone"
      id="emergency-number"
      name="emergency-number"
      type="tel"
      pattern="[0-9]{10}"
      disabled={isloading}
      value={patient.emergencyPhone || ""}
      onChange={(e) => setPatient({ ...patient, emergencyPhone: e.target.value })}
      placeholder="Enter emergency contact phone"
    />

    <div className="mt-6">
      <button
        type="submit"
        disabled={isloading}
        className={`group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 ${isloading ? 'opacity-70 cursor-not-allowed' : 'hover:bg-blue-700'} shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors`}
      >
        {isloading ? 'Creating account...' : 'Create User Account'}
      </button>
    </div>
    <AuthDivider />
    <GoogleSignupButton
      disabled={isloading}
      onCredential={handleGoogleSignup}
      userType="user"
    />
  </form>
);

const DoctorSignUp = ({handleSubmit, handleGoogleSignup, message, doctor, setDoctor, isloading}) => (
  <form className="space-y-4" onSubmit={handleSubmit}>
    {message && (
      <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-md flex items-start">
        <AlertCircle className="h-5 w-5 text-red-500 mr-3 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-red-700">{message}</p>
      </div>
    )}

    <SectionHeading title="General Information" />
    
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <InputField
        icon={<Mail className="h-5 w-5 text-gray-400" />}
        label="Email"
        id="email"
        name="email"
        type="email"
        required
        disabled={isloading}
        value={doctor.email || ""}
        onChange={(e) => setDoctor({ ...doctor, email: e.target.value })}
        placeholder="Enter your email address"
      />
      
      <InputField
        icon={<Lock className="h-5 w-5 text-gray-400" />}
        label="Password"
        id="password"
        name="password"
        type="password"
        required
        disabled={isloading}
        value={doctor.password || ""}
        onChange={(e) => setDoctor({ ...doctor, password: e.target.value })}
        placeholder="Create a password"
      />
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <InputField
        icon={<User className="h-5 w-5 text-gray-400" />}
        label="First Name"
        id="firstName"
        name="firstName"
        type="text"
        required
        disabled={isloading}
        value={doctor.firstName || ""}
        onChange={(e) => setDoctor({ ...doctor, firstName: e.target.value })}
        placeholder="Enter your first name"
      />
      
      <InputField
        icon={<User className="h-5 w-5 text-gray-400" />}
        label="Last Name"
        id="lastName"
        name="lastName"
        type="text"
        disabled={isloading}
        value={doctor.lastName || ""}
        onChange={(e) => setDoctor({ ...doctor, lastName: e.target.value })}
        placeholder="Enter your last name"
      />
    </div>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="mb-4">
        <label htmlFor="gender" className="block text-sm font-medium text-gray-700 mb-1">
          Gender
        </label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Users className="h-5 w-5 text-gray-400" />
          </div>
          <select
            id="gender"
            name="gender"
            required
            disabled={isloading}
            value={doctor.gender || ""}
            onChange={(e) => setDoctor({ ...doctor, gender: e.target.value })}
            className="appearance-none block w-full px-3 py-2.5 pl-10 bg-white border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          >
            <option value="" disabled>Select your gender</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>
      
      <InputField
        icon={<Phone className="h-5 w-5 text-gray-400" />}
        label="Phone Number"
        id="phone"
        name="phone"
        type="tel"
        disabled={isloading}
        value={doctor.phone || ""}
        onChange={(e) => setDoctor({ ...doctor, phone: e.target.value })}
        placeholder="Enter your phone number"
      />
    </div>

    <InputField
      icon={<FileText className="h-5 w-5 text-gray-400" />}
      label="Bio"
      id="bio"
      name="bio"
      type="text"
      disabled={isloading}
      value={doctor.bio || ""}
      onChange={(e) => setDoctor({ ...doctor, bio: e.target.value })}
      placeholder="Tell us about your medical practice"
    />

    <SectionHeading title="Professional Experience" />
    
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <InputField
        icon={<Stethoscope className="h-5 w-5 text-gray-400" />}
        label="Years of Experience"
        id="years"
        name="years"
        type="number"
        required
        disabled={isloading}
        value={doctor.years || ""}
        onChange={(e) => setDoctor({ ...doctor, years: e.target.value })}
        placeholder="Years of professional practice"
      />
      
      <InputField
        icon={<HeartPulse className="h-5 w-5 text-gray-400" />}
        label="Expertise/Specialization"
        id="expertise"
        name="expertise"
        type="text"
        required
        disabled={isloading}
        value={doctor.expertise || ""}
        onChange={(e) => setDoctor({ ...doctor, expertise: e.target.value })}
        placeholder="Your medical specialization"
      />
    </div>

    <SectionHeading title="Clinic Information" />
    
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <InputField
        icon={<MapPin className="h-5 w-5 text-gray-400" />}
        label="Clinic Name"
        id="clinicName"
        name="clinicName"
        type="text"
        disabled={isloading}
        value={doctor.clinicName || ""}
        onChange={(e) => setDoctor({ ...doctor, clinicName: e.target.value })}
        placeholder="Name of your clinic or hospital"
      />
      
      <InputField
        icon={<Phone className="h-5 w-5 text-gray-400" />}
        label="Clinic Phone"
        id="clinicPhone"
        name="clinicPhone"
        type="tel"
        disabled={isloading}
        value={doctor.clinicPhone || ""}
        onChange={(e) => setDoctor({ ...doctor, clinicPhone: e.target.value })}
        placeholder="Clinic contact number"
      />
    </div>

    <InputField
      icon={<MapPin className="h-5 w-5 text-gray-400" />}
      label="Clinic Location"
      id="clinicLocation"
      name="clinicLocation"
      type="text"
      disabled={isloading}
      value={doctor.clinicLocation || ""}
      onChange={(e) => setDoctor({ ...doctor, clinicLocation: e.target.value })}
      placeholder="Full address of your clinic"
    />

    <div className="mt-6">
      <button
        type="submit"
        disabled={isloading}
        className={`group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 ${isloading ? 'opacity-70 cursor-not-allowed' : 'hover:bg-blue-700'} shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors`}
      >
        {isloading ? 'Creating account...' : 'Create Doctor Account'}
      </button>
    </div>
    <AuthDivider />
    <GoogleSignupButton
      disabled={isloading}
      onCredential={handleGoogleSignup}
      userType="doctor"
    />
  </form>
);

const SignUp = () => {
  const {type} = useParams();
  const [userType, setUserType] = useState(type || "select");
  const navigate = useNavigate();
  const [patient, setPatient] = useState({});
  const [doctor, setDoctor] = useState({});
  const [isloading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const { isAuth, setIsAuth, setUser, setRole } = useAuth();
  
  useEffect(() => {
    if (isAuth) {
      navigate("/dashboard");
    }
  }, [isAuth, navigate]);
  
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setMessage("");
    setIsLoading(true);
    try {
      const data = userType === "user" ? patient : doctor;
      const res = await axios.post(
        `${BACKEND_URL}/${userType}/signup`, 
        data, 
        { withCredentials: true, headers: { "Content-Type": "application/json" } }
      );
      if (res.status === 201) {
        console.log("check : ", res.data);
        setIsAuth(true);
        setUser(res.data.result);
        setRole(userType);
        navigate("/dashboard");
      } else {
        setMessage(res.data.message);
      }
    } catch (err) {
      console.log(err);
      setMessage(err.response?.data?.message || "An error occurred during signup");
    }
    setIsLoading(false);
  }, [userType, patient, doctor, setIsAuth, setUser, setRole, navigate]);

  const handleGoogleSignup = useCallback(async (response) => {
    setMessage("");

    if (!response?.credential) {
      setMessage("Google signup did not return a valid credential");
      return;
    }

    if (userType === "doctor" && (!doctor.years || !doctor.expertise)) {
      setMessage("Add your years of experience and expertise before using Google signup as a doctor");
      return;
    }

    setIsLoading(true);
    try {
      const profile = userType === "user" ? patient : doctor;
      const res = await axios.post(
        `${BACKEND_URL}/${userType}/google-auth`,
        { credential: response.credential, role: userType, profile },
        { withCredentials: true, headers: { "Content-Type": "application/json" } }
      );

      if (res.status === 201) {
        setIsAuth(true);
        setUser(res.data.result);
        setRole(res.data.role || userType);
        navigate("/dashboard");
      } else {
        setMessage(res.data.message || "Google signup failed");
      }
    } catch (err) {
      console.log(err);
      setMessage(err.response?.data?.message || "Google signup failed. Please try again.");
    }
    setIsLoading(false);
  }, [userType, patient, doctor, setIsAuth, setUser, setRole, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white p-8 sm:p-10 rounded-2xl shadow-md border border-gray-100">
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">
              {userType === "select" 
                ? "Create your account" 
                : userType === "user" 
                  ? "Sign up as a Patient" 
                  : "Sign up as a Doctor"}
            </h1>
            <p className="mt-3 text-gray-600">
              Already have an account?{" "}
              <Link
                to="/login"
                className="font-medium text-blue-600 hover:text-blue-500 transition-colors"
              >
                Sign in here
              </Link>
            </p>
          </div>

          {userType === "select" && <ProfileSelection setUserType={setUserType} />}
          {userType === "user" && (
            <PatientSignUp 
              handleSubmit={handleSubmit}
              handleGoogleSignup={handleGoogleSignup}
              message={message}
              patient={patient}
              setPatient={setPatient}
              isloading={isloading}
            />
          )}
          {userType === "doctor" && (
            <DoctorSignUp 
              handleSubmit={handleSubmit} 
              handleGoogleSignup={handleGoogleSignup}
              message={message} 
              doctor={doctor} 
              setDoctor={setDoctor} 
              isloading={isloading} 
            />
          )}

          {userType !== "select" && (
            <button
              onClick={() => setUserType("select")}
              className="mt-6 flex items-center justify-center w-full text-sm text-gray-600 hover:text-blue-600 py-2 transition-colors font-medium"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Change profile type
            </button>
          )}

          <div className="mt-8 pt-6 border-t border-gray-200">
            <p className="text-xs text-center text-gray-500">
              By signing up, you agree to MediPulse's{" "}
              <a
                href="#"
                className="text-blue-600 hover:underline"
              >
                Terms of Service
              </a>{" "}
              and{" "}
              <a
                href="#"
                className="text-blue-600 hover:underline"
              >
                Privacy Policy
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignUp;
