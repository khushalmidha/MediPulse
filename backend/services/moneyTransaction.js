import mongoose from "mongoose";
export const moneyTransaction = async (callback) => {
  for (let attempt = 0; attempt < 8; attempt++) {
    const session = await mongoose.startSession();
    try { return await session.withTransaction(() => callback(session)); }
    catch (error) { if (error.code !== 11000 || attempt === 7) throw error; }
    finally { await session.endSession(); }
  }
};
