import { useEffect } from "react";
import RecommendationCard from "../components/RecommendationCard";
import { Link, useNavigate } from "react-router-dom";
import RecommendationDoctors from "../components/RecommendationDoctors";
import { useAuth } from "../context/AuthContext";

const Dashboard = () => {
	const { isAuth, loader, role } = useAuth();
	const navigate = useNavigate();
	console.log("Dashboard", isAuth);
	useEffect(()=>{
		if(loader){
			return
		}
		if(!isAuth){
			navigate("/login");
		}
	},[isAuth,loader])
	return (
		<div className="p-6 bg-gray-100 min-h-screen">
			<h2 className="text-2xl font-semibold">
				Welcome to Your Health Dashboard
			</h2>


			<div className="mt-6">
				<RecommendationCard />
			</div>

			<div className="bg-blue-500 h-48 pt-12 mt-12 shadow-md border rounded-sm">
				<h1 className="flex justify-center font-bold tracking-tighter text-4xl mb-1 text-white">
					Find Specialized Healthcare Providers
				</h1>
				<p className="flex justify-center text-xl text-white">
					Connect with specialized and experienced doctors based on the disease
					you are facing
				</p>
			</div>

			<div className="mb-10">
				<RecommendationDoctors />
			</div>

			{role === "doctor" && (
				<div className="rounded-lg border border-blue-200 bg-white p-5 shadow-sm">
					<h3 className="text-lg font-semibold text-gray-900">Appointment Queue</h3>
					<p className="mt-2 text-sm text-gray-600">
						Start and manage booked appointments one by one from your doctor panel.
					</p>
					<Link
						to="/doctor/appointments"
						className="mt-4 inline-block rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
					>
						Open Doctor Queue
					</Link>
				</div>
			)}
		</div>
	);
};

export default Dashboard;
