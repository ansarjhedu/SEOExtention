import mongoose from 'mongoose';

const LinkSchema = new mongoose.Schema({
  url: { type: String, required: true },
  text: { type: String, default: '' },
  type: { type: String, enum: ['internal', 'external'], required: true },
  category: { type: String, default: 'other' },
  statusCode: { type: Number, default: 200 } // Track HTTP status (e.g., 200, 404, 500)
});

const ScanSchema = new mongoose.Schema({
  projectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: false,
  },
  targetUrl: {
    type: String,
    required: true,
  },
  links: [LinkSchema],
  totalFound: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  }
});

export default mongoose.model('Scan', ScanSchema);