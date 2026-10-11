require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Database Model
const donorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    bloodGroup: {
      type: String,
      enum: ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"],
      required: true,
    },
    phone: { type: String, required: true, trim: true },
    location: { type: String, default: "" },
    available: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const Donor = mongoose.model("Donor", donorSchema);

// Routes
app.get("/", (req, res) => {
  res.send("Blood Donor API is running ");
});

app.get("/donors", async (req, res) => {
  try {
    const list = await Donor.find().sort({ available: -1, createdAt: -1 });
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/donors", async (req, res) => {
  try {
    const d = await Donor.create(req.body);
    res.status(201).json(d);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put("/donors/:id", async (req, res) => {
  try {
    const d = await Donor.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!d) return res.status(404).json({ error: "Not found" });
    res.json(d);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/donors/:id", async (req, res) => {
  try {
    await Donor.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Start
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB connected");
    app.listen(process.env.PORT, "0.0.0.0", () => {
      console.log(` Server running on port ${process.env.PORT}`);
    });
  })
  .catch((err) => console.log("DB error:", err.message));