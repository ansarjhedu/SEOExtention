import mongoose from 'mongoose';

export const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000, // Fail and print error if connection takes more than 5s
    });
    console.log(`MongoDB Connected successfully to: ${conn.connection.host}`);
  } catch (error) {
    console.error(`MongoDB connection failure: ${error.message}`);
    console.log('Please ensure MongoDB is installed and running on your local machine.');
  }
};