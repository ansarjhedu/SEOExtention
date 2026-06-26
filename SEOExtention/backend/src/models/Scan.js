//els/Scan.js

import mongoose from 'mongoose';

const ScanSchema = new mongoose.Schema({
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: false,
  },
  targetUrl: { type: String, required: true },
  totalFound: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
  },
  
  // Consolidated Dealership Profile Metadata
  dealershipMetadata: {
    dealershipName: { type: String, default: '' },
    legalCorporateName: { type: String, default: '' },
    dbaAlternateName: { type: String, default: '' },
    streetAddress: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    zipCode: { type: String, default: '' },
    telephoneMainLine: { type: String, default: '' },
    salesHours: { type: String, default: '' },
    serviceHours: { type: String, default: '' },
    latitude: { type: String, default: '' },
    longitude: { type: String, default: '' },
    googleBusinessUrl: { type: String, default: '' },
    
    // Department Specific Information
    financeDetails: {
      lendingPartners: { type: [String], default: [] },
      programsOffered: { type: [String], default: [] }
    },
    serviceDetails: {
      tiers: { type: [String], default: [] },
      claims: { type: [String], default: [] }
    }
  },
  
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('Scan', ScanSchema);