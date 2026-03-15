import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import doctorModel from "../models/doctorModel.js";
import appointmentModel from "../models/appointmentModel.js";
import userModel from "../models/userModel.js";
import axios from 'axios';

// Doctor login
const loginDoctor = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await doctorModel.findOne({ email });

    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get doctor's appointments
const appointmentsDoctor = async (req, res) => {
  try {
    const docId = req.user.id;
    const appointments = await appointmentModel.find({ docId }).lean();
    res.json({ success: true, appointments });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Cancel appointment
const appointmentCancel = async (req, res) => {
  try {
    const docId = req.user.id;
    const { appointmentId } = req.body;

    const appointment = await appointmentModel.findById(appointmentId);
    if (!appointment || appointment.docId.toString() !== docId) {
      return res.status(403).json({ success: false, message: "Invalid doctor or appointment" });
    }

    // --- AUTOMATED REFUND LOGIC ---
    let refundStatus = 'none';
    let refundAmount = 0;

    if (appointment.payment && appointment.paymentId) {
      // Calculate time difference between now and appointment slot
      const [day, month, year] = appointment.slotDate.split('_');
      const timeParts = appointment.slotTime.match(/(\d+):(\d+)\s*(AM|PM)?/i);
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
        refundAmount = appointment.amount;
      } else if (diffHours > 12) {
        refundStatus = 'partial';
        refundAmount = appointment.amount / 2; // 50% refund
      }

      if (refundAmount > 0) {
        try {
          const payments = await razorpayInstance.orders.fetchPayments(appointment.paymentId);
          const successfulPayment = payments.items.find(p => p.status === 'captured');

          if (successfulPayment) {
            // Execute Refund via Razorpay API
            await razorpayInstance.payments.refund(successfulPayment.id, {
              amount: refundAmount * 100, // Amount in paise
              notes: { reason: 'Doctor Cancelled Appointment', type: refundStatus }
            });
          }
        } catch (refundError) {
          console.error("Razorpay Refund Error:", refundError);
        }
      }
    }
    // --- END AUTOMATED REFUND LOGIC ---

    await appointmentModel.findByIdAndUpdate(appointmentId, {
      cancelled: true,
      refundStatus,
      refundAmount
    });

    res.json({ success: true, message: "Appointment Cancelled" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Complete appointment
const appointmentComplete = async (req, res) => {
  try {
    const docId = req.user.id;
    const { appointmentId } = req.body;

    const appointment = await appointmentModel.findById(appointmentId);
    if (!appointment || appointment.docId.toString() !== docId) {
      return res.status(403).json({ success: false, message: "Invalid doctor or appointment" });
    }

    await appointmentModel.findByIdAndUpdate(appointmentId, { isCompleted: true });

    // Send review request email
    try {
      const user = await userModel.findById(appointment.userId);
      const doctor = await doctorModel.findById(docId);

      if (user && user.email) {
        await axios.post(
          'https://api.brevo.com/v3/smtp/email',
          {
            sender: { email: process.env.EMAIL_FROM, name: "HealthAxis Team" },
            to: [{ email: user.email, name: user.name }],
            subject: `How was your appointment with Dr. ${doctor.name}?`,
            htmlContent: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eff2f5; border-radius: 10px;">
                  <h2 style="color: #0D7377;">Thank you for choosing HealthAxis, ${user.name}!</h2>
                  <p>Your appointment with Dr. ${doctor.name} is now complete.</p>
                  <p>We'd love to hear about your experience. Your feedback helps other patients make informed decisions and helps our doctors provide the best care possible.</p>
                  <div style="text-align: center; margin: 30px 0;">
                      <a href="${process.env.FRONTEND_URL}/my-appointments" style="background-color: #0D7377; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold;">Leave a Review</a>
                  </div>
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
        console.log("Review request email sent to:", user.email);
      }
    } catch (emailError) {
      console.error("Failed to send review request email:");
      if (emailError.response) {
        console.error("Status:", emailError.response.status);
        console.error("Data:", emailError.response.data);
      } else {
        console.error("Message:", emailError.message);
      }
      // Don't fail the whole request if email fails
    }

    res.json({ success: true, message: "Appointment Completed" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get all doctors (for frontend list)
const doctorList = async (req, res) => {
  try {
    const doctors = await doctorModel.find({}).select("-password -email").lean();
    res.json({ success: true, doctors });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Toggle doctor's availability
const changeAvailability = async (req, res) => {
  try {
    const { docId } = req.body;

    if (!docId) {
      return res.status(400).json({ success: false, message: "Doctor ID missing" });
    }

    const doctor = await doctorModel.findById(docId);
    if (!doctor) {
      return res.status(404).json({ success: false, message: "Doctor not found" });
    }

    doctor.available = !doctor.available;
    await doctor.save();
    res.json({ success: true, message: "Availability changed successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};


// Get doctor's profile
const doctorProfile = async (req, res) => {
  try {
    const docId = req.user.id;
    const profile = await doctorModel.findById(docId).select("-password").lean();
    res.json({ success: true, profileData: profile });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update doctor's profile
const updateDoctorProfile = async (req, res) => {
  try {
    const docId = req.user.id;
    const { fees, address, available, about } = req.body; // ✅ include `about`

    await doctorModel.findByIdAndUpdate(docId, {
      fees,
      address,
      available,
      about, // ✅ update `about`
    });

    res.json({ success: true, message: "Profile Updated" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};


// Get detailed dashboard data for analytics
const doctorDashboard = async (req, res) => {
  try {
    const docId = req.user.id;
    const appointments = await appointmentModel.find({ docId }).lean();

    let earnings = 0;
    let pendingPayments = 0;
    let completedAppointments = 0;
    let cancelledAppointments = 0;
    const patientSet = new Set();
    const trendMap = {};

    // 1. Initialize last 7 days for the trend graph
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayKey = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      trendMap[dayKey] = 0;
    }

    appointments.forEach((a) => {
      // Patients
      patientSet.add(a.userId.toString());

      // Appointment Status Counts
      if (a.cancelled) {
        cancelledAppointments += 1;
      } else if (a.isCompleted) {
        completedAppointments += 1;
      }

      // Financials
      let isPaid = false;
      if (a.payment) {
        earnings += a.amount;
        isPaid = true;
      } else if (!a.cancelled) {
        // Not cancelled and NOT paid yet -> pending cash collection
        pendingPayments += a.amount;
      }

      // Trend Calculation (only count revenue for completed or paid)
      if (isPaid && a.date) {
        const apptDate = new Date(a.date);
        const dayKey = apptDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        if (trendMap[dayKey] !== undefined) {
          trendMap[dayKey] += a.amount;
        }
      }
    });

    const revenueTrend = Object.keys(trendMap).map((date) => ({
      date,
      revenue: trendMap[date],
    }));

    const latestAppointments = await appointmentModel.find({ docId }).sort({ date: -1 }).limit(5).lean();

    const dashData = {
      earnings,
      pendingPayments,
      appointments: appointments.length,
      completedAppointments,
      cancelledAppointments,
      patients: patientSet.size,
      revenueTrend,
      latestAppointments,
    };

    res.json({ success: true, dashData });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export {
  loginDoctor,
  appointmentsDoctor,
  appointmentCancel,
  appointmentComplete,
  doctorList,
  changeAvailability,
  doctorProfile,
  updateDoctorProfile,
  doctorDashboard,
};
