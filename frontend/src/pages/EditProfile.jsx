import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import axios from "axios";
import { BACKEND_URL } from "../utils";


const EditProfile = () => {
  const { user, role } = useAuth();
  
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    bio: "",
    gender: "",
    phoneNumber: "",
    expertise: "",
    years: ""
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    
    // Pre-fill existing data
    setFormData({
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      bio: user.bio || "",
      gender: user.gender || "",
      phoneNumber: user.phone || user.phoneNumber || "",
      expertise: user.experience?.expertise || "",
      years: user.experience?.years || ""
    });
    setLoading(false);
  }, [user]);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (role === "doctor" && (!formData.expertise || formData.expertise.trim() === "")) {
      alert("Expertise (Specialty) is required for doctors.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        firstName: formData.firstName,
        lastName: formData.lastName,
        bio: formData.bio,
        gender: formData.gender,
      };

      if (role === "doctor") {
        payload.phone = formData.phoneNumber;
        payload.experience = {
          expertise: formData.expertise,
          years: Number(formData.years)
        };
      } else {
        payload.phoneNumber = formData.phoneNumber;
      }

      const endpoint = role === "doctor" ? `${BACKEND_URL}/doctor` : `${BACKEND_URL}/user`;
      
      await axios.put(endpoint, payload, { withCredentials: true });
      alert("Profile updated successfully");
      
      // Optionally, reload to refresh user context
      window.location.reload();
    } catch (error) {
      alert(error.response?.data?.message || "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 dark:bg-slate-900">
      <div className="max-w-md mx-auto bg-white dark:bg-slate-800 rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold mb-6 text-gray-900 dark:text-white">Edit Profile</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">First Name</label>
              <input type="text" name="firstName" required value={formData.firstName} onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm dark:bg-slate-700 dark:border-gray-600 dark:text-white px-3 py-2 border" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Last Name</label>
              <input type="text" name="lastName" required value={formData.lastName} onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm dark:bg-slate-700 dark:border-gray-600 dark:text-white px-3 py-2 border" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Gender</label>
            <select name="gender" required value={formData.gender} onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm dark:bg-slate-700 dark:border-gray-600 dark:text-white px-3 py-2 border">
              <option value="">Select Gender</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Phone Number</label>
            <input type="number" name="phoneNumber" value={formData.phoneNumber} onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm dark:bg-slate-700 dark:border-gray-600 dark:text-white px-3 py-2 border" />
          </div>

          {role === "doctor" && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Expertise / Specialty <span className="text-red-500">*</span></label>
                <input type="text" name="expertise" required value={formData.expertise} onChange={handleChange} placeholder="E.g., Cardiologist" className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm dark:bg-slate-700 dark:border-gray-600 dark:text-white px-3 py-2 border" />
                <p className="mt-1 text-xs text-red-500">Specialty is strictly required for doctors.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Years of Experience</label>
                <input type="number" name="years" value={formData.years} onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm dark:bg-slate-700 dark:border-gray-600 dark:text-white px-3 py-2 border" />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Bio</label>
            <textarea name="bio" rows="3" value={formData.bio} onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 sm:text-sm dark:bg-slate-700 dark:border-gray-600 dark:text-white px-3 py-2 border"></textarea>
          </div>

          <div className="pt-4">
            <button type="submit" disabled={saving} className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50">
              {saving ? "Saving..." : "Save Profile"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditProfile;

