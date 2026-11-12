/** §12 statuses as shown to people (in_review is "Awaiting review"). */
export const LESSON_STATUS_LABEL: Record<string, string> = {
  generating: 'Generating', draft: 'Draft', in_review: 'Awaiting review', changes_requested: 'Changes requested', resubmitted: 'Resubmitted',
  approved: 'Approved', published: 'Published', archived: 'Archived', failed: 'Generation failed', rejected: 'Rejected',
};
export const LESSON_STATUSES = Object.keys(LESSON_STATUS_LABEL);
export const REVIEW_ACTION_LABEL: Record<string, string> = {
  submit: 'Submitted for review', resubmit: 'Resubmitted', approve: 'Approved', request_changes: 'Requested changes', publish: 'Published', unpublish: 'Unpublished',
  comment: 'Commented', create: 'Created', edit: 'Edited', reject: 'Rejected', restore: 'Restored', verify_key: 'Verified answer key', assign: 'Assigned reviewer', unassign: 'Removed reviewer', archive: 'Archived', retry: 'Retried generation', cancel: 'Cancelled generation',
};
const TONE: Record<string, string> = { published: 'bg-brand-50 text-brand-900', approved: 'bg-brand-50 text-brand-900', failed: 'bg-red-50 text-red-800', changes_requested: 'bg-red-50 text-red-800', rejected: 'bg-red-50 text-red-800', archived: 'bg-slate-100 text-slate-700' };
export const statusTone = (v: string) => TONE[v] ?? 'bg-amber-50 text-amber-900';
/** Question bank statuses (§13): `published` is shown as "Approved (in bank)". */
export const QUESTION_STATUS_LABEL: Record<string, string> = { draft: 'Draft', in_review: 'Awaiting review', changes_requested: 'Changes requested', resubmitted: 'Resubmitted', published: 'Approved (in bank)', rejected: 'Rejected', archived: 'Archived' };
export const GAME_STATUS_LABEL: Record<string, string> = { draft: 'Draft', in_review: 'Awaiting review', changes_requested: 'Changes requested', resubmitted: 'Resubmitted', approved: 'Approved', published: 'Published', archived: 'Archived' };
