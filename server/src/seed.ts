/**
 * SAMPLE DATA ONLY. Every record is flagged isSample:true and names carry "(Sample)".
 * Subject list reflects common SHS offerings but is NOT an authoritative statement of the official curriculum.
 */
import { School, AcademicLevel, AcademicYear, Programme, Subject, SubjectCombination, User, StudentProfile, TeacherAssignment, CurriculumDocument, LearningResource, CurriculumVersion } from './models/index.js';
import { hashPassword } from './services/auth.js';
import { schoolNameKey } from './services/schools.js';

export async function seed(password = process.env.SEED_PASSWORD ?? 'SamplePass2026') {
  const s = { isSample: true };
  const shs = await AcademicLevel.create({ kind: 'SHS', name: 'Senior High School', years: 3, ...s });
  await AcademicLevel.create({ kind: 'JHS', name: 'Junior High School', years: 3, enabled: false, ...s });
  await AcademicYear.create({ label: '2026/2027', startDate: '2026-09-01', endDate: '2027-07-31', current: true, ...s });
  const ver = await CurriculumVersion.create({ code: 'SHS 2023+', name: 'SHS curriculum 2023 (sample)', levelId: shs._id, status: 'active', activatedAt: new Date(), ...s });
  const school = await School.create({ name: 'Sample Academy (Sample)', code: 'SAMPLE-01', region: 'Greater Accra', levelKinds: ['SHS'], ...s });
  const sci = await Programme.create({ name: 'General Science', code: 'GSCI', levelId: shs._id, ...s });
  const bus = await Programme.create({ name: 'Business', code: 'BUS', levelId: shs._id, ...s });
  const core = await Subject.insertMany(['English Language:ENG', 'Mathematics:MATH', 'General Science:S-GENSCI', 'Social Studies:SOC'].map((x) => {
    const [name, code] = x.split(':'); return { name, code, levelId: shs._id, category: 'core', curriculumVersion: 'SHS 2023+', curriculumVersionId: ver._id, ...s };
  }));
  const mk = (name: string, code: string, programmeIds: any[]) => Subject.create({ name, code, levelId: shs._id, category: 'elective', programmeIds, curriculumVersion: 'SHS 2023+', curriculumVersionId: ver._id, ...s });
  const bio = await mk('Biology', 'BIO', [sci._id]); const chem = await mk('Chemistry', 'CHEM', [sci._id]);
  const phy = await mk('Physics', 'PHY', [sci._id]); const emath = await mk('Additional Mathematics', 'AMATH', [sci._id, bus._id]);
  const econ = await mk('Economics', 'ECON', [bus._id]); const acc = await mk('Financial Accounting', 'FACC', [bus._id]);
  const sciCombo = await SubjectCombination.create({ name: 'Pure Science (Bio/Chem/Phy)', programmeId: sci._id, subjectIds: [bio._id, chem._id, phy._id], minElectives: 3, maxElectives: 4, ...s });
  const busCombo = await SubjectCombination.create({ name: 'Accounting (Econ/FAcc)', programmeId: bus._id, subjectIds: [econ._id, acc._id], minElectives: 2, maxElectives: 4, ...s });

  const pw = await hashPassword(password);
  const u = (email: string, fullName: string, roles: any[], schoolId?: any) => User.create({ email, fullName, roles, schoolId, passwordHash: pw, ...s });
  const superAdmin = await u('super@sample.ghlearn.test', 'Super Admin (Sample)', ['super_admin']);
  const schoolAdmin = await u('admin@sample.ghlearn.test', 'School Admin (Sample)', ['school_admin'], school._id);
  const editor = await u('editor@sample.ghlearn.test', 'Curriculum Editor (Sample)', ['curriculum_editor']);
  const teacher = await u('teacher@sample.ghlearn.test', 'Biology Teacher (Sample)', ['teacher'], school._id);
  const counselor = await u('counselor@sample.ghlearn.test', 'School Counselor (Sample)', ['counselor'], school._id);
  const curriculumAdmin = await u('curriculum@sample.ghlearn.test', 'Curriculum Admin (Sample)', ['curriculum_admin']);
  const operator = await u('operator@sample.ghlearn.test', 'System Operator (Sample)', ['system_operator']);
  const ama = await u('ama@sample.ghlearn.test', 'Ama Mensah (Sample Student)', ['student'], school._id);
  const kofi = await u('kofi@sample.ghlearn.test', 'Kofi Boateng (Sample Student)', ['student'], school._id);
  const coreIds = core.map((c) => c._id);
  const sp = { schoolName: school.name, schoolNameKey: schoolNameKey(school.name), region: 'Greater Accra' };
  await StudentProfile.create({ ...sp, userId: ama._id, schoolId: school._id, levelId: shs._id, programmeId: sci._id, combinationId: sciCombo._id, yearOfStudy: 1, subjectIds: [...coreIds, bio._id, chem._id, phy._id], onboardedAt: new Date(), ...s });
  await StudentProfile.create({ ...sp, userId: kofi._id, schoolId: school._id, levelId: shs._id, programmeId: bus._id, combinationId: busCombo._id, yearOfStudy: 1, subjectIds: [...coreIds, econ._id, acc._id], onboardedAt: new Date(), ...s });
  await TeacherAssignment.create({ teacherId: teacher._id, schoolId: school._id, subjectId: bio._id, classGroup: '1 Science A', yearOfStudy: 1, ...s });

  const doc = await CurriculumDocument.create({ title: 'SAMPLE: Biology Year 1 Learner Material, Section 1', subjectId: bio._id, levelId: shs._id, yearOfStudy: 1, curriculumVersionId: ver._id, curriculumVersion: ver.code, fileKind: 'pdf',
    storage: { provider: 'remote', key: 'sample' },
    provenance: { uploadedVia: 'seed', sourceUrl: 'https://curriculumresources.edu.gh/wp-content/uploads/2024/11/LM-Biology-section-1-LVersion.pdf', publisher: 'NaCCA / Ministry of Education (as listed on source site)', driveFileId: '1EhX4WVYZdnfefA-NgPLRE0YDOouoBCBO', retrievedAt: new Date('2026-10-01') },
    approvalStatus: 'unverified', uploadedBy: editor._id, ...s });
  const res = await LearningResource.insertMany([
    { title: 'SAMPLE: Cells, the basic unit of life', kind: 'notes', subjectId: bio._id, yearOfStudy: 1, strand: 'Sample strand', topic: 'Cells', sourceDocumentId: doc._id, status: 'published', body: { markdown: '**Sample content** for development. Not generated from the official manual.' }, ...s },
    { title: 'SAMPLE: Draft quiz on cell organelles', kind: 'quiz', subjectId: bio._id, yearOfStudy: 1, topic: 'Cells', sourceDocumentId: doc._id, status: 'draft', ...s },
    { title: 'SAMPLE: Demand and supply basics', kind: 'notes', subjectId: econ._id, yearOfStudy: 1, topic: 'Demand and supply', status: 'published', body: { markdown: '**Sample content** for development.' }, ...s },
  ]);
  { const { backfillRoleAssignments } = await import('./services/roles.js'); await backfillRoleAssignments(); }
  return { ver, shs, school, sci, bus, core, bio, chem, phy, emath, econ, acc, sciCombo, busCombo, users: { superAdmin, schoolAdmin, editor, teacher, counselor, curriculumAdmin, operator, ama, kofi }, doc, resources: res, password };
}
