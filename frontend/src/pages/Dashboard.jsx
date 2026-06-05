import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import RecommendationCard from "../components/RecommendationCard";
import { Link, useNavigate } from "react-router-dom";
import RecommendationDoctors from "../components/RecommendationDoctors";
import { useAuth } from "../context/AuthContext";
import { BACKEND_URL } from "../utils";

const formatEventDate = (value) => {
	if (!value) return "Date not set";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString([], {
		weekday: "short",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
};

const Dashboard = () => {
	const { isAuth, loader, role } = useAuth();
	const navigate = useNavigate();
	const [communityEvents, setCommunityEvents] = useState([]);
	const [eventsLoading, setEventsLoading] = useState(false);
	const [eventsError, setEventsError] = useState("");
	console.log("Dashboard", isAuth);

	useEffect(()=>{
		if(loader){
			return
		}
		if(!isAuth){
			navigate("/login");
		}
	},[isAuth,loader])

	useEffect(() => {
		if (loader || !isAuth) return;
		let ignore = false;

		const loadCommunityEvents = async () => {
			setEventsLoading(true);
			setEventsError("");
			try {
				const [communitiesResponse, eventsResponse] = await Promise.all([
					axios.get(`${BACKEND_URL}/community/user`, { withCredentials: true }),
					axios.get(`${BACKEND_URL}/event`, {
						withCredentials: true,
						params: { status: "upcoming" },
					}),
				]);

				if (ignore) return;
				const communities = communitiesResponse.data || [];
				const communityIds = new Set(communities.map((community) => String(community._id)));
				const communityNames = new Map(
					communities.map((community) => [String(community._id), community.title]),
				);

				const filtered = (eventsResponse.data.events || [])
					.filter((event) => communityIds.has(String(event.community)))
					.map((event) => ({
						...event,
						communityName: communityNames.get(String(event.community)) || "Community",
					}));

				setCommunityEvents(filtered);
			} catch (error) {
				if (!ignore) {
					setEventsError(error.response?.data?.message || "Unable to load community events");
				}
			} finally {
				if (!ignore) {
					setEventsLoading(false);
				}
			}
		};

		loadCommunityEvents();
		return () => {
			ignore = true;
		};
	}, [isAuth, loader]);

	const visibleCommunityEvents = useMemo(
		() => communityEvents.slice(0, 4),
		[communityEvents],
	);

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

			<div className="mb-10 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<h3 className="text-lg font-semibold text-gray-900">Events From Your Communities</h3>
						<p className="mt-1 text-sm text-gray-600">
							Upcoming events connected to communities you have joined.
						</p>
					</div>
					<Link to="/events" className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700">
						View all events
					</Link>
				</div>

				{eventsLoading ? (
					<p className="mt-4 text-sm text-gray-500">Loading community events...</p>
				) : eventsError ? (
					<p className="mt-4 text-sm text-red-600">{eventsError}</p>
				) : visibleCommunityEvents.length === 0 ? (
					<p className="mt-4 text-sm text-gray-500">
						No upcoming events from your joined communities yet.
					</p>
				) : (
					<div className="mt-4 grid gap-4 md:grid-cols-2">
						{visibleCommunityEvents.map((event) => (
							<div key={event._id} className="rounded-lg border border-gray-200 p-4">
								<div className="flex flex-wrap items-start justify-between gap-3">
									<div>
										<p className="text-xs font-medium text-blue-600">{event.communityName}</p>
										<h4 className="mt-1 font-semibold text-gray-900">{event.title}</h4>
										<p className="mt-1 text-sm text-gray-500">{formatEventDate(event.time)}</p>
									</div>
									<span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold capitalize text-blue-700">
										{event.kind}
									</span>
								</div>
								<p className="mt-3 line-clamp-2 text-sm text-gray-700">{event.bio}</p>
							</div>
						))}
					</div>
				)}
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
