import bcrypt from "bcryptjs";
import asyncHandler from "express-async-handler";

import User from "../models/userModel.js";
import OTP from "../models/otpModel.js";
import generateToken from "../utils/createToken.js";
import { sendWelcomeEmail, sendOTPEmail } from "../utils/emailUtils.js";
import { OAuth2Client } from "google-auth-library";

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// @desc    Register new user
// @route   POST /api/v1/users

const createUser = asyncHandler(async (req, res) => {
  const { username, password, email } = req.body;
  if (!username || !password || !email) {
    res.status(400);
    throw new Error("Invalid user, Please fill all the required fields");
  }

  //Check if the user already exists
  const userExists = await User.findOne({ email });
  if (userExists) {
    res.status(400);
    throw new Error("User already exists");
  }

  //Hash the password
  const salt = await bcrypt.genSalt(10);
  const hashedPass = await bcrypt.hash(password, salt);

  //create a new user
  const newUser = new User({ username, email, password: hashedPass });

  try {
    await newUser.save();

    //To generate jwt token
    generateToken(res, newUser._id);

    res.json({
      _id: newUser._id,
      username: newUser.username,
      email: newUser.email,
      isAdmin: newUser.isAdmin,
      points: newUser.points,
    });

    // Send Welcome Email
    try {
      await sendWelcomeEmail(newUser);
    } catch (emailErr) {
      console.error("Email error:", emailErr.message);
    }
  } catch (error) {
    console.log(error.message);
  }

  //   res.json({ message: "user created successfully", username, password, email });
});

// @desc    Request Signup OTP
// @route   POST /api/v1/users/request-otp
const requestOTP = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    res.status(400);
    throw new Error("Email is required");
  }

  // Check if user already exists
  const userExists = await User.findOne({ email });
  if (userExists) {
    res.status(400);
    throw new Error("User already exists");
  }

  // Generate 6 digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  // Save/Update OTP in DB
  await OTP.findOneAndUpdate(
    { email },
    { $set: { otp, createdAt: Date.now() } },
    { upsert: true, new: true }
  );

  // Send Email
  try {
    await sendOTPEmail(email, otp);
    res.status(200).json({ message: "OTP sent to your email" });
  } catch (error) {
    res.status(500);
    throw new Error("Failed to send OTP email");
  }
});

// @desc    Verify OTP and Register user
// @route   POST /api/v1/users/verify-otp
const verifyOTPAndRegister = asyncHandler(async (req, res) => {
  const { username, email, password, otp } = req.body;

  if (!username || !email || !password || !otp) {
    res.status(400);
    throw new Error("Missing required fields");
  }

  // Verify OTP
  const lastOTP = await OTP.findOne({ email });

  if (!lastOTP || lastOTP.otp !== otp) {
    res.status(400);
    throw new Error("Invalid or expired OTP");
  }

  // Check again for user (double check)
  const userExists = await User.findOne({ email });
  if (userExists) {
    res.status(400);
    throw new Error("User already exists");
  }

  // OTP verified, create user
  const salt = await bcrypt.genSalt(10);
  const hashedPass = await bcrypt.hash(password, salt);

  const newUser = new User({ username, email, password: hashedPass });
  await newUser.save();

  // Clean up OTP
  await OTP.deleteOne({ email });

  // Generate token
  generateToken(res, newUser._id);

  res.status(201).json({
    _id: newUser._id,
    username: newUser.username,
    email: newUser.email,
    isAdmin: newUser.isAdmin,
    points: newUser.points,
  });

  // Send welcome email
  try {
    await sendWelcomeEmail(newUser);
  } catch (emailErr) {
    console.error("Welcome email error:", emailErr.message);
  }
});

// @desc    Login the user
// @route   POST /api/v1/users/auth

const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  //verify user exists
  const existingUser = await User.findOne({ email });
  if (!existingUser) {
    return res.status(401).json({ message: "Invalid email or password" });
  }

  const isPasswordValid = await bcrypt.compare(
    password,
    existingUser.password
  );
  if (!isPasswordValid) {
    return res.status(401).json({ message: "Invalid email or password" });
  }

  generateToken(res, existingUser._id);
  return res.status(200).json({
    _id: existingUser._id,
    username: existingUser.username,
    email: existingUser.email,
    isAdmin: existingUser.isAdmin,
    points: existingUser.points,
  });
});

// @desc    Authenticate with Google OAuth
// @route   POST /api/v1/users/google-auth
const googleAuth = asyncHandler(async (req, res) => {
  const { credential } = req.body;

  if (!credential) {
    return res.status(400).json({ message: "No Google token provided" });
  }

  try {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { email, name, sub } = payload; // sub is the unique Google ID

    // Check if user already exists
    let existingUser = await User.findOne({ email });

    if (!existingUser) {
      // Create a seamless new user for Google login
      // Generate a random secure password since they login via Google
      const salt = await bcrypt.genSalt(10);
      const randomPassword = await bcrypt.hash(sub + Date.now().toString(), salt);

      existingUser = await User.create({
        username: name,
        email,
        password: randomPassword,
        isAdmin: false,
      });
    }

    generateToken(res, existingUser._id);

    return res.status(200).json({
      _id: existingUser._id,
      username: existingUser.username,
      email: existingUser.email,
      isAdmin: existingUser.isAdmin,
      points: existingUser.points,
    });

  } catch (error) {
    console.error("Google Auth Error:", error);
    res.status(401).json({ message: "Invalid Google Token" });
  }
});

// @desc    Logout the current user
// @route   POST /api/v1/users/logout
const logoutCurrentUser = asyncHandler(async (req, res) => {
  res.cookie("jwt", "", {
    httpOnly: true,
    expires: new Date(0),
  });

  res.status(200).json({ message: "Logged out successfully" });
});

// @desc    Get the all users (for admin only)
// @route   GET /api/v1/users/
const getAllUsers = asyncHandler(async (req, res) => {
  const users = await User.find({});

  res.status(200).json(users);
});

// @desc    Get the current user
// @route   GET /api/v1/users/profile
const getCurrentUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (user) {
    res.status(200).json({
      _id: user._id,
      username: user.username,
      email: user.email,
      points: user.points,
    });
  } else {
    res.status(404);
    throw new Error("user not found");
  }
});

// @desc    Get the current user
// @route   PUT /api/v1/users/profile

// const updateCurrentUserProfile = asyncHandler(async (req, res) => {
//   const currentUser = await User.findById(req.user._id);

//   if (!currentUser) {
//     res.status(404);
//     throw new Error("User not found");
//   }

//   if (currentUser) {
//     // Check if the request body includes a new password
//     if (req.body.password) {
//       // Hash the new password with bcrypt
//       const salt = await bcrypt.genSalt(10);
//       const hashedPassword = await bcrypt.hash(req.body.password, salt);

//       req.body.password = hashedPassword;
//     }

//     // Update the user's profile, including the hashed password if it was provided
//     const updatedUser = await User.findByIdAndUpdate(req.user._id, req.body, {
//       new: true,
//     });

//     res.json(updatedUser);
//   }
// });

const updateCurrentUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (user) {
    user.username = req.body.username || user.username;
    user.email = req.body.email || user.email;

    // Check if the request body includes a new password
    if (req.body.password) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(req.body.password, salt);
      user.password = hashedPassword;
    }

    const updatedUser = await user.save();

    res.json({
      _id: updatedUser._id,
      username: updatedUser.username,
      email: updatedUser.email,
      isAdmin: updatedUser.isAdmin,
      points: updatedUser.points,
    });
  } else {
    res.status(404);
    throw new Error("User not found");
  }
});

// @desc    Delete the user by id (admin only)
// @route   DELETE /api/v1/users/:id
const deleteUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  if (user) {
    // Check, If the user is an admin
    if (user.isAdmin) {
      res.status(400);
      throw new Error("Can not delete Admin");
    }
    await User.deleteOne({ _id: user._id });
    res.status(200);
    res.json({ message: "successfully deleted!" });
  }
});

// @desc    Get the user by id (admin only)
// @route   GET /api/v1/users/:id
const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) return res.status(404).json({ message: "User not found" });

  if (user) {
    res.status(200);
    res.json(user);
  }
});

// @desc    Update the user by id (admin only)
// @route   PUT /api/v1/users/:id
const updateUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (user) {
    user.username = req.body.username || user.username;
    user.email = req.body.email || user.email;
    user.isAdmin = Boolean(req.body.isAdmin);

    const updatedUser = await user.save();

    res.json({
      _id: updatedUser._id,
      username: updatedUser.username,
      email: updatedUser.email,
      isAdmin: updatedUser.isAdmin,
    });
  } else {
    res.status(404);
    throw new Error("User not found");
  }
});

export {
  createUser,
  loginUser,
  googleAuth,
  logoutCurrentUser,
  getAllUsers,
  getCurrentUserProfile,
  updateCurrentUserProfile,
  deleteUserById,
  getUserById,
  updateUserById,
  requestOTP,
  verifyOTPAndRegister,
};
