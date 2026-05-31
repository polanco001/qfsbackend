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