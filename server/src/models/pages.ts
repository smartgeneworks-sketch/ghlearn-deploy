import mongoose, { Schema } from 'mongoose';
import { PAGE_KINDS, PAGE_STATUSES, PAGE_AUDIENCES } from '@ghlearn/shared/src/pages';

const pageSchema = new Schema({
  slug: { type: String, required: true, unique: true }, title: { type: String, required: true },
  kind: { type: String, enum: PAGE_KINDS, required: true, index: true }, audience: { type: String, enum: PAGE_AUDIENCES, default: 'everyone' },
  summary: { type: String, default: '' }, body: { type: String, default: '' }, order: { type: Number, default: 100 },
  status: { type: String, enum: PAGE_STATUSES, default: 'draft', index: true }, reviewNote: { type: String, default: '' },
  publishedAt: Date, publishedBy: { type: Schema.Types.ObjectId, ref: 'User' }, updatedBy: { type: Schema.Types.ObjectId, ref: 'User' }, version: { type: Number, default: 1 },
}, { timestamps: true });
export const ContentPage = mongoose.model('ContentPage', pageSchema);
