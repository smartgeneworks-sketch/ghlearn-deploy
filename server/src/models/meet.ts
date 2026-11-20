import mongoose, { Schema } from 'mongoose';
import { MEETING_MODES, MEETING_STATUSES } from '@ghlearn/shared';
const { ObjectId } = Schema.Types;

/** Availability published by a teacher or counselor. A slot is "taken" while an active meeting references it. */
export const MeetingSlot = mongoose.model('MeetingSlot', new Schema({
  hostId: { type: ObjectId, ref: 'User', required: true, index: true }, schoolId: { type: ObjectId, ref: 'School', required: true, index: true },
  start: { type: Date, required: true }, end: { type: Date, required: true }, modes: { type: [String], enum: MEETING_MODES, default: ['in_person', 'online'] },
  location: String, link: String,
}, { timestamps: true }).index({ hostId: 1, start: 1 }));

/** Statuses pending | awaiting_student | confirmed hold the time (active=true); declined | cancelled release it. */
const meetingSchema = new Schema({
  studentId: { type: ObjectId, ref: 'User', required: true, index: true }, hostId: { type: ObjectId, ref: 'User', required: true, index: true },
  schoolId: { type: ObjectId, ref: 'School', required: true, index: true }, slotId: { type: ObjectId, ref: 'MeetingSlot' },
  start: { type: Date, required: true }, end: { type: Date, required: true },
  topic: { type: String, required: true }, mode: { type: String, enum: MEETING_MODES, required: true }, link: String, location: String, note: String,
  status: { type: String, enum: MEETING_STATUSES, default: 'pending', index: true }, active: { type: Boolean, default: true },
  history: [{ at: Date, by: { type: ObjectId, ref: 'User' }, action: String, note: String, start: Date, end: Date, _id: false }],
  /** Set when the one-hour reminder was sent (in-app, plus SMS for those who opted in). Cleared when the time changes. */
  reminderSentAt: Date,
}, { timestamps: true });
meetingSchema.index({ hostId: 1, start: 1 }); meetingSchema.index({ studentId: 1, start: 1 });
/** DB-level guard against double-booking the same slot (two concurrent requests). */
meetingSchema.index({ slotId: 1 }, { unique: true, partialFilterExpression: { active: true, slotId: { $exists: true } } });
export const Meeting = mongoose.model('Meeting', meetingSchema);
