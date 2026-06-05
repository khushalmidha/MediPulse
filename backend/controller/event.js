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
	const { status = "all" } = req.query;
	const now = new Date();
	const events = await Event.find({}).sort({ time: 1 });

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
};

const createEvent = async (req, res, next) => {
	const { title, bio, location, community_name, kind, time, reminders } =
		req.body;
	if (!title || !bio || !kind || !time || !reminders || !community_name) {
		return res.json({
			message: "Title, Bio, Location, Kind, Time and Reminders are required",
		});
	}

	const community = await Community.findOne({ title: community_name });
	if (!community) {
		return res.status(404).json({ message: "Community not found" });
	}

	const result = await Event.create({
		title: title,
		bio: bio,
		location: location,
		community: community._id,
		kind: kind,
		time: time,
		reminders: reminders,
		author: req.auth.id,
		author_name: req.auth.name || "MediPulse member",
	});

	res
		.status(201)
		.json({ message: "Event created successfully", success: true, result });
};

export { createEvent, getEvents };
