const mongoose = require('mongoose');

const kycSubmissionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  fullName: String,
  email: String,
  phoneNumber: String,
  address: String,
  city: String,
  state: String,
  postalCode: String,
  country: String,
  proofType: String,
  driverLicenseFront: String,
  driverLicenseBack: String,
  proofOfResidence: String,
  // ─── NEW FIELDS ──────────────────────────────────
  dateOfBirth: {
    type: Date,
    required: false
  },
  ssn: {
    type: String,
    required: false,
    select: false  // hides SSN by default when querying
  },
  ssnLast4: {
    type: String,
    required: false
  },
  // ──────────────────────────────────────────────────
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('KYCSubmission', kycSubmissionSchema);
