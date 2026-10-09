import { createCommunityMessage, broadcastCommunity } from "../services/communityAccess.js";
import { getIO } from "../socket.js";
const createMessage = async (req, res) => {
  const msg = await createCommunityMessage(req.body.id, req.body.content, req.auth);
  await broadcastCommunity(getIO(), req.body.id, "newMessage", msg).catch(() => {});
  return res.status(201).json({ message: "Message Created", msg });
};
export { createMessage };
