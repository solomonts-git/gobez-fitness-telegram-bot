import dotenv from "dotenv";
import TelegramBot from "node-telegram-bot-api";
import mongoose from "mongoose";
import axios from "axios";
import express from "express";
import User from "./models/User.js";

dotenv.config();

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const app = express();
app.use(express.json());

// MongoDB connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB error:", err));

// Packages
const PACKAGES = [
  { id: "basic", name: "Basic Monthly", description: "Gym access + group classes", price: 1000 },
  { id: "premium", name: "Premium Annual", description: "All access + personal trainer", price: 10000 },
  { id: "trial", name: "Day Pass", description: "One-day access", price: 100 },
];

// 🏁 /start — Friendly intro + menu
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const welcome = `👋 Welcome to *${process.env.BUSINESS_NAME}*!\n${process.env.BUSINESS_DESCRIPTION}\n\nChoose an option:`;

  bot.sendMessage(chatId, welcome, {
    parse_mode: "Markdown",
    reply_markup: {
      keyboard: [
        [{ text: "📋 Business Info" }, { text: "🕒 Opening Hours" }],
        [{ text: "📞 Contact" }, { text: "💪 Membership Packages" }],
      ],
      resize_keyboard: true,
    },
  });
});

// 🏢 Business Info
bot.onText(/\/info|📋 Business Info/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `🏋️ *${process.env.BUSINESS_NAME}*\n${process.env.BUSINESS_DESCRIPTION}`,
    { parse_mode: "Markdown" }
  );
});

// 🕒 Opening Hours
bot.onText(/\/hours|🕒 Opening Hours/, (msg) => {
  bot.sendMessage(msg.chat.id, `🕒 *Opening Hours:*\n${process.env.BUSINESS_HOURS}`, { parse_mode: "Markdown" });
});

// 📞 Contact Info
bot.onText(/\/contact|📞 Contact/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `📞 *Phone:* ${process.env.BUSINESS_PHONE}\n📧 *Email:* ${process.env.BUSINESS_EMAIL}\n📍 *Location:* ${process.env.BUSINESS_LOCATION}`,
    { parse_mode: "Markdown" }
  );
});

// 💪 Packages
bot.onText(/\/packages|💪 Membership Packages/, (msg) => {
  const list = PACKAGES.map(p => `💼 *${p.name}*\n${p.description}\n💰 ${p.price} ${process.env.CURRENCY}`).join("\n\n");
  bot.sendMessage(msg.chat.id, `🏋️ *Our Packages:*\n\n${list}`, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: PACKAGES.map(p => [{ text: `${p.name} (${p.price} ${process.env.CURRENCY})`, callback_data: `buy_${p.id}` }]),
    },
  });
});

// 📱 Ask contact
async function requestContact(chatId) {
  await bot.sendMessage(chatId, "📱 Please share your phone number:", {
    reply_markup: {
      keyboard: [
        [{ text: "Share Contact 📞", request_contact: true }]
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

// 📞 Save contact
bot.on("contact", async (msg) => {
  const { id, first_name, last_name } = msg.from;
  const phone = msg.contact.phone_number;

  await User.findOneAndUpdate(
    { telegramId: id },
    { fullName: `${first_name} ${last_name || ""}`, phone },
    { upsert: true }
  );

  bot.sendMessage(msg.chat.id, `✅ Thanks ${first_name}! Your contact is saved.`);
});

// 💳 Handle package purchase
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const pkgId = query.data.replace("buy_", "");
  const selected = PACKAGES.find(p => p.id === pkgId);
  if (!selected) return bot.answerCallbackQuery(query.id, { text: "Invalid package!" });

  const user = await User.findOne({ telegramId: userId });
  if (!user || !user.phone) {
    await requestContact(chatId);
    return bot.answerCallbackQuery(query.id, { text: "Please share your contact first!" });
  }

  const tx_ref = `TX-${Date.now()}`;
  await User.findOneAndUpdate(
    { telegramId: userId },
    { selectedPackage: selected.name, chapaTxRef: tx_ref, paymentStatus: "pending" },
    { upsert: true }
  );

  try {
    const response = await axios.post("https://api.chapa.co/v1/transaction/initialize", {
      amount: selected.price,
      currency: process.env.CURRENCY,
      email: `${user.fullName.replace(" ", ".")}@gobezfitness.com`,
      first_name: user.fullName.split(" ")[0],
      last_name: user.fullName.split(" ")[1] || "",
      tx_ref,
      callback_url: process.env.CHAPA_CALLBACK_URL,
      return_url: `${process.env.BASE_URL}/success`,
      customization: {
        title: selected.name,
        description: selected.description,
      },
    }, {
      headers: { Authorization: `Bearer ${process.env.CHAPA_SECRET_KEY}` },
    });

    const checkoutUrl = response.data.data.checkout_url;
    bot.sendMessage(chatId, `💳 Click below to pay for *${selected.name}*:\n${checkoutUrl}`, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("Chapa error:", err.response?.data || err.message);
    bot.sendMessage(chatId, "❌ Payment initialization failed. Please try again later.");
  }
});

// 🔁 Webhook for Chapa callback
app.post("/api/chapa/callback", async (req, res) => {
  const { tx_ref, status } = req.body;
  const user = await User.findOne({ chapaTxRef: tx_ref });
  if (!user) return res.status(404).send("User not found");

  user.paymentStatus = status;
  user.paymentDate = new Date();
  await user.save();

  bot.sendMessage(
    user.telegramId,
    status === "success"
      ? "✅ Payment successful! Your membership is now active. 🎉"
      : "❌ Payment failed. Please try again."
  );

  res.sendStatus(200);
});

// Root route for Vercel
app.get("/", (_, res) => res.send("🏋️ Gobez Fitness Bot (Chapa Integrated) is running 🚀"));

app.listen(3000, () => console.log("🚀 Gobez Bot running on port 3000"));
