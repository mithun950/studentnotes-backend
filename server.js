
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("node:dns").setServers(["8.8.8.8", "1.1.1.1"]);
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

if (!process.env.MONGO_URI || !process.env.JWT_SECRET) {
  throw new Error("MONGO_URI and JWT_SECRET must be configured");
}

// USER MODEL
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: { type: String, required: true }
}, { timestamps: true });

const User = mongoose.model("User", userSchema);

// DONOR MODEL
const donorSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true
  },
  name: { type: String, required: true, trim: true },
  bloodGroup: {
    type: String,
    enum: ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"],
    required: true
  },
  phone: { type: String, required: true, trim: true },
  location: { type: String, default: "" },
  available: { type: Boolean, default: true }
}, { timestamps: true });

const Donor = mongoose.model("Donor", donorSchema);

// JWT AUTHENTICATION
function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Please login first" });
  }

  try {
    const token = header.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function createToken(user) {
  return jwt.sign(
    { userId: user._id.toString() },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

// HOME
app.get("/", (req, res) => {
  res.send("Blood Donor API is running");
});

// REGISTER
app.post("/auth/register", async (req, res) => {
  try {
    const { name, email, password, bloodGroup, phone, location } = req.body;

    if (!name?.trim() || !email?.trim() || !password ||
        !bloodGroup || !phone?.trim()) {
      return res.status(400).json({ error: "Please fill all required fields" });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (await User.findOne({ email: normalizedEmail })) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: await bcrypt.hash(password, 12)
    });

    try {
      const donor = await Donor.create({
        userId: user._id,
        name: name.trim(),
        bloodGroup,
        phone: phone.trim(),
        location: location?.trim() || "",
        available: true
      });

      res.status(201).json({
        message: "Registration successful",
        token: createToken(user),
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email
        },
        donor
      });
    } catch (error) {
      await User.findByIdAndDelete(user._id);
      throw error;
    }
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: "Email already registered" });
    }
    res.status(400).json({ error: error.message });
  }
});

// LOGIN
app.post("/auth/login", async (req, res) => {
  try {
    const email = req.body.email?.trim().toLowerCase();
    const password = req.body.password;

    const user = await User.findOne({ email });

    if (!user || !(await bcrypt.compare(password || "", user.password))) {
      return res.status(401).json({ error: "Incorrect email or password" });
    }

    res.json({
      message: "Login successful",
      token: createToken(user),
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    res.status(500).json({ error: "Login failed" });
  }
});

// MY PROFILE
app.get("/auth/me", auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("-password");

    if (!user) return res.status(404).json({ error: "User not found" });

    const donor = await Donor.findOne({ userId: user._id });

    res.json({
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email
      },
      donor
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// UPDATE OWN PROFILE
app.put("/auth/me", auth, async (req, res) => {
  try {
    const { name, email, bloodGroup, phone, location } = req.body;
    const user = await User.findById(req.userId);

    if (!user) return res.status(404).json({ error: "User not found" });

    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: "Name required" });
      user.name = name.trim();
    }

    if (email !== undefined) {
      if (!email.trim()) return res.status(400).json({ error: "Email required" });
      user.email = email.trim().toLowerCase();
    }

    await user.save();

    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (bloodGroup !== undefined) updates.bloodGroup = bloodGroup;
    if (phone !== undefined) updates.phone = phone.trim();
    if (location !== undefined) updates.location = location.trim();

    const donor = await Donor.findOneAndUpdate(
      { userId: req.userId },
      { $set: updates },
      { new: true, runValidators: true }
    );

    res.json({
      message: "Profile updated",
      user: { id: user._id.toString(), name: user.name, email: user.email },
      donor
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: "Email already registered" });
    }
    res.status(400).json({ error: error.message });
  }
});

// PUBLIC DONOR LIST
app.get("/donors", async (req, res) => {
  try {
    const donors = await Donor.find()
      .select("-userId")
      .sort({ available: -1, createdAt: -1 });

    res.json(donors);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// CHANGE ONLY OWN AVAILABILITY
app.patch("/donors/me/availability", auth, async (req, res) => {
  try {
    const { available } = req.body;

    if (typeof available !== "boolean") {
      return res.status(400).json({ error: "available must be true or false" });
    }

    const donor = await Donor.findOneAndUpdate(
      { userId: req.userId },
      { $set: { available } },
      { new: true, runValidators: true }
    );

    if (!donor) {
      return res.status(404).json({ error: "Donor profile not found" });
    }

    res.json({
      message: "Availability updated",
      available: donor.available
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// START SERVER
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected");
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(error => {
    console.error("Database error:", error.message);
    process.exit(1);
  });
