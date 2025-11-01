import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  telegramId: { type: String, unique: true },
  fullName: String,
  phone: String,
  selectedPackage: String,
  paymentStatus: { type: String, default: "pending" },
  chapaTxRef: String,
  paymentDate: Date,
});

export default mongoose.models.User || mongoose.model("User", userSchema);
