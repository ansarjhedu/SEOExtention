//els/DiscoveredLink.js

import mongoose from 'mongoose';

const DiscoveredLinkSchema = new mongoose.Schema({
  scanId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Scan', 
    required: true,
    index: true // Indexing this makes querying links for a specific scan ultra-fast
  },
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
  statusCode: { type: Number, default: 200 },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model('DiscoveredLink', DiscoveredLinkSchema);