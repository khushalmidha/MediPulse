import { configDotenv } from "dotenv";
import jwt from "jsonwebtoken";

configDotenv();

export function createSecret(id,role, expiresIn = 60 * 60 * 24 * 3) {
	return jwt.sign({ id,role }, process.env.TOKEN_KEY, {
		expiresIn,
	});
}
