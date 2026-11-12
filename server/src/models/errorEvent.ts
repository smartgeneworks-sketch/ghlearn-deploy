import mongoose, { Schema } from 'mongoose';

/** Recent server errors for System Settings → Status. One record per distinct error, counted; kept 30 days. No request bodies, no secrets. */
const s = new Schema({
  fingerprint: { type: String, required: true, unique: true }, kind: { type: String, enum: ['http', 'process'], required: true },
  method: String, path: String, status: Number, name: String, message: String, stack: String, requestId: String, commit: String,
  count: { type: Number, default: 1 }, firstAt: { type: Date, default: Date.now }, lastAt: { type: Date, default: Date.now },
});
s.index({ lastAt: 1 }, { expireAfterSeconds: 30 * 86400 });
export const ErrorEvent = mongoose.model('ErrorEvent', s);
