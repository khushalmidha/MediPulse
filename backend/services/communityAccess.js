import mongoose from "mongoose";
import Community from "../model/community.js";
import Message from "../model/message.js";
import { idOf, isRecordId } from "./hospitalAccess.js";
import { resolveSession } from "./authSessions.js";

export const isCommunityOrganizer = (community, actor) => actor?.role === "doctor" && idOf(community?.author) === String(actor.id);
export const canAccessCommunity = (community, actor) => Boolean(community && ["user", "doctor"].includes(actor?.role)
  && (isCommunityOrganizer(community, actor) || (community.members || []).some(id => idOf(id) === String(actor.id))));
export const communitySummary = community => ({ _id: community._id, title: community.title, bio: community.bio,
  category: community.category, author: community.author, memberCount: new Set((community.members || []).map(idOf)).size,
  createdAt: community.createdAt, updatedAt: community.updatedAt });
export async function requireCommunityAccess(id, actor, session) {
  if (!isRecordId(id)) throw Object.assign(new Error("Valid community id is required"), { status: 400 });
  const community = await Community.findById(id).session(session || null);
  if (!canAccessCommunity(community, actor)) throw Object.assign(new Error("Community membership is required"), { status: 403 });
  return community;
}
export async function createCommunityMessage(id, content, actor) {
  if (typeof content !== "string" || !content.trim() || content.length > 4000)
    throw Object.assign(new Error("Message must contain 1 to 4000 characters"), { status: 400 });
  const session = await mongoose.startSession();
  let message;
  try {
    await session.withTransaction(async () => {
      const community = await requireCommunityAccess(id, actor, session);
      // A write on the membership document serializes leave and send transactions.
      await Community.updateOne({ _id: community._id }, { $inc: { activityRevision: 1 } }, { session });
      [message] = await Message.create([{ community: community._id, author: actor.id, author_name: actor.name || "MediPulse member", content: content.trim() }], { session });
    });
  } finally { await session.endSession(); }
  return message;
}
export async function broadcastCommunity(io, id, event, payload, except) {
  if (!io) return;
  const community = await Community.findById(id);
  for (const recipient of await io.in(String(id)).fetchSockets()) {
    try {
      await resolveSession(recipient.data.sessionToken, "account");
      if (!canAccessCommunity(community, recipient.data.communityActor)) { recipient.leave(String(id)); continue; }
      if (recipient.id !== except) recipient.emit(event, payload);
    } catch { recipient.disconnect(true); }
  }
}
