import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { BACKEND_URL } from "../utils";

const EditProfile = () => {
	const navigate = useNavigate();
	const [formData, setFormData] = useState({
		firstName: "",
		lastName: "",
		email: "",
		phoneNumber: "",
		bio: "",
		gender: "",
		medical: { primaryCondition: "" },
		emergencyContact: { name: "", relation: "", phoneNumber: "" },
	});

	useEffect(() => {
		axios
			.get(`${BACKEND_URL}/user`, { withCredentials: true })
			.then((response) => {
        if(!response.data.medical){
          response.data.medical = {};
        }
        if(!response.data.emergencyContact){
          response.data.emergencyContact = {};
        }
				setFormData(response.data);
			})
			.catch((error) => console.error("Error fetching profile data", error));
	}, []);

	const handleChange = (e) => {
		const { name, value } = e.target;

		if (name.startsWith("medical.")) {
			setFormData((prev) => ({
				...prev,
				medical: { ...prev.medical, [name.split(".")[1]]: value },
			}));
		} else if (name.startsWith("emergencyContact.")) {
			setFormData((prev) => ({
				...prev,
				emergencyContact: {
					...prev.emergencyContact,
					[name.split(".")[1]]: value,
				},
			}));
		} else {
			setFormData((prev) => ({ ...prev, [name]: value }));
		}
	};

	const handleSubmit = async (e) => {
		e.preventDefault();
		try {
			await axios.put(`${BACKEND_URL}/user/`, formData, { withCredentials: true });
			alert("Profile updated successfully!");
			navigate("/dashboard");
		} catch (error) {
			console.error("Error updating profile", error);
			alert("Failed to update profile.");
		}
	};

	return (
		<div className="max-w-2xl mx-auto p-6 bg-white shadow-md rounded-lg mt-12 mb-12">
			<button
				className="text-blue-600 mb-4"
				onClick={() => navigate("/dashboard")}
			>
				← Back to Dashboard
			</button>
			<h2 className="text-2xl font-semibold mb-2">Edit Profile</h2>
			<p className="text-gray-600 mb-4">
				Update your personal information and preferences.
			</p>

			<form onSubmit={handleSubmit} className="space-y-4">
				<div className="p-4 border rounded-lg border-white shadow-lg">
					<h3 className="text-lg font-semibold mb-2">Basic Information</h3>
					<div className="grid grid-cols-2 gap-2 mb-2">
						<input
							type="text"
							name="firstName"
							value={formData.firstName}
							onChange={handleChange}
							placeholder="First Name"
							className="p-2 border rounded"
							required
						/>
						<input
							type="text"
							name="lastName"
							value={formData.lastName}
							onChange={handleChange}
							placeholder="Last Name"
							className="p-2 border rounded"
						/>
						<input
							type="email"
							name="email"
							value={formData.email}
							onChange={handleChange}
							placeholder="Email"
							className="p-2 border rounded"
							required
						/>
						<input
							type="text"
							name="phoneNumber"
							value={formData.phoneNumber}
							onChange={handleChange}
							placeholder="Phone Number"
							className="p-2 border rounded"
						/>
					</div>
					<input
						type="gender"
						name="gender"
						value={formData.gender}
						onChange={handleChange}
						placeholder="Gender"
						className="p-2 border rounded"
					/>
					<textarea
						name="bio"
						value={formData.bio}
						onChange={handleChange}
						placeholder="Bio"
						className="p-2 border rounded w-full mt-2"
					></textarea>
				</div>

				<div className="p-4 border rounded-lg border-white shadow-lg">
					<h3 className="text-lg font-semibold mb-2">Medical Information</h3>
					<input
						type="text"
						name="medical.primaryCondition"
						value={formData.medical.primaryCondition}
						onChange={handleChange}
						placeholder="Primary Condition"
						className="p-2 border rounded w-full"
					/>
				</div>

				<div className="p-4 border rounded-lg border-white shadow-lg">
					<h3 className="text-lg font-semibold mb-2">Emergency Contact</h3>
					<div className="grid grid-cols-2 gap-4">
						<input
							type="text"
							name="emergencyContact.name"
							value={formData.emergencyContact.name}
							onChange={handleChange}
							placeholder="Contact Name"
							className="p-2 border rounded"
						/>
						<input
							type="text"
							name="emergencyContact.relation"
							value={formData.emergencyContact.relation}
							onChange={handleChange}
							placeholder="Relationship"
							className="p-2 border rounded"
						/>
					</div>
					<input
						type="text"
						name="emergencyContact.phoneNumber"
						value={formData.emergencyContact.phoneNumber}
						onChange={handleChange}
						placeholder="Contact Phone"
						className="p-2 border rounded w-full mt-2"
					/>
				</div>

				<div className="flex justify-end space-x-4">
					<button
						type="button"
						className="px-4 py-2 bg-gray-200 rounded-md"
						onClick={() => navigate("/profile")}
					>
						Cancel
					</button>
					<button
						type="submit"
						className="px-4 py-2 bg-blue-600 text-white rounded-md"
					>
						Save Changes
					</button>
				</div>
			</form>
		</div>
	);
};

export default EditProfile;
