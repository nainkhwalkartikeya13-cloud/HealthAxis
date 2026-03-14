import express from 'express'
import nodemailer from 'nodemailer'

const contactRouter = express.Router()

contactRouter.post('/send', async (req, res) => {
  try {
    const { firstName, lastName, email, message } = req.body

    if (!firstName || !email || !message) {
      return res.json({ success: false, message: 'Please fill all required fields.' })
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: parseInt(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })

    // Email to Kartikeya (site owner notification)
    await transporter.sendMail({
      from: `"HealthAxis Contact Form" <${process.env.EMAIL_FROM}>`,
      to: process.env.SMTP_USER,
      subject: `📩 New Contact Form Message from ${firstName} ${lastName || ''}`,
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 32px; border-radius: 16px;">
          <div style="background: #0D7377; padding: 24px 32px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: white; font-size: 22px; margin: 0;">🏥 HealthAxis</h1>
            <p style="color: rgba(255,255,255,0.75); margin: 4px 0 0 0; font-size: 14px;">New Contact Form Submission</p>
          </div>
          <div style="background: white; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e2e8f0; border-top: none;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 10px 0; color: #64748b; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; width: 120px;">Name</td>
                <td style="padding: 10px 0; color: #1e293b; font-size: 15px; font-weight: 600;">${firstName} ${lastName || ''}</td>
              </tr>
              <tr style="border-top: 1px solid #f1f5f9;">
                <td style="padding: 10px 0; color: #64748b; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Email</td>
                <td style="padding: 10px 0; color: #0D7377; font-size: 15px; font-weight: 600;">${email}</td>
              </tr>
              <tr style="border-top: 1px solid #f1f5f9;">
                <td style="padding: 10px 0; color: #64748b; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; vertical-align: top;">Message</td>
                <td style="padding: 10px 0; color: #1e293b; font-size: 15px; line-height: 1.6;">${message}</td>
              </tr>
            </table>
            <div style="margin-top: 24px; padding-top: 24px; border-top: 1px solid #f1f5f9; text-align: center;">
              <a href="mailto:${email}" style="background: #0D7377; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 14px;">Reply to ${firstName}</a>
            </div>
          </div>
          <p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 20px;">HealthAxis · Developed by Kartikeya Nainkhwal</p>
        </div>
      `,
    })

    // Auto-reply to the user who sent the message
    await transporter.sendMail({
      from: `"HealthAxis Support" <${process.env.EMAIL_FROM}>`,
      to: email,
      subject: `We received your message, ${firstName}! 👋`,
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 32px; border-radius: 16px;">
          <div style="background: #0D7377; padding: 24px 32px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: white; font-size: 22px; margin: 0;">🏥 HealthAxis</h1>
            <p style="color: rgba(255,255,255,0.75); margin: 4px 0 0 0; font-size: 14px;">Support Team</p>
          </div>
          <div style="background: white; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e2e8f0; border-top: none;">
            <h2 style="color: #1e293b; font-size: 20px; font-weight: 800; margin: 0 0 12px 0;">Hi ${firstName}! 👋</h2>
            <p style="color: #475569; font-size: 15px; line-height: 1.7; margin: 0 0 16px 0;">
              Thank you for reaching out to HealthAxis. We've received your message and our team will get back to you within <strong>24 hours</strong>.
            </p>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px 20px; margin: 20px 0;">
              <p style="margin: 0; color: #64748b; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Your message:</p>
              <p style="margin: 8px 0 0 0; color: #1e293b; font-size: 14px; line-height: 1.6; font-style: italic;">"${message}"</p>
            </div>
            <p style="color: #475569; font-size: 15px; line-height: 1.7;">Meanwhile, you can browse our verified doctors and book an appointment directly on our platform.</p>
          </div>
          <p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 20px;">© ${new Date().getFullYear()} HealthAxis · Developed by Kartikeya Nainkhwal</p>
        </div>
      `,
    })

    res.json({ success: true, message: 'Your message has been sent! We will reply within 24 hours.' })

  } catch (err) {
    console.error('Contact form error:', err.message)
    res.json({ success: false, message: 'Failed to send message. Please try again or email us directly.' })
  }
})

export default contactRouter
