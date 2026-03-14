import asyncHandler from "express-async-handler";
import User from "../models/userModel.js";
import generateToken from "../utils/createToken.js";
import sendResponse from "../utils/responseHandler.js";

// @desc    Register new user
// @route   POST /api/v1/users

const createUser = asyncHandler(async (req, res) => {
  const { username, password, email } = req.body;

  if (!username || !password || !email) {
    res.status(400);
    throw new Error("Please fill all the required fields");
  }

  const userExists = await User.findOne({ email });
  if (userExists) {
    res.status(400);
    throw new Error("User already exists");
  }

  // Password hashing is now handled by the User model pre-save hook
  const newUser = await User.create({ username, email, password });

  if (newUser) {
    generateToken(res, newUser._id);
    sendResponse(res, 201, "User registered successfully", {
      _id: newUser._id,
      username: newUser.username,
      email: newUser.email,
      isAdmin: newUser.isAdmin,
    });
  } else {
    res.status(400);
    throw new Error("Invalid user data");
  }
});

// @desc    Login the user
// @route   POST /api/v1/users/auth

const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });

  if (user && (await user.comparePassword(password))) {
    generateToken(res, user._id);
    sendResponse(res, 200, "Logged in successfully", {
      _id: user._id,
      username: user.username,
      email: user.email,
      isAdmin: user.isAdmin,
    });
  } else {
    res.status(401);
    throw new Error("Invalid email or password");
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
  logoutCurrentUser,
  getAllUsers,
  getCurrentUserProfile,
  updateCurrentUserProfile,
  deleteUserById,
  getUserById,
  updateUserById,
};
