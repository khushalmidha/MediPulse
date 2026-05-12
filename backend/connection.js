import mongoose from "mongoose";

const connectMongo = async (url) => {
	if (!url) {
		throw new Error("DATABASE_URL is not configured");
	}

	await mongoose.connect(url, {
		serverSelectionTimeoutMS: 10000,
	});
	console.log("Connected to mongoDB");
};

export default connectMongo;
