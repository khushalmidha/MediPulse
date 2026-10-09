import { isCommunityOrganizer } from "../services/communityAccess.js";
import Community from "../model/community.js";
import Event from "../model/event.js";

const mapEvent = (event) => ({
	_id: event._id,
	title: event.title,
	bio: event.bio,
	location: event.location || "",
	kind: event.kind,
	time: event.time,
	reminders: event.reminders || [],
	community: event.community,
	author: event.author,
	author_name: event.author_name,
	createdAt: event.createdAt,
	updatedAt: event.updatedAt,
});

const getEvents = async (req, res) => {
	try {
		const { status = "all" } = req.query;
		const now = new Date();
		const communities = await Community.find({ $or: [{ members: req.auth.id }, ...(req.auth.role === "doctor" ? [{ author: req.auth.id }] : [])] });
		const events = await Event.find({ community: { $in: communities.map(item => item._id) } }).sort({ time: 1 });

		const filteredEvents = events.filter((event) => {
			const eventDate = new Date(event.time);
			if (Number.isNaN(eventDate.getTime()) || status === "all") return true;
			if (status === "upcoming") return eventDate >= now;
			if (status === "past") return eventDate < now;
			return true;
		});

		if (status === "past") {
			filteredEvents.sort((a, b) => new Date(b.time) - new Date(a.time));
		}

		return res.status(200).json({ events: filteredEvents.map(mapEvent) });
	} catch (error) {
		console.error("Error in getEvents:", error);
		return res.status(500).json({ message: "Internal server error", error: error.message });
	}
};

const createEvent = async (req, res, next) => {
	try {
		const { title, bio, location, community_name, kind, time, reminders } =
			req.body;
		if (!title || !bio || !kind || !time || !Array.isArray(reminders) || (!community_name && !req.body.communityId) || !["online", "offline"].includes(kind) || !Number.isFinite(new Date(time).getTime())) {
			return res.status(400).json({
				message: "Title, Bio, Location, Kind, Time and Reminders are required",
			});
		}

		const community = req.body.communityId ? await Community.findById(req.body.communityId) : await Community.findOne({ title: community_name });
		if (!community) {
			return res.status(404).json({ message: "Community not found" });
		}

		if (!isCommunityOrganizer(community, req.auth)) return res.status(403).json({ message: "Community organizer required" });
		const result = await Event.create({
			title: title,
			bio: bio,
			location: location,
			community: community._id,
			kind: kind,
			time: new Date(time).toISOString(),
			reminders: reminders,
			author: req.auth.id,
			author_name: req.auth.name || "MediPulse member",
		});

		res
			.status(201)
			.json({ message: "Event created successfully", success: true, result });
	} catch (error) {
		console.error("Error in createEvent:", error);
		return res.status(500).json({ message: "Internal server error", error: error.message });
	}
};

export { createEvent, getEvents };
