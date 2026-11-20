const err = { $ref: '#/components/responses/Error' };
const op = (summary: string, tag: string, extra: Record<string, unknown> = {}) => ({ summary, tags: [tag], responses: { 200: { description: 'OK' }, 401: err, 403: err, 422: err }, ...extra });
const body = (ref: string) => ({ requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } } } });
const configPaths: Record<string, unknown> = {};
for (const [p, s] of [['schools', 'School'], ['levels', 'Level'], ['academic-years', 'AcademicYear'], ['programmes', 'Programme'], ['subjects', 'Subject'], ['combinations', 'Combination']] as const) {
  configPaths[`/api/config/${p}`] = { get: op(`List ${p}`, 'Config'), post: op(`Create ${p}`, 'Config', body(s)) };
  configPaths[`/api/config/${p}/{id}`] = { patch: op(`Update ${p}`, 'Config', body(s)), delete: op(`Delete ${p} (super admin)`, 'Config') };
}
export const openapi = {
  openapi: '3.1.0',
  info: { title: 'GH Learn API', version: '0.1.0', description: 'Auth uses httpOnly cookies gl_at (access, 15 min) and gl_rt (refresh, rotated). Errors: {error:{code,message,details,requestId}}.' },
  paths: {
    '/api/health': { get: op('Health + AI provider status', 'System') },
    '/api/auth/register': { post: op('Register (always creates a student)', 'Auth', body('Register')) },
    '/api/auth/login': { post: op('Log in; sets cookies. Locks after 8 failures for 15 min', 'Auth', body('Login')) },
    '/api/auth/refresh': { post: op('Rotate refresh token (reuse revokes family)', 'Auth') },
    '/api/auth/logout': { post: op('Revoke refresh token and clear cookies', 'Auth') },
    '/api/auth/me': { get: op('Current user', 'Auth') },
    ...configPaths,
    '/api/onboarding': { post: op('Student onboarding: region, school name (free text, linked if it matches), level, Learning Area, core + elective subjects (no limits)', 'Student', body('Onboarding')) },
    '/api/me/profile': { get: op('Student profile', 'Student') },
    '/api/me/subjects': { get: op('Authorised subjects only', 'Student') },
    '/api/subjects/{subjectId}/resources': { get: op('Resources for a subject (403 if not enrolled; students see published only)', 'Learning') },
    '/api/resources/{id}': { get: op('One resource (subject access enforced)', 'Learning') },
    '/api/admin/users': { get: op('List users (school-scoped for school admins)', 'Admin') },
    '/api/admin/users/{id}': { patch: op('Change roles/status/school', 'Admin') },
    '/api/admin/teacher-assignments': { post: op('Assign teacher to subject', 'Admin') },
    '/api/admin/students/{userId}/subjects': { patch: op('Change a student\'s subjects', 'Admin') },
    '/api/auth/csrf': { get: op('Issue CSRF token (send as X-CSRF-Token on unsafe requests)', 'Auth') },
    '/api/documents': { get: op('List documents (filters q, processingStatus, mappingStatus, approvalStatus, docType, subjectId, duplicates=include|only, page)', 'Documents') },
    '/api/documents/stats': { get: op('Counts by status', 'Documents') },
    '/api/documents/upload': { post: op('Upload PDF (multipart: file, title?, subjectId?, docType?, yearOfStudy?, allowDuplicate?). 409 DUPLICATE_DOCUMENT, 413, 415, 422 ENCRYPTED_PDF', 'Documents') },
    '/api/documents/{id}': { get: op('Detail incl. processing report, nodes, jobs, duplicates', 'Documents'), patch: op('Metadata/mapping (documents:map); approvalStatus (content:review)', 'Documents') },
    '/api/documents/{id}/process': { post: op('Queue (re)processing; 409 if already queued', 'Documents') },
    '/api/documents/{id}/pages': { get: op('Extracted page text (from,to)', 'Documents') },
    '/api/documents/{id}/chunks': { get: op('Chunks (page)', 'Documents') },
    '/api/documents/{id}/file': { get: op('Original PDF (staff only)', 'Documents') },
    '/api/documents/{id}/nodes': { post: op('Add manual structure node', 'Documents') },
    '/api/documents/{id}/nodes/{nodeId}': { patch: op('Edit/verify node', 'Documents'), delete: op('Remove node', 'Documents') },
    '/api/documents/jobs/{jobId}': { get: op('Job status/progress/errors', 'Documents') },
    '/api/admin/teacher-assignments/{id}': { delete: op('Remove assignment', 'Admin') },
    '/api/admin/students/{userId}/profile': { get: op('Student profile', 'Admin') },
    '/api/admin/audit': { get: op('Audit log', 'Admin') },
  },
  components: {
    responses: { Error: { description: 'Error', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {}, requestId: { type: 'string' } } } } } } } } },
    schemas: {
      Register: { type: 'object', required: ['fullName', 'email', 'password', 'acceptTerms'], properties: { fullName: { type: 'string' }, email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 10 }, dateOfBirth: { type: 'string', format: 'date' }, guardianEmail: { type: 'string' }, acceptTerms: { const: true } } },
      Login: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } },
      Onboarding: { type: 'object', required: ['region', 'schoolName', 'levelId', 'yearOfStudy'], properties: { region: { type: 'string', description: 'One of the 16 regions of Ghana' }, schoolName: { type: 'string' }, schoolId: { type: 'string' }, levelId: { type: 'string' }, programmeId: { type: 'string', description: 'Learning Area' }, yearOfStudy: { type: 'integer' }, coreSubjectIds: { type: 'array', items: { type: 'string' } }, electiveSubjectIds: { type: 'array', items: { type: 'string' } } } },
      School: { type: 'object', properties: { name: { type: 'string' }, code: { type: 'string' }, region: { type: 'string' }, levelKinds: { type: 'array', items: { enum: ['SHS', 'JHS'] } } } },
      Level: { type: 'object', properties: { kind: { enum: ['SHS', 'JHS'] }, name: { type: 'string' }, years: { type: 'integer' } } },
      AcademicYear: { type: 'object', properties: { label: { type: 'string', example: '2026/2027' }, startDate: { type: 'string' }, endDate: { type: 'string' } } },
      Programme: { type: 'object', description: 'Learning Area (stored as programme)', properties: { name: { type: 'string' }, code: { type: 'string' }, levelId: { type: 'string' } } },
      Subject: { type: 'object', properties: { name: { type: 'string' }, code: { type: 'string' }, levelId: { type: 'string' }, category: { enum: ['core', 'elective'] }, programmeIds: { type: 'array', items: { type: 'string' } } } },
      Combination: { type: 'object', properties: { name: { type: 'string' }, programmeId: { type: 'string' }, subjectIds: { type: 'array', items: { type: 'string' } }, minElectives: { type: 'integer' }, maxElectives: { type: 'integer' } } },
    },
  },
};
