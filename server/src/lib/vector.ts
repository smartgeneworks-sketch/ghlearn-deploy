import mongoose from 'mongoose';
const { Binary } = mongoose.mongo;
/**
 * Embeddings are stored as BSON vectors (binData subtype 9, float32): 768 dims take ~3 KB instead of ~10 KB for an
 * array of doubles, which is what lets the full learner-manual library fit in Atlas M0's 512 MB. Atlas Vector Search
 * indexes both forms, so passages embedded before this change (number arrays) keep working.
 */
export const toStoredVector = (v: number[]) => Binary.fromFloat32Array(Float32Array.from(v));
export function fromStoredVector(x: unknown): number[] | null {
  if (Array.isArray(x)) return x as number[];
  if (x instanceof Binary && x.sub_type === Binary.SUBTYPE_VECTOR) return Array.from(x.toFloat32Array());
  return null;
}
