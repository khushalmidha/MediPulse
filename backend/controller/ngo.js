import Ngo from "../model/ngo.js";

const getAllNgos = async (_, res) => {
	const ngos = await Ngo.find({}).sort({ createdAt: -1 });
	return res.json(ngos);
};

export { getAllNgos };
