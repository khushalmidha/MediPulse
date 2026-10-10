import mongoose from "mongoose";
import { assertMongoTransactions } from "./services/readiness.js";

const connectMongo = async (url) => {
	if (!url) {
		throw new Error("DATABASE_URL is not configured");
	}

	await mongoose.connect(url, {
		serverSelectionTimeoutMS: 10000,
		autoIndex: false,
		autoCreate: false,
	});
	await assertMongoTransactions(mongoose.connection);
	console.log("Connected to mongoDB");
};

export default connectMongo;
