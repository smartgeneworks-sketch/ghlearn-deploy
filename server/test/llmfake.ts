import { testLlm, type LlmRequest } from '../src/services/ai.js';
import { config } from '../src/config.js';
/** Scripted model for tests: produces a well-formed lesson for whatever section keys are requested. */
export function lessonResponder(over: (keys: string[], req: LlmRequest) => any = () => ({})) {
  return (req: LlmRequest) => {
    const u = req.messages.at(-1)!.content;
    const keys = JSON.parse(u.match(/"key": one of (\[[^\]]*\])/)![1]) as string[];
    const sec = (key: string): any => {
      const base = { key, content: `Section ${key}: The cell membrane controls what enters and leaves the cell. Organelles inside the cell perform functions.`, citations: ['S1'], sourceSupport: 'source', data: {} };
      const data: Record<string, any> = {
        A: { subtopic: 'Organelles', indicators: ['Describe cell structure'], estimatedMinutes: 60 },
        B: { objectives: ['State the functions of the cell membrane', 'Understand cells'] },
        C: { diagnostic: [{ question: 'What is a living thing?', answer: 'Something that carries out life processes' }] },
        E: { terms: [{ term: 'Cell', definition: 'Basic unit of life' }], examples: [{ problem: 'Name the outer layer', steps: ['Recall'], answer: 'Cell membrane' }], misconceptions: [{ misconception: 'Cells are visible', correction: 'Most need a microscope' }] },
        F: { diagrams: [{ kind: 'flow', title: 'Light <script>alert(1)</script> path', caption: 'Path of light', steps: ['Mirror', 'Lens', 'Eye'] }, { kind: 'pie', title: 'bad' }] },
        G: { activities: [{ title: 'Onion cells', grouping: 'pairs', steps: ['Observe the slide', 'Draw'] }] },
        H: { practicals: [{ title: 'Model cell', materials: ['Clear bag', 'Jelly'], instructions: ['Fill bag'], expectedOutputs: 'A model', safety: ['Wash hands'], criteria: ['Labels correct'] }] },
        I: { questions: [0, 1, 2].map((i) => ({ question: `Q${i}`, options: ['a', 'b', 'c', 'd'], correctIndex: 1, explanation: 'because' })), exercises: [{ question: 'What controls entry?', type: 'short_answer', answer: 'Cell membrane', explanation: 'It is selectively permeable', difficulty: 'easy' }], reflection: ['What surprised you?'] },
        J: { flashcards: [{ front: 'Cell', back: 'Unit of life' }], conceptMap: { root: 'Cell', children: [{ label: 'Membrane' }, { label: 'Nucleus', children: ['DNA'] }] } },
      };
      return { ...base, data: data[key] ?? {}, ...(key === 'C' ? { citations: [], sourceSupport: 'general' } : {}), ...(key === 'D' ? { citations: ['S1', 'S99'] } : {}) };
    };
    const out = { title: 'Cells and organelles', sections: keys.map(sec) };
    return JSON.stringify(over(keys, req) ?? out) === '{}' ? JSON.stringify(out) : JSON.stringify({ ...out, ...over(keys, req) });
  };
}
export function useTestLlm() { (config as any).LLM_PROVIDER = 'test-llm'; testLlm.calls.length = 0; testLlm.fail = 0; }
export function noLlm() { (config as any).LLM_PROVIDER = ''; }
export { testLlm };
