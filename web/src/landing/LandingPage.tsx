import { PublicLayout } from './PublicShell';
import { HeroSection } from './Hero';
import { LearningSearch, SubjectExplorer } from './Discovery';
import { LiveSessionsSection } from './LiveSessions';
import { HowItWorks, AITutorShowcase, IllustratedLessonPreview, PracticeAndGames, PersonalizedLearningShowcase, TeacherFeatures, SchoolFeatures, FeatureGrid, TestimonialsOrLearningPrinciples, FAQAccordion, FinalCTA } from './Sections';
/** The public landing page (docs/LANDING_SPEC.md §5, sections in order). */
export function LandingPage() {
  return <PublicLayout>
    <HeroSection /><LearningSearch /><SubjectExplorer /><HowItWorks /><AITutorShowcase /><IllustratedLessonPreview /><PracticeAndGames />
    <PersonalizedLearningShowcase /><LiveSessionsSection /><TeacherFeatures /><SchoolFeatures /><FeatureGrid /><TestimonialsOrLearningPrinciples /><FAQAccordion /><FinalCTA />
  </PublicLayout>;
}
export default LandingPage;
