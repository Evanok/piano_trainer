/**
 * Inference for a gradient-boosted tree ensemble exported from LightGBM.
 *
 * Only the prediction half is here: training happens offline (see
 * `docs/auto-grade.md`), and the result is `gradeModel.json`, a flat array
 * representation of the trees. Running it is a walk down numeric thresholds,
 * so there is no runtime dependency and nothing to keep in sync with a
 * Python process.
 */

/**
 * One tree, flattened into parallel arrays. Node `i` splits on feature `f[i]`
 * at threshold `t[i]`; `l[i]` / `r[i]` are child indices, where a negative
 * value `-k` means "leaf k - 1" in `v`.
 */
export interface FlatTree {
  f: number[]
  t: number[]
  l: number[]
  r: number[]
  v: number[]
}

export interface GradeModel {
  version: number
  /** Feature order the model was trained on; the feature vector must match it. */
  features: string[]
  /** Z-score normalisation fitted on the training split. */
  mean: number[]
  std: number[]
  trees: FlatTree[]
  clamp: [number, number]
}

function predictTree(tree: FlatTree, features: number[]): number {
  if (tree.f.length === 0) {
    return tree.v[0]
  }
  let node = 0
  for (;;) {
    // LightGBM numeric splits send `value <= threshold` to the left child.
    const next = features[tree.f[node]] <= tree.t[node] ? tree.l[node] : tree.r[node]
    if (next < 0) {
      return tree.v[-next - 1]
    }
    node = next
  }
}

/** Raw (unclamped, unrounded) ensemble output for one already-raw feature vector. */
export function predictGrade(model: GradeModel, rawFeatures: number[]): number {
  if (rawFeatures.length !== model.features.length) {
    throw new Error(`expected ${model.features.length} features, got ${rawFeatures.length}`)
  }
  const normalised = rawFeatures.map((value, i) => (value - model.mean[i]) / model.std[i])
  let total = 0
  for (const tree of model.trees) {
    total += predictTree(tree, normalised)
  }
  return total
}
