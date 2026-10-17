export const Q = (type: string, data: any, extra: any = {}) => ({ _id: 'x', type, stem: 'A question stem here', topic: 'Cells', marks: 1, explanation: 'Because.', citations: [{}], data, ...extra });
export const SAMPLES: Record<string, any> = {
  mcq: Q('mcq', { options: ['Nucleus', 'Membrane', 'Wall', 'Vacuole'], correctIndex: 1 }),
  true_false: Q('true_false', { answer: false }),
  short_answer: Q('short_answer', { acceptedAnswers: ['photosynthesis'] }),
  gap_fill: Q('gap_fill', { text: 'Plants make {{1}} using {{2}}.', gaps: [{ accepted: ['glucose', 'sugar'] }, { accepted: ['sunlight', 'light'] }] }),
  matching: Q('matching', { pairs: [{ left: 'Nucleus', right: 'Controls the cell' }, { left: 'Mitochondrion', right: 'Respiration' }, { left: 'Ribosome', right: 'Makes proteins' }] }),
  ordering: Q('ordering', { items: ['Evaporation', 'Condensation', 'Precipitation', 'Collection'] }),
  diagram_labelling: Q('diagram_labelling', { centre: 'Plant cell', labels: [{ accepted: ['cell wall'] }, { accepted: ['nucleus'] }, { accepted: ['chloroplast'] }], alt: 'A plant cell' }),
  numerical: Q('numerical', { value: 9.8, tolerance: 2, toleranceType: 'pct', unit: 'm/s²', requireUnit: true }, { marks: 2 }),
  structured: Q('structured', { parts: [{ prompt: 'Name the organelle', type: 'short_answer', acceptedAnswers: ['nucleus'], marks: 1 }, { prompt: 'Pick one', type: 'mcq', options: ['a', 'b'], correctIndex: 0, marks: 1 }] }, { marks: 2 }),
  essay: Q('essay', { guidance: 'Mention X', wordLimit: 300 }, { rubric: [{ criterion: 'Knowledge', maxMarks: 4 }, { criterion: 'Communication', maxMarks: 2 }], marks: 6 }),
  case_study: Q('case_study', { scenario: 'Ama sells kenkey at Makola market and notices her customers buy more when prices fall on Fridays.', parts: [{ prompt: 'What law?', type: 'mcq', options: ['Demand', 'Supply'], correctIndex: 0, marks: 1 },
    { prompt: 'Explain', type: 'essay', rubric: [{ criterion: 'Reasoning', maxMarks: 3 }] }] }, { marks: 4 }),
};
