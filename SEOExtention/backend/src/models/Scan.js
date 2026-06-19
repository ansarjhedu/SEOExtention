// models/Scan.js

import mongoose from 'mongoose';

const LinkSchema = new mongoose.Schema({
  url: { type: String, required: true },
  text: { type: String, default: '' },
  type: { type: String, enum: ['internal', 'external'], required: true },
  category: { 
    type: String, 
    enum: ['inventory', 'collection', 'product', 'page', 'other'], 
    default: 'other' 
  },
  subCategory: { type: String, default: '' },
  vehicleType: { type: String, default: '' },
  brandName: { type: String, default: '' },
  modelName: { type: String, default: '' },
  year: { type: String, default: '' },
  price: { type: String, default: '' },
  verificationStatus: { 
    type: String, 
    enum: ['verified', 'missing', 'not_applicable'], 
    default: 'not_applicable' 
  },
  statusCode: { type: Number, default: 200 }
});

const ScanSchema = new mongoose.Schema({
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: false,
  },
  targetUrl: { type: String, required: true },
  links: [LinkSchema],
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