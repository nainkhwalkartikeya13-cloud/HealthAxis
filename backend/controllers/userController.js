import validator from 'validator'
import bcrypt from 'bcrypt'
import userModel from "../models/userModel.js";
import doctorModel from "../models/doctorModel.js";
import appointmentModel from "../models/appointmentModel.js";
import jwt from "jsonwebtoken";
import { v2 as cloudinary } from 'cloudinary'
import razorpay from 'razorpay';
import twilio from 'twilio';
import nodemailer from 'nodemailer';
import { OAuth2Client } from 'google-auth-library';
import crypto from 'crypto';

const twilioClient = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

import axios from 'axios';

const sendVerificationEmail = async (email, name, code) => {
    try {
        console.log(`[BREVO API DEBUG] Attempting to send email to ${email} via HTTP API`);

        const response = await axios.post(
            'https://api.brevo.com/v3/smtp/email',
            {
                sender: { email: process.env.EMAIL_FROM, name: "HealthAxis Team" },
                to: [{ email: email, name: name }],
                subject: "Verify your HealthAxis account",
                htmlContent: `
                    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eff2f5; border-radius: 10px;">
                        <h2 style="color: #0D7377;">Welcome to HealthAxis, ${name}!</h2>
                        <p>Thank you for signing up. Please use the following 6-digit code to verify your email address:</p>
                        <div style="font-size: 32px; font-weight: bold; color: #0D7377; letter-spacing: 5px; text-align: center; padding: 20px; background: #f4f7f9; border-radius: 8px; margin: 20px 0;">
                            ${code}
                        </div>
                        <p>This code will expire in 1 hour.</p>
                        <p>If you did not create this account, please ignore this email.</p>
                        <hr style="border: none; border-top: 1px solid #eff2f5; margin: 20px 0;">
                        <p style="font-size: 12px; color: #6B8799;">HealthAxis Technologies • Secure & Professional Healthcare</p>
                    </div>
                `
            },
            {
                headers: {
                    'accept': 'application/json',
                    'api-key': process.env.BREVO_API_KEY,
                    'content-type': 'application/json'
                }
            }
        );

        console.log(`[BREVO API DEBUG] Email sent successfully to ${email}. Message ID: ${response.data.messageId}`);
    } catch (error) {
        console.error(`[BREVO CRITICAL ERROR] Failed to send email to ${email}`);
        if (error.response) {
            console.error(`[BREVO CRITICAL ERROR] Status: ${error.response.status}`);
            console.error(`[BREVO CRITICAL ERROR] Data:`, error.response.data);
        } else {
            console.error(`[BREVO CRITICAL ERROR] Message: ${error.message}`);
        }
        throw error;
    }
};


const registerUser = async (req, res) => {
    try {
        const { name, email, password } = req.body;
        console.log(`[REGISTRATION ATTEMPT] Name: ${name}, Email: ${email}`);

        // checking for all data to register user
        if (!name || !email || !password) {
            return res.status(400).json({ success: false, message: 'Missing Details' })
        }
        // validating email format
        if (!validator.isEmail(email)) {
            return res.status(400).json({ success: false, message: "Please enter a valid email" })
        }
        // validating strong password
        if (password.length < 8) {
            return res.status(400).json({ success: false, message: "Please enter a strong password" })
        }

        // checking if user already exists
        const exists = await userModel.findOne({ email });
        if (exists) {
            console.warn(`[REGISTRATION FAILED] User already exists: ${email}`);
            return res.status(400).json({ success: false, message: "User already exists" })
        }

        // hashing user password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt)

        // Generate verification code
        const verificationCode = crypto.randomInt(100000, 999999).toString();
        const verificationCodeExpires = Date.now() + 3600000; // 1 hour

        const userData = {
            name,
            email,
            password: hashedPassword,
            verificationCode,
            verificationCodeExpires
        }

        const newUser = new userModel(userData)
        const user = await newUser.save()

        // Send Email
        try {
            await sendVerificationEmail(email, name, verificationCode);
        } catch (mailError) {
            console.error('[NODEMAILER ERROR]', mailError.message);
            // We don't fail registration if email fails, user can resend later
        }

        res.json({ success: true, message: 'Verification code sent to your email' })
    } catch (error) {
        console.error('[REGISTRATION ERROR]', error)
        if (error.code === 11000) {
            return res.status(400).json({ success: false, message: "User already exists" })
        }
        res.status(500).json({ success: false, message: "Internal Server Error" })
    }
}
// API to login user
const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await userModel.findOne({ email }).lean()
        if (!user) {
            return res.json({ success: false, message: "User does not exist" })
        }
        const isMatch = await bcrypt.compare(password, user.password)
        if (isMatch) {
            if (!user.isVerified) {
                return res.json({ success: false, message: "Please verify your email first", unverified: true })
            }
            const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' })
            res.json({ success: true, token })
        }
        else {
            res.status(401).json({ success: false, message: "Invalid credentials" })
        }
    } catch (error) {
        console.error('Login error:', error.message)
        res.status(500).json({ success: false, message: error.message })
    }
}

// API to get user profile data
const getProfile = async (req, res) => {

    try {
        const { userId } = req.body
        const userData = await userModel.findById(userId).select('-password').lean()

        res.json({ success: true, userData })

    } catch (error) {
        console.log(error)
        res.json({ success: false, message: error.message })
    }
}

// API to update user profile
const updateProfile = async (req, res) => {

    try {

        const { userId, name, phone, address, dob, gender } = req.body
        const imageFile = req.file

        if (!name || !phone || !dob || !gender) {
            return res.json({ success: false, message: "Data Missing" })
        }

        await userModel.findByIdAndUpdate(userId, { name, phone, address: JSON.parse(address), dob, gender })

        if (imageFile) {

            // upload image to cloudinary
            const imageUpload = await cloudinary.uploader.upload(imageFile.path, { resource_type: "image" })
            const imageURL = imageUpload.secure_url

            await userModel.findByIdAndUpdate(userId, { image: imageURL })
        }

        res.json({ success: true, message: 'Profile Updated' })

    } catch (error) {
        console.log(error)
        res.json({ success: false, message: error.message })
    }
}

// API to book appointment 
const bookAppointment = async (req, res) => {

    try {

        const { userId, docId, slotDate, slotTime, reportUrl, reportName } = req.body
        const docData = await doctorModel.findById(docId).select("-password").lean()

        if (!docData.available) {
            return res.json({ success: false, message: 'Doctor Not Available' })
        }

        let slots_booked = docData.slots_booked

        // checking for slot availablity 
        if (slots_booked[slotDate]) {
            if (slots_booked[slotDate].includes(slotTime)) {
                return res.json({ success: false, message: 'Slot Not Available' })
            }
            else {
                slots_booked[slotDate].push(slotTime)
            }
        } else {
            slots_booked[slotDate] = []
            slots_booked[slotDate].push(slotTime)
        }

        const userData = await userModel.findById(userId).select("-password").lean()

        delete docData.slots_booked

        const appointmentData = {
            userId,
            docId,
            userData,
            docData,
            amount: docData.fees,
            slotTime,
            slotDate,
            date: Date.now(),
            reportUrl: reportUrl || null,
            reportName: reportName || null,
        }

        const newAppointment = new appointmentModel(appointmentData)
        await newAppointment.save()

        // save new slots data in docData
        await doctorModel.findByIdAndUpdate(docId, { slots_booked })

        // --- WhatsApp Notification Logic ---
        try {
            if (userData.phone && userData.phone !== '000000000') {
                const message = `*HealthAxis Appointment Confirmed* 🏥\n\nHello ${userData.name},\n\nYour appointment with *${docData.name}* has been successfully scheduled.\n\n📅 *Date:* ${slotDate.replace(/_/g, '/')}\n🕒 *Time:* ${slotTime}\n🏢 *Address:* ${docData.address.line1}, ${docData.address.line2}\n\nPlease arrive 15 minutes early. Thank you for choosing HealthAxis!`;

                await twilioClient.messages.create({
                    from: process.env.TWILIO_WHATSAPP_NUMBER,
                    to: `whatsapp:${userData.phone.startsWith('+') ? userData.phone : '+91' + userData.phone}`,
                    body: message
                });
                console.log('WhatsApp notification sent successfully');
            }
        } catch (twilioError) {
            console.error('Twilio Error:', twilioError.message);
            // We don't return error to user if only notification fails
        }
        // ------------------------------------

        res.json({ success: true, message: 'Appointment Booked' })

    } catch (error) {
        console.log(error)
        res.json({ success: false, message: error.message })
    }

}

// API to upload a previous medical report to an appointment (optional, before/during booking)
const uploadReport = async (req, res) => {
    try {
        const { appointmentId, userId } = req.body;
        const reportFile = req.file;

        if (!reportFile) {
            return res.json({ success: false, message: 'No file uploaded.' });
        }

        // Upload to Cloudinary (auto-detect pdf/image)
        const uploadResult = await cloudinary.uploader.upload(reportFile.path, {
            resource_type: 'auto',
            folder: 'healthaxis_reports',
        });

        // Save the URL back on the appointment (if appointmentId provided)
        // Or return the URL for the frontend to attach during booking
        if (appointmentId) {
            const appt = await appointmentModel.findById(appointmentId);
            if (!appt) return res.json({ success: false, message: 'Appointment not found.' });
            if (appt.userId !== userId) return res.json({ success: false, message: 'Unauthorized.' });

            await appointmentModel.findByIdAndUpdate(appointmentId, {
                reportUrl: uploadResult.secure_url,
                reportName: reportFile.originalname
            });
        }

        res.json({
            success: true,
            reportUrl: uploadResult.secure_url,
            reportName: reportFile.originalname,
            message: 'Report uploaded successfully!'
        });

    } catch (error) {
        console.error('[UPLOAD REPORT ERROR]', error);
        res.json({ success: false, message: error.message });
    }
};

// API to cancel appointment
const cancelAppointment = async (req, res) => {
    try {

        const { userId, appointmentId } = req.body
        const appointmentData = await appointmentModel.findById(appointmentId)

        // verify appointment user 
        if (appointmentData.userId !== userId) {
            return res.json({ success: false, message: 'Unauthorized action' })
        }

        // --- AUTOMATED REFUND LOGIC ---
        let refundStatus = 'none';
        let refundAmount = 0;

        if (appointmentData.payment && appointmentData.paymentId) {
            // Calculate time difference between now and appointment slot
            const [day, month, year] = appointmentData.slotDate.split('_');
            // Assuming slotTime is like "10:30 AM" or "10:30"
            const timeParts = appointmentData.slotTime.match(/(\d+):(\d+)\s*(AM|PM)?/i);
            let hours = parseInt(timeParts[1], 10);
            const mins = parseInt(timeParts[2], 10);

            if (timeParts[3] && timeParts[3].toUpperCase() === 'PM' && hours < 12) {
                hours += 12;
            } else if (timeParts[3] && timeParts[3].toUpperCase() === 'AM' && hours === 12) {
                hours = 0;
            }

            const slotDateTime = new Date(`${year}-${month}-${day}T${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:00`);
            const now = new Date();

            const diffMs = slotDateTime - now;
            const diffHours = diffMs / (1000 * 60 * 60);

            if (diffHours > 24) {
                refundStatus = 'full';
                refundAmount = appointmentData.amount;
            } else if (diffHours > 12) {
                refundStatus = 'partial';
                refundAmount = appointmentData.amount / 2; // 50% refund
            }

            if (refundAmount > 0) {
                try {
                    // Fetch payments for this order
                    const payments = await razorpayInstance.orders.fetchPayments(appointmentData.paymentId);

                    // Assuming we refund the first successful payment attached to this order
                    const successfulPayment = payments.items.find(p => p.status === 'captured');

                    if (successfulPayment) {
                        // Execute Refund via Razorpay API
                        await razorpayInstance.payments.refund(successfulPayment.id, {
                            amount: refundAmount * 100, // Amount in paise
                            notes: {
                                reason: 'User Cancelled Appointment',
                                type: refundStatus
                            }
                        });
                    }
                } catch (refundError) {
                    console.error("Razorpay Refund Error:", refundError);
                    // We log the error but still proceed to cancel the appointment in DB
                }
            }
        }
        // --- END REFUND LOGIC ---

        await appointmentModel.findByIdAndUpdate(appointmentId, {
            cancelled: true,
            refundStatus,
            refundAmount
        })

        // releasing doctor slot 
        const { docId, slotDate, slotTime } = appointmentData

        const doctorData = await doctorModel.findById(docId)

        let slots_booked = doctorData.slots_booked

        slots_booked[slotDate] = slots_booked[slotDate].filter(e => e !== slotTime)

        await doctorModel.findByIdAndUpdate(docId, { slots_booked })

        res.json({ success: true, message: 'Appointment Cancelled' })

    } catch (error) {
        console.log(error)
        res.json({ success: false, message: error.message })
    }
}

// API to get user appointments for frontend my-appointments page
const listAppointment = async (req, res) => {
    try {

        const { userId } = req.body
        const appointments = await appointmentModel.find({ userId }).lean()

        res.json({ success: true, appointments })

    } catch (error) {
        console.log(error)
        res.json({ success: false, message: error.message })
    }
}

const razorpayInstance = new razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
})

// API to make payment of appointment using razorpay
const paymentRazorpay = async (req, res) => {
    try {

        const { appointmentId } = req.body
        const appointmentData = await appointmentModel.findById(appointmentId).lean()

        if (!appointmentData || appointmentData.cancelled) {
            return res.json({ success: false, message: 'Appointment Cancelled or not found' })
        }

        // creating options for razorpay payment
        const options = {
            amount: appointmentData.amount * 100,
            currency: process.env.CURRENCY,
            receipt: appointmentId,
        }

        // creation of an order
        const order = await razorpayInstance.orders.create(options)

        res.json({ success: true, order })

    } catch (error) {
        console.log(error)
        res.json({ success: false, message: error.message })
    }
}

// API to verify payment of razorpay
const verifyRazorpay = async (req, res) => {
    try {
        const { razorpay_order_id } = req.body
        const orderInfo = await razorpayInstance.orders.fetch(razorpay_order_id)

        if (orderInfo.status === 'paid') {
            await appointmentModel.findByIdAndUpdate(orderInfo.receipt, {
                payment: true,
                paymentId: razorpay_order_id
            })
            res.json({ success: true, message: "Payment Successful" })
        }
        else {
            res.json({ success: false, message: 'Payment Failed' })
        }
    } catch (error) {
        console.log(error)
        res.json({ success: false, message: error.message })
    }
}


// API to verify email
const verifyEmail = async (req, res) => {
    try {
        const { email, code } = req.body;
        const user = await userModel.findOne({ email });

        if (!user) {
            return res.json({ success: false, message: "User not found" })
        }

        if (user.isVerified) {
            return res.json({ success: false, message: "Account already verified" })
        }

        if (user.verificationCode !== code || user.verificationCodeExpires < Date.now()) {
            return res.json({ success: false, message: "Invalid or expired code" })
        }

        user.isVerified = true;
        user.verificationCode = '';
        user.verificationCodeExpires = undefined;
        await user.save();

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' })
        res.json({ success: true, message: "Email verified successfully", token })

    } catch (error) {
        console.error(error);
        res.json({ success: false, message: error.message })
    }
}

// API to resend verification code
const resendCode = async (req, res) => {
    try {
        const { email } = req.body;
        const user = await userModel.findOne({ email });

        if (!user) {
            return res.json({ success: false, message: "User not found" })
        }

        const verificationCode = crypto.randomInt(100000, 999999).toString();
        user.verificationCode = verificationCode;
        user.verificationCodeExpires = Date.now() + 3600000;
        await user.save();

        await sendVerificationEmail(user.email, user.name, verificationCode);
        res.json({ success: true, message: "Verification code resent" })

    } catch (error) {
        console.error(error);
        res.json({ success: false, message: error.message })
    }
}

// API for Google Login
const googleLogin = async (req, res) => {
    try {
        const { credential } = req.body;
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID
        });

        const { name, email, picture } = ticket.getPayload();

        let user = await userModel.findOne({ email });

        if (!user) {
            // Create new verified user for Google login
            const userData = {
                name,
                email,
                image: picture,
                isVerified: true,
                password: await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10)
            }
            user = new userModel(userData);
            await user.save();
        }

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' })
        res.json({ success: true, token })

    } catch (error) {
        console.error('Google Auth Error:', error.message);
        res.json({ success: false, message: "Google authentication failed" })
    }
}

export { registerUser, loginUser, getProfile, updateProfile, bookAppointment, uploadReport, listAppointment, cancelAppointment, paymentRazorpay, verifyRazorpay, verifyEmail, resendCode, googleLogin }
